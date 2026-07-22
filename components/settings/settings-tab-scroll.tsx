"use client";

import { cn } from "@/lib/utils";

/** Minimum width before a settings tab scrolls horizontally instead of collapsing.. */
export const SETTINGS_TAB_MIN_WIDTH = "min-w-[720px]";

/**
 * Scroll viewport + floor-width content box shared by every settings tab.
 * Below 720px the viewport scrolls horizontally rather than letting panels
 * crush their controls (clip-and-scroll, not graceful shrink).
 * Use inside a `flex flex-col h-full` parent so `flex-1` can establish height.
 */
export function SettingsTabScroll({
  children,
  className,
  contentClassName,
}: {
  children: React.ReactNode;
  /** Viewport overrides (rare). Applied to the outer scrollable div. */
  className?: string;
  /** Padding + vertical spacing for the content box, e.g. "p-6 space-y-5". */
  contentClassName?: string;
}) {
  return (
    <div className={cn("flex-1 overflow-auto", className)}>
      <div className={cn(SETTINGS_TAB_MIN_WIDTH, contentClassName)}>{children}</div>
    </div>
  );
}
