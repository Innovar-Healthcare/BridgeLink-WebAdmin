/**
 * Custom Node.js server for BridgeLink Web UI.
 *
 * Production mode (next start):
 *   - If SSL_CERT_FILE + SSL_KEY_FILE env vars are set → HTTPS via https.createServer()
 *   - Otherwise → plain HTTP with a warning (backwards-compatible)
 *
 * Compile with: tsc -p tsconfig.server.json
 * Run with:     node server.js
 */

// Default to production BEFORE Next.js is required (tsc's CommonJS emit keeps
// this statement ahead of the import-requires below): Next and React select
// dev-vs-production code paths at require time, and `dev` below derives from
// NODE_ENV. The packaged artifact's launcher scripts don't set NODE_ENV, which
// booted Next in dev mode and crashed on the missing `app` source directory
//. Next's generated standalone server hardcodes the same default;
// server.js is never used for development (`npm run dev` runs `next dev`).
// (Cast: Next's type augmentation marks NODE_ENV readonly; runtime assignment is fine.)
(process.env as Record<string, string | undefined>).NODE_ENV ||= "production";

import fs from "node:fs";
import http from "node:http";
import https from "node:https";

import { parse } from "node:url";
import next from "next";

// Read webadmin.conf and inject values into process.env.
// On Docker:  written by docker-entrypoint.sh from docker-compose environment vars.
// On Windows: written by the installer wizard during setup.
// Keys are whitelisted so a hand-edited conf cannot inject arbitrary env vars.
//
// The conf path can be overridden via WEBADMIN_CONF; setting it to an empty string
// skips the conf entirely so explicit PORT / BRIDGELINK_SERVER_URL env vars win.
// The E2E webServer uses this so the repo's shipped default conf (PORT=3000,
// BRIDGELINK_SERVER_URL=…8443) doesn't shadow the test port/server. Docker and
// Windows leave it unset and keep reading the conf beside the server bundle.
const CONF_KEYS = new Set([
  "PORT",
  "BRIDGELINK_SERVER_URL",
  "BRIDGELINK_ALLOWED_SERVERS",
  "BRIDGELINK_PUBLIC_HOST",
]);
const confPath = process.env.WEBADMIN_CONF ?? `${__dirname}/webadmin.conf`;
if (confPath) {
  try {
    const confLines = fs.readFileSync(confPath, "utf8").split(/\r?\n/);
    for (const line of confLines) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (CONF_KEYS.has(key) && val) process.env[key] = val;
    }
  } catch {
    // No conf file — rely on existing process.env values and built-in defaults.
  }
}

const port = parseInt(process.env.PORT ?? "3000", 10);
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev });
const handle = app.getRequestHandler();

const HSTS_VALUE = "max-age=63072000; includeSubDomains";

/**
 * Inline mirror of lib/cookie-security.ts:isSecureContext for the raw Node
 * request available in this custom server. HSTS must only be sent on a secure
 * context, otherwise a single HTTPS hit can pin sibling plain-HTTP services on
 * the domain. Importing the lib helper here is avoided on purpose:
 * tsconfig.server.json compiles server.ts with outDir ".", so a relative import
 * would emit a stray lib/*.js that could shadow the .ts during `next build`.
 * Keep this precedence in sync with isSecureContext.
 *
 * @param directTls true when this process terminated TLS directly (HTTPS server)
 */
function isSecureRequest(req: http.IncomingMessage, directTls: boolean): boolean {
  const override = process.env.COOKIE_SECURE?.toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  if (directTls || process.env.HTTPS === "true") return true;

  if (process.env.TRUST_PROXY?.toLowerCase() !== "false") {
    const raw = req.headers["x-forwarded-proto"];
    const xfp = Array.isArray(raw) ? raw[0] : raw;
    if (xfp) {
      const proto = xfp.split(",")[0]?.trim().toLowerCase();
      if (proto === "https") return true;
      if (proto === "http") return false;
    }
  }

  return process.env.NODE_ENV === "production";
}

/**
 * Inline mirror of lib/cookie-security.ts:isLoopbackHost for the raw Node
 * request. HSTS must never be sent to loopback hosts: the local HTTPS launcher
 * serves a self-signed cert, and an HSTS pin would make the browser reject it
 * with no bypass, blanking the page. Importing the lib helper is
 * avoided for the same outDir reason noted on isSecureRequest above.
 * Keep in sync with isLoopbackHost.
 *
 * Assumes the real client Host reaches this server — true when server.ts
 * terminates TLS directly (both the local launcher `start-https.sh` / `start-https.bat`
 * and the EC2 deploy run `node server.js` with SSL_CERT_FILE set) or when it sits
 * behind a Host-preserving proxy (nginx `proxy_set_header Host $host`). In both
 * cases the client Host is loopback or a real domain, so this check correctly
 * suppresses HSTS only for the loopback / local-launcher case.
 */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  let hostname: string;
  const bracket = host.match(/^\[(.+)\]/);
  if (bracket) {
    hostname = bracket[1];
  } else if ((host.match(/:/g) ?? []).length > 1) {
    hostname = host; // bare IPv6 literal, no port
  } else {
    const colon = host.lastIndexOf(":");
    hostname = colon === -1 ? host : host.slice(0, colon);
  }
  hostname = hostname.trim().toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return false;
}

app.prepare().then(() => {
  const certFile = process.env.SSL_CERT_FILE;
  const keyFile = process.env.SSL_KEY_FILE;

  if (certFile && keyFile) {
    process.env.HTTPS = "true";
    const options: https.ServerOptions = {
      cert: fs.readFileSync(certFile),
      key: fs.readFileSync(keyFile),
    };
    https
      .createServer(options, (req, res) => {
        if (isSecureRequest(req, true) && !isLoopbackHost(req.headers.host))
          res.setHeader("Strict-Transport-Security", HSTS_VALUE);
        const parsedUrl = parse(req.url ?? "/", true);
        handle(req, res, parsedUrl);
      })
      .on("error", (err) => {
        console.error("[server] HTTPS server error:", err.message);
        process.exit(1);
      })
      .listen(port, () => {
        console.log(`> Ready on https://localhost:${port}`);
      });
  } else {
    if (certFile || keyFile) {
      console.warn(
        "[server] SSL_CERT_FILE and SSL_KEY_FILE must both be set for HTTPS. Falling back to HTTP."
      );
    }
    http
      .createServer((req, res) => {
        // Plaintext hop here, but TLS may be terminated upstream — emit HSTS only
        // when a secure context is signalled (X-Forwarded-Proto / COOKIE_SECURE),
        // and never to loopback hosts (self-signed dev certs —.
        if (isSecureRequest(req, false) && !isLoopbackHost(req.headers.host))
          res.setHeader("Strict-Transport-Security", HSTS_VALUE);
        const parsedUrl = parse(req.url ?? "/", true);
        handle(req, res, parsedUrl);
      })
      .on("error", (err) => {
        console.error("[server] HTTP server error:", err.message);
        process.exit(1);
      })
      .listen(port, () => {
        console.log(`> Ready on http://localhost:${port}`);
      });
  }
});
