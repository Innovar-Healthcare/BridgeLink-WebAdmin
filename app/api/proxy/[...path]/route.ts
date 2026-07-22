/**
 * Catch-all proxy route: /api/proxy/* → BridgeLink REST API
 *
 * Session management strategy
 * ───────────────────────────
 * BridgeLink's Jetty server issues a new JSESSIONID on every unauthenticated
 * (401) response. If we forward those Set-Cookie headers to the browser, each
 * failed concurrent request from the dashboard overwrites the valid session
 * cookie obtained at login.
 *
 * To prevent this we manage the upstream session ourselves:
 *   - On login (2xx with upstream Set-Cookie: JSESSIONID=...) we store the
 *     session in a per-server HttpOnly cookie named bl_sess_<hash8>, where
 *     <hash8> is the first 8 hex characters of SHA-256(serverUrl). A companion
 *     cookie bl_sess_url_<hash8> records the server URL for eviction purposes.
 *   - On every proxy request we resolve the target server from the x-bl-server
 *     header (set by the client from per-tab sessionStorage), hash it, and read
 *     the matching bl_sess_<hash8> cookie to inject as JSESSIONID upstream.
 *   - 401/4xx/5xx responses never touch the browser cookies, so a valid
 *     session is never overwritten by anonymous sessions.
 *   - Each server gets its own cookie pair, so multiple browser tabs logged
 *     into different BridgeLink servers coexist without interference.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchBridgeLink } from "@/lib/bl-dispatcher";
import { parseCookieHeader } from "@/lib/parse-cookie-header";
import { resolveAllowedServer } from "@/lib/server-allowlist";
import { serverHash } from "@/lib/server-hash";
import { logServerError } from "@/lib/server-log";
import { resolveCookieSecure } from "@/lib/cookie-security";
import { getFixtureShortCircuit, mergeFixtureExtensions } from "@/lib/webadmin-fixtures";

// Minimum body size (bytes) before it's worth gzipping. Below ~1 KB the
// compression headers + CPU overhead outweigh the savings.
const GZIP_MIN_BYTES = 1024;

function isCompressibleContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith("text/") || ct.includes("json") || ct.includes("xml") || ct.includes("javascript")
  );
}

// Self-signed BridgeLink certificates are tolerated per-hop via fetchBridgeLink()
// (lib/bl-dispatcher.ts), NOT by disabling TLS verification process-wide.

const SESSION_COOKIE_PREFIX = "bl_sess_";
const URL_COOKIE_PREFIX = "bl_sess_url_";
const MAX_SESSIONS = 8;

function sessionCookieName(hash: string): string {
  return `${SESSION_COOKIE_PREFIX}${hash}`;
}

function urlCookieName(hash: string): string {
  return `${URL_COOKIE_PREFIX}${hash}`;
}

type CookieAttrs = {
  httpOnly: boolean;
  sameSite: "lax";
  path: string;
  secure: boolean;
  maxAge?: number;
};

/**
 * If storing a new session pushes us over MAX_SESSIONS, evict the oldest
 * entries (preferring any without a URL sentinel, then alphabetically).
 */
