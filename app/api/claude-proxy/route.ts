/**
 * Claude AI proxy — POST /api/claude-proxy
 *
 * Returns 501 in the base build. The commercial claude-ai plugin registers
 * a streaming Anthropic Messages API handler via registerRouteHandler().
 */
import { NextRequest, NextResponse } from "next/server";
import "@/plugins";
import { pluginsReady } from "@/plugins/_ready";
import { pluginRegistry } from "@/lib/plugin-registry";

export async function POST(req: NextRequest) {
  await pluginsReady;
  const handler = pluginRegistry.routeHandlers.get("POST /api/claude-proxy");
  if (!handler) return NextResponse.json({ error: "Not available" }, { status: 501 });
  return handler(req);
}
