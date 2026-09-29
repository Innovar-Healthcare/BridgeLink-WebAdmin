# Declarative Plugins (`webadmin.json`)

A declarative plugin gives your BridgeLink extension a Web Administrator UI without
writing any client code. You add one JSON file to your extension package, and the Web
Administrator draws the screens with its own built-in components. There is no rebuild,
no redistribution, and no Innovar review step.

This page covers when to use one, how to package, validate, preview, and install it, and
the licensing terms. The full grammar is in
[DECLARATIVE-REFERENCE.md](./DECLARATIVE-REFERENCE.md).

---

## When to use a declarative plugin

Use a declarative plugin when your extension's UI is a **form over its properties**. That
covers most extensions: a connector's host, port, and credentials; a settings tab of
toggles and text fields; a data type's options; a transformer step's fields.

Use a [compiled-in plugin](./OVERVIEW.md) when you need something a form cannot express:
custom rendering, a bespoke tree or table, a full page, or any interaction beyond a form.

The manifest will never support scripts or expressions. When a form is not enough, the
answer is an action button that calls your extension's own REST endpoint, or a
compiled-in plugin.

---

## How it works

1. Your engine extension zip carries a `webadmin/webadmin.json` file.
2. When an administrator signs in, the Web Administrator asks the BridgeLink server for
   the manifests of every installed **and enabled** extension.
3. It validates each manifest strictly. A manifest that fails is skipped, and the reason
   is shown on the **Extensions** page.
4. It renders every declared panel with its own components, labelled with your
   extension's name.

No plugin code runs in the browser or in the Web Administrator server. Every string in
your manifest is shown as plain text. Disabling your extension on the server removes its
UI.

---

## Requirements

| What you declare                                                                | Web Administrator | BridgeLink server |
| ------------------------------------------------------------------------------- | ----------------- | ----------------- |
| Connector panels, settings panels (`manifestVersion` 1)                         | 26.6.0 or newer   | 26.6.0 or newer   |
| Transmission modes, connector sections, transformer steps (`manifestVersion` 2) | 26.9.0 or newer   | 26.6.0 or newer   |
| Data types (`manifestVersion` 2)                                                | 26.9.0 or newer   | 26.9.0 or newer   |
| Collection fields: maps, lists, tables (`manifestVersion` 3)                    | 26.9.0 or newer   | 26.6.0 or newer   |
| Manifest Preview page                                                           | 26.9.0 or newer   | any               |

An older Web Administrator skips a manifest it cannot read and shows why. It never
renders it wrong. If your manifest relies on a newer build, you can set
`minWebAdminVersion` to say so (see the reference).

Your extension's server half must still be installed for channels that use it to save
and deploy. The manifest only describes the UI.

---

## Packaging

Add one file to your extension zip. Nothing else about packaging changes:

```
my-extension.zip
├── plugin.xml / source.xml / destination.xml   (existing engine metadata)
├── *-server.jar / *-shared.jar                 (existing engine code)
└── webadmin/
    └── webadmin.json                           (the declarative UI manifest)
```

Two values come from your existing engine metadata, not from the manifest:

- **Name:** the `<name>` element of your `plugin.xml` (or connector metadata).
- **Path:** the `path` attribute on its root element, for example
  `<pluginMetaData path="acme-smtp">`. It is also your extension's install folder.

The path matters. Action buttons may only call endpoints under `/extensions/<path>/`, so
a manifest written for the wrong path fails validation.

---

## A complete example

This manifest adds a connector panel and a settings tab for a fictional **Acme SMTP**
extension installed at path `acme-smtp`. It is valid as written:

```json
{
  "manifestVersion": 1,
  "connectorPanels": [
    {
      "mode": "destination",
      "transportName": "Acme SMTP Sender",
      "sections": [
        {
          "title": "Connection",
          "fields": [
            {
              "key": "smtpHost",
              "type": "text",
              "label": "SMTP Host",
              "tooltip": "Hostname or IP address of the SMTP server.",
              "validation": [{ "rule": "required" }]
            },
            {
              "key": "smtpPort",
              "type": "number",
              "label": "SMTP Port",
              "validation": [
                { "rule": "required" },
                { "rule": "min", "value": 1 },
                { "rule": "max", "value": 65535 }
              ]
            },
            {
              "key": "encryption",
              "type": "select",
              "label": "Encryption",
              "options": [
                { "value": "none", "label": "None" },
                { "value": "TLS", "label": "STARTTLS" },
                { "value": "SSL", "label": "SSL" }
              ]
            },
            {
              "key": "username",
              "type": "text",
              "label": "Username",
              "visibleWhen": { "field": "encryption", "op": "ne", "value": "none" }
            },
            {
              "key": "password",
              "type": "secret",
              "label": "Password",
              "visibleWhen": { "field": "encryption", "op": "ne", "value": "none" }
            }
          ]
        }
      ],
      "actions": [
        {
          "label": "Test Connection",
          "endpoint": "/extensions/acme-smtp/test-connection",
          "method": "POST",
          "confirm": "Send a test connection request to the configured SMTP server?"
        }
      ]
    }
  ],
  "settingsPanels": [
    {
      "tabKey": "acme-smtp",
      "tabLabel": "Acme SMTP",
      "sections": [
        {
          "title": "Defaults",
          "fields": [
            {
              "key": "defaultFrom",
              "type": "text",
              "label": "Default From Address",
              "defaultValue": "noreply@example.com"
            },
            {
              "key": "auditEnabled",
              "type": "checkbox",
              "label": "Audit Outbound Mail",
              "defaultValue": "false"
            }
          ]
        }
      ]
    }
  ]
}
```

