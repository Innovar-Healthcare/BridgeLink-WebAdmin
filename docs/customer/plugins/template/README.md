# Starter template — Web Administrator half

A minimal, self-contained plugin scaffold for the BridgeLink Web Administrator.
It declares one settings tab with a single boolean field, using the standard
load → edit → save pattern. Copy it, rename it, and replace the field with
whatever your plugin configures.

| File               | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `index.ts`         | Entry point — default-exports a `definePlugin()` manifest               |
| `template-tab.tsx` | The settings-tab component (`usePluginSettings` + shared form controls) |
| `api-template.ts`  | Typed REST wrappers; documents Pattern A (property bag) vs Pattern B    |

> This is the **Web Administrator (TypeScript) half** only. Full-stack plugins
> also need a Java server half built with Maven — the Java starter skeleton and
> its conventions guide are provided when you engage Innovar. The Java conventions, including the
> critical REST request-body rule, are summarized in
> [../BUILD-A-PLUGIN.md](../BUILD-A-PLUGIN.md).

## Use it

1. Copy this folder into a plugin directory in your Web Administrator checkout:

   ```bash
   cp -r docs/customer/plugins/template plugins/my-plugin
   ```

2. Rename the placeholders (see below).
3. Regenerate the plugin loader and run the dev server:

   ```bash
   npm run plugins:gen
   npm run dev
   ```

See [../QUICKSTART.md](../QUICKSTART.md) for the full first-run walkthrough.

## Rename the placeholders

This template uses **"Starter"** as a placeholder name. Replace it throughout:

| Find                                                                          | Replace with                                                                                   | Where                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| `StarterSettingsTab`                                                          | `{YourName}SettingsTab`                                                                        | component name (3 files)              |
| `StarterProperties`                                                           | `{YourName}Properties`                                                                         | interface name                        |
| `getStarterProperties` / `setStarterProperties`                               | `get/set{YourName}Properties`                                                                  | API wrapper names                     |
| `STARTER_PLUGIN_NAME`                                                         | keep, or rename the constant                                                                   | `api-template.ts`, `template-tab.tsx` |
| `"My Plugin"`                                                                 | your plugin's display name — **must match your server plugin's `plugin.xml` `<name>` exactly** | `api-template.ts`, `index.ts`         |
| `"starter"` / `"Starter"` (tabKey, tabLabel, permissionKey, `starter.enable`) | your plugin's slug / labels / property keys                                                    | `index.ts`, `api-template.ts`         |
| `template-tab.tsx` / `api-template.ts`                                        | `{your-slug}-tab.tsx` / `api-{your-slug}.ts`                                                   | file names                            |

The `serverPluginName` string in `index.ts` is the join key between this Web
Administrator half and your Java server plugin — it must match the server
plugin's `<name>` exactly, or the settings tab won't appear. (`api-template.ts`
passes the same string as `STARTER_PLUGIN_NAME` to `usePluginSettings()` so
settings load/save against the right server plugin.)

## Verify

```bash
npx tsc --noEmit
npm run test:unit
npm run build
```
