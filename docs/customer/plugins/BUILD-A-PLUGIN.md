# Building a Plugin

This guide walks through building a BridgeLink Web Administrator plugin from an
empty directory to a working feature. It assumes you have a local development
environment set up — see [LOCAL-SETUP.md](./LOCAL-SETUP.md) — and that you've
read [ARCHITECTURE.md](./ARCHITECTURE.md) for the extension-point catalog.

We cover two examples:

- A **settings-tab plugin** — the simplest useful plugin (Web Administrator only).
- A **custom transformer step** — a fuller example exercising the channel
  editor.

Then we summarize the **Java server half** for full-stack plugins.

---

## Prerequisites

- Node.js 22.x LTS and npm
- A checkout of the BridgeLink Web Administrator source you can build (provided
  as part of partner onboarding)
- A BridgeLink server to develop against (your own BridgeLink instance)

The fastest start is to copy the **reference template** rather than starting from
a blank directory. This SDK ships the Web Administrator half of the template at
[`template/`](./template/); the Java server skeleton is provided when you engage
Innovar. [QUICKSTART.md](./QUICKSTART.md)
gets the template running in a few minutes.

---

## The shape of a plugin

A plugin is a directory under `plugins/`. Its `index.ts` is the entry point: it
imports your components and **default-exports a `definePlugin({...})` manifest**
declaring what the plugin contributes. The generated plugin loader imports that
module and registers the manifest — before any screen renders.

```
plugins/
  my-plugin/
    index.ts          ← entry point (default-exports definePlugin() manifest)
    my-plugin-tab.tsx ← your component(s)
    api-my-plugin.ts  ← REST calls (if any)
```

**Import rules:**

- Base-app modules: use `@/lib/...`, `@/components/...`, `@/app/...` aliases.
- Plugin-internal modules: use relative imports (`./my-component`).
- **Never import from another plugin's directory** — plugins must be
  independent.

---

## Example 1: A settings-tab plugin

### Step 1 — Create the directory and entry point

```typescript
// plugins/my-plugin/index.ts

import { definePlugin } from "@/lib/plugin-manifest";
import { MyPluginTab } from "./my-plugin-tab";
import { MyPluginActionPanel } from "./my-plugin-action-panel";

export default definePlugin({
  id: "my-plugin", // unique WebUI id — by convention the plugins/<dir> name
  serverPluginName: "My Plugin", // gates the tab; must match the server plugin <name> exactly

  settingsTabs: [
    {
      tabLabel: "My Plugin",
      tabKey: "my-plugin",
      component: MyPluginTab,
      actionPanel: MyPluginActionPanel, // or null
      permissionKey: "Settings.My Plugin",
    },
  ],
});
```

### Step 2 — Build the tab component

Plugin components are standard React components and may use any shared component
or hook from the base app. The `usePluginSettings` hook implements the common
load → edit → save lifecycle for property-bag settings: you pass `fromRecord` /
`toRecord` converters and it returns `props`, a `set` function, and `save` /
`dirty` / `saving` / `loading` / `error` state.

```tsx
// plugins/my-plugin/my-plugin-tab.tsx
"use client";

import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import { SettingsSection, FieldRow } from "@/components/settings/settings-section";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Button } from "@/components/ui/button";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { MY_PLUGIN_NAME, fromRecord, toRecord, type MyPluginSettings } from "./api-my-plugin";

export function MyPluginTab() {
  const { props, loading, saving, error, dirty, set, save } = usePluginSettings<MyPluginSettings>({
    pluginName: MY_PLUGIN_NAME,
    fromRecord,
    toRecord,
  });

  if (loading) return <div className="p-4">Loading…</div>;
  if (!props) return <ApiErrorAlert error={error} />;

  return (
    <div className="space-y-4 p-4">
      <ApiErrorAlert error={error} />
      <SettingsSection title="My Plugin">
        <FieldRow label="Enabled">
          <FormCheckbox checked={props.enabled} onChange={(v) => set("enabled", v)} />
        </FieldRow>
      </SettingsSection>
      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
```

Compose UI from the shared component library (`SettingsSection`, `FieldRow`,
`Input`, `FormCheckbox`, `SecretInput`, and so on) so your plugin matches the
rest of the application, including dark mode.

### Step 3 — Add the settings module

Keep your plugin's settings shape and API calls in their own module. For the
property-bag pattern above, you just define the interface and the converters —
`usePluginSettings` reads and writes via the generic plugin-properties endpoints
for you:

```typescript
// plugins/my-plugin/api-my-plugin.ts

export const MY_PLUGIN_NAME = "My Plugin"; // must match the server plugin <name>

/** Mirrors your server-side properties class. */
export interface MyPluginSettings {
  enabled: boolean;
}

const KEY_ENABLED = "myplugin.enable";

export function fromRecord(record: Record<string, string>): MyPluginSettings {
  return { enabled: record[KEY_ENABLED] === "true" };
}

export function toRecord(form: MyPluginSettings): Record<string, string> {
  return { [KEY_ENABLED]: String(form.enabled) };
}
```

