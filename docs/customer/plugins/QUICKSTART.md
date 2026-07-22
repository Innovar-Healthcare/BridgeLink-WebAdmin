# Quickstart

This gets you from zero to a plugin that loads in the BridgeLink Web
Administrator, using the reference template. Budget about ten minutes. For
environment details and the full set of commands, see
[LOCAL-SETUP.md](./LOCAL-SETUP.md).

---

## 1. Start from the reference template

This SDK ships a minimal, self-contained plugin scaffold at
[`template/`](./template/). Copy it into a new plugin directory in your Web
Administrator checkout:

```bash
cp -r docs/customer/plugins/template plugins/my-first-plugin
```

This is the Web Administrator (TypeScript) half — `index.ts`, a settings-tab
component, and an API module. Full-stack plugins add a Java server half; its
starter skeleton is provided when you engage Innovar. For this quickstart we only need the Web
Administrator half.

## 2. Point it at an extension point

Open `plugins/my-first-plugin/index.ts`. The template's manifest declares a
**settings tab** gated by `serverPluginName`, so it only appears once the matching
server-side plugin is installed and enabled. To see something immediately without
deploying anything to a server, contribute a **page** instead **and omit
`serverPluginName`** — with no server gate the page shows in the sidebar right
away:

```typescript
// plugins/my-first-plugin/index.ts
import { definePlugin } from "@/lib/plugin-manifest";
import { Boxes } from "lucide-react";
import { StarterSettingsTab } from "./template-tab";

export default definePlugin({
  id: "my-first-plugin",
  // no serverPluginName → nothing to gate against, so the page is always visible

  pages: [
    {
      slug: "my-first-plugin", // URL: /p/my-first-plugin
      label: "My First Plugin",
      icon: Boxes,
      tooltip: "Hello from my first plugin",
      navGroup: "Operations",
      component: StarterSettingsTab,
    },
  ],
});
```

(You'll switch back to a `serverPluginName` + `settingsTabs` manifest once you
build the real thing — see [BUILD-A-PLUGIN.md](./BUILD-A-PLUGIN.md).)

## 3. Let the loader pick it up

The plugin loader is generated automatically. Regenerate it (the dev and build
commands also do this for you):

```bash
npm run plugins:gen
```

## 4. Run the dev server

```bash
npm run dev
```

Open the app, log in, and look in the sidebar under **Operations** — **My First
Plugin** is there, and clicking it renders your component at
`/p/my-first-plugin`.

## 5. Confirm it builds clean

```bash
npx tsc --noEmit
npm run build
```

That's a working plugin. To prove the model's most important property, delete
`plugins/my-first-plugin/`, run `npm run plugins:gen`, and rebuild — the app
compiles and runs exactly as before. Nothing in the core app referenced your
plugin by name.

---

## Next steps

- Build a real feature: [BUILD-A-PLUGIN.md](./BUILD-A-PLUGIN.md) walks through a
  settings tab, a transformer step, and the Java server half.
- Understand every extension point: [ARCHITECTURE.md](./ARCHITECTURE.md).
