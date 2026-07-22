# Local Development Setup

This covers the development environment, the build commands you'll use daily, and
the quality gates your plugin must pass before it can be submitted or shipped.

---

## Prerequisites

- **Node.js 22.x LTS** and **npm**
- **Git**
- For a Java server half: **JDK 17** and **Maven**
- A **BridgeLink server** to develop against — use your own BridgeLink instance

The application's dev server proxies API calls to your BridgeLink server, so you
won't hit CORS issues during development. Point it at your instance to test
against real data.

---

## Getting the source

You develop your plugin inside a checkout of the BridgeLink Web Administrator
source. Partners receive access to the source as part of onboarding; in-house teams use their licensed copy.

```bash
git clone <your-bridgelink-webui-source-url> bridgelink-webui
cd bridgelink-webui
npm install
```

Your plugin lives in its own directory under `plugins/`:

```
bridgelink-webui/
  app/         ← core application
  components/  ← shared UI components you can reuse
  lib/         ← shared hooks and utilities
  plugins/
    my-plugin/        ← your plugin
```

Start by copying the bundled template — [`template/`](./template/) in this SDK —
into `plugins/` (see [QUICKSTART.md](./QUICKSTART.md)).

---

## Daily commands

| Command               | What it does                                                   |
| --------------------- | -------------------------------------------------------------- |
| `npm run plugins:gen` | Regenerates the plugin loader by scanning `plugins/*/index.ts` |
| `npm run dev`         | Starts the dev server (regenerates the loader first)           |
| `npm run build`       | Production build (regenerates the loader first)                |
| `npx tsc --noEmit`    | Type-checks without emitting                                   |
| `npm run test:unit`   | Runs the unit test suite                                       |
| `npm run format`      | Auto-formats with Prettier                                     |
| `npm run ci`          | The full gate — see below                                      |

You rarely need to run `npm run plugins:gen` by hand; `dev` and `build` run it
automatically. The generated loader is never edited or committed by hand.

### Building a Java server half

```bash
cd plugins/my-plugin/java
mvn clean package        # produces the deployable plugin ZIP
```

Install the resulting ZIP on your BridgeLink server (Settings → Extensions), then
verify your Web Administrator settings tab appears once the server plugin is
enabled. The Java starter skeleton provided during onboarding ships with a
`PLUGIN-TEMPLATE.md` that documents the Maven layout and build profiles for the
BridgeLink versions you target.

---

## Quality gates

Your plugin must pass the same checks as the core application. The single
command is:

```bash
npm run ci
```

which runs, and requires **zero errors and zero warnings** from, all of:

- **TypeScript** (`tsc --noEmit`) — strict mode, no `any`
- **ESLint** (`--max-warnings 0`) — warnings fail the build
- **Table, tab, and border linters** — see standards below
- **Prettier** (`--check`) — formatting must be clean
- **Unit tests** (`test:unit`)

Run `npm run format` to fix formatting drift before committing.

Beyond these mechanical gates, a submittable plugin must also meet the
[security requirements](./SECURITY.md) and the [testing expectations](./TESTING.md).
The [pre-submission checklist](./CHECKLIST.md) pulls all of it together.

---

## Code standards

Plugins follow the same standards as the core application. The ones that most
often trip people up:

- **No `any` types.** Use proper interfaces; mirror your Java DTOs in TypeScript.
- **No `console.log`** in shipped code.
- **No "Mirth" in comments or user-visible strings.** The product is BridgeLink.
  The only exceptions are Java fully-qualified class names used as literal XML
  tag strings (e.g. `"com.mirth.connect.*"`) and server-defined metadata keys —
  protocol values the server owns.
- **Borders:** use `border-border` for neutral surface borders and `border-input`
  for form inputs. Hardcoded `border-gray-*` / `border-slate-*` / `border-zinc-*`
  / bare `border-[#hex]` are rejected by the border linter. Semantic accent
  borders (`border-blue-*`, `border-red-*`, etc.) are fine when they convey
  state.
- **Tables:** compose the shared `@/components/data-table` primitives. Raw
  `<table>`/`<tr>`/`<td>` elements are rejected by the table linter.
- **Reuse before you build.** The base app ships a large component and hook
  library (`@/components/...`, `@/lib/hooks/...`) — settings panels, dialogs,
  form controls, tables, tooltips, status badges. Use them so your plugin matches
  the application and inherits dark mode.
- **Credential fields** (passwords, keys, secrets) use `type="text"` with the
  shared `SecretInput` component, not `type="password"` — this keeps browser
  password managers from prompting to save server credentials.

---

## Verifying graceful absence

Before you consider a plugin done, confirm the application still builds and runs
with your plugin removed:

```bash
mv plugins/my-plugin /tmp/   # temporarily remove it
npm run build                # should still succeed
mv /tmp/my-plugin plugins/   # put it back
```

This is a hard requirement: the base application must never depend on any one
plugin being present.
