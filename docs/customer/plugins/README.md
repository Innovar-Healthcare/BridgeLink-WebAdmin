# Building BridgeLink Web Administrator Plugins

A developer SDK for extending the BridgeLink Web Administrator with your own
plugins — settings tabs, pages, connector types, transformer steps, single
sign-on, access control, and more.

> Building plugins is for developers. If you only need to **configure** plugins
> you've purchased, you don't need these guides.

Read in this order:

1. **[OVERVIEW.md](./OVERVIEW.md)** — what plugins are, who this is for, and the
   one constraint that shapes everything (build-time, no runtime install).
2. **[QUICKSTART.md](./QUICKSTART.md)** — copy the reference template and see a
   plugin load in about ten minutes.
3. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — the extension-point catalog and how
   the plugin system fits together.
4. **[BUILD-A-PLUGIN.md](./BUILD-A-PLUGIN.md)** — a step-by-step build, with a
   full transformer-step example and the Java server half.
5. **[LOCAL-SETUP.md](./LOCAL-SETUP.md)** — environment, build commands, and the
   quality gates your plugin must pass.
6. **[SECURITY.md](./SECURITY.md)** — the security requirements your plugin is
   reviewed against (data boundaries, secrets, XSS, authorization, dependencies).
7. **[TESTING.md](./TESTING.md)** — tooling, what to test, and coverage
   expectations.
8. **[CHECKLIST.md](./CHECKLIST.md)** — the pre-flight gate that pulls all of
   the above together.

The ready-to-copy scaffold lives in **[template/](./template/)** (the Web
Administrator half of a plugin).

For the rest of the BridgeLink Web Administrator documentation, see the
[customer docs index](../README.md).
