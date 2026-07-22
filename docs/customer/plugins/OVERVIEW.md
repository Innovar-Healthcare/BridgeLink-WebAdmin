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

## How plugins work, in one minute

A plugin is **TypeScript/React source** in its own directory that **registers
itself** into the application's extension points at startup. The core app never
references your plugin by name — it just reads from the registries your plugin
fills in.

The one constraint that shapes everything else:

> **Web Administrator plugins compile into the application at build time. There is no
> runtime install.** A plugin must be present in the source tree when the
> application is built. You cannot drop a plugin archive onto a running server
> the way you can with a server-side Java extension.

This is why the canonical way to ship a plugin to customers is to have Innovar
**include it in the standard distribution**. A plugin that's present in the build
but not licensed stays dormant and invisible, so one distribution can safely
carry every approved plugin. Activation is controlled by the server: the Web Administrator
asks the server which plugins are entitled, and only those light up.

Many plugins also have a **Java server half** (a connector, transformer, or REST
service) that _is_ installed at runtime on the BridgeLink server. The two halves
talk only over BridgeLink's REST API. A **UI-only plugin** has no server half at
all.

> **On the roadmap — declarative runtime plugins (no client code).** The
> build-time constraint above applies to today's TypeScript/React plugins. A
> declarative runtime model is in active development that removes it for the most
> common case. A plugin ships a small JSON manifest (`webadmin.json`) _inside its
> own extension package_, and the Web Administrator renders it with its own
> built-in components — **no plugin code runs in the browser, and no Web
> Administrator rebuild or redistribution is required.** The manifest describes
> connector and settings panels — fields, layout, show/enable-when logic, and
> validation — declaratively, so a properties-editor plugin will install on a
> running instance the same way a server-side extension does today. The
> compiled-in path documented in these guides remains fully supported for UI that
> needs custom rendering beyond a form. Packaging, review, and licensing details
> for third-party declarative contributions will be published alongside the
> feature.

---

## What you can build

A plugin can register into any of these extension points (full details and code
in [ARCHITECTURE.md](./ARCHITECTURE.md)):

| Surface             | Examples                                                           |
| ------------------- | ------------------------------------------------------------------ |
| **Settings**        | A settings tab for your plugin's configuration                     |
| **Navigation**      | A full page at `/p/{slug}` with a sidebar item                     |
| **Authentication**  | A single sign-on section on the login page; RBAC permission rules  |
| **Channel editor**  | Extra tabs, connector types, connector sections, transformer steps |
| **Message formats** | Custom data types, transmission/framing modes, attachment viewers  |
| **Routes**          | Plugin-owned pages (e.g. OAuth callbacks) and API handlers         |

---

## The lifecycle at a glance

```
   Develop                Verify                 Ship
   ───────                ──────                 ────
1. Copy the template   4. tsc + tests + build  6a. Partner: submit source
2. Register into          all pass                 → review → included in
   extension points    5. App still builds          the standard build
3. Build the UI           with your plugin       6b. In-house: source review +
   (and Java half)         removed                    license → your build
```

Both paths run through Innovar — the partner path for review and inclusion, the
in-house path for source review and BSL authorization.

---

## Where to go next

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
