# Release Notes

## 26.9.1 (October 28, 2026)

This is a security patch. It moves the Web Administrator to Node.js 22.23.4, which
fixes a remote code execution flaw in Node.js, and updates Next.js to fix critical
advisories. It also changes how the service is installed so it no longer runs with
full system rights. Upgrade as soon as you can.

**Before you upgrade,** read [Upgrade notes for 26.9.1](#upgrade-notes-for-2691) if you
install on Linux or macOS with your own Node.js, run the tarball or zip on an offline
machine, or set your own certificate in `webadmin.conf`.

---

### Security

- **Node.js 22.23.4.** Earlier Node.js 22 releases have a flaw in their Brotli
  decompression that lets a server the Web Administrator connects to run code on the
  Web Administrator's host (CVE-2026-111497). The Windows installer installs 22.23.4,
  the Docker image is built on it, and the tarball and zip start scripts download it
  when the Node.js they find is older.
- **Next.js 16.4.3,** which fixes critical advisories in Next.js 16.0.0 to 16.4.0.
- **The service no longer runs with full system rights.** On Linux it runs as its own
  account, `blwebadmin` (`_blwebadmin` on macOS), instead of root. On Windows it runs
  as `NT SERVICE\BridgeLinkWebAdmin` instead of LocalSystem.
- **Windows: locked-down runtime and certificate folders.** Setup takes over
  `%ProgramData%\BridgeLink\.node` and `%ProgramData%\BridgeLink\certs`, so other local
  users can no longer place files next to `node.exe` or read the TLS private key.

### Fixes

- Upgrading no longer drops lines you added to `webadmin.conf` by hand, such as
  `BRIDGELINK_CA_CERT`. Before, an upgrade could silently turn off certificate pinning.

---

### Upgrade notes for 26.9.1

- **Linux and macOS: Node.js 22.23.4 or later is required.** `install.sh` stops on an
  older Node.js 22, before it changes anything, and prints the command to upgrade it.
  Your current install keeps running. `BL_ALLOW_UNSUPPORTED_NODE=1` installs anyway,
  which is not supported and leaves the flaw in place.
- **Tarball and zip installs.** The start scripts download Node.js 22.23.4 once if the
  Node.js they find is older or a different major version. On a machine without
  internet access, install Node.js 22.23.4 or a later 22.x by hand first.
- **Your own certificate in `webadmin.conf`.** The service account must be able to read
  both files. On Linux and macOS, `install.sh` checks this and stops with the commands
  to fix the permissions if it cannot. On Windows, if the service account cannot be
  set, the service stays on LocalSystem and Setup writes the reason to its log in the
  install folder's `logs` directory.
- **Windows: `%ProgramData%\BridgeLink` must not be a link or owned by another user.**
  Setup stops if it is, and its log gives the commands to fix it.
- **Docker.** Pull the `26.9.1` image. Images already published keep the old Node.js.

### Compatibility

- **BridgeLink server:** 26.3.0 or newer, unchanged from 26.9.0.
- **Node.js:** 22.23.4 or a later 22.x for the tarball and zip installs (26.9.0 accepted
  any 22.x).
- **Browsers:** current versions of Chrome, Edge, Firefox, and Safari.

When reporting a bug, please include the build identifier (`26.9.1`). See
[Getting help](#getting-help).

---

## 26.9.0 (September 30, 2026)

This release lets server extensions add their own screens to the Web Administrator
with a JSON manifest, adds diagnostics for channels stuck stopping or starting, and
moves several editor checks onto the server so they match the engine exactly. It
also includes security hardening and a long list of fixes that bring behavior in
line with the Java administrator.

**Before you upgrade,** read [Upgrade notes](#upgrade-notes) if you use
multi-factor login, run behind a reverse proxy without a configured server URL, set a TLS certificate or
`BRIDGELINK_CA_CERT` in `webadmin.conf`, or use DICOM connectors.

---

### Highlights

- **Declarative plugins.** A server extension can now add Web Administrator UI by
  shipping a `webadmin.json` manifest: connector and settings panels, transmission
  modes, sections inside other connectors, filter and transformer steps, data
  types, and map, list, and table fields. The Web Administrator draws the manifest
  with its own form components, so no plugin code runs in the browser. See
  [Declarative plugins](./plugins/DECLARATIVE-PLUGINS.md).
- **Manifest Preview.** Plugin authors can paste a manifest and see it rendered live,
  with working examples and a built-in reference. Open **Extensions** and choose
  **Manifest Preview**.
- **Stuck-channel diagnostics.** The Dashboard flags a channel that has been
  Stopping or Starting longer than the server's stop grace period. The new
  **Thread Diagnostics** dialog shows what each of the channel's threads is doing
  and what the last stop or halt was waiting on, and copies the report as text
  for a support ticket. It contains thread names and stack frames, never message content.
  Settings > Server gains a stop grace period setting, and Halt now asks for
  confirmation.
- **Editor checks that match the engine.** JavaScript validation, cron expression
  checks and next-fire-time previews, the message tree preview, the script
  reference list and autocomplete, and built-in connector defaults now come from
  the server, so they agree with what the engine will actually do.
- **Message template Preview.** The Message Templates tab has a **Preview** button
  that shows a template with its `${...}` variables resolved.

### Improvements

- **Config Search.** Back returns to your results. Opening a match goes to the
  exact filter rule or transformer step and line. Mapper, Message Builder, Rule
  Builder, XSLT, External Script, and Destination Set Filter steps, and scripts
  inside Iterators, are now searched, so expect more results than before.
- **New channel in a group.** Right-click a group, or a channel inside one, and
  choose **New Channel** to create the channel directly in that group.
- **Message Browser.** A **Line Endings** toggle shows each line's CR/LF characters
  in the content viewer. Paging and result counts now match the Java administrator.
- **Flow View.** The filter and transformer badges on connector cards open the
  matching editor.
- **Code editor.** JSDoc comment blocks are highlighted separately from ordinary
  comments. The Font setting now takes effect: JetBrains Mono, Fira Code, and
  Cascadia Code ship with the application.
- **Channel scripts.** The Scripts tabs now read Deploy, Undeploy, Preprocessor,
  Postprocessor and open on Deploy, as in the Java administrator.
- **Export.** Exporting several channels or groups follows the "Export code
  template libraries with channels" preference instead of always asking.
- **Backup and restore.** Server backups record their date. Restore checks the
  file first and refuses a backup made by a newer BridgeLink version.
- **Lookup Manager.** Values whose key contains `/`, `%`, or `\` can now be viewed,
  edited, and deleted.
- **Login.** When the server is set by configuration, the login page says so under
  the read-only Server field.
- **Licensed plugins.** A plugin page your license does not cover shows an upgrade
  prompt.
- **Narrow windows.** The Export Results and Import Message dialogs now fit at
  split-screen widths.

### Fixes

- Uninstalling an extension now removes it. Before, it came back after a server
  restart.
- JavaScript validation no longer rejects valid regular expressions such as
  `(?::...)`, or regex and string literals inside template literals.
- The Attachment Handler's **Validate JS** button checks the current script, not
  the previous version.
- Message content that looks like a number (for example `10e33`) is shown exactly
  as stored.
- Code template import allows two templates with the same name in different
  libraries.
- Deleting a tag that is in use as a Dashboard or Channels filter no longer leaves
  a filter you cannot clear.
- Switching channels in the Message Browser drops metadata search criteria the new
  channel does not have, instead of failing the search.
- Lookup Advanced Search no longer offers Contains and Not Contains, which the
  server does not support.
- Undeploy is disabled when any selected channel cannot be undeployed, instead of
  undeploying only some of them.
- Settings > Resources no longer re-sorts the table while you type, keeps the
  settings of resource types it does not recognize, and validates the Default
  Resource directory.
- The Columns menu is no longer cut off when the message detail pane is docked.
- Message Browser **Export CSV** and **Export Results** to My Computer are now
  recorded in the server's audit log, like exports to the server.
- A server on a newer patch of the same release line (for example 26.9.1) no
  longer triggers the "newer than this build" notice.
- On a server older than 26.9, a plugin that declares a data type keeps its other
  screens. The Extensions page explains why the data type is unavailable.
- A user whose password is in its grace period can change it from the Web
  Administrator when the server restricts grace-period sessions.

### Security

- CSV exports neutralize spreadsheet formulas, so a cell starting with `=`, `+`,
  `-`, or `@` cannot run as a formula when the file is opened in Excel.
- In same-host mode, the Web Administrator no longer trusts the request's `Host`
  header by default when choosing which BridgeLink server to connect to (see
  [Upgrade notes](#upgrade-notes)).
- The first login on a new install requires setting a new password.
- Importing messages from your computer enforces limits: 100 MB per file,
  500 MB unpacked in total, and 100,000 entries per archive.
- Logging out clears all cached server data from the browser.
- Multi-factor login supports the single-use check that BridgeLink 26.9 servers
  require.
- Critical and high-severity advisories in production dependencies are resolved.

---

### Upgrade notes

- **Multi-factor login: upgrade the Web Administrator first.** A 26.9.0 server
  requires a single-use check that Web Administrator 26.6.0 does not send, so
  26.6.0 cannot complete a multi-factor login against it. Upgrade the Web
  Administrator before, or together with, the server. Password-only logins are
  not affected.
- **Same-host mode behind a reverse proxy.** This applies only if you set neither
  `BRIDGELINK_SERVER_URL` nor `BRIDGELINK_ALLOWED_SERVERS`. The Web Administrator
  no longer derives the server from the `Host` header. Set `BRIDGELINK_PUBLIC_HOST`
  (recommended) or `BRIDGELINK_SERVER_URL`. Set `TRUST_PROXY_HOST=true` only if
  your proxy pins the `Host` header.
- **TLS certificate in `webadmin.conf`.** `SSL_CERT_FILE` and `SSL_KEY_FILE` set in
  `webadmin.conf` were previously ignored, and a self-signed certificate was
  served. They are now used. Check that both paths point to valid files before
  you upgrade.
- **`BRIDGELINK_CA_CERT` on the Windows service.** This setting in `webadmin.conf`
  was previously ignored on the Windows service. It is now enforced. If the
  certificate does not match your BridgeLink server, every login fails until you
  correct it.
- **DICOM timeouts.** Five DICOM Listener and Sender timeout fields were labeled
  in seconds, but the engine has always read them as milliseconds. The labels now
  say milliseconds. Your saved values are unchanged, so check any value that was
  entered as seconds: `30` means 30 milliseconds.
- **Config Search** returns more matches than before, because more step types are
  searched.

### Compatibility

- **BridgeLink server:** 26.3.0 or newer, unchanged from 26.6.0.
- **Features that need a 26.9.0 server:** stuck-channel diagnostics, message template
  Preview, server-side editor checks, Lookup keys containing `/`, `%`, or `\`, and
  declarative data types and some other plugin features (see
  [Declarative plugins](./plugins/DECLARATIVE-PLUGINS.md)). On an older server,
  these features are hidden or fall back to the 26.6 behavior.
- **Node.js:** 22.x for the tarball and zip installs, unchanged.
- **Browsers:** current versions of Chrome, Edge, Firefox, and Safari.

When reporting a bug, please include the build identifier (`26.9.0`). See
[Getting help](#getting-help).

---

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
  [github.com/Innovar-Healthcare/BridgeLink-WebAdmin](https://github.com/Innovar-Healthcare/BridgeLink-WebAdmin)

When reporting a bug, please include the build identifier (`26.6.0`), your browser
and OS, what you were doing, and any browser-console errors. See
[WELCOME.md](./WELCOME.md#what-to-include-in-a-bug-report) for the full checklist.
