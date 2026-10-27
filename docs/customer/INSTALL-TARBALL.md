# Installing BridgeLink Web Administrator — Tarball / Zip

This guide covers running BridgeLink Web Administrator from the Linux
tarball (`.tar.gz`) or Windows zip artifact. No build tools are required —
the artifact is fully self-contained.

For hardware, OS, browser, and network requirements, see
[SYSTEM-REQUIREMENTS.md](./SYSTEM-REQUIREMENTS.md).

---

## Prerequisites

None. **Node.js is downloaded automatically on first launch** if it is not already installed.

The start scripts (`start-https.sh` / `start-https.bat`) check for Node.js 22 (22.23.4 or
later) and, if it is missing, older, or another major version, download the official binary
from nodejs.org into a local `.node/` folder next to the script. An internet connection is
required only on that run; subsequent launches are fully offline. A WebAdmin upgrade that raises
the minimum version downloads once more.

If you prefer to install Node.js yourself before running the app, download the LTS installer
from [nodejs.org](https://nodejs.org) and select the latest **Node.js 22.x** (22.23.4 or
later). The scripts will detect it and skip the automatic download.

---

## Receiving the Artifact

The artifact is delivered as a zip file (e.g. `bridgelink-webui.zip`).
Extract it to any directory on the machine:

```bash
unzip bridgelink-webui.zip -d bridgelink-webui
```

The extracted folder contains:

```
bridgelink-webui/
  start-https.sh     ← launcher (start-https.bat on Windows) — run this
  server.js          ← Next.js server (HTTPS when SSL_CERT_FILE + SSL_KEY_FILE are set, else plain HTTP)
  webadmin.conf      ← runtime configuration — the port and BridgeLink server URL
  certs/             ← place your TLS certificate and key here
    server.crt
    server.key
  node_modules/      ← all dependencies (pre-bundled, no npm install needed)
  public/            ← static assets
  .next/             ← compiled application code
  WELCOME.md         ← start here
  docs/              ← full documentation set
```

No `npm install` is required. Everything is already bundled.

---

## Configuration

Configuration comes from two places:

- **`webadmin.conf`** — a small text file beside `server.js` in the extracted folder. It
  holds the listening port, the BridgeLink server URL, and (optionally) the TLS certificate
  and key paths and the BridgeLink CA certificate. Edit it with any text editor; changes take
  effect on the next start.
- **Environment variables** — everything else: cookie and proxy behavior. The TLS certificate
  paths (`SSL_CERT_FILE` / `SSL_KEY_FILE`) and `BRIDGELINK_CA_CERT` may be set **via
  `webadmin.conf` or environment**.

> **Important:** `webadmin.conf` is the source of truth for the settings it contains, and it
> **overrides the environment**. Setting `PORT` or `BRIDGELINK_SERVER_URL` as environment
> variables has no effect on this install type — edit `webadmin.conf` instead.

As shipped, the file contains:

```
PORT=3000
BRIDGELINK_SERVER_URL=https://localhost:8443
```

| Variable                 | Set via                      | Required   | Default                  | Description                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRIDGELINK_SERVER_URL`  | `webadmin.conf`              | No         | `https://localhost:8443` | URL of the BridgeLink server, e.g. `https://10.0.0.5:8443`. Shown pre-set and read-only on the login screen. If blanked, the login screen derives `https://<host>:8443` from `BRIDGELINK_PUBLIC_HOST` (or from the request `Host` header only when `TRUST_PROXY_HOST=true` — see.                                                                               |
| `PORT`                   | `webadmin.conf`              | No         | `3000`                   | TCP port the application listens on.                                                                                                                                                                                                                                                                                                                                      |
| `BRIDGELINK_CA_CERT`     | webadmin.conf or environment | No         | (none)                   | Absolute path to a PEM file (CA or self-signed cert) for the BridgeLink TLS hop. When set, full cert verification is enabled. When unset, self-signed certs are accepted automatically. Do **not** set `NODE_TLS_REJECT_UNAUTHORIZED`. A `webadmin.conf` value wins over the environment.                                                                                 |
| `BRIDGELINK_PUBLIC_HOST` | Environment                  | No         | (none)                   | Trusted public hostname (or `host:port`) of this Web UI. Used in `sameHost` allowlist mode so the BridgeLink server derivation cannot be spoofed via a forged `Host` header. **Required** in `sameHost` mode as of unless an explicit `BRIDGELINK_SERVER_URL` / `BRIDGELINK_ALLOWED_SERVERS` is set — the request `Host` header is no longer trusted by default. |
| `SSL_CERT_FILE`          | webadmin.conf or environment | HTTPS only | (none)                   | Absolute or relative path to the TLS certificate PEM file. Required for HTTPS with `node server.js`. Set it in `webadmin.conf` (uncomment the shipped example row) or as an environment variable — a `webadmin.conf` value wins.                                                                                                                                          |
| `SSL_KEY_FILE`           | webadmin.conf or environment | HTTPS only | (none)                   | Absolute or relative path to the TLS private key PEM file. Required for HTTPS with `node server.js`. Set it in `webadmin.conf` (uncomment the shipped example row) or as an environment variable — a `webadmin.conf` value wins.                                                                                                                                          |
| `COOKIE_SECURE`          | Environment                  | No         | auto                     | Override cookie `Secure` flag and HSTS. `true` forces secure; `false` disables both (use for intentional plain-HTTP deployments).                                                                                                                                                                                                                                         |
| `TRUST_PROXY`            | Environment                  | No         | `true`                   | Set to `false` to ignore `X-Forwarded-Proto` headers (disables HTTPS detection via reverse proxy). Governs cookie `Secure`/HSTS only — not `sameHost` server derivation.                                                                                                                                                                                                  |
| `TRUST_PROXY_HOST`       | Environment                  | No         | `false`                  | `sameHost` mode only. Set to `true` to derive the BridgeLink origin from the request `Host` header when `BRIDGELINK_PUBLIC_HOST` is unset. Enable **only** if a fronting proxy pins `Host`; otherwise a spoofed `Host` can retarget the upstream hop. Prefer `BRIDGELINK_PUBLIC_HOST`.                                                                         |

