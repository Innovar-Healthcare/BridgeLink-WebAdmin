"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

/** Padding overrides keyed by density. Height is intentionally NOT set — use `rows` or explicit height. */
const DENSITY_CLASSES: Record<ViewDensity, string> = {
  comfortable: "px-3 py-2",
  default: "px-2.5 py-1.5",
  compact: "px-2 py-1",
};

/**
 * Tab-key handler for textareas.
 * - Tab: insert \t at cursor / replace selection
 * - Shift+Tab: outdent — remove one leading \t from each line in the selection
 * - Escape: blur the field so keyboard users can exit via Escape → Tab
 *
 * Uses the native setter + synthetic "input" event so React's onChange fires.
 * Export allows raw <textarea> elements to reuse the same logic.
 */
export function handleTabKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
  if (e.key === "Escape") {
    e.currentTarget.blur();
    return;
  }

  if (e.key === "Tab") {
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;

    let newVal: string;
    let newStart: number;
    let newEnd: number;

    if (!e.shiftKey) {
      // Tab: insert \t at cursor / replace selection
      newVal = val.slice(0, start) + "\t" + val.slice(end);
      newStart = newEnd = start + 1;
    } else {
      // Shift+Tab: remove one leading \t from each line that overlaps the selection
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      const region = val.slice(lineStart, end);
      let removedBeforeCursor = 0;
      let totalRemoved = 0;

      const newRegion = region.replace(/^(\t?)/gm, (match, tab, offset) => {
        if (tab === "\t") {
          if (lineStart + (offset as number) < start) removedBeforeCursor++;
          totalRemoved++;
          return "";
        }
        return "";
      });

      newVal = val.slice(0, lineStart) + newRegion + val.slice(end);
      newStart = Math.max(lineStart, start - removedBeforeCursor);
      newEnd = Math.max(newStart, end - totalRemoved);
    }

    // Use the native setter + input event so React's synthetic onChange fires.
    const nativeSet = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    nativeSet?.call(el, newVal);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    requestAnimationFrame(() => el.setSelectionRange(newStart, newEnd));
  }
}

interface TextareaProps extends React.ComponentProps<"textarea"> {
  /**
   * View density override. When provided, padding adjusts:
   * - comfortable: px-3 py-2
   * - default:     px-2.5 py-1.5
   * - compact:     px-2 py-1
   *
   * When omitted the default padding (px-3 py-2) is used.
   */
  density?: ViewDensity;
  /**
   * When true, Tab inserts a literal tab character instead of moving browser focus.
   * Shift+Tab removes one leading tab from each line in the selection (outdent).
   * Escape blurs the field so keyboard users can still exit via Escape → Tab.
   */
  enableTabKey?: boolean;
}

function Textarea({ className, density, enableTabKey, onKeyDown, ...props }: TextareaProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (enableTabKey) {
      handleTabKeyDown(e);
      if (e.key === "Tab" || e.key === "Escape") return;
    }

    onKeyDown?.(e);
  }

  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-background text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        density ? DENSITY_CLASSES[density] : "px-3 py-2",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
}

export { Textarea };
export type { TextareaProps };
