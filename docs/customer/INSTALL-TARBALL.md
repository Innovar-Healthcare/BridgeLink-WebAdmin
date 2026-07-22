# Installing BridgeLink Web Administrator — Tarball / Zip

This guide covers running BridgeLink Web Administrator from the Linux
tarball (`.tar.gz`) or Windows zip artifact. No build tools are required —
the artifact is fully self-contained.

For hardware, OS, browser, and network requirements, see
[SYSTEM-REQUIREMENTS.md](./SYSTEM-REQUIREMENTS.md).

---

## Prerequisites

None. **Node.js is downloaded automatically on first launch** if it is not already installed.

The start scripts (`start-https.sh` / `start-https.bat`) check for Node.js 22 and, if it is
missing, download the official binary from nodejs.org into a local `.node/` folder next to the
script. An internet connection is required only on that first run; subsequent launches are
fully offline.

If you prefer to install Node.js yourself before running the app, download the LTS installer
from [nodejs.org](https://nodejs.org) and select **Node.js 22.x**. The scripts will detect it
and skip the automatic download.

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
  server.js          ← Next.js server (HTTPS when SSL_CERT_FILE + SSL_KEY_FILE are set, else plain HTTP)
  certs/             ← place your TLS certificate and key here
    server.crt
    server.key
  node_modules/      ← all dependencies (pre-bundled, no npm install needed)
  public/            ← static assets
  .next/             ← compiled application code
```

No `npm install` is required. Everything is already bundled.

---

## Configuration

All configuration is passed as environment variables when starting the server.
The only variable that is commonly needed is `BRIDGELINK_SERVER_URL`.

| Variable                 | Required   | Default | Description                                                                                                                                                                                                                            |
| ------------------------ | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRIDGELINK_SERVER_URL`  | No         | (none)  | URL of the BridgeLink server, e.g. `https://10.0.0.5:8443`. If omitted, users enter the URL on the login screen.                                                                                                                       |
| `BRIDGELINK_CA_CERT`     | No         | (none)  | Absolute path to a PEM file (CA or self-signed cert) for the BridgeLink TLS hop. When set, full cert verification is enabled. When unset, self-signed certs are accepted automatically. Do **not** set `NODE_TLS_REJECT_UNAUTHORIZED`. |
| `BRIDGELINK_PUBLIC_HOST` | No         | (none)  | Trusted public hostname (or `host:port`) of this Web UI. Used in `sameHost` allowlist mode so the BridgeLink server derivation cannot be spoofed via a forged `Host` header.                                                           |
| `PORT`                   | No         | `3000`  | TCP port the application listens on.                                                                                                                                                                                                   |
| `SSL_CERT_FILE`          | HTTPS only | (none)  | Absolute or relative path to the TLS certificate PEM file. Required for HTTPS with `node server.js`.                                                                                                                                   |
| `SSL_KEY_FILE`           | HTTPS only | (none)  | Absolute or relative path to the TLS private key PEM file. Required for HTTPS with `node server.js`.                                                                                                                                   |
| `COOKIE_SECURE`          | No         | auto    | Override cookie `Secure` flag and HSTS. `true` forces secure; `false` disables both (use for intentional plain-HTTP deployments).                                                                                                      |
| `TRUST_PROXY`            | No         | `true`  | Set to `false` to ignore `X-Forwarded-Proto` headers (disables HTTPS detection via reverse proxy).                                                                                                                                     |

---

## TLS Certificates

The start scripts generate a self-signed certificate automatically on first HTTPS launch —
no manual steps needed. The files are placed in `certs/server.crt` and `certs/server.key`.

Browsers will show a one-time "connection not private" warning for self-signed certificates.
Click **Advanced → Proceed** (Chrome) or **Accept the Risk** (Firefox) to continue.

If you have a CA-issued certificate, place your `server.crt` and `server.key` files in the
`certs/` folder before launching. The scripts detect existing certificates and skip generation.

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

1. Download Node.js 22 automatically if not installed (one-time, requires internet)
2. Generate a self-signed TLS certificate in `certs/` if none exists (one-time)
3. Start the HTTPS server on **https://localhost:3000**

> **Note:** All platforms are HTTPS-only. Use `start-https.sh` (Linux/macOS) or `start-https.bat` (Windows).

To pre-set the BridgeLink server URL:

```cmd
set BRIDGELINK_SERVER_URL=https://10.0.0.5:8443
.\start-https.bat
```

Or from PowerShell:

```powershell
$env:BRIDGELINK_SERVER_URL = "https://10.0.0.5:8443"
.\start-https.bat
```

---

### macOS / Linux

```bash
cd bridgelink-webui
./start-https.sh
```

To pre-set the server URL:

```bash
BRIDGELINK_SERVER_URL=https://10.0.0.5:8443 ./start-https.sh
```

---

### Custom port

Set the `PORT` environment variable before running the script:

**Windows:**

```cmd
set PORT=8443
start-https.bat
```

**macOS / Linux:**

```bash
PORT=8443 ./start-https.sh
```

---

## Logging In

1. Open **https://localhost:3000** in a browser.
2. If `BRIDGELINK_SERVER_URL` was **not** set, the login screen has a **Server URL** field.
   Enter the full URL of the BridgeLink server (e.g. `https://10.0.0.5:8443`).
3. Enter your BridgeLink username and password.
4. Click **Login**.

---

## Running as a Background Service (optional)

To keep the server running after closing the terminal, use a process manager.

### macOS / Linux — using `pm2`

```bash
npm install -g pm2

cd bridgelink-webui

SSL_CERT_FILE=./certs/server.crt \
SSL_KEY_FILE=./certs/server.key \
BRIDGELINK_SERVER_URL=https://10.0.0.5:8443 \
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
`start-https.bat` as a background service. Set `BRIDGELINK_SERVER_URL` and any other
environment variables in the service configuration.

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

The start script could not find Node.js and the automatic download failed (no internet access,
firewall, or proxy blocking nodejs.org). To resolve:

1. Download the Node.js 22 LTS installer manually from [nodejs.org](https://nodejs.org) on a
   machine with internet access.
2. Install it on the target machine and re-open the terminal.
3. Re-run the start script — it will detect the installed version and skip the download.

### Login fails immediately with a network error

- Check that `BRIDGELINK_SERVER_URL` points to the correct host and port.
- If the BridgeLink server uses a self-signed certificate, it is accepted
  automatically — no extra env var needed. To pin a specific CA cert instead,
  set `BRIDGELINK_CA_CERT=/path/to/ca.pem`.
- Confirm the BridgeLink server is reachable: `curl -k https://10.0.0.5:8443/api/server/version`

### `EADDRINUSE: address already in use :::3000`

Port 3000 is taken by another process. Stop the other process or change ports:

```bash
SSL_CERT_FILE=./certs/server.crt SSL_KEY_FILE=./certs/server.key PORT=8443 node server.js   # HTTPS on 8443
PORT=8080 node server.js                                                                     # plain HTTP on 8080
```

### Browser shows "Your connection is not private" / certificate warning

This is expected when using a self-signed certificate. Click **Advanced → Proceed** (Chrome)
or **Accept the Risk and Continue** (Firefox) to bypass the warning for local testing.
In production, use a certificate issued by a trusted CA (e.g. Let's Encrypt) to avoid this.

### Session expires unexpectedly

This is normal — BridgeLink sessions time out after a period of inactivity.
Log in again to resume the session.
