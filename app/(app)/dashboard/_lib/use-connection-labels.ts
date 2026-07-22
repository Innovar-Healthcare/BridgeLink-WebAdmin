"use client";

import { useMemo } from "react";
import type { ConnectorStateMap } from "@/lib/api/api-dashboard";

/**
 * Map of channelId → HTML-stripped source-connection label, memoized on the
 * connector-state map. Precomputed once per tick so the Connection
 * sort comparator does an O(1) lookup instead of re-running the strip regex
 * O(n log n) times per sort.
 */
export function useConnectionLabels(connectorStates: ConnectorStateMap): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const [key, entry] of Object.entries(connectorStates)) {
      if (key.endsWith("_0")) {
        map.set(key.slice(0, -2), (entry[1] ?? "").replace(/<[^>]+>/g, "").trim());
      }
    }
    return map;
  }, [connectorStates]);
}
