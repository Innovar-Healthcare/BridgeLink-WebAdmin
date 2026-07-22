"use client";

import { ArrowUpCircle, X } from "lucide-react";
import type { UpdateCheckResult } from "@/lib/hooks/use-update-check";

interface UpdateBannerProps {
  result: UpdateCheckResult;
  onViewUpdate: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ result, onViewUpdate, onDismiss }: UpdateBannerProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-950/40 border-b border-orange-200 dark:border-orange-800/60 text-sm shrink-0">
      <ArrowUpCircle className="w-4 h-4 text-orange-500 shrink-0" />
      <span className="text-orange-900 dark:text-orange-200 min-w-0">
        WebAdmin <span className="font-mono font-medium">{result.latestVersion}</span> is available.{" "}
        <button
          onClick={onViewUpdate}
          className="underline underline-offset-2 font-medium hover:text-orange-700 dark:hover:text-orange-100 transition-colors"
        >
          What&apos;s new →
        </button>
      </span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss update notification"
        className="ml-auto p-0.5 text-orange-400 hover:text-orange-700 dark:hover:text-orange-200 transition-colors rounded shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
