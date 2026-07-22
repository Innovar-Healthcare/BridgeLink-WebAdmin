"use client";

/**
 * Generic auth callback route — /auth/callback.
 *
 * The core repo only owns the URL surface. Any plugin that needs this route
 * registers a component via `registerRoutePage("/auth/callback", ...)`. If
 * no plugin has registered, the route 404s.
 */

import { use } from "react";
import { notFound } from "next/navigation";
import "@/plugins";
import { pluginsReady } from "@/plugins/_ready";
import { pluginRegistry } from "@/lib/plugin-registry";

export default function AuthCallbackPage() {
  use(pluginsReady);
  const route = pluginRegistry.routePages.find((p) => p.path === "/auth/callback");
  if (!route) return notFound();
  const Component = route.component;
  return <Component />;
}
