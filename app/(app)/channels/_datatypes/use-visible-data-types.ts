"use client";

/**
 * Data-type names to offer in the inbound/outbound data-type dropdowns, in
 * registry order, filtered by server-enablement gating.
 *
 * Built-in data types carry no `pluginName` so they always appear; a
 * plugin-contributed data type appears only when its server extension is
 * installed AND enabled. Lookup-by-name (rendering, template parsing, and
 * serialization) is never gated, so a channel already using a gated type still
 * works — the dropdown pins that current value as a disabled "(unavailable)"
 * option instead of dropping it, which would otherwise let a save silently
 * rewrite the channel's data type to the first remaining option.
 */

import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";
import { DATA_TYPE_OPTIONS, DATA_TYPE_REGISTRY } from "./index";

export function useVisibleDataTypes(): readonly string[] {
  const surfaceEnabled = usePluginSurfaceEnabled();
  return DATA_TYPE_OPTIONS.filter((name) =>
    surfaceEnabled(DATA_TYPE_REGISTRY.get(name)?.pluginName)
  );
}
