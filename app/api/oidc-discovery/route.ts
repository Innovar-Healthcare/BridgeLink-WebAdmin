/**
 * Generic API dispatch route — GET /api/oidc-discovery.
 *
 * The core repo only owns the URL surface. Any plugin that needs to handle
 * this request registers via
 * `registerRouteHandler("GET", "/api/oidc-discovery", handler)`. If nothing
 * is registered, the route returns 404.
 */

import { NextRequest, NextResponse } from "next/server";
import "@/plugins";
import { pluginsReady } from "@/plugins/_ready";
import { pluginRegistry } from "@/lib/plugin-registry";

export async function GET(req: NextRequest) {
  await pluginsReady;
  const handler = pluginRegistry.routeHandlers.get("GET /api/oidc-discovery");
  if (!handler) return NextResponse.json({ error: "Not available" }, { status: 404 });
  return handler(req);
}