`webadmin.conf` recognizes seven settings in total: `PORT`, `BRIDGELINK_SERVER_URL`,
`BRIDGELINK_ALLOWED_SERVERS`, `BRIDGELINK_PUBLIC_HOST`, `SSL_CERT_FILE`, `SSL_KEY_FILE`, and
`BRIDGELINK_CA_CERT`. Only `PORT` and `BRIDGELINK_SERVER_URL` are present in the shipped file;
the other five (including the two SSL paths and the CA certificate, shipped commented-out) can
be set through the environment — but
if you add any of them to `webadmin.conf`, the file wins for it too. Any other setting is
ignored if placed in the file.

---

## TLS Certificates

The start scripts generate a self-signed certificate automatically on first HTTPS launch —
no manual steps needed. Where the generated files land depends on the platform and install
mode:

| Mode                                   | Generated cert location                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| Linux / macOS (tarball)                | `./certs` beside `server.js`                               |
| Windows tarball / no-service installer | `%LOCALAPPDATA%\BridgeLink\certs` (no admin rights needed) |
| Windows service (NSSM) installer       | `%ProgramData%\BridgeLink\certs`                           |

Browsers will show a one-time "connection not private" warning for self-signed certificates.
Click **Advanced → Proceed** (Chrome) or **Accept the Risk** (Firefox) to continue.

**Bring your own (CA-issued) certificate.** Place your `server.crt` and `server.key` files in
the `certs/` folder beside the launcher (on Windows this is the `.\certs` folder next to
`start-https.bat`) before launching. The scripts detect an existing pair and skip generation.
Alternatively, point `SSL_CERT_FILE` / `SSL_KEY_FILE` at any path via `webadmin.conf` or the
environment — a supplied value is honored on every delivery channel and wins over the default
`certs/` location.

---

## Starting the Server

The start scripts handle everything — including downloading Node.js automatically on first run
if it is not already installed. **Do not call `node` directly.**

---

### Windows

Double-click **`start-https.bat`** in Explorer, or run it from any terminal
(Command Prompt or PowerShell):

```cmd
.\start-https.bat
```

> **Important:** always run the `.bat` file, not the `.ps1` directly. The `.bat` bypasses
> Windows script execution policy automatically. Running `.\start-https.ps1` directly will
> fail with an "Unauthorized Access" error unless your system policy allows unsigned scripts.

The script will:

1. Download Node.js 22 automatically if it is not installed or is older than 22.23.4 (one-time,
   requires internet)
2. Use a `.\certs\server.crt` + `.\certs\server.key` pair if you dropped one there; otherwise
   generate a self-signed certificate into `%LOCALAPPDATA%\BridgeLink\certs` (one-time, no
   admin rights needed)
3. Start the HTTPS server on **https://localhost:3000**

> **Note:** All platforms are HTTPS-only. Use `start-https.sh` (Linux/macOS) or `start-https.bat` (Windows).

To point the app at your BridgeLink server, edit the `BRIDGELINK_SERVER_URL` line in
`webadmin.conf` (in the same folder as `start-https.bat`) before launching:

```
BRIDGELINK_SERVER_URL=https://10.0.0.5:8443
```

Then run `.\start-https.bat`. Setting this as an environment variable will not work —
`webadmin.conf` overrides it.

---

### macOS / Linux

```bash
cd bridgelink-webui
./start-https.sh
```

To point the app at your BridgeLink server, edit the `BRIDGELINK_SERVER_URL` line in
`webadmin.conf` (in the same folder as `start-https.sh`) before launching:

