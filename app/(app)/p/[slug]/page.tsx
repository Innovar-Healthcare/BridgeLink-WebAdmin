"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { pluginRegistry } from "@/lib/plugin-registry";
import {
  usePluginSurfaceEnabled,
  usePluginSurfaceLocked,
  usePluginSurfaceReady,
} from "@/lib/plugin-gating";
import { LockedFeature } from "@/components/locked-feature";

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
  const surfaceLocked = usePluginSurfaceLocked();
  const ready = usePluginSurfaceReady(page ?? undefined);

  if (!page) return notFound();
  if (page.pluginName || page.licensedPluginId) {
    if (!ready) return null;
    // Installed but unlicensed is a different answer from absent.
    // Work Queue is the first commercial plugin to contribute a page, so this is
    // the first time the distinction is reachable: 404ing an installed feature
    // tells the operator it does not exist, when what they need to know is that
    // it needs a license. Matches how licensed settings tabs already behave.
    // LockedFeature does not mount the real component, so no unlicensed API
    // calls fire.
    if (surfaceLocked(page)) {
      return (
        <LockedFeature
          licensedPluginId={page.licensedPluginId!}
          featureName={page.label}
          icon={page.icon}
        />
      );
    }
    if (!surfaceEnabled(page)) return notFound();
  }

  const Component = page.component;
  return <Component />;
}
