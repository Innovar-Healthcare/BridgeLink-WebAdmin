/** Shared Tailwind class helpers for form inputs across connector panels. */

import { densityHeight, type ViewDensity } from "@/lib/hooks/use-compact-mode";

/**
 * Returns a complete className string for a text input in a connector panel.
 * When `density` is omitted the `h-8` default is used (same as the original static string).
 */
export function inputCls(density?: ViewDensity): string {
  const h = density ? densityHeight(density) : "h-8";
  return `${h} px-3 text-sm rounded border border-border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed`;
}

/**
 * Returns a complete className string for a native <select> in a connector panel.
 * When `density` is omitted the `h-8` default is used.
 */
export function selectCls(density?: ViewDensity): string {
  const h = density ? densityHeight(density) : "h-8";
  return `${h} px-2 text-sm rounded border border-border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed`;
}

/** Override border to red for invalid fields. Uses `!important` to beat base border. */
export const inputErrorCls =
  "!border-red-500 dark:!border-red-400 focus:!border-red-500 focus:!ring-red-500/30";

export const selectErrorCls = "!border-red-500 dark:!border-red-400";

/** Small inline error message shown beneath an invalid field. */
export const fieldErrorMsgCls = "text-xs text-red-500 dark:text-red-400 mt-0.5";
