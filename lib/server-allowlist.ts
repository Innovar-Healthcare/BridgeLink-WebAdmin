/**
 * BridgeLink server allowlist — SSRF guard for the Next.js proxy /.
 *
 * The proxy, whoami, and SSL import-pem routes all relay browser requests to a
 * BridgeLink server whose URL the browser supplies via the `x-bl-server`
 * header. Trusting that header unconditionally turns the Next.js server into an
 * open SSRF relay. This module is the single server-side gate that decides
 * whether a requested server is permitted.
 *
 * Enforcement lives HERE, not in the login dropdown — an attacker bypasses the
 * dropdown by POSTing directly to /api/proxy with their own header. The login
 * UI reads `getServerConfig()` purely to decide how to render the server field.
 *
 * Deployment modes (resolved from environment at request time):
 *   - multi    BRIDGELINK_ALLOWED_SERVERS=a,b,c → only those exact origins
 *   - single   BRIDGELINK_SERVER_URL=x          → only that one origin
 *   - sameHost no allowlist env                 → https://<host>:8443 (see note)
 *   - open     BL_ALLOW_ANY_SERVER=1 or dev     → allowlist disabled (free text)
 *
 * Matching is by NORMALIZED ORIGIN (scheme + lowercased host + port), never by
 * substring/prefix, so `https://evil.com/?x=https://real` and `user@host`
 * tricks cannot smuggle a disallowed host past the check. Only https is
 * accepted; http, file, and other schemes never match.
 *
 * ## sameHost mode and Host-header trust
 *
 * In `sameHost` mode the allowed server is derived as `https://<host>:8443`.
 * The host is resolved with this precedence:
 *
 *   1. BRIDGELINK_PUBLIC_HOST env var — trusted operator-supplied hostname (or
 *      host:port); safe regardless of the request Host header.
 *   2. Request Host header — only when TRUST_PROXY is not "false" (the default).
 *      Requires the fronting proxy/load-balancer to pin the Host header to the
 *      real public hostname; without that guarantee a spoofed Host gives an
 *      attacker-controlled (but https-only, port-8443-fixed) SSRF target.
 *   3. null — when neither source is available. Operators in this state should
 *      set BRIDGELINK_SERVER_URL or BRIDGELINK_ALLOWED_SERVERS explicitly.
 */

import { logStartupWarn } from "./server-log";

export type ServerMode = "multi" | "single" | "sameHost" | "open";

export interface ServerConfig {
  /** Which deployment model is active. */
  mode: ServerMode;
  /** Allowed server origins to offer in the login UI (empty in open mode). */
  servers: string[];
  /** Suggested default server for the login field. */
  defaultServer: string;
}

/** Minimal shape we need from the incoming request — works with NextRequest and test doubles. */
interface HeaderReq {
  headers: { get(name: string): string | null };
}

/**
 * Normalize a raw server URL to a canonical https origin (`https://host[:port]`),
 * lowercasing the host and discarding any path, query, fragment, or credentials.
 * Returns `null` for anything that isn't a valid absolute https URL.
 */
export function normalizeBlOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const port = u.port ? `:${u.port}` : "";
  return `https://${u.hostname.toLowerCase()}${port}`;
}

/**
 * Open mode disables the allowlist entirely. Active when an operator explicitly
 * sets BL_ALLOW_ANY_SERVER=1, or automatically during local development
 * (`npm run dev` → NODE_ENV=development) so the "connect to various BL servers"
 * workflow keeps its free-text field. NEVER auto-on in production or test.
 */
function isOpenMode(): boolean {
  return process.env.BL_ALLOW_ANY_SERVER === "1" || process.env.NODE_ENV === "development";
}

/** One-time loud warning when open mode is active in a production build. */
function warnIfOpenInProduction(): void {
  if (process.env.NODE_ENV === "production") {
    logStartupWarn(
      "open-mode",
      "OPEN MODE: BridgeLink server allowlist is DISABLED (BL_ALLOW_ANY_SERVER=1). " +
        "Any server URL supplied by a client will be proxied. Never set this on a shared " +
        "or internet-facing deployment."
    );
  }
}

