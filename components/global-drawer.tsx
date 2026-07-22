"use client";

/**
 * GlobalDrawer — fixed right-side slide-out panel for plugin drawer pages.
 *
 * Reads useDrawer() to know which plugin slug is active (if any).
 * Looks up the plugin component from pluginRegistry.pages.
 * Renders a header (icon + label + close button) and the component body.
 *
 * Animation: CSS translate-x-0 ↔ translate-x-full with transition-transform.
 * Backdrop click and Escape key both close the drawer.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { pluginRegistry } from "@/lib/plugin-registry";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";
import { useDrawer } from "@/lib/hooks/use-drawer";

export function GlobalDrawer() {
  const { activeSlug, subtitle, closeDrawer } = useDrawer();

  // Gate the host itself/: the sidebar pre-filters its
  // openDrawer() calls, but the drawer must not trust its callers — a gated-off
  // (disabled or unlicensed) plugin page is treated as closed, mirroring the
  // /p/[slug] route's notFound.
  const surfaceEnabled = usePluginSurfaceEnabled();
  const found = activeSlug ? pluginRegistry.pages.find((p) => p.slug === activeSlug) : null;
  const plugin = found && surfaceEnabled(found) ? found : null;
  const isOpen = plugin !== null && plugin !== undefined;
  const drawerWidth = plugin?.drawerWidth ?? 480;

  // Close on Escape
  const closeRef = useRef(closeDrawer);
  // eslint-disable-next-line react-hooks/refs
  closeRef.current = closeDrawer;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const Component = plugin?.component ?? null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={plugin?.label ?? "Panel"}
        className={cn(
          "fixed top-0 right-0 z-50 flex flex-col h-screen bg-white dark:bg-gray-900",
          "border-l border-border shadow-2xl",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{ width: drawerWidth }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3 shrink-0">
          {plugin && <plugin.icon className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
              {plugin?.label ?? ""}
            </div>
            {subtitle && (
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={closeDrawer}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors"
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">{Component && <Component />}</div>
      </div>
    </>
  );
}
