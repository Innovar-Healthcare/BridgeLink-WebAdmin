# Plugin Architecture & Extension Points

This guide explains how BridgeLink Web Administrator plugins work and catalogs
every extension point your plugin can register into. Read
[OVERVIEW.md](./OVERVIEW.md) first for the big picture, then use this as your
reference while building.

---

## How a plugin works

A Web Administrator plugin is **TypeScript/React source** that lives in its own
`plugins/<your-plugin>/` directory and **declares its contributions** to
well-defined extension points when the application starts.

Three rules define the model:

1. **One declarative manifest.** Your plugin's `index.ts` **default-exports** a
   single `definePlugin({...})` manifest describing every contribution it makes —
   before any screen renders. It performs no other module-scope side effects. The
   base application reads from its registries at render time; it never imports
   your plugin by name.

2. **Dependencies point one way.** Your plugin imports from the base app
   (`@/lib/...`, `@/components/...`, `@/app/...`). The base app never imports
   from `plugins/`. This keeps the application buildable with or without any
   given plugin.

3. **Build-time, not runtime.** Plugins compile into the application bundle when
   it is built. There is **no runtime install** — a plugin must be present in
   the source tree at build time. See [OVERVIEW.md](./OVERVIEW.md) for what this
   means for shipping your plugin. _(A declarative, no-client-code runtime model
   that lifts this for manifest-based properties editors is on the roadmap — see
   the roadmap note in [OVERVIEW.md](./OVERVIEW.md).)_

When a plugin is absent, every extension point simply stays empty and the
application runs normally. You never write stub files or edit a central
manifest — adding or removing a plugin directory is all it takes.

---

## The two halves of a plugin

Most non-trivial plugins have two halves that talk to each other only over
BridgeLink's REST API — there is no in-process coupling:

| Half                               | Lives in               | Runs in                      | Responsibility                                              |
| ---------------------------------- | ---------------------- | ---------------------------- | ----------------------------------------------------------- |
| **Web Administrator** (TypeScript) | `plugins/<name>/`      | The browser (Next.js bundle) | Settings tabs, pages, connector sections, editor extensions |
| **Server** (Java) — opt.           | `plugins/<name>/java/` | The BridgeLink server JVM    | REST endpoints, connectors, transformers, persistence       |

**UI-only plugins** have no Java half at all — they are pure Web Administrator
enhancements (dashboards, visual tools, workflow shortcuts). **Full-stack
plugins** add a Java server extension that the Web Administrator half calls. This guide
focuses on the Web Administrator half; the Java half is summarized in
[BUILD-A-PLUGIN.md](./BUILD-A-PLUGIN.md) and templated in your starter project.

