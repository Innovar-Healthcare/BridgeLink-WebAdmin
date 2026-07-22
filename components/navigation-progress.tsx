"use client";

import { useIsNavigating } from "@/lib/hooks/use-navigating-router";

/**
 * Thin indeterminate progress bar rendered at the very top of the viewport.
 * Becomes visible during route transitions (via NavigatingRouterProvider).
 * isPending stays true for the entire duration including Next.js dev compilation.
 * Mount once in the app layout, inside NavigatingRouterProvider.
 */
export function NavigationProgress() {
  const isNavigating = useIsNavigating();

  if (!isNavigating) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5 overflow-hidden bg-blue-100 dark:bg-blue-900/30">
      <div
        className="h-full w-1/3 bg-blue-500 dark:bg-blue-400"
        style={{ animation: "nav-progress 1.2s ease-in-out infinite" }}
      />
    </div>
  );
}
