import type { NextRequest } from "next/server";

/** Inputs for {@link isSecureContext}, abstracted so non-NextRequest callers can reuse it. */
export interface SecureContextInput {
  /** Read a request header by (lowercase) name; returns null when absent. */
  getHeader: (name: string) => string | null;
  /**
   * True when this Node process terminates TLS directly (e.g. the custom HTTPS
   * server). Equivalent to the HTTPS=true env signal but available before the
   * env var is set, so the custom server can pass it explicitly.
   */
  directTls?: boolean;
}

/**
 * Decide whether the current request is on a secure (HTTPS) context.
 *
 * Precedence (highest to lowest):
 *   1. COOKIE_SECURE env var ("true" / "false") — explicit operator override
 *   2. directTls / HTTPS env var "true" — Node process terminated TLS directly
 *   3. X-Forwarded-Proto request header — external TLS terminator (nginx, ELB, Cloudflare…)
 *      Skipped when TRUST_PROXY=false so operators on internal-only HTTP can opt out.
 *   4. NODE_ENV === "production" — default-secure in production, non-secure in dev
 *
 * Operators running plain HTTP intentionally in production should set
 * COOKIE_SECURE=false; this both keeps session cookies non-Secure and suppresses
 * the HSTS header.
 *
 * Mirrored by an inline copy in `server.ts` (raw Node request); keep in sync.
 */
export function isSecureContext({ getHeader, directTls = false }: SecureContextInput): boolean {
  const override = process.env.COOKIE_SECURE?.toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  if (directTls || process.env.HTTPS === "true") return true;

  // X-Forwarded-Proto may be a comma-separated list; the first value is the
  // scheme seen by the outermost client-facing proxy.
  if (process.env.TRUST_PROXY?.toLowerCase() !== "false") {
    const xfp = getHeader("x-forwarded-proto");
    if (xfp) {
      const proto = xfp.split(",")[0]?.trim().toLowerCase();
      if (proto === "https") return true;
      if (proto === "http") return false;
    }
  }

  return process.env.NODE_ENV === "production";
}

/**
 * Decide the `Secure` flag for managed session cookies. Thin wrapper over
 * {@link isSecureContext} for the Next.js request type.
 */
export function resolveCookieSecure(req: NextRequest): boolean {
  return isSecureContext({ getHeader: (name) => req.headers.get(name) });
}

/**
 * True when the request's `Host` targets a loopback address (the local dev /
 * QA box itself). HSTS must never be sent to these hosts: there is no real
 * domain to protect, and the local HTTPS launcher serves a self-signed cert —
 * an HSTS pin would force the browser to reject that cert with no bypass,
 * blanking the page. Port-agnostic; matches localhost, *.localhost,
 * 127.0.0.0/8 loopback IPv4, ::1, and the 0.0.0.0 wildcard.
 *
 * Mirrored by an inline copy in `server.ts` (raw Node request); keep in sync.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  // Strip the port. IPv6 literals are bracketed ("[::1]:3000"); take the part
  // inside the brackets. IPv4/hostnames split on the last colon.
  let hostname: string;
  const bracket = host.match(/^\[(.+)\]/);
  if (bracket) {
    // Bracketed IPv6, optionally with a port: "[::1]" or "[::1]:3000".
    hostname = bracket[1];
  } else if ((host.match(/:/g) ?? []).length > 1) {
    // Bare IPv6 literal with no port (a port would require brackets).
    hostname = host;
  } else {
    // hostname or IPv4, optionally with a port.
    const colon = host.lastIndexOf(":");
    hostname = colon === -1 ? host : host.slice(0, colon);
  }
  hostname = hostname.trim().toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "0.0.0.0") return true;
  // 127.0.0.0/8 is entirely loopback.
  if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return false;
}
