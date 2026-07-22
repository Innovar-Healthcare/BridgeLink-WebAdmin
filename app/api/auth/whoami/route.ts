/**
 * GET /api/auth/whoami
 *
 * Rehydrates session info from HttpOnly cookies when sessionStorage is empty
 * (e.g. a new browser tab opened while already signed in to another tab).
 *
 * The client passes the target server via the x-bl-server header (read from
 * localStorage["bl_last_server"] which the login page writes on successful
 * login). The route hashes the URL to locate the matching bl_sess_<hash8>
 * cookie, calls the upstream /users/current endpoint to verify the session,
 * and returns {username, serverUrl, userId} on success.
 *
 * Returns 401 when the header is absent, the session cookie is missing,
 * or the upstream session is invalid.
 * Returns 502 when the BridgeLink server cannot be reached.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchBridgeLink } from "@/lib/bl-dispatcher";
import { parseCookieHeader } from "@/lib/parse-cookie-header";
import { resolveAllowedServer } from "@/lib/server-allowlist";
import { serverHash } from "@/lib/server-hash";
import { logServerError } from "@/lib/server-log";

// Self-signed BridgeLink certificates are tolerated per-hop via fetchBridgeLink()
// (lib/bl-dispatcher.ts), NOT by disabling TLS verification process-wide.

export interface WhoamiResponse {
  username: string;
  serverUrl: string;
  userId?: number;
}

export async function GET(req: NextRequest) {
  if (!req.headers.get("x-bl-server")) {
    return NextResponse.json({}, { status: 401 });
  }

  // SSRF gate: only rehydrate against an allowlisted server.
  // A disallowed host is treated as "not logged in here" (401, no fetch).
  const resolved = resolveAllowedServer(req);
  if ("error" in resolved) {
    return NextResponse.json({}, { status: 401 });
  }
  const serverUrl = resolved.url;

  const cookies = parseCookieHeader(req.headers.get("cookie") ?? "");
  const hash = serverHash(serverUrl);
  const session = cookies[`bl_sess_${hash}`];

  if (!session) {
    return NextResponse.json({}, { status: 401 });
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetchBridgeLink(`${serverUrl}/api/users/current`, {
      headers: {
        Cookie: `JSESSIONID=${session}`,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
      },
    });
  } catch (err) {
    logServerError("whoami", "Upstream fetch failed", err);
    return NextResponse.json({ error: "Failed to reach BridgeLink server" }, { status: 502 });
  }

  if (!upstreamRes.ok) {
    return NextResponse.json({}, { status: 401 });
  }

  let username: string | undefined;
  let userId: number | undefined;
  try {
    const text = await upstreamRes.text();
    const raw = JSON.parse(text) as Record<string, unknown>;
    // XStream wraps the root object in its FQN or alias:
    //   {"com.mirth.connect.model.User": {...}} — FQN wrapper (key contains ".")
    //   {"user": {...}} — XStreamAlias wrapper
    // Plain user objects (multiple keys or no wrapping) are used as-is.
    const keys = Object.keys(raw);
    const isWrapper = keys.length === 1 && (keys[0].includes(".") || keys[0] === "user");
    const userObj = isWrapper ? (raw[keys[0]] as Record<string, unknown>) : raw;
    username = typeof userObj.username === "string" ? userObj.username : undefined;
    userId = typeof userObj.id === "number" ? userObj.id : undefined;
  } catch {
    return NextResponse.json({}, { status: 401 });
  }

  if (!username) {
    return NextResponse.json({}, { status: 401 });
  }

  const body: WhoamiResponse = { username, serverUrl, userId };
  return NextResponse.json(body);
}
