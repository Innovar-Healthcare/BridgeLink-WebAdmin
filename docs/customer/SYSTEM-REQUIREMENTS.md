# BridgeLink Web Administrator — System Requirements

This document describes the resources needed to run BridgeLink Web
Administrator. The application has two distinct components with separate
resource profiles:

- **The application server** — a small Node.js process that serves the UI
  and proxies API calls to your BridgeLink server. Installed either as a
  Docker container or as a self-contained tarball/zip.
- **The user's browser** — where the UI actually renders. Runs on each
  individual user's workstation.

---

## Server requirements

### Resource footprint

The server process is intentionally lightweight. It does not cache channel
data — every browser holds its own session — so memory stays nearly flat as
users connect.

| Resource              | Idle   | Per active user       | Recommended (production)               |
| --------------------- | ------ | --------------------- | -------------------------------------- |
| RAM                   | ~65 MB | +5-10 MB              | **2 GB** (~10 concurrent users)        |
| CPU                   | < 1%   | mostly proxy overhead | **2 vCPU**                             |
| Disk                  | 500 MB | —                     | **1 GB** (room for logs and the image) |
| Open file descriptors | low    | ~5 per active session | default ulimits are fine               |

For larger deployments, scale linearly: ~50 concurrent users → 4 vCPU, 4 GB
RAM. The bottleneck is **network egress to browsers**, not CPU or RAM.

### Operating system

- **Linux server (Docker)**: any distribution with Docker 20.10+ —
  RHEL 8+, Ubuntu 20.04+, Debian 11+, Amazon Linux 2/2023, SLES 15+
- **Linux server (native)**: Node.js 22.x LTS; same distributions as above
- **Windows / macOS**: supported for local testing or single-user use; not
  recommended as a server install

### Network requirements (server-side)

The application server makes outbound HTTPS calls to your BridgeLink server and
serves inbound HTTPS traffic to each user's browser. With gzip compression
enabled by default, bandwidth usage is modest:

| Traffic                                                                  | Direction       | Volume               |
| ------------------------------------------------------------------------ | --------------- | -------------------- |
| Initial channel load (one-time per browser session)                      | UI → browser    | ~1.5 MB              |
| Dashboard status poll (every 20s by default while Dashboard tab is open) | UI → browser    | ~35 KB               |
| API calls to BridgeLink                                                  | UI ↔ BridgeLink | varies; pass-through |

A user with the Dashboard tab open for an 8-hour workday consumes
approximately **50 MB** of bandwidth from the application server (at the 20s
default poll interval; the interval is configurable in Settings → Administrator,
and bandwidth scales inversely with it). Multiply by concurrent users for total
egress sizing.

### TLS

The application server can serve HTTPS in two modes:

- **Operator-supplied certificate** (recommended for production): mount a
  certificate and private key into the container at `/app/certs` (Docker) or
  drop them into the `certs/` folder (tarball/zip).
- **Auto-generated self-signed certificate**: if no certificate is present at
  startup, the entrypoint generates one with 825-day validity. Each container
  instance gets its own unique key. Browsers will show a one-time warning.

For multi-user deployments behind a corporate hostname, a CA-issued cert (or
a placement behind a reverse proxy that terminates TLS) is strongly
recommended.

---

## End-user (browser) requirements

Each user runs the UI in their own browser; the server does not share state
between users.

| Resource                      | Minimum                                      | Recommended   |
| ----------------------------- | -------------------------------------------- | ------------- |
| RAM available to browser tab  | 500 MB                                       | 1 GB          |
| Browser                       | Chrome 120, Edge 120, Firefox 120, Safari 17 | latest stable |
| Network to application server | 5 Mbps                                       | broadband     |
| Screen resolution             | 1280 × 800                                   | 1920 × 1080   |

A typical Channels tab loaded against a 200-300 channel deployment uses
roughly **250-400 MB** of browser tab memory. The browser also lazily loads
the channel editor (Monaco-based) when first opened, which adds ~50 MB.

---

## Deployment options

The same build is available in three formats. Pick whichever fits your
environment.

| Format                        | Best for                              | Setup                                            |
| ----------------------------- | ------------------------------------- | ------------------------------------------------ |
| **Docker image**              | Linux servers, multi-user deployments | `docker pull innovarhc/bridgelink-web-ui:latest` |
| **Linux tarball** (`.tar.gz`) | Linux servers without Docker          | Extract, run `./start-https.sh`                  |
| **Windows zip** (`.zip`)      | Windows servers, single-user testing  | Extract, double-click `start-https.bat`          |

For step-by-step installation, see
[INSTALL-TARBALL.md](./INSTALL-TARBALL.md) (tarball/zip) or
[INSTALL-DOCKER.md](./INSTALL-DOCKER.md) (Docker).
