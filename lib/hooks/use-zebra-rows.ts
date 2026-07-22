"use client";

import { useEffect, useState } from "react";
import { loadAdminPrefs } from "@/lib/admin-prefs";
import { SETTINGS_SAVED_EVENT } from "@/lib/hooks/use-server-info";

/**
 * Reads the zebra-row-striping preference from the Administrator settings
 * (localStorage, key `bl-admin-prefs-v1`). The setting is edited and persisted
 * in the Administrator settings tab; this hook is read-only for consumers
 * (the shared TableRow primitive).
 *
 * Re-reads when the Administrator tab saves (SETTINGS_SAVED_EVENT), so a change
 * propagates to every open table in the same tab without a reload.
 */
export function useZebraRows(): { isZebraOn: boolean } {
  const [on, setOn] = useState<boolean>(() => loadAdminPrefs().zebraRows);

  useEffect(() => {
    const handler = () => setOn(loadAdminPrefs().zebraRows);
    window.addEventListener(SETTINGS_SAVED_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, handler);
  }, []);

  return { isZebraOn: on };
}
