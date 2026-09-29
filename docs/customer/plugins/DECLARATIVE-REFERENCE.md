# Declarative Plugin Reference (`webadmin.json`)

The complete grammar for a declarative plugin manifest. Start with
[DECLARATIVE-PLUGINS.md](./DECLARATIVE-PLUGINS.md) for packaging, validation, preview,
and licensing. The **Manifest Preview** page in the Web Administrator lists the same
field types and limits, generated from the validator itself.

---

## Manifest anatomy

A manifest is one JSON object. The complete Acme SMTP manifest in
[DECLARATIVE-PLUGINS.md](./DECLARATIVE-PLUGINS.md#a-complete-example) shows a connector
panel and a settings panel together. The top-level keys:

| Key                  | Required | Meaning                                                          |
| -------------------- | -------- | ---------------------------------------------------------------- |
| `manifestVersion`    | yes      | `1`, `2`, or `3`. Use the lowest version that expresses your UI. |
| `minWebAdminVersion` | no       | A dotted version floor such as `"26.9.0"`.                       |
| `$schema`            | no       | Accepted and ignored. Kept only for your own tooling.            |
| `connectorPanels`    | no       | Connector type properties panels (version 1).                    |
| `settingsPanels`     | no       | Settings tabs (version 1).                                       |
| `transmissionModes`  | no       | TCP transmission modes (version 2).                              |
| `dataTypes`          | no       | Data type properties (version 2).                                |
| `connectorSections`  | no       | Sections injected into other connectors' panels (version 2).     |
| `transformerSteps`   | no       | Filter/transformer step types (version 2).                       |

Any other key is rejected, at every level of the manifest.

The pieces, top to bottom:

- **`manifestVersion`**: a Web Administrator that does not support your version skips the
  manifest with a visible reason rather than misrendering it. Version 2 adds the four
  newer contribution kinds. A build that knows the kind name but does not implement it
  skips **that kind only**, with a reason, and loads the rest. Version 3 adds the
  collection field types, `variableToggle`, and section `presentation` (see "Collection
  fields"). Use `1` unless you need a version 2 kind or a version 3 field type.
- **`minWebAdminVersion`** (optional): older Web Administrator builds skip the whole
  manifest. From 26.9.0 on, the floor is checked before strict validation, so the reason
  names your version floor. A 26.6.0 build still skips the manifest, but its reason names
  the first key or version it does not recognize.
- **`connectorPanels[]`**: each declares a `mode` (`source` or `destination`) and a
  `transportName`. The transport name is the Connector Type dropdown entry, and it must
  match a real connector on the server, or channel save fails. Field `key`s name **direct
  child elements** of the connector's `<properties>` XML. The server supplies connector
  defaults (from your Java `ConnectorProperties` class), so connector fields must **not**
  set `defaultValue`.
- **`settingsPanels[]`**: each declares a `tabKey` (a lowercase slug: `a-z`, `0-9`, `-`)
  and a `tabLabel` for a tab under Settings. Field keys map to entries of your extension's
  `/extensions/<name>/properties` record, and **may** set `defaultValue`.
- **`sections[]`**: titled groups of fields within a panel.
- **`fields[]`**: one form control each. Every field has a `key` (starts with a letter;
  letters, digits, `.`, `_`, `-`), a `type`, and a `label`. Optional: `tooltip`,
  `placeholder`, `defaultValue`, `visibleWhen`, `enabledWhen`, `validation`.
  - Scalar types: `text`, `secret` (masked), `number`, `checkbox`, `select`, `radio`,
    `textarea`, plus `javascript` on **data type and transformer step fields only**.
  - `select` and `radio` **require** `options` (`[{ "value": "...", "label": "..." }]`).
  - `placeholder` is allowed only on `text`, `secret`, `number`, and `textarea`.
  - Every value is a string. A `checkbox` reads and writes `"true"` or `"false"`.
- **Collection field types (`manifestVersion: 3`)**: `map`, `multimap`, `stringList`,
  and `table` edit repeated structure, in every kind except transmission modes. See
  "Collection fields" below.
- **`visibleWhen` / `enabledWhen`**: a condition on another field in the same panel:
  - `{ "field": "encryption", "op": "eq", "value": "TLS" }` (or `"op": "ne"`)
  - `{ "field": "encryption", "op": "in", "values": ["TLS", "SSL"] }`
  - `{ "field": "authentication", "op": "truthy" }`
  - Combine leaf conditions with `{ "allOf": [...] }` or `{ "anyOf": [...] }`, one level
    deep. A hidden field's validation is skipped.
- **`validation[]`**: `{ "rule": "required" }`, `{ "rule": "pattern", "pattern": "..." }`
  (a regular expression, see "Regex safety"), and `{ "rule": "min" }` / `{ "rule": "max" }`
  with a `value` (number fields only). Each rule may carry a custom `message`.
- **`actions[]`**: up to four buttons per panel that call **your own** extension endpoint
  on the administrator's session. `method` is `GET` or `POST`. The `endpoint` must start
  with `/extensions/<your-path>/`, so a button can never call another extension or a core
  endpoint. The optional `confirm` text is shown as a prompt first.

## Transmission modes (`manifestVersion: 2`)

If your extension ships a server-side `TransmissionModeProvider` plugin, declare its UI
here. Your mode then appears in the TCP Listener and TCP Sender **Transmission Mode**
dropdown. Its settings render in the shared transmission mode dialog, below the standard
Start and End of Message Bytes rows.

```json
{
  "manifestVersion": 2,
  "transmissionModes": [
    {
      "name": "AcmeSyslog",
      "displayName": "Acme Syslog",
      "propertiesClass": "com.example.acme.syslog.AcmeSyslogModeProperties",
      "defaultStartBytes": "",
      "defaultEndBytes": "0A",
      "fields": [
        {
          "key": "framingMethod",
          "type": "select",
          "label": "Framing Method",
          "defaultValue": "nonTransparent",
          "options": [
            { "value": "nonTransparent", "label": "Non-Transparent (trailer byte)" },
            { "value": "octetCounting", "label": "Octet Counting" }
          ]
        },
        {
          "key": "maxMessageLength",
          "type": "number",
          "label": "Max Message Length",
          "defaultValue": "2048",
          "visibleWhen": { "field": "framingMethod", "op": "eq", "value": "octetCounting" },
          "validation": [{ "rule": "min", "value": 480, "message": "Allow at least 480 octets." }]
        }
      ]
    }
  ]
}
```

- **`name`** becomes the element's `<pluginPointName>`. It must match your server
  plugin's `getPluginPointName()`. The server finds the stream handler by this name at
  deploy time, and an unknown name fails deploy.
- **`displayName`** is the dropdown label.
- **`propertiesClass`** is written as the `class` attribute of
  `<transmissionModeProperties>`. Every field `key` becomes a text child element, and each
  must be a real member of your Java `TransmissionModeProperties` subclass. The server
  rejects unknown members when a channel is saved.
- **`defaultValue` is allowed** here, unlike connector panels. The server has no defaults
  endpoint for this element, so the Web Administrator builds it from your declared
  defaults, the same way the Java administrator's `getDefaultProperties()` does.
- **`defaultStartBytes` / `defaultEndBytes`** are uppercase hex (`^[0-9A-F]*$`, empty
  allowed). They fill the shared start and end byte rows when a user picks your mode.
- **`startBytesValidation` / `endBytesValidation`** (`manifestVersion: 3`) add rules to
  those two rows. You cannot declare them as fields, because the dialog owns them, and the
  default rule is only "valid hex, blank allowed". If your handler needs more, for example
  exactly one byte:

  ```json
  "startBytesValidation": [
    { "rule": "required", "message": "Invalid start of message byte." },
    { "rule": "pattern", "pattern": "^[0-9A-F]{1,2}$", "message": "Enter exactly one byte." }
  ]
  ```

  Each takes 1 to 8 rules, checked as if on a `text` field, so `min` and `max` are
  rejected. The standard hex rule still runs, so a value can report both messages.

- Your mode can never replace the built-in MLLP or Basic modes.

## Data types (`manifestVersion: 2`)

If your extension ships a server-side data type plugin (a `DataTypeServerPlugin` with its
`DataTypeProperties` class), declare its **Set Data Types** properties here. Your type
then appears in the inbound and outbound data type dropdowns with a properties panel.

**Requires a BridgeLink 26.9.0 server or newer.** Older servers cannot supply data type
defaults. On those, the Web Administrator drops your data types, loads the rest of your
manifest, and shows the extension as "Partially loaded" with the reason. If your manifest
declares only data types, it is shown as "Skipped" with the same reason. The server still
runs your data type in deployed channels.

```json
{
  "manifestVersion": 2,
  "dataTypes": [
    {
      "name": "AcmeDIMSE",
      "displayName": "Acme DIMSE",
      "isBinary": true,
      "propertyGroups": [
        {
          "group": "serialization",
          "fields": [
            {
              "key": "transferSyntax",
              "type": "select",
              "label": "Transfer Syntax",
              "options": [
                { "value": "implicitLittleEndian", "label": "Implicit VR Little Endian" },
                { "value": "explicitLittleEndian", "label": "Explicit VR Little Endian" }
              ]
            },
            { "key": "decodePixelData", "type": "checkbox", "label": "Decode Pixel Data" }
          ]
        },
        {
          "group": "batch",
          "fields": [
            {
              "key": "splitType",
              "type": "select",
              "label": "Split Batch By",
              "options": [
                { "value": "Association", "label": "Association" },
                { "value": "JavaScript", "label": "JavaScript" }
              ]
            },
            {
              "key": "batchScript",
              "type": "javascript",
              "label": "JavaScript",
              "visibleWhen": { "field": "splitType", "op": "eq", "value": "JavaScript" }
            }
          ]
        }
      ]
    }
  ]
}
```

- **`name`** is the data type key: your server plugin's `getPluginPointName()` and the
  channel XML `<inboundDataType>` value. Channels that use it need your server jar to save
  and deploy. The UI renders either way.
- **Defaults come from the server.** It serializes your `DataTypeProperties` class, so
  `defaultValue` is **not** allowed on data type fields, and every `class` and `version`
  attribute in the stored XML comes from the server.
- **`propertyGroups[]`** declare fields per group: `serialization`, `deserialization`,
  `batch`, `responseGeneration`, `responseValidation`. Field keys become text children of
  the group's element (`<serializationProperties>` and so on) and must be real members of
  your Java group class. **The Web Administrator decides where each group shows**, the
  same way the Java administrator does. Declare each group once.
  - Serialization: the inbound panel. It shows again on the outbound panel as Template
    Serialization.
  - Deserialization: the outbound panel.
  - Batch: source connectors only. It takes effect only when Process Batch is on.
  - Response Generation: source connectors only.
  - Response Validation: the response transformer's inbound panel only.
- **`javascript` fields** open the Web Administrator's script editor. The script is
  written by the administrator, stored like any other field, and run by the **server** at
  message time. No code travels in the manifest. Only the `required` rule applies.
- A group you do not declare still round-trips unchanged and stays editable in the XML tab.
- **`defaultAttachmentHandler`** (optional, a Java class name) fills in the channel's
  attachment handler when a source's inbound type is switched to your data type.
- **`isBinary`**: set it for opaque formats so Message Trees shows the binary note.
- Message Trees parsing, syntax highlighting, attachment viewers, and reference-panel code
  templates cannot be declared. The standard fallbacks apply.

## Connector sections (`manifestVersion: 2`)

If your extension ships a server-side `ConnectorPropertiesPlugin` (a
`ConnectorPluginProperties` subclass stored in the connector's `<pluginProperties>`, the
same pattern as HTTP Authentication and SSL), declare the section it adds to **other**
connectors' panels here.

```json
{
  "manifestVersion": 2,
  "connectorSections": [
    {
      "mode": "source",
      "name": "Acme Audit",
      "propertiesClass": "com.example.acme.audit.AcmeAuditPluginProperties",
      "appliesTo": ["HTTP Listener", "TCP Listener"],
      "sections": [
        {
          "title": "Acme Audit",
          "fields": [
            {
              "key": "auditEnabled",
              "type": "checkbox",
              "label": "Enable Auditing",
              "defaultValue": "false"
            },
            {
              "key": "auditEndpoint",
              "type": "text",
              "label": "Audit Endpoint",
              "placeholder": "audit.example.com:6514",
              "defaultValue": "",
              "visibleWhen": { "field": "auditEnabled", "op": "truthy" },
              "validation": [{ "rule": "required" }]
            },
            {
              "key": "secureChannel",
              "type": "checkbox",
              "label": "Secure Channel",
              "defaultValue": "false"
            }
          ]
        }
      ],
      "securesTransportWhen": { "field": "secureChannel", "op": "truthy" }
    }
  ]
}
```

- **`name`** must be unique within your manifest.
- **`appliesTo`** lists the transport names the section appears on (up to 16). It is a
  plain name match. Built-in connectors and other extensions' connectors both work. You
  cannot apply a section to a connector panel your own manifest declares in the same
  `mode`; put those fields in the panel instead.
- **`propertiesClass`** is your `ConnectorPluginProperties` subclass. It becomes the
  section's element under `<pluginProperties>`, and the section can touch only that
  element. The host connector's fields and other plugins' elements are out of reach. The
  classes that belong to the built-in SSL and HTTP Authentication sections are rejected.
- **Defaults come from your manifest**, so `defaultValue` is allowed. **Declare every
  member of your Java class**: an undeclared member arrives on the server as `null`.
- The Web Administrator adds your element when the connector type is switched, and on the
  first edit of an existing channel. An untouched section saves without the element, so
  your server plugin must handle that (channels created before it was installed look the
  same). Validation rules apply only once the element exists, so a `required` field never
  blocks saving a channel whose section was never touched.
- **`securesTransportWhen`** (optional) says when your section secures the transport:
  `true` (always) or a condition on your own fields. It switches the listener's URL
  preview to `https://` and marks the sender as SSL-configured.
- `javascript` fields are not allowed here.

## Transformer steps (`manifestVersion: 2`)

If your extension ships a server-side transformer step (a `Step` subclass, like Mapper or
JavaScript), declare it here. It then appears in the filter/transformer **Add** dropdown,
with its properties in the detail pane.

```json
{
  "manifestVersion": 2,
  "transformerSteps": [
    {
      "name": "Acme Note",
      "stepClass": "com.example.acme.note.AcmeNoteStep",
      "contexts": ["source", "destination"],
      "fields": [
        {
          "key": "noteVariable",
          "type": "text",
          "label": "Variable",
          "defaultValue": "note",
          "validation": [
            { "rule": "required" },
            {
              "rule": "pattern",
              "pattern": "^[A-Za-z_][A-Za-z0-9_]*$",
              "message": "Variable must be a valid identifier."
            }
          ]
        },
        {
          "key": "useCustomScript",
          "type": "checkbox",
          "label": "Use Custom Script",
          "defaultValue": "false"
        },
        {
          "key": "script",
          "type": "javascript",
          "label": "Custom Script",
          "visibleWhen": { "field": "useCustomScript", "op": "truthy" }
        }
      ]
    }
  ]
}
```

- **`name`** is the step type and its label everywhere in the editor. There is no
  separate display name. Match your server plugin's `getPluginPointName()`.
- **`stepClass`** is your `Step` subclass. It becomes the step's element in the channel's
  `<elements>` list. The built-in step classes are rejected.
- **`contexts`** says where the step is offered: `["source"]`, `["destination"]`, or both.
- **Defaults come from your manifest**, so `defaultValue` is allowed. **Declare every
  member of your Java class**: an undeclared member arrives on the server as `null`.
- **You do not write a script generator.** The server builds each step's script from its
  saved properties at deploy time. The read-only **Generated Script** tab shows a note
  saying so.
- **`javascript` fields** are allowed for a script the administrator writes and the server
  runs. `defaultValue` is not allowed on them, because a default script would be code
  shipped in the manifest.
- Maps, lists, and tables are declarable with the collection field types below. A few
  shapes still need a compiled-in plugin: a `List<Pair<String,String>>` (as in Mapper
  replacements), a `List<Integer>`, and child steps (as in Iterator).

## Collection fields (`manifestVersion: 3`)

Four field types edit repeated structure: key-value maps, string lists, and tables. They
work in connector panels, settings panels, connector sections, data types, and
transformer steps, but not in transmission modes. They take no `placeholder`, `options`, `defaultValue`, or
`validation`, and conditions may refer only to scalar fields.

A field fragment (it goes inside a section's `fields` list):

```json
{
  "key": "headers",
  "type": "map",
  "label": "Headers",
  "keyLabel": "Name",
  "valueLabel": "Value",
  "addLabel": "Add Header",
  "variableToggle": {
    "variableKey": "headersVariable",
    "useVariableKey": "isUseHeadersVariable",
    "tableLabel": "Use Table",
    "variableLabel": "Use Map"
  }
}
```

How each type is stored in the connector XML:

- **`map`**: `<headers class="linked-hash-map"><entry><string>k</string><string>v</string></entry></headers>`.
  Takes `keyLabel`, `valueLabel`, `addLabel`.
- **`multimap`** (`Map<String,List<String>>`, as in HTTP headers): each `<entry>`'s value
  is a `<list>` of `<string>`.
- **`stringList`**: `<key><string>a</string>...</key>`, with no `class` attribute. Takes
  `itemLabel` and `addLabel`.
- **`table`**: declare `rowElement` (the row's Java class name) and up to 8 `columns`
  (`{ "element": "...", "label": "...", "placeholder": "..." }`, placeholder optional).
  Stored as `<key><rowElement><col>...</col></rowElement>...</key>`. Declare every
  non-null member of the row class as a column.

Options:

- **`variableToggle`** (connector panels, settings panels, and connector sections only)
  adds a "use a channel variable instead" choice. It is backed by two sibling elements you
  name: `variableKey` (the variable name) and `useVariableKey` (the on/off flag). Name
  them exactly as your Java class does; conventions differ between connectors
  (`isUse...Variable` in SMTP, `use...Variable` in HTTP). Table content is kept while the
  variable is selected. Optional `variablePlaceholder` and `variableTooltip` apply to the
  variable input.
- **In settings panels** there is no XML. The field's rows are stored as JSON in the
  property value, and your Java side parses it: `["a","b"]` for `stringList`,
  `[["k","v"]]` for `map`, `[["k",["v1","v2"]]]` for `multimap`, and
  `[{ "col": "v" }]` for `table`. A settings `table` still declares `rowElement`, which is
  ignored.
- **Section `presentation`**: set `"presentation": "dialog"` on a section to put its
  fields behind a button that opens a dialog. Useful for a large table.

## Complexity caps

A manifest over any of these limits is skipped, and the reason names the limit.

| Limit                                               | Cap                  |
| --------------------------------------------------- | -------------------- |
| Manifest size (characters of JSON)                  | 65,536               |
| Contributions, all six kinds combined               | 8                    |
| Transports per connector section `appliesTo`        | 16                   |
| Sections per panel (data type groups: 5)            | 8                    |
| Fields per panel, across its sections               | 64                   |
| Options per field                                   | 32                   |
| Actions per panel                                   | 4                    |
| Validation rules per field                          | 8                    |
| Terms per `allOf`/`anyOf`, values per `in`          | 8                    |
| Columns per `table` field                           | 8                    |
| Label / free text / key / endpoint length           | 120 / 500 / 64 / 256 |
| Regex pattern length / length of input it may check | 256 / 4,096          |

The Manifest Preview page's reference pane lists the same limits, read from the validator.

## Regex safety

Validation `pattern`s run against user input in the administrator's browser. The
validator rejects patterns that can hang the browser on a bad input (catastrophic
backtracking) before they ever run. Two kinds are refused:

- **Nested quantifiers**: `(a+)+`, `(a*)*`, `(a{1,3})+`. A non-capturing group is fine
  (`(?:x)+`), and so is an exact count inside a repeated group (`(\d{4})+`).
- **Ambiguous alternation inside repetition**: `(a|aa)+`, `(a|ab)*`, `(?:x|xx){2,}`. An
  alternation inside a repeated group is allowed **only** when every branch is a single
  character and no two branches overlap: `(a|b)+`, `(\d|-)+`, `([0-9]|[a-f])*`.

Rewrites for common rejected patterns:

- `^(\d{1,3}\.){3}\d{1,3}$` becomes `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$`.
- `^[a-z0-9]+([-.][a-z0-9]+)*$` becomes `^[a-z0-9][a-z0-9.-]*$`.
- `(ab|cd)+` becomes `(?:ab|cd)` if one match is enough, or a character-class form.

## Security guarantees

These hold for every manifest version, and they are why the grammar looks the way it does:

1. No plugin code runs in the browser or the Web Administrator server. JSON goes in; the
   Web Administrator's own components come out.
2. Every manifest string is shown as plain text. No HTML, and no image or icon URLs.
3. Action buttons can call only your own `/extensions/<path>/` endpoints, on the
   administrator's session.
4. The server builds defaults only from the classes your own extension declares.
5. **The grammar will never gain a script or expression hook.** Anything a form cannot
   express belongs in your extension's servlet (called from an action button) or a
   compiled-in plugin.

## How the grammar evolves

The manifest language is a versioned public contract:

> New constructs are added only when a real plugin needs them. Nothing is removed or
> renamed within a major version.

Unknown keys are rejected everywhere, so any new construct inside a kind (a field type, an
operator, a key) comes with a `manifestVersion` bump. An older Web Administrator then skips
a newer manifest with a reason instead of misrendering it. New contribution kinds are the
exception: version 2 reserved their names up front, so a build that does not implement a
kind skips just that kind and loads the rest.

Write your manifest against the lowest version that expresses what you need. Set
`minWebAdminVersion` if you rely on something added in a specific build (see "Manifest
anatomy" for how 26.6.0 reports it).
