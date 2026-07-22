"use client";

import { AlertCircle } from "lucide-react";

interface ApiErrorAlertProps {
  error: string | null;
  className?: string;
}

/**
 * Shared error alert for API errors. Renders nothing when error is null/empty.
 * Mirrors the error display pattern used across Dashboard, Events, Channels pages.
 */
export function ApiErrorAlert({ error, className = "mx-6 mt-4" }: ApiErrorAlertProps) {
  if (!error) return null;
  return (
    <div
      className={`${className} flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400`}
    >
      <AlertCircle className="mt-0.5 w-4 h-4 shrink-0" />
      {/* whitespace-pre-wrap preserves newlines/indentation in multi-line errors (e.g. the
          per-template code-template save validation list) while still wrapping long lines. */}
      <span className="whitespace-pre-wrap">{error}</span>
    </div>
  );
}
