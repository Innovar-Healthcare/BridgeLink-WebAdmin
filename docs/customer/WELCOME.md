# Welcome to BridgeLink Web Administrator

BridgeLink Web Administrator is a modern, browser-based admin interface for
the BridgeLink integration engine. It replaces the legacy Java Swing
administrator with full feature parity and a faster, more responsive
experience — no Java runtime, no per-workstation install of the admin client,
and a UI that works on any modern browser.

---

## Getting installed

Pick the format that fits your environment:

| Format                        | Best for                                                      | See                                        |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| **Docker image**              | Linux servers, multi-user deployments                         | [INSTALL-DOCKER.md](./INSTALL-DOCKER.md)   |
| **Linux tarball** (`.tar.gz`) | Linux servers without Docker, or restrictive network policies | [INSTALL-TARBALL.md](./INSTALL-TARBALL.md) |
| **Windows zip** (`.zip`)      | Windows servers, single-user testing                          | [INSTALL-TARBALL.md](./INSTALL-TARBALL.md) |

Before installing, confirm your environment meets
[SYSTEM-REQUIREMENTS.md](./SYSTEM-REQUIREMENTS.md).

The legacy Java administrator remains available — your BridgeLink server still
accepts it, and switching between the two is non-destructive.

---

## Licensing

BridgeLink Web Administrator is distributed under the **Business Source License
1.1**. In brief:

- You may **copy, modify, create derivative works of, and redistribute** it for
  **non-production** use — development, evaluation, and building extensions.
- You may run it in **production**, but only as the administration or operational
  layer for your own BridgeLink integration engine, and only within the license's
  Additional Use Grant — chiefly internal use within your organization, and
  single-tenant deployments where the end customer independently controls and
  operates the instance.
- Offering it as a hosted, managed, or SaaS service to third parties (OEM use), or
  using it with an integration engine other than BridgeLink (competing use),
  requires a separate commercial license.
- Three years after each version is released, that version converts to the Mozilla
  Public License 2.0.

This plain-language summary is not a substitute for the license — see the
[LICENSE](../../LICENSE) file for the authoritative terms. For commercial
licensing, contact Innovar Healthcare.

---

## Getting help

- **Slack — for questions, discussion, and quick help:**
  [bridgelink.innovarhealthcare.com](https://bridgelink.innovarhealthcare.com)

- **GitHub Issues — for bugs and feature requests:**
  [github.com/Innovar-Healthcare/BridgeLink-WebAdmin](https://github.com/Innovar-Healthcare/BridgeLink-WebAdmin)

### What to include in a bug report

Including these details speeds up our response significantly:

1. **Build identifier** — the image tag (e.g. `26.6.0`) or the artifact filename you installed
2. **Browser and OS** — e.g. "Chrome 124 on Windows 11" or "Safari 17 on
   macOS 14"
3. **What you were trying to do** — one sentence is fine
4. **What happened vs. what you expected**
5. **Steps to reproduce** if you can isolate them
6. **Browser console errors** if you can copy them (open DevTools →
   Console)

Screenshots and short screen recordings are very welcome.

---

## What's next

1. Confirm the [system requirements](./SYSTEM-REQUIREMENTS.md) for your
   target environment
2. Install via [Docker](./INSTALL-DOCKER.md) or [tarball/zip](./INSTALL-TARBALL.md)
3. Log in with your existing BridgeLink credentials