What each part does:

- **`connectorPanels`** adds "Acme SMTP Sender" to the destination Connector Type list.
  `transportName` must match the connector your server jar registers, or channel save
  fails. Each field `key` is a child element of the connector's `<properties>` XML. The
  server supplies the defaults, so connector fields do not set `defaultValue`.
- **`settingsPanels`** adds an "Acme SMTP" tab under Settings. Its field keys are your
  extension's stored properties, and they may set `defaultValue`.
- **`visibleWhen`** hides the credentials until encryption is turned on.
- **`actions`** adds a button that calls your own endpoint on the administrator's
  session, after a confirmation prompt.

Every other contribution kind and field type is in
[DECLARATIVE-REFERENCE.md](./DECLARATIVE-REFERENCE.md).

---

## Validate your manifest

The command-line validator runs the same checks the Web Administrator runs at load time.
Put it in your build so a broken manifest fails there, not on a customer's server.

It ships in the [Web Administrator source repository](https://github.com/Innovar-Healthcare/BridgeLink-WebAdmin).
From a checkout, after `npm install`:

```bash
npm run validate:manifest -- path/to/my-extension --name "Acme SMTP Connector" --path acme-smtp
```

The target can be your extension folder (it finds `webadmin/webadmin.json`) or the JSON
file itself. Pass `--path` with your real extension path, because action endpoints are
checked against it. Without it, the folder name is used.

On success it prints `OK` and a count of what was declared. On failure it exits non-zero
and names the exact spot, for example
`manifest.connectorPanels[0].sections[0].fields[2].validation[0].pattern: ...`.

The validator is only as new as your checkout. Validate against the release your
customers run.

---

## Preview your manifest

The **Manifest Preview** page draws a manifest with the real Web Administrator
components while you edit it. Open **Extensions** and choose **Manifest Preview**.

- Paste or type your manifest on the left. The preview updates as you type, and errors
  appear as a banner without losing what is already drawn.
- Set the extension name and path so action endpoints are checked as they will be on the
  server.
- Use **Validate** on each panel to see your field rules fire.
- **Examples** loads working manifests for every contribution kind.
- **Download webadmin/** saves a zip holding `webadmin/webadmin.json`, ready to merge into
  your extension zip.
- The reference pane lists which field types each kind allows, and the size limits.

The preview registers nothing and calls none of your endpoints. It cannot catch problems
that only the server sees, such as a field key your Java class does not have. Test on a
real server before you ship.

**Editor autocomplete** lives on this page. You may keep a `$schema` line in your
manifest; the Web Administrator accepts and ignores it.

---

## Install and check it loaded

Install your extension zip the same way you install any BridgeLink extension, then sign
in to the Web Administrator again. Open **Extensions** and look at the **Web
Contributions** card:

- **Loaded** means every declared contribution is live.
- **Partially loaded (N of M contributions)** means some were dropped, and each has its
  reason. Two common causes: a name that collides with a built-in or another extension
  (the first one registered wins, and built-ins always come first), or a data type on a
  server older than 26.9.0. A manifest that declares only data types shows as Skipped on
  such a server.
- **Skipped** means the whole manifest was rejected. The reason names the first failure's
  location.

If your extension is not listed, check that it is enabled on the server.

---

## Licensing

The Web Administrator is licensed under the Business Source License with an Additional
Use Grant (see [LICENSE](../../../LICENSE)). Clause (3) of that grant permits
"development, use, distribution, and commercial licensing of extensions or modifications
that interoperate with the Licensed Work".

Innovar's position on declarative plugins:

> Authoring and distributing a declarative plugin manifest (`webadmin.json`) does not
> copy, modify, or redistribute the BridgeLink Web Administrator. The manifest contains no
> executable code and ships as part of your BridgeLink engine extension, not as part of
> the Web Administrator. Innovar considers declarative manifests to be extensions that
> interoperate with the Licensed Work under clause (3) of the Additional Use Grant, not
> modifications of it. You do not need a separate license from Innovar to author,
> distribute, or commercially license a plugin whose Web Administrator integration
> consists only of a declarative manifest.

This covers the Web Administrator side only. Your extension's server half is governed by
the BridgeLink engine's license, as it always has been.

Innovar does not review manifest-only plugins before you ship them. Compiled-in plugins
are different: they become part of the Web Administrator build, so they go through
Innovar (see [OVERVIEW.md](./OVERVIEW.md)).
