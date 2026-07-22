/**
 * Generic API dispatch route — POST /api/ssl/import-trusted-pem.
 *
 * The core repo only owns the URL surface. Any plugin that needs to handle
 * this request registers via
 * `registerRouteHandler("POST", "/api/ssl/import-trusted-pem", handler)`.
 * If nothing is registered, the route returns 404.
 */

import { NextRequest, NextResponse } from "next/server";
import { pluginRegistry } from "@/lib/plugin-registry";

export async function POST(req: NextRequest) {
  const handler = pluginRegistry.routeHandlers.get("POST /api/ssl/import-trusted-pem");
  if (!handler) return NextResponse.json({ error: "Not available" }, { status: 404 });
  return handler(req);
}
