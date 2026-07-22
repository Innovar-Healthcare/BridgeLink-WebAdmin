# Installing BridgeLink Web Administrator — Docker

This guide covers running BridgeLink Web Administrator from the official
Docker images. For hardware, OS, and browser requirements, see
[SYSTEM-REQUIREMENTS.md](./SYSTEM-REQUIREMENTS.md).

---

## Images

The image is published to Docker Hub as `innovarhealthcare/bridgelink-webadmin`.

It is published with several tags pointing at the same image digest, so you can
pin to whichever level of stability you want:

| Tag            | Example        | Use for                                                    |
| -------------- | -------------- | ---------------------------------------------------------- |
| `:latest`      | `:latest`      | "Give me whatever's current"                               |
| `:<version>`   | `:26.6.0`      | Pin to a specific release (recommended for production)     |
| `:YYYYMMDD`    | `:20260511`    | Pin to a specific day's build (reproducibility / rollback) |
| `:sha-<short>` | `:sha-b6a7884` | Pin to an exact commit                                     |

**Platforms:** `linux/amd64`, `linux/arm64` (built natively on each platform)

---

## Quick start

### docker compose (recommended)

Create a `docker-compose.yml`:

```yaml
services:
  bridgelink-webui:
    image: innovarhealthcare/bridgelink-webadmin:latest
    container_name: bridgelink-webui
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      BRIDGELINK_SERVER_URL: https://your-bridgelink-server:8443
      # Self-signed BridgeLink TLS is accepted automatically — do NOT set
      # NODE_TLS_REJECT_UNAUTHORIZED. To pin a specific CA cert instead:
      # BRIDGELINK_CA_CERT: /path/to/ca.pem
      # Required — accepts the BSL 1.1 license and the BridgeLink WebAdmin
      # Supplemental Terms. See the License section below.
      BL_ACCEPT_LICENSE: "1"
    restart: unless-stopped
```

Then:

```bash
docker compose up -d        # start
docker compose logs -f      # watch logs
docker compose down         # stop
```

### docker run (manual)

```bash
docker pull innovarhealthcare/bridgelink-webadmin:latest

docker run -d \
  -p 3000:3000 \
  -e BRIDGELINK_SERVER_URL=https://your-bridgelink-server:8443 \
  -e BL_ACCEPT_LICENSE=1 \
  --name bridgelink-webui \
  innovarhealthcare/bridgelink-webadmin:latest
```

Open `https://localhost:3000` in your browser. (HTTPS is the default — see
"TLS certificates" below.)

---

## Environment variables

| Variable                 | Required | Default                 | Description                                                                                                                                                                                                                                    |
| ------------------------ | -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRIDGELINK_SERVER_URL`  | Yes      | —                       | URL of the BridgeLink server, e.g. `https://server:8443`                                                                                                                                                                                       |
| `BL_ACCEPT_LICENSE`      | Yes      | —                       | Must be set to `1` to accept the BSL 1.1 license and the BridgeLink WebAdmin Supplemental Terms. Any other non-empty value is rejected; unset/empty blocks startup.                                                                            |
| `BRIDGELINK_CA_CERT`     | No       | —                       | Absolute path to a PEM file (CA or self-signed cert) for the BridgeLink TLS hop. When set, full cert verification is enabled. When unset, self-signed certs are accepted automatically. Do **not** set `NODE_TLS_REJECT_UNAUTHORIZED`.         |
| `BRIDGELINK_PUBLIC_HOST` | No       | —                       | Trusted public hostname (or `host:port`) of this Web UI. Used in `sameHost` allowlist mode so the BridgeLink server derivation cannot be spoofed via a forged `Host` header. Recommended for deployments without an explicit server allowlist. |
| `PORT`                   | No       | `3000`                  | Port the application listens on                                                                                                                                                                                                                |
| `SSL_CERT_FILE`          | No       | `/app/certs/server.crt` | Path inside the container to the TLS certificate for the Web UI                                                                                                                                                                                |
| `SSL_KEY_FILE`           | No       | `/app/certs/server.key` | Path inside the container to the TLS private key for the Web UI                                                                                                                                                                                |
| `COOKIE_SECURE`          | No       | auto                    | Override cookie `Secure` flag and HSTS. `true` forces secure; `false` disables both (use for intentional plain-HTTP deployments).                                                                                                              |
| `TRUST_PROXY`            | No       | `true`                  | Set to `false` to ignore `X-Forwarded-Proto` headers (disables HTTPS detection via reverse proxy).                                                                                                                                             |

---

## TLS certificates

The container serves HTTPS by default. On first start, the entrypoint script
checks for an existing cert and key at the paths above:

- **If both files exist**, they are used as-is. Mount your own cert
  (CA-issued or self-signed) to skip auto-generation.
- **If either file is missing**, the entrypoint generates a fresh self-signed
  cert with a unique private key (825-day validity). Each container instance
  gets its own key — no shared keys across deployments.

### Using your own certificate (recommended for production)

```bash
docker run -d \
  -p 3000:3000 \
  -v /etc/ssl/bridgelink:/app/certs:ro \
  -e BRIDGELINK_SERVER_URL=https://your-server:8443 \
  -e BL_ACCEPT_LICENSE=1 \
  innovarhealthcare/bridgelink-webadmin:latest
```

The host directory must contain `server.crt` and `server.key`, and must be
readable by UID 1000 inside the container (see "Non-root user" below).

### Persisting the auto-generated cert across restarts

Use a Docker named volume so the cert generated on first start survives
container recreation:

```bash
docker run -d \
  -p 3000:3000 \
  -v bridgelink-certs:/app/certs \
  -e BRIDGELINK_SERVER_URL=https://your-server:8443 \
  -e BL_ACCEPT_LICENSE=1 \
  innovarhealthcare/bridgelink-webadmin:latest
```

---

## License

BridgeLink Web Administrator is licensed under the Business Source License 1.1 (BSL 1.1) and the BridgeLink WebAdmin Supplemental Terms. Both documents ship inside the image:

- `/app/LICENSE` — Business Source License 1.1
- `/app/SUPPLEMENTAL-TERMS.md` — BridgeLink WebAdmin Supplemental Terms

Starting the container requires accepting these terms via `BL_ACCEPT_LICENSE=1` (see the Environment variables table above). Omitting this variable — or setting it to any value other than `1` — causes the container to print the license terms and exit.

---

## Non-root user

The container runs as the `node` user (UID 1000, GID 1000) — the standard
non-root user that ships with the `node:alpine` base image. This means:

- **Bind-mounted host directories** (e.g.
  `-v /etc/ssl/bridgelink:/app/certs`) must be readable (and writable, if
  you want auto-generated certs to persist back to the host) by UID 1000:

  ```bash
  sudo chown -R 1000:1000 /etc/ssl/bridgelink
  ```

- **Docker named volumes** (e.g. `-v bridgelink-certs:/app/certs`)
  automatically inherit the correct ownership on first write — no manual
  chown needed.

- The container **cannot bind to ports below 1024** (e.g. 80 or 443) without
  explicit Linux capabilities. Use port 3000 inside the container and map to
  whatever port you want on the host: `-p 443:3000`.

---

## Updating

To pull the latest image and restart:

```bash
docker compose pull && docker compose up -d
```

> **Breaking change:** This release requires `BL_ACCEPT_LICENSE=1` to start (see License above). Existing deployments must add this variable before pulling — otherwise the container exits and restart-loops.

To roll back to a previous build, change the image tag in
`docker-compose.yml`:

```yaml
image: innovarhealthcare/bridgelink-webadmin:26.6.0
```

…and run `docker compose up -d` again.
