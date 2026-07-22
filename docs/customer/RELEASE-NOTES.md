# Release Notes

## 26.6.0 — General Availability (July 20, 2026)

This is the first general-availability release of **BridgeLink Web
Administrator**, a modern, browser-based replacement for the legacy Java Swing
administrator. It ships with **full feature parity** with the Swing client — every
tab, column, filter, dialog, and behavior — plus a faster, more responsive
experience that needs no Java runtime and no per-workstation install.

Point your browser at the server and log in with your existing BridgeLink
credentials. The legacy Java administrator remains fully supported and switching
between the two is non-destructive, so you can adopt the Web Administrator at your
own pace.

---

### Highlights

- **No install, no Java client.** Administer BridgeLink from any modern browser.
  Nothing to deploy to each workstation, nothing to keep in sync with the server.
- **Full parity with the Java Swing administrator.** The Java client was treated
  as the source of truth for every calculation, highlight rule, column order,
  filter, and API call — so behavior matches what your team already knows.
- **Efficient by design.** The Web Administrator mirrors the Java client's
  delta-fetch and paging patterns and calls the same server endpoints, so audit
  logging, authorization, and server load stay consistent with the Swing client.
- **Light and dark themes, adjustable view density,** and per-user column layouts
  that persist across sessions.

### What's included

- **Dashboard** — live channel and connector statuses, per-channel statistics and
  trends, and all channel/connector operations (start, stop, pause, halt, deploy,
  undeploy, clear statistics) from both the toolbar and context menus.
- **Channels** — channel and group management with the full metadata view: revision
  deltas, deployed dates, tags, dependencies, and last-modified tracking.
- **Channel Editor** — Summary, Source, Destinations, and connector configuration
  for every supported connector type, plus filters, transformers, iterators, and
  the full transformer/filter step library.
- **Message Browser** — search, view, and export messages and attachments;
  reprocess and remove messages at channel and connector scope, with the same
  destructive-operation confirmations as the Java client.
- **Events** — the full server event log with filtering, paging, count, and
  jump-to-page.
- **Alerts, Users, Code Templates, Global Scripts, and Lookup tables.**
- **Settings** — server, administrator, and data-pruner settings with live
  refresh.
- **Extensions** — view installed server plugins and their status.
- **Integrated code editing** — a self-hosted Monaco editor with JavaScript/E4X
  syntax highlighting and validation across every script surface.

### Plugin support

The Web Administrator ships with the plugin surfaces used by BridgeLink's
commercial add-ons — Access Control, OIDC single sign-on, SSL/certificate
management, SIEM, License Manager, and more — as well as the built-in
**Version History** plugin. Availability of commercial plugins is governed by your
license.

Developers can extend the Web Administrator with their own plugins (settings tabs,
pages, connectors, and SSO integrations). See the
[plugin developer guide](./plugins/README.md).

---

### Installation

Choose the format that fits your environment:

| Format                        | Best for                              | Guide                                      |
| ----------------------------- | ------------------------------------- | ------------------------------------------ |
| **Docker image**              | Linux servers, multi-user deployments | [INSTALL-DOCKER.md](./INSTALL-DOCKER.md)   |
| **Linux tarball** (`.tar.gz`) | Linux servers without Docker          | [INSTALL-TARBALL.md](./INSTALL-TARBALL.md) |
| **Windows zip** (`.zip`)      | Windows servers, single-user testing  | [INSTALL-TARBALL.md](./INSTALL-TARBALL.md) |

Confirm your environment first: [SYSTEM-REQUIREMENTS.md](./SYSTEM-REQUIREMENTS.md).

### Compatibility

- **BridgeLink server:** version **26.3.0 or newer**. The Web Administrator checks
  the server version at login and blocks against servers older than the minimum;
  a server newer than this build shows a dismissible notice.
- **Browsers:** current versions of Chrome, Edge, Firefox, and Safari.

### Licensing

BridgeLink Web Administrator is distributed under the **Business Source License
1.1**. Production use is permitted only within the scope of the Additional Use
Grant; other uses may require a separate commercial license. See
[LICENSE](../../LICENSE) for the authoritative terms, and
[WELCOME.md](./WELCOME.md#licensing) for a plain-language summary. For commercial
licensing, contact Innovar Healthcare.

### Notes for this release

- The legacy Java Swing administrator remains available and supported. Both clients
  can be used against the same server.
- Per-user preferences (column widths and visibility, theme, view density) are
  stored in the browser. Clearing site data or switching browsers resets them.

### Getting help

- **Slack** — questions, discussion, quick help:
  [bridgelink.innovarhealthcare.com](https://bridgelink.innovarhealthcare.com)
- **GitHub Issues** — bugs and feature requests:
  [github.com/Innovar-Healthcare/BridgeLink-Webadmin](https://github.com/Innovar-Healthcare/BridgeLink-Webadmin)

When reporting a bug, please include the build identifier (`26.6.0`), your browser
and OS, what you were doing, and any browser-console errors. See
[WELCOME.md](./WELCOME.md#what-to-include-in-a-bug-report) for the full checklist.
