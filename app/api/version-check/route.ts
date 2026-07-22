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
// need zero configuration. In dev/test we only check when VERSION_CHECK_URL is
// explicitly set, so local runs and CI don't pollute the deployment analytics.
const PROD_VERSION_CHECK_URL = "https://updates.bridgelink.online/v1/version-check";

export async function GET() {
  const configured = process.env.VERSION_CHECK_URL?.trim();
  const url =
    configured || (process.env.NODE_ENV === "production" ? PROD_VERSION_CHECK_URL : undefined);
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