When you need read-only computed fields, custom endpoints, or action endpoints,
switch to typed REST calls with `request()` from `@/lib/api-client` instead — and
read [the request-body rule](#critical-rest-request-body-rule) below, the most
common source of confusing 500 errors. The bundled
[`template/api-template.ts`](./template/api-template.ts) documents both patterns.

### Step 4 — Add Next.js routes (if needed)

If your plugin needs a page (e.g. an OAuth callback) or an API route, declare
them on your manifest via the `routePages` and `routeHandlers` fields:

```typescript
import MyCallbackPage from "./callback-page";

export default definePlugin({
  id: "my-plugin",
  serverPluginName: "My Plugin",

  routePages: [{ path: "/auth/my-plugin/callback", component: MyCallbackPage }],
  routeHandlers: [
    // Lazy loader thunk ONLY — the handler module (and its server-only deps) is
    // imported on first request, never at registration time. An eager
    // `import { POST } from "./my-handler"` would drag server-only code into the
    // client bundle and trip the app CSP.
    {
      method: "POST",
      path: "/api/my-plugin/action",
      loader: () => import("./my-handler").then((m) => m.POST),
    },
  ],
});
```

A matching route file must exist under `app/` for Next.js to know the URL. A few
shared paths already have generic dispatcher files; a brand-new URL needs a small
dispatcher added to `app/`. Coordinate new URL surface with your Innovar contact
during submission — for self-hosted builds you add the dispatcher yourself,
following the pattern of the existing ones. Do **not** use re-export wrapper
files.

### Step 5 — Let the loader pick it up

`plugins/index.ts` is generated automatically. After adding your directory, the
next `npm run dev`, `npm run build`, or explicit `npm run plugins:gen` regenerates
it. You never edit it by hand, and there are no stub files to maintain.

### Step 6 — Verify

```bash
npx tsc --noEmit   # TypeScript compiles cleanly
npm run test:unit  # tests pass
npm run build      # production build succeeds
```

The settings tab appears in Settings once the matching server plugin is
installed and enabled.

---

## Walkthrough: a custom transformer step

This example adds an **Uppercase Mapper** transformer step that maps a source
variable to its uppercase value, available in both source and destination
transformers. It exercises the full step lifecycle: defaults, XML round-trip,
script generation, validation, and an editor panel.

### 1 — Entry point

```typescript
// plugins/uppercase-step/index.ts

import { definePlugin, transformerStepContribution } from "@/lib/plugin-manifest";
import type {
  TransformerStepDefinition,
  TransformerStepEditorProps,
} from "@/app/(app)/channels/_lib/filter-transformer-steps";
import { childText, tcStr } from "@/app/(app)/channels/_lib/filter-transformer-xml-helpers";

interface UppercaseStep {
  type: "Uppercase Mapper";
  name: string;
  sequenceNumber: string;
  enabled: boolean;
  sourceVariable: string;
  targetVariable: string;
}

function UppercaseEditor({ step, onChange }: TransformerStepEditorProps<UppercaseStep>) {
  return (
    <div className="flex flex-col gap-2 p-2">
      <label>
        Source variable
        <input
          value={step.sourceVariable}
          onChange={(e) => onChange({ ...step, sourceVariable: e.target.value })}
        />
      </label>
      <label>
        Target variable
        <input
          value={step.targetVariable}
          onChange={(e) => onChange({ ...step, targetVariable: e.target.value })}
        />
      </label>
    </div>
  );
}

const UppercaseStepDefinition: TransformerStepDefinition<UppercaseStep> = {
  type: "Uppercase Mapper",
  xmlTag: "com.example.UppercaseMapperStep",
  contexts: ["source", "destination"],

  defaults: () => ({
    type: "Uppercase Mapper",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    sourceVariable: "",
    targetVariable: "",
  }),

  parse: (el) => ({
    type: "Uppercase Mapper",
    name: "",
    sequenceNumber: "0",
    enabled: true,
    sourceVariable: childText(el, "sourceVariable"),
    targetVariable: childText(el, "targetVariable"),
  }),

  serialize: (step) =>
    tcStr("sourceVariable", step.sourceVariable) + tcStr("targetVariable", step.targetVariable),

  emitScript: (step) =>
    `channelMap.put('${step.targetVariable}', ` +
    `msg['${step.sourceVariable}'].toString().toUpperCase());`,

  validate: (step) => {
    if (!step.sourceVariable.trim()) return "Source variable cannot be empty.";
    if (!step.targetVariable.trim()) return "Target variable cannot be empty.";
    return null;
  },

  EditorPanel: UppercaseEditor,
};

export default definePlugin({
  id: "uppercase-step",
  // transformerStepContribution() widens the concretely-typed definition to the
  // registry's base step type.
  transformerSteps: [transformerStepContribution(UppercaseStepDefinition)],
});
```

The registry layers `name`, `sequenceNumber`, and `enabled` onto your `parse()`
result and wraps your `serialize()` body in the outer `<xmlTag>` element — so
your hooks only deal with step-specific fields.

### 2 — Run it

```bash
npm run plugins:gen   # regenerate the loader (also runs on dev/build)
npm run dev
```

Open a channel, go to the Source or Destination transformer tab, click **Add
Step** — "Uppercase Mapper" appears in the dropdown.

---

## The Java server half

Full-stack plugins add a Java server extension under `plugins/<name>/java/`,
built with Maven into a deployable plugin ZIP. Innovar provides a complete
three-module Java starter skeleton (`shared`, `server`, `distribution`) — with
the correct POMs, assembly descriptor, and a generated `plugin.xml` — as part of
onboarding. Start from it and rename rather
than building Maven config from scratch.

At a glance:

| Module         | Output              | Responsibility                                                |
| -------------- | ------------------- | ------------------------------------------------------------- |
| `shared`       | `<name>-shared.jar` | DTOs, constants, the JAX-RS REST interface, config POJO       |
| `server`       | `<name>-server.jar` | Plugin lifecycle, business logic, REST servlet, exceptions    |
| `distribution` | `<name>.zip`        | Bundles the JARs + third-party libs + `plugin.xml` into a ZIP |

The Web Administrator half and the Java half communicate **only over BridgeLink's REST
API**. The contract is the JAX-RS interface in `shared`; the Web Administrator mirrors its
DTOs in TypeScript.

### Critical: REST request-body rule

This is the single most common source of confusing failures, so it's worth
internalizing before you write any endpoint.

BridgeLink reads REST request bodies through XStream, which only understands the
types it has been told about at server startup. **Your plugin's own DTO classes
are never registered with XStream.** A `@PUT`/`@POST` method whose body parameter
is typed as a plugin DTO fails deserialization _before your method runs_,
returning an **empty HTTP 500 with nothing in the server log** — your
`catch (Exception)` never fires.

**Safe request-body types:**

- `java.util.Properties` — the standard plugin config envelope; use it for
  settings updates and other key/value mutations.
- `java.lang.String` — for free-form JSON/text your servlet parses itself.
- BridgeLink core domain classes (e.g. `com.mirth.connect.model.Channel`) —
  already registered with XStream.
- Form-encoded (`@FormParam`) or multipart (`@FormDataParam`) fields, bound
  individually — required for file uploads.

**Unsafe:** a plugin-defined DTO as a body parameter. Don't do it.

> The asymmetry matters: a plugin-defined DTO is fine as a **return type** — only
> **inputs** are affected.

Two more rules that apply to every parameter:

- Every parameter must carry `@Param("name")` (BridgeLink's annotation, applied
  _in addition_ to the standard JAX-RS annotation). Without it, binding fails.
- Mark secrets with `@Param(value = "password", excludeFromAudit = true)` so they
  stay out of the audit log.

A settings update therefore looks like this on the server:

```java
@PUT
@Path("/settings")
@MirthOperation(name = "updateSettings", display = "Update Settings", auditable = true)
MySettings updateSettings(@Param("properties") Properties properties) throws ClientException;
```

…and the Web Administrator half builds the matching envelope:

```typescript
function buildPropertiesBody(props: Record<string, string>): string {
  const entries = Object.entries(props).map(([k, v]) => ({ "@name": k, $: v }));
  const property = entries.length === 1 ? entries[0] : entries;
  return JSON.stringify({ properties: { property } });
}

export async function updateSettings(settings: { enabled: boolean }): Promise<MySettings> {
  return request<MySettings>("/plugins/my-plugin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: buildPropertiesBody({ enabled: String(settings.enabled) }),
  });
}
```

The Java starter skeleton ships with a conventions guide (`PLUGIN-TEMPLATE.md`)
that documents the full Java side — module responsibilities, the exception
hierarchy, property naming, the build profiles, and several reference patterns.
It is the authoritative guide for the server half and is provided with the
skeleton during onboarding.

---

## Testing

Write unit tests for your plugin's logic and components. For components that read
the plugin registry, mock the registry:

```typescript
import { vi } from "vitest";

const mockRegistry = vi.hoisted(() => ({
  permissionsProvider: null,
  settingsTabs: [],
  ssoLoginSection: null,
  postLoginVerify: null,
}));

vi.mock("@/lib/plugin-registry", () => ({ pluginRegistry: mockRegistry }));
```

Don't make real network calls in unit tests — mock `fetch`. See
[TESTING.md](./TESTING.md) for the full guide and the coverage expected for
submission.

---

## Plugin checklist

- [ ] `plugins/<name>/index.ts` default-exports a `definePlugin({...})` manifest
- [ ] `serverPluginName` on the manifest matches the server plugin `<name>`
- [ ] All base-app imports use `@/` path aliases; no imports from other plugins
- [ ] `routePages` / `routeHandlers` declared on the manifest for any routes used
      (`routeHandlers` use lazy `loader: () => import(...)` thunks, never eager imports)
- [ ] `npm run plugins:gen` picks up the directory (loader imports the module)
- [ ] `npx tsc --noEmit`, `npm run test:unit`, and `npm run build` all pass
- [ ] The app still builds and runs with your plugin directory removed
- [ ] (Full-stack) `@PUT`/`@POST` bodies use only XStream-safe types; every
      parameter carries `@Param("…")`
- [ ] Dark mode looks correct