/** Parse and normalize BRIDGELINK_ALLOWED_SERVERS (comma-separated). */
function parseAllowedServersEnv(): string[] {
  const raw = process.env.BRIDGELINK_ALLOWED_SERVERS;
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const normalized = normalizeBlOrigin(trimmed);
    if (normalized) {
      if (!out.includes(normalized)) out.push(normalized);
    } else {
      logStartupWarn(
        `bad-allow:${trimmed}`,
        `Ignoring invalid BRIDGELINK_ALLOWED_SERVERS entry (must be an absolute https URL): ${trimmed}`
      );
    }
  }
  return out;
}

/**
 * Parse a bare host string (e.g. "example.com", "example.com:8443", "[::1]")
 * into a hostname. Returns null for unparseable input.
 */
function parseHostname(raw: string): string | null {
  try {
    return new URL(`http://${raw}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Derive `https://<host>:8443` for sameHost mode.
 *
 * Precedence:
 *   1. BRIDGELINK_PUBLIC_HOST env var (trusted; ignores the request Host header)
 *   2. Request Host header (only when TRUST_PROXY !== "false")
 *   3. null (safe fallback; operators should set an explicit allowlist env)
 */
function sameHostDefault(req: HeaderReq): string | null {
  const publicHost = process.env.BRIDGELINK_PUBLIC_HOST;
  if (publicHost) {
    const hostname = parseHostname(publicHost.trim());
    if (hostname) return `https://${hostname}:8443`;
  }

  if (process.env.TRUST_PROXY?.toLowerCase() !== "false") {
    const host = req.headers.get("host");
    if (host) {
      const hostname = parseHostname(host);
      if (hostname) return `https://${hostname}:8443`;
    }
  }

  return null;
}

/**
 * Resolve the active server configuration for the login UI. Read fresh from the
 * environment on every call so tests (and runtime env changes) take effect.
 */
export function getServerConfig(req: HeaderReq): ServerConfig {
  if (isOpenMode()) {
    warnIfOpenInProduction();
    const def = sameHostDefault(req) ?? normalizeBlOrigin(process.env.BRIDGELINK_SERVER_URL) ?? "";
    return { mode: "open", servers: [], defaultServer: def };
  }

  const multi = parseAllowedServersEnv();
  if (multi.length > 0) {
    return { mode: "multi", servers: multi, defaultServer: multi[0] };
  }

  const single = normalizeBlOrigin(process.env.BRIDGELINK_SERVER_URL);
  if (single) {
    return { mode: "single", servers: [single], defaultServer: single };
  }

  const sameHost = sameHostDefault(req);
  return {
    mode: "sameHost",
    servers: sameHost ? [sameHost] : [],
    defaultServer: sameHost ?? "",
  };
}

/**
 * The security gate. Resolve the requested BridgeLink server from the
 * `x-bl-server` header (falling back to BRIDGELINK_SERVER_URL) and validate it
 * against the active allowlist. Returns the normalized origin on success, or a
 * generic error string the caller maps to HTTP 400 — BEFORE any fetch is made.
 */
export function resolveAllowedServer(req: HeaderReq): { url: string } | { error: string } {
  const raw = req.headers.get("x-bl-server") ?? process.env.BRIDGELINK_SERVER_URL ?? null;
  if (!raw) {
    return { error: "No BridgeLink server configured" };
  }

  const candidate = normalizeBlOrigin(raw);
  if (!candidate) {
    return { error: "Requested server is not allowed" };
  }

  if (isOpenMode()) {
    warnIfOpenInProduction();
    return { url: candidate };
  }

  const { servers } = getServerConfig(req);
  if (servers.includes(candidate)) {
    return { url: candidate };
  }
  return { error: "Requested server is not allowed" };
}
