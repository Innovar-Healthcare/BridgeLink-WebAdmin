/**
 * GET /api/config — public deployment configuration for the login UI.
 *
 * Returns how the operator configured server access so the login page can
 * render the Server field appropriately:
 *   - mode "multi"    → dropdown populated from `servers`
 *   - mode "single"   → pre-set, read-only (BRIDGELINK_SERVER_URL)
 *   - mode "sameHost" → pre-set, read-only (https://<host>:8443)
 *   - mode "open"     → free-text field (dev / BL_ALLOW_ANY_SERVER=1)
 *
 * This is UX only — it does NOT grant access. The actual SSRF gate is
 * `resolveAllowedServer()` enforced in the proxy/whoami/import-pem routes, so a
 * client that ignores this endpoint and forges `x-bl-server` is still blocked.
 *
 * No authentication: the login page must read this before any session exists,
 * and it exposes only the operator's already-public server URLs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/server-allowlist";

export function GET(req: NextRequest) {
  return NextResponse.json(getServerConfig(req));
}