The join key between the two halves is the **plugin name string** — the
`serverPluginName` you declare once on your `definePlugin({...})` manifest must
exactly match the `<name>` your Java plugin declares. The server reports
installed/enabled plugins to the Web Administrator, and your plugin's UI only
appears when the matching server plugin is present and enabled. See
[Server-enablement gating](#server-enablement-gating) below for the full rule.

---

## Extension points

Every extension point is a **field on your `definePlugin({...})` manifest**. You
declare only the fields you use; each takes an array of contribution objects (or,
for the single-fill points, one value). `definePlugin` is imported from
`@/lib/plugin-manifest`; the contribution _types_ come from `@/`-aliased paths in
the base application.

A complete manifest looks like this:

```typescript
// plugins/my-plugin/index.ts
import { definePlugin } from "@/lib/plugin-manifest";
import { MyPage } from "./my-page";
import { MyPluginTab } from "./my-plugin-tab";

export default definePlugin({
  id: "my-plugin", // unique WebUI id — by convention the plugins/<dir> name
  serverPluginName: "My Server Plugin", // gates the UI; must match plugin.xml <name>; omit if client-only
  // licensedPluginId: "My Server Plugin", // optional License Manager gate (see below)

  pages: [{ slug: "my-plugin", label: "My Plugin", component: MyPage }],
  settingsTabs: [
    { tabLabel: "My Plugin", tabKey: "my-plugin", component: MyPluginTab, actionPanel: null },
  ],
});
```

### Quick reference

| Manifest field                                           | Extension point                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `pages`                                                  | Full pages at `/p/{slug}` + sidebar nav items                    |
| `settingsTabs`                                           | Settings page tabs                                               |
| `channelEditorTabs`                                      | Extra Channel Editor tabs (edit mode only)                       |
| `monacoEditorActions`                                    | Monaco editor context-menu actions                               |
| `referencePanelTabs`                                     | Extra filter/transformer Reference Panel tabs                    |
| `referenceCategories`                                    | Reference tab categories + Monaco autocomplete                   |
| `routePages`                                             | Pages rendered by fixed core route files (e.g. `/auth/callback`) |
| `routeHandlers`                                          | Server-side route handlers (lazy loaders only)                   |
| `ssoLogin`                                               | SSO login section + post-login verify (single-fill)              |
| `permissionsProvider`                                    | RBAC permissions resolver (single-fill)                          |
| `sourceConnectors` / `destinationConnectors`             | New connector types                                              |
| `sourceConnectorPlugins` / `destinationConnectorPlugins` | Cross-cutting connector panel sections                           |
| `dataTypes`                                              | Data types                                                       |
| `transmissionModes`                                      | TCP transmission modes                                           |
| `transformerSteps`                                       | Filter/transformer step types                                    |
| `attachmentViewers`                                      | Message browser attachment viewers                               |
| `slots`                                                  | Named single-fill mount points (dialogs, overlays, post-save)    |

> The `slots` field fills additional specialized mount points (code-template and
> repository history dialogs, import dialogs, post-save handlers). The fields
> above cover the extension points most plugins need; ask your Innovar contact if
> you need one not listed here.

The rest of this section documents the common extension points in detail. Each
sample shows the **contribution object** you add to the corresponding manifest
field.

### Plugin pages

The `pages` field contributes full pages at `/p/{slug}` and injects a sidebar
nav item for each automatically.

```typescript
import { Network } from "lucide-react";
import { MyPage } from "./my-page";

// pages: [ ... ] on your definePlugin() manifest
{
  slug: "my-plugin", // URL: /p/my-plugin
  label: "My Plugin", // sidebar label
  icon: Network, // lucide-react icon
  tooltip: "Short description.", // sidebar tooltip
  navGroup: "Operations", // "Operations" | "Build" | "Administration" (default "Operations")
  component: MyPage, // React component rendered at the route
  permissionKey: "MyPermission", // optional RBAC key; item hidden when "No Permission"
}
```

Contributions are idempotent by `slug` (first-wins). If no plugin contributes a
slug, `/p/{slug}` returns 404.

### Settings tabs

The `settingsTabs` field adds tabs to the Settings page. A tab is shown only when
the server reports the matching plugin as installed and enabled — the gate is your
manifest's `serverPluginName`, so you don't repeat it per tab.

```typescript
import { MyPluginTab } from "./my-plugin-tab";

// settingsTabs: [ ... ] on your definePlugin() manifest
{
  tabLabel: "My Plugin", // display name on the tab
  tabKey: "my-plugin", // unique tab key
  component: MyPluginTab, // tab body component
  actionPanel: null, // optional toolbar component
  permissionKey: "Settings.My Plugin", // RBAC key; tab hidden when "No Permission"
}
```

Contributions are idempotent by `tabKey` (first-wins). A tab may set its own
`pluginName` to override the manifest's `serverPluginName` gate, but most plugins
just declare `serverPluginName` once and omit it here.

### SSO login section

The `ssoLogin` field contributes a login UI section and a post-login
verification hook. It is a single-fill point — only one plugin can fill it
(first-wins).

```typescript
// ssoLogin: { ... } on your definePlugin() manifest
{
  section: MySsoLoginSection, // rendered below the credentials form
  postLoginVerify: myPostLoginVerify, // async (serverUrl, username) => void — throw to block login
}
```

> The login page is pre-auth, so `ssoLogin` is **not** server-enablement gated —
> an SSO plugin self-gates via its own public discovery/config endpoint.

`SsoLoginProps` passed to your section:

```typescript
interface SsoLoginProps {
  serverUrl: string;
  disabled: boolean; // true while credential login is in progress
  onError: (message: string) => void; // surface an error on the login page
  onLoadingChange: (loading: boolean) => void;
}
```

`postLoginVerify` runs after a successful credential login. Throw an `Error`
with a human-readable message to block the login.

### Permissions provider

The `permissionsProvider` field contributes a role-based access-control
resolver. It is a single-fill point — only one plugin can fill it (first-wins).

```typescript
// permissionsProvider on your definePlugin() manifest
async () => {
  // Return null for allow-all (e.g. plugin disabled, or user has no role).
  // Return a Map<permissionKey, PermissionLevel> to enforce RBAC.
  return permsMap;
};
```

`PermissionLevel` is `"No Permission" | "View" | "Editor"`. When no provider is
registered, or the provider returns `null`, every permission defaults to
`"Editor"` (allow-all) — so the base app is fully usable without any RBAC
plugin.

### Channel editor tab

The `channelEditorTabs` field adds tabs to the channel editor, after the
built-in Summary / Source / Destinations / Scripts tabs, shown only when editing
an existing channel.

```typescript
// channelEditorTabs: [ ... ] on your definePlugin() manifest
{
  key: "my-plugin-tab",
  label: "My Plugin",
  component: MyPluginChannelTab, // receives { channelId, channelName }
}
```

Idempotent by `key` (first-wins).

### Post-channel-save handler and editor overlay

These are **named slots** — declare them in the manifest's `slots` field. The
`"channels.post-save"` slot runs a callback after every successful channel save.
Errors thrown inside the handler are swallowed — the save flow is never blocked
or rolled back.

The `"channel-editor.overlay"` slot mounts a component at the bottom of the
channel editor's DOM — the right place for dialogs triggered by the post-save
handler. The overlay receives no props and manages its own state (typically via a
module-level signal the post-save handler fires). Slots are single-fill
(first-wins).

```typescript
// slots: { ... } on your definePlugin() manifest
{
  "channels.post-save": async (channelXml, mode) => {
    // mode: "edit" (existing) | "new" (newly created)
    await doSomething(channelXml, mode);
  },
  "channel-editor.overlay": MyChannelEditorOverlay,
}
```

### Source / destination connector types

The `sourceConnectors` and `destinationConnectors` fields add full connector
types to the channel editor dropdowns. The `transportName` must match the
`<transportName>` produced by your Java server-side connector, and becomes the
registry key (first-wins).

```typescript
// sourceConnectors: [ ... ] on your definePlugin() manifest
{
  transportName: "DICOM Listener",
  defaultPropertiesXml: `<properties class="com.example.DicomListenerProperties"/>`,
  BottomSection: DicomListenerBottomSection,
  validate: (propertiesXml) => [], // return ValidationError[]
}
```

`ConnectorDefinition` fields: `transportName`, optional `TopSection` /
`BottomSection` components, `defaultPropertiesXml`, and `validate`. The
destination variant mirrors this but updates destination connector state.

### Connector cross-cutting plugin sections

The `sourceConnectorPlugins` / `destinationConnectorPlugins` fields inject an
optional settings section into _several_ connector types at once. Unlike a
connector type, a plugin section is cross-cutting: visibility is decided by
`isApplicable()` rather than a single `transportName`.

```typescript
import type { ConnectorPluginDefinition } from "@/app/(app)/channels/_connectors/types";

const MyConnectorSection: ConnectorPluginDefinition = {
  isApplicable: (transportName, propertiesXml) =>
    ["HTTP Listener", "TCP Listener"].includes(transportName) &&
    propertiesXml?.includes("MyPluginProperties") === true,
  injectDefaults: (_transportName, propertiesXml) => propertiesXml, // optional
  Section: MySourceSection,
};

// sourceConnectorPlugins: [MyConnectorSection] on your definePlugin() manifest
```

> **Type rename:** the connector-section type is
> `ConnectorPluginDefinition`, imported from
> `@/app/(app)/channels/_connectors/types`. The bare name `PluginDefinition` now
> means the manifest type in `@/lib/plugin-manifest`. The destination variant is
> `DestinationPluginDefinition` from `.../destinations/types`.

Two-layer gating: the section renders only if your plugin's server extension is
installed and enabled (via the manifest's `serverPluginName`); `isApplicable()`
then filters by connector type and XML tag. Keep `isApplicable()` pure — no
network calls.

### Data types

The `dataTypes` field contributes a data type — BridgeLink's unit of message
format. A data type governs how messages are parsed, shown in the Msg Trees
panel, highlighted in editors, and which attachment viewer is shown by default.

```typescript
// dataTypes: [ ... ] on your definePlugin() manifest
{
  name: "DIMSE",
  displayName: "DIMSE (DICOM)",
  defaultPropertiesXml: (tagName) => `<${tagName}/>`,
  getDefaultAttachmentHandler: () =>
    "com.mirth.connect.server.attachments.dicom.DICOMAttachmentHandlerProvider",
  tokenMarker: { languageId: "dimse-xml", tokenizer: { root: [[/<[^>]+>/, "tag"]] } },
  codeTemplateContributions: [
    { name: "Get DIMSE field", code: "msg['dimse:Field']", category: "DIMSE Functions" },
  ],
  // AttachmentViewer: MyViewerComponent, // optional, takes precedence in dispatch
}
```

All hooks except `name` and `defaultPropertiesXml` are optional. Idempotent by
`name` (first-wins) — don't shadow a built-in type unintentionally.

### Transmission modes

The `transmissionModes` field adds a framing mode to the TCP Listener / TCP
Sender dropdown.

```typescript
// transmissionModes: [ ... ] on your definePlugin() manifest
{
  name: "Syslog", // matches <transmissionModeName> in channel XML
  displayName: "Syslog (RFC 5425)",
  defaultStartBytes: "",
  defaultEndBytes: "",
  buildSampleFrame: (payload) => `<${payload.length}>${payload}`, // optional
  validate: (props) => [], // optional
  SettingsSection: SyslogSettingsSection, // optional
}
```

Modes appear in declaration order and are idempotent by `name` (first-wins).

### Transformer steps

The `transformerSteps` field adds a custom step to the source and/or destination
transformer "Add" dropdown. Each step declares its full lifecycle — XML
round-trip, generated-script emission, validation, and a React editor panel. The
[full walkthrough](./BUILD-A-PLUGIN.md#walkthrough-a-custom-transformer-step)
builds one end to end.

Because a step definition is written against a concrete step shape, wrap it with
`transformerStepContribution()` (from `@/lib/plugin-manifest`) so it widens to the
registry's base type:

```typescript
import { transformerStepContribution } from "@/lib/plugin-manifest";

const StoredProcedureStep = {
  type: "Stored Procedure", // Add-dropdown label + discriminant (unique)
  xmlTag: "com.example.StoredProcedureStep", // FQN Java class used as the XML tag
  contexts: ["source", "destination"], // which transformers list it
  defaults: () => ({ ... }),
  parse: (el) => ({ ... }),
  serialize: (step) => "...",
  emitScript: (step) => "...", // JavaScript shown in the Generated Script tab
  validate: (step) => (ok ? null : "error message"),
  EditorPanel: MyEditorComponent,
};

// transformerSteps: [transformerStepContribution(StoredProcedureStep)] on your manifest
```

Idempotent by `type` (first-wins); declaration order determines dropdown order.
Container steps (holding nested steps) implement `visitChildren` / `withChildren`
— see the dispatch rules below.

### Attachment viewers

The `attachmentViewers` field contributes a component that renders message
attachment content. Use it when your viewer applies across multiple data types
or needs MIME-based dispatch. When a viewer is 1:1 with a data type you own,
prefer the `AttachmentViewer` hook on a `dataTypes` entry instead — it takes
precedence.

```typescript
// attachmentViewers: [ ... ] on your definePlugin() manifest
{
  name: "MyAttachmentViewer",
  canView: (att) => att.type.toLowerCase().includes("dicom"),
  Component: MyViewerComponent, // receives { attachment, channelId, messageId }
  priority: 10, // higher wins when multiple viewers match
}
```

---

## Server-enablement gating

Declare `serverPluginName` **once** on your manifest — the server plugin name
exactly as your Java `plugin.xml` `<name>` declares it (and as
`GET /extensions/plugins/` reports it). The Web Administrator stamps it onto every
enumeration/selection contribution your plugin makes, then hides those surfaces
unless that server plugin is **installed and enabled** on the connected server:

- pages, settings tabs, channel-editor tabs, Monaco editor actions, reference
  panel tabs, reference categories;
- connector types, connector plugin sections, data types, transmission modes,
  transformer steps, attachment viewers;
- named `slots`.

A dormant plugin — server extension absent or disabled — therefore contributes
**zero visible UI**. Omit `serverPluginName` entirely for a client-only plugin
(no Java half); its UI is then always visible.

**Lookup-by-key is never gated.** Resolving an _existing_ channel's
`transportName`, data type `name`, or transformer step `xmlTag` to its
(compiled-in) definition always succeeds — so a channel authored on a server that
has your plugin still renders and round-trips without data loss on a server that
doesn't. A dropdown pins a gated current value as a disabled "(unavailable)"
option rather than dropping it.

**Always ungated** (they carry no gate): `routePages` and `routeHandlers` (a
route like an OIDC `/auth/callback` must render before an authenticated session
exists), `ssoLogin` (the login page is pre-auth), and `permissionsProvider` (an
RBAC hook whose contract is to fail open). These are infrastructure, not
user-facing chrome.

### License gating (commercial plugins)

`licensedPluginId` is an optional second gate, AND-composed with
`serverPluginName`. Set it to your plugin's License Manager product name (the
`pluginId` reported by the License Manager's `plugin-license-statuses`
endpoint — usually the same string as `serverPluginName`). When set, the
plugin's license-gated surfaces (pages, settings tabs, channel-editor tabs,
Monaco actions, reference panel tabs, reference categories, connector plugin
sections, slots) stay hidden unless the server reports that id as licensed, on
top of the enablement gate. Omit it for core or unlicensed plugins — their UI is
not license-gated. The XML-round-trip-sensitive kinds (connector types, data
types, transmission modes, transformer steps, attachment viewers) are
intentionally **not** license-gated.

---

## Dispatch and precedence

### Attachment viewer selection

For each attachment, the message browser picks a viewer using a three-tier
chain:

1. **Per-data-type viewer** — the `AttachmentViewer` from a `dataTypes` entry
   wins when `att.type` contains that data type's `name` (case-insensitive).
2. **MIME-registry viewer** — otherwise, the highest-`priority` `attachmentViewers`
   entry whose `canView()` returns true. Ties break by declaration order (last
   declared wins).
3. **Built-in fallback** — the text / Monaco editor when nothing matches.

So if both a data type and a MIME-registry entry match the same attachment, the
data-type viewer wins. Use the registry entry only for viewers that span
multiple data types.

### Transformer step recursion

Container steps (e.g. Iterator) recurse through their children automatically.
The dispatch helpers (`parseStep()`, `serializeStep()`, `emitStepJs()`) are
re-entrant. If your custom step holds nested steps, implement:

- `visitChildren(step)` — return the immediate child steps for tree walking
- `withChildren(step, children)` — return a copy of `step` with children replaced

Without these, tree-walking helpers won't recurse into your step's children.

---

## The plugin loader

`plugins/index.ts` is **auto-generated**. A build step scans `plugins/*/index.ts`
on disk and, per directory found, imports the module and passes it to
`registerPluginModule()` — which registers the module's default-exported
`definePlugin({...})` manifest — then signals that plugin registration is
complete. You never edit this file by hand — adding a plugin directory and
running the generator (or just `npm run dev` / `npm run build`) picks it up
automatically. See [LOCAL-SETUP.md](./LOCAL-SETUP.md) for the exact commands.

Route files and pages wait for the "plugins ready" signal before reading from a
registry, so registration always completes before anything tries to look up your
contribution.

---

## A plugin's directory layout

A typical full-stack plugin:

```
plugins/
  my-plugin/
    index.ts                  ← entry point: default-exports definePlugin() manifest
    api-my-plugin.ts          ← typed REST wrappers for your server endpoints
    my-plugin-tab.tsx         ← settings tab component (if any)
    my-plugin-action-panel.tsx ← optional toolbar component
    java/                     ← optional Java server half (Maven, 3 modules)
      shared/                   - DTOs, constants, REST interface contract
      server/                   - lifecycle, business logic, servlet
      distribution/             - assembly into a deployable plugin ZIP
```

A UI-only plugin omits the `java/` directory entirely.

---

## Graceful absence

The base application compiles and runs with no plugins present. Every extension
point handles the empty case:

- No plugin pages → `/p/*` returns 404; no extra sidebar items
- No settings tabs → Settings shows only built-in tabs
- No SSO section → login page shows only the credentials form
- No permissions provider → all features accessible (allow-all)
- No connector types / sections → only built-in connectors render
- No data types / transmission modes / transformer steps → only built-ins appear
- No attachment viewers → message browser falls back to text/Monaco
- No post-save handler or editor overlay → channel saves complete with no side effects

This is what lets a single distribution carry many plugins: an un-entitled or
absent plugin is simply invisible.
