"use client";

import { AlertTriangle, X } from "lucide-react";
import type { CompatResult } from "@/lib/version-compat";

interface CompatibilityBannerProps {
  compat: CompatResult;
  onDismiss: () => void;
}

/**
 * Dismissible warning strip shown when the Core server is newer than this Web
 * Admin build (untested). Non-blocking — the hard-block case is gated at login
 * and in the app shell, never here. Styled to match {@link UpdateBanner}.
 */
export function CompatibilityBanner({ compat, onDismiss }: CompatibilityBannerProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 dark:bg-orange-950/40 border-b border-orange-200 dark:border-orange-800/60 text-sm shrink-0">
      <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
      <span className="text-orange-900 dark:text-orange-200 min-w-0">
        BridgeLink server <span className="font-mono font-medium">{compat.serverVersion}</span> is
        newer than this Web Admin build{" "}
        <span className="font-mono font-medium">{compat.webAdminVersion}</span>. Some features may
        not work as expected.
      </span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss compatibility warning"
        className="ml-auto p-0.5 text-orange-400 hover:text-orange-700 dark:hover:text-orange-200 transition-colors rounded shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
