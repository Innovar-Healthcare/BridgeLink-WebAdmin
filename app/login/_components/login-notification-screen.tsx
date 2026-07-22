"use client";

import { Button } from "@/components/ui/button";

interface Props {
  /** The server-configured login notification message (loginNotificationMessage). */
  message: string;
  /** True while the acknowledgment / post-login routing is in flight. */
  accepting: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * Login Notification & Consent screen — mirrors the Java client's
 * CustomBannerPanelDialog shown from LoginPanel.handleSuccess() when the server
 * setting "Require Login Notification and Consent" is enabled. The user must
 * Accept to enter the app; Cancel logs them back out. Shown on every login while
 * the setting is enabled.
 */
export function LoginNotificationScreen({ message, accepting, onAccept, onCancel }: Props) {
  return (
    <div className="p-8 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Login Notification
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Please review the notice below. You must accept it to continue.
        </p>
      </div>

      <div className="max-h-[50vh] overflow-auto rounded border border-border bg-muted/30 p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {message}
        </pre>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={accepting}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40"
        >
          Cancel
        </button>
        <Button
          type="button"
          onClick={onAccept}
          disabled={accepting}
          className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {accepting ? "Accepting…" : "Accept"}
        </Button>
      </div>
    </div>
  );
}