function evictExcessSessions(
  req: NextRequest,
  res: NextResponse,
  currentHash: string,
  cookieAttrs: CookieAttrs
): void {
  const browserCookies = parseCookieHeader(req.headers.get("cookie") ?? "");
  const existingHashes = Object.keys(browserCookies)
    .filter((k) => k.startsWith(URL_COOKIE_PREFIX))
    .map((k) => k.slice(URL_COOKIE_PREFIX.length));

  // Include the current hash — it may be freshly written in this response.
  const allHashes = Array.from(new Set([...existingHashes, currentHash]));
  if (allHashes.length <= MAX_SESSIONS) return;

  // Sort candidates for eviction: orphaned entries (URL cookie missing) first,
  // then alphabetically for determinism.
  const candidates = allHashes
    .filter((h) => h !== currentHash)
    .sort((a, b) => {
      const aOrphaned = !browserCookies[urlCookieName(a)];
      const bOrphaned = !browserCookies[urlCookieName(b)];
      if (aOrphaned !== bOrphaned) return aOrphaned ? -1 : 1;
      return a.localeCompare(b);
    });

  const evictCount = allHashes.length - MAX_SESSIONS;
  for (let i = 0; i < evictCount && i < candidates.length; i++) {
    const h = candidates[i];
    res.cookies.set(sessionCookieName(h), "", { ...cookieAttrs, maxAge: 0 });
    res.cookies.set(urlCookieName(h), "", { ...cookieAttrs, maxAge: 0 });
  }
}

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  // SSRF gate: only proxy to an allowlisted BridgeLink server.
  // Rejected before any upstream fetch is attempted.
  const resolved = resolveAllowedServer(req);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const serverUrl = resolved.url;

  const upstreamBase = `${serverUrl}/api`;
  const hash = serverHash(serverUrl);
  const pathStr = path.join("/");

  // Preserve query string
  const search = req.nextUrl.search ?? "";
  const upstreamUrl = `${upstreamBase}/${pathStr}${search}`;

  // Dev-only runtime-plugin fixture mode: answer the webadmin
  // manifest/defaults/action endpoints from BL_WEBADMIN_PLUGINS_FIXTURE_DIR
  // instead of the server. Instant null (zero overhead) when the mode is off,
  // and never active in production builds.
  const fixture = await getFixtureShortCircuit(req.method, pathStr, search);
  if (fixture) {
    // 204 must not carry a body (matches the null-body handling below).
    return new NextResponse(fixture.status === 204 ? null : fixture.body, {
      status: fixture.status,
      headers: { "Content-Type": fixture.contentType },
    });
  }

  // Read the per-server upstream session cookie.
  const browserCookies = parseCookieHeader(req.headers.get("cookie") ?? "");
  const upstreamSession = browserCookies[sessionCookieName(hash)] ?? "";

  // Build upstream headers — inject the upstream JSESSIONID, NOT the raw
  // browser cookie header (which would expose our bl_sess_* cookies).
  const upstreamHeaders: HeadersInit = {
    Accept: req.headers.get("accept") ?? "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  // Only set Content-Type for requests that can have a body.
  // GET/HEAD requests with Content-Type cause Jersey to return 405 Method Not Allowed.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const ct = req.headers.get("content-type");
    if (ct) (upstreamHeaders as Record<string, string>)["Content-Type"] = ct;
  }
  if (upstreamSession) {
    upstreamHeaders["Cookie"] = `JSESSIONID=${upstreamSession}`;
  }
  // Forward MFA login data header for the second login call in the MFA flow.
  const mfaLoginData = req.headers.get("x-mirth-login-data");
  if (mfaLoginData) {
    (upstreamHeaders as Record<string, string>)["X-Mirth-Login-Data"] = mfaLoginData;
  }

  // Buffer the request body for non-GET/HEAD rather than forwarding req.body as
  // a stream. Streaming with `duplex: "half"` through undici's fetch is
  // unreliable in the standalone build — if the framework disturbs/pre-reads the
  // request stream, undici throws `TypeError: fetch failed` and login dies
  //. An ArrayBuffer forwards binary and multipart payloads byte-for-
  // byte; admin request bodies are small enough that buffering is a non-issue
  // (the large channel-summary payload is on the response path, untouched below).
  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetchBridgeLink(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      ...(body !== undefined && body.byteLength > 0 ? { body } : {}),
    });
  } catch (err) {
    // Log detail server-side only — returning it would aid SSRF port probing.
    logServerError("proxy", `Upstream fetch failed for ${pathStr}`, err);
    return NextResponse.json({ error: "Failed to reach BridgeLink server" }, { status: 502 });
  }

  // Dev-only runtime-plugin fixture mode: merge fixture extensions
  // into the installed-plugins listing so the existing enablement gating sees
  // them. Null (zero overhead) when the mode is off or the path differs; the
  // tiny merged JSON body skips the gzip streaming path below.
  const fixtureMerged = await mergeFixtureExtensions(pathStr, upstreamRes);
  if (fixtureMerged) {
    return new NextResponse(fixtureMerged.body, {
      status: fixtureMerged.status,
      headers: { "Content-Type": fixtureMerged.contentType },
    });
  }

  // Build our response, forwarding status.
  // 204 No Content must not have a body; handle null body defensively for other statuses.
  let res: NextResponse;
  if (upstreamRes.status === 204 || !upstreamRes.body) {
    res = new NextResponse(null, { status: upstreamRes.status });
  } else {
    const contentType = upstreamRes.headers.get("content-type") ?? "application/json";
    const responseHeaders: Record<string, string> = { "Content-Type": contentType };

    // Gzip compressible bodies when the browser accepts it. Without this, the
    // 11 MB initial channel summary response (and similar) ship uncompressed,
    // which dominates bandwidth on a multi-user install.
    // Use a streaming CompressionStream rather than buffering — no proportional memory growth.
    const acceptEncoding = req.headers.get("accept-encoding") ?? "";
    const clientWantsGzip = acceptEncoding.includes("gzip");
    const contentLengthStr = upstreamRes.headers.get("content-length");
    const contentLength = contentLengthStr !== null ? Number(contentLengthStr) : null;
    // When Content-Length is absent (chunked), err toward compressing — can't measure first.
    const knownSmall = contentLength !== null && contentLength < GZIP_MIN_BYTES;

    let responseBody: ReadableStream<Uint8Array>;
    if (clientWantsGzip && isCompressibleContentType(contentType) && !knownSmall) {
      responseBody = upstreamRes.body.pipeThrough(new CompressionStream("gzip"));
      responseHeaders["Content-Encoding"] = "gzip";
      responseHeaders["Vary"] = "Accept-Encoding";
      // Do not forward Content-Length — compressed size differs; transfer will be chunked.
    } else {
      responseBody = upstreamRes.body;
      if (contentLength !== null && contentLength > 0) {
        responseHeaders["Content-Length"] = String(contentLength);
      }
      // Pass through upstream Content-Encoding if present.
      const upstreamEncoding = upstreamRes.headers.get("content-encoding");
      if (upstreamEncoding) responseHeaders["Content-Encoding"] = upstreamEncoding;
    }

    res = new NextResponse(responseBody, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  }

  const cookieAttrs: CookieAttrs = {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: resolveCookieSecure(req),
  };

  // Only update managed cookies on successful (2xx) responses.
  // BridgeLink returns a fresh JSESSIONID on every 401; forwarding those to
  // the browser would overwrite the authenticated session obtained at login.
  if (upstreamRes.status >= 200 && upstreamRes.status < 300) {
    if (pathStr === "users/_logout") {
      // Clear only the current server's cookies — other tabs' sessions are unaffected.
      res.cookies.set(sessionCookieName(hash), "", { ...cookieAttrs, maxAge: 0 });
      res.cookies.set(urlCookieName(hash), "", { ...cookieAttrs, maxAge: 0 });
    } else {
      const rawSetCookies: string[] = [];
      upstreamRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") rawSetCookies.push(value);
      });

      for (const value of rawSetCookies) {
        const match = /JSESSIONID=([^;]+)/i.exec(value);
        if (match) {
          res.cookies.set(sessionCookieName(hash), match[1], cookieAttrs);
          // URL sentinel lets us enumerate sessions for eviction.
          res.cookies.set(urlCookieName(hash), serverUrl, cookieAttrs);
          evictExcessSessions(req, res, hash, cookieAttrs);
        }
      }
    }
  }

  return res;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
