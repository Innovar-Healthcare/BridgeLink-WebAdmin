"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { pluginRegistry } from "@/lib/plugin-registry";
import { usePluginSurfaceEnabled, usePluginSurfaceReady } from "@/lib/plugin-gating";

interface Props {
  params: Promise<{ slug: string }>;
}

export default function PluginPage({ params }: Props) {
  const { slug } = use(params);
  const page = pluginRegistry.pages.find((p) => p.slug === slug);

  // Gate server-backed plugin pages on the plugin being active, so a direct URL
  // to a disabled plugin's page 404s rather than mounting a page that
  // immediately fails its API calls. Wait for the relevant cache to resolve
  // first to avoid flashing notFound (or making those calls) while it loads.
  const surfaceEnabled = usePluginSurfaceEnabled();
  const ready = usePluginSurfaceReady(page ?? undefined);

  if (!page) return notFound();
  if (page.pluginName || page.licensedPluginId) {
    if (!ready) return null;
    if (!surfaceEnabled(page)) return notFound();
  }

  const Component = page.component;
  return <Component />;
}
