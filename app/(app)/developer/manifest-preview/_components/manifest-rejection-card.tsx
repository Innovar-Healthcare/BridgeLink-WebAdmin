"use client";

/**
 * Error surface for the Manifest Preview page — shown when the pasted text
 * isn't valid JSON (severity "error") or is valid JSON the strict validator
 * rejects (severity "warning"). The detail is the validator's
 * JSON-path-prefixed reason (or the JSON parser's message), rendered monospace
 * so the path reads clearly.
 *
 * `compact` renders a slim banner (used over a still-rendered last-good
 * preview); otherwise a full card (used when there is nothing to fall back to).
 * The region is `role="alert"` so assistive tech announces it when it appears
 * after the debounce.
 */

import { AlertOctagon, AlertTriangle, CornerDownRight } from "lucide-react";

type Severity = "error" | "warning";

const STYLES: Record<Severity, { box: string; icon: string; title: string; detail: string }> = {
  error: {
    box: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
    icon: "text-red-600 dark:text-red-500",
    title: "text-red-800 dark:text-red-400",
    detail: "text-red-700 dark:text-red-500",
  },
  warning: {
    box: "border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30",
    icon: "text-yellow-600 dark:text-yellow-500",
    title: "text-yellow-800 dark:text-yellow-400",
    detail: "text-yellow-700 dark:text-yellow-500",
  },
};

export function ManifestRejectionCard({
  title,
  detail,
  note,
  severity = "warning",
  compact = false,
  onJump,
}: {
  title: string;
  detail: string;
  note?: string;
  severity?: Severity;
  compact?: boolean;
  /** When set, renders a "Jump to error" affordance that focuses the offending JSON. */
  onJump?: () => void;
}) {
  const s = STYLES[severity];
  const Icon = severity === "error" ? AlertOctagon : AlertTriangle;

  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-lg border ${s.box} ${compact ? "p-2.5" : "p-4"}`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${s.icon}`} />
      <div className="min-w-0">
        <p className={`text-sm font-medium ${s.title}`}>{title}</p>
        <p className={`mt-1 break-words font-mono text-xs ${s.detail}`}>{detail}</p>
        {note && <p className={`mt-1 text-xs ${s.detail}`}>{note}</p>}
        {onJump && (
          <button
            type="button"
            onClick={onJump}
            className={`mt-1.5 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:opacity-80 ${s.detail}`}
          >
            <CornerDownRight className="size-3" /> Jump to error
          </button>
        )}
      </div>
    </div>
  );
}
