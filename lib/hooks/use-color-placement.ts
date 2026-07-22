"use client";

import { useEffect, useState } from "react";
import { loadAdminPrefs, type ThemeColorPlacement } from "@/lib/admin-prefs";
import { SETTINGS_SAVED_EVENT } from "@/lib/hooks/use-server-info";

export type ColorPlacement = ThemeColorPlacement;

/**
 * Reads the theme-color placement preference from the Administrator settings
 * (localStorage, key `bl-admin-prefs-v1`). The setting is edited and persisted
 * in the Administrator settings tab; this hook is read-only for consumers
 * (app layout, sidebar, page header).
 *
 * Re-reads when the Administrator tab saves (SETTINGS_SAVED_EVENT), so a change
 * propagates to every open consumer in the same tab without a reload.
 */
export function useColorPlacement(): { colorPlacement: ColorPlacement } {
  const [placement, setPlacement] = useState<ColorPlacement>(
    () => loadAdminPrefs().themeColorPlacement
  );

  useEffect(() => {
    const handler = () => setPlacement(loadAdminPrefs().themeColorPlacement);
    window.addEventListener(SETTINGS_SAVED_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, handler);
  }, []);

  return { colorPlacement: placement };
}
