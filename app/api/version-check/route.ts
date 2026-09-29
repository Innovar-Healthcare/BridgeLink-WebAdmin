/**
 * Version check proxy — GET /api/version-check
 *
 * Forwards to the Innovar-hosted update endpoint so the browser never calls
 * an external host (CSP: connect-src 'self'). Fail-silent: any error returns
 * a null body rather than a non-2xx status so the client hook never disrupts
 * the app on a network failure.
 */
import { NextResponse } from "next/server";

// Hosted update endpoint. Used by default in production so prod deployments
// need zero configuration.
const PROD_VERSION_CHECK_URL = "https://updates.bridgelink.online/v1/version-check";

/**
 * Resolves the endpoint to check, or `undefined` to skip the check entirely.
 *
 * `VERSION_CHECK_URL` has three states, and the difference between "unset" and
 * "set to blank" is load-bearing:
 *
 *   unset            → production checks the hosted endpoint; dev/test skip
 *   set to a URL     → check that URL (any environment)
 *   set but blank,
 *   or "off"/"false"/
 *   "disabled"       → skip the check in every environment, production included
 *
 * That last state exists because the E2E suite builds and runs the app with
 * NODE_ENV=production (see playwright.config.ts), which used to fall through to
 * the hosted endpoint and send real analytics traffic on every page load — each
 * Playwright context starts with empty localStorage, so the client's 24h
 * throttle never applied. That accounted for ~99% of all rows in the deployment
 * analytics dataset. Note that returning "" from a trim() is NOT
 * enough on its own to opt out: an empty string is falsy, so it would fall
 * through to the production default — the explicit `undefined` check below is
 * what makes opting out possible.
 *
 * Blank-as-disabled matches WEBADMIN_CONF="" and BETA_MODE="" in the same
 * playwright.config.ts env block.
 */
const DISABLE_VALUES = new Set(["", "off", "false", "disabled"]);

function resolveVersionCheckUrl(): string | undefined {
  const raw = process.env.VERSION_CHECK_URL;
  if (raw !== undefined && DISABLE_VALUES.has(raw.trim().toLowerCase())) return undefined;

  const configured = raw?.trim();
  return configured || (process.env.NODE_ENV === "production" ? PROD_VERSION_CHECK_URL : undefined);
}

export async function GET() {
  const url = resolveVersionCheckUrl();
  if (!url) return NextResponse.json(null);

  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0.0";

  try {
    const res = await fetch(`${url}?version=${encodeURIComponent(version)}`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json(null);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(null);
  }
}
