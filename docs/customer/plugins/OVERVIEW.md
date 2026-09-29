# Building BridgeLink Web Administrator Plugins

BridgeLink Web Administrator has a mature plugin system. You can extend almost
every surface of the application — add settings tabs, full pages, connector
types, transformer steps, data types, single sign-on, role-based access control,
and more — without modifying the core application.

This documentation is for developers building plugins. If you only want to
configure plugins you've purchased, you don't need it.

---

## Who this is for

There are two kinds of plugin builder, and the technical workflow is the same for
both:

- **Partners** building a plugin to be reviewed by Innovar and included in the
  standard BridgeLink distribution, so it can be sold or distributed to
  BridgeLink customers. This is the primary, supported path.
- **In-house teams** building a private plugin for their own BridgeLink
  deployment, not for resale.

---

## Two ways to build a plugin

- **Declarative plugins** describe their UI in a JSON file (`webadmin.json`) that ships
  inside your BridgeLink engine extension. The Web Administrator draws the screens with
  its own components. **No plugin code runs in the browser, and there is no Web
  Administrator rebuild or redistribution.** Install the extension on a running server and
  the UI appears. This fits properties editors: connector panels, settings tabs, data
  types, transmission modes, connector sections, and transformer steps. Start with
  [DECLARATIVE-PLUGINS.md](./DECLARATIVE-PLUGINS.md).
- **Compiled-in plugins** are TypeScript/React source built into the Web Administrator.
  Use them when you need custom rendering beyond a form: full pages, bespoke tables, login
  sections, access-control rules. The rest of these guides cover this path.

If your UI is a form over your extension's properties, build a declarative plugin.

---

## How compiled-in plugins work, in one minute

A compiled-in plugin is **TypeScript/React source** in its own directory that **registers
itself** into the application's extension points at startup. The core app never
references your plugin by name — it just reads from the registries your plugin
fills in.

The one constraint that shapes everything else:

> **Compiled-in plugins build into the application. There is no runtime install.** A
> compiled-in plugin must be present in the source tree when the application is built.
> You cannot drop it onto a running server the way you can with a server-side Java
> extension (or a declarative plugin).

This is why the canonical way to ship a compiled-in plugin to customers is to have
Innovar **include it in the standard distribution**. A plugin that's present in the build
but not licensed stays dormant and invisible, so one distribution can safely
carry every approved plugin. Activation is controlled by the server: the Web Administrator
asks the server which plugins are entitled, and only those light up.

Many plugins also have a **Java server half** (a connector, transformer, or REST
service) that _is_ installed at runtime on the BridgeLink server. The two halves
talk only over BridgeLink's REST API. A **UI-only plugin** has no server half at
all.

---

## What you can build

A compiled-in plugin can register into any of these extension points (full details
and code in [ARCHITECTURE.md](./ARCHITECTURE.md)). The channel editor and message format
surfaces that are properties forms can also be built declaratively:

| Surface             | Examples                                                           |
| ------------------- | ------------------------------------------------------------------ |
| **Settings**        | A settings tab for your plugin's configuration                     |
| **Navigation**      | A full page at `/p/{slug}` with a sidebar item                     |
| **Authentication**  | A single sign-on section on the login page; RBAC permission rules  |
| **Channel editor**  | Extra tabs, connector types, connector sections, transformer steps |
| **Message formats** | Custom data types, transmission/framing modes, attachment viewers  |
| **Routes**          | Plugin-owned pages (e.g. OAuth callbacks) and API handlers         |

---

## The compiled-in lifecycle at a glance

```
   Develop                Verify                 Ship
   ───────                ──────                 ────
1. Copy the template   4. tsc + tests + build  6a. Partner: submit source
2. Register into          all pass                 → review → included in
   extension points    5. App still builds          the standard build
3. Build the UI           with your plugin       6b. In-house: source review +
   (and Java half)         removed                    license → your build
```

Both compiled-in paths run through Innovar — the partner path for review and
inclusion, the in-house path for source review and BSL authorization. Declarative
plugins do not: you ship them in your own extension package (see the licensing section of
[DECLARATIVE-PLUGINS.md](./DECLARATIVE-PLUGINS.md#licensing)).

---

## Where to go next

**Building a declarative plugin:** read
[DECLARATIVE-PLUGINS.md](./DECLARATIVE-PLUGINS.md), then
[DECLARATIVE-REFERENCE.md](./DECLARATIVE-REFERENCE.md) for the full grammar.

**Building a compiled-in plugin:**

1. **[QUICKSTART.md](./QUICKSTART.md)** — get the reference template running
   locally in a few minutes.
2. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — the extension-point catalog and how
   the plugin system fits together.
3. **[BUILD-A-PLUGIN.md](./BUILD-A-PLUGIN.md)** — a step-by-step build, including
   a full transformer-step example and the Java server half.
4. **[LOCAL-SETUP.md](./LOCAL-SETUP.md)** — development environment, build
   commands, and the quality gates your plugin must pass.
5. **[SECURITY.md](./SECURITY.md)** and **[TESTING.md](./TESTING.md)** — the
   security and testing requirements your plugin is reviewed against.
6. **[CHECKLIST.md](./CHECKLIST.md)** — the pre-flight gate covering the build,
   security, and testing checks before you engage Innovar.