```
BRIDGELINK_SERVER_URL=https://10.0.0.5:8443
```

Then run `./start-https.sh`. Setting this as an environment variable will not work —
`webadmin.conf` overrides it.

---

### Custom port

Edit the `PORT` line in `webadmin.conf`:

```
PORT=8443
```

Then start the server normally (`./start-https.sh` or `start-https.bat`). The port takes
effect on the next start.

> Setting `PORT` as an environment variable has no effect on this install type —
> `webadmin.conf` overrides it. Change the file.

---

## Logging In

1. Open **https://localhost:3000** in a browser.
2. The **Server** field is pre-set and read-only — it shows `BRIDGELINK_SERVER_URL` from
   `webadmin.conf`, or `https://<the host you browsed to>:8443` if that value was blanked.
   If it is not the server you want, correct `BRIDGELINK_SERVER_URL` in `webadmin.conf` and
   restart.
3. Enter your BridgeLink username and password.
4. Click **Login**.

> To let users pick from several BridgeLink servers, set `BRIDGELINK_ALLOWED_SERVERS` to a
> comma-separated list. The login screen then shows a dropdown instead of a fixed value.
> This one is read from the environment, since it is not in the shipped `webadmin.conf`.

---

## Running as a Background Service (optional)

To keep the server running after closing the terminal, use a process manager.

### macOS / Linux — using `pm2`

Set the port and BridgeLink server URL in `webadmin.conf` first — `server.js` reads the file
from its own folder, so pm2 picks them up automatically. Only the TLS paths are passed as
environment variables:

```bash
npm install -g pm2

cd bridgelink-webui

SSL_CERT_FILE=./certs/server.crt \
SSL_KEY_FILE=./certs/server.key \
pm2 start server.js --name bridgelink-webui

pm2 save              # persist across reboots
pm2 startup           # follow the printed instructions to enable auto-start
```

Check status:

```bash
pm2 status
pm2 logs bridgelink-webui
```

Stop the server:

```bash
pm2 stop bridgelink-webui
```

### Windows — running in the background

On Windows, use [NSSM](https://nssm.cc) or the Windows Task Scheduler to run
`start-https.bat` as a background service. Set the port and BridgeLink server URL in
`webadmin.conf` — the service picks them up from the file. Any other settings go in the
service configuration as environment variables.

---

## HTTPS Options

### Built-in TLS (simplest — no extra tools)

Run `server.js` with `SSL_CERT_FILE` and `SSL_KEY_FILE` set (the start scripts do this
automatically). When both variables are present, `server.js` terminates TLS directly and
binds the public `PORT` as an HTTPS server.

### External reverse proxy (for production with a CA-issued certificate)

If you prefer to terminate TLS outside the Node.js process:

- **Nginx** — proxy `https://your-domain:443` → `http://localhost:3000` (using `server.js`)
- **Caddy** — automatic TLS with a one-line `Caddyfile`
- **Load balancer** — AWS ALB, Azure Application Gateway, etc.

In this case, run `node server.js` (plain HTTP, without `SSL_CERT_FILE`/`SSL_KEY_FILE`) and
let the reverse proxy handle TLS.

---

## Troubleshooting

### `node: command not found` / download fails on first run

The start script could not find Node.js 22 (22.23.4 or later) and the automatic download failed
(no internet access, firewall, or proxy blocking nodejs.org). To resolve:

1. Download the Node.js 22 LTS installer (22.23.4 or later) manually from
   [nodejs.org](https://nodejs.org) on a machine with internet access.
2. Install it on the target machine and re-open the terminal.
3. Re-run the start script — it will detect the installed version and skip the download.

### Login fails immediately with a network error

- Check that `BRIDGELINK_SERVER_URL` in `webadmin.conf` points to the correct host and port.
- If the BridgeLink server uses a self-signed certificate, it is accepted
  automatically — no extra env var needed. To pin a specific CA cert instead,
  set `BRIDGELINK_CA_CERT=/path/to/ca.pem` in `webadmin.conf` or the environment.
- Confirm the BridgeLink server is reachable: `curl -k https://10.0.0.5:8443/api/server/version`

### `EADDRINUSE: address already in use :::3000`

Port 3000 is taken by another process. Stop the other process, or change the port by editing
`webadmin.conf`:

```
PORT=8443
```

Then re-run the start script. Prefixing the command with `PORT=...` will not work —
`webadmin.conf` overrides it.

### Browser shows "Your connection is not private" / certificate warning

This is expected when using a self-signed certificate. Click **Advanced → Proceed** (Chrome)
or **Accept the Risk and Continue** (Firefox) to bypass the warning for local testing.
In production, use a certificate issued by a trusted CA (e.g. Let's Encrypt) to avoid this.

### Session expires unexpectedly

This is normal — BridgeLink sessions time out after a period of inactivity.
Log in again to resume the session.
