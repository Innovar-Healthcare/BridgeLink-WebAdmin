/**
 * "Recently deployed" cell highlight — shared by the Dashboard and Channels tabs.
 *
 * Both Java panels paint the "Last Deployed" cell khaki `Color(240,230,140)` with
 * black text when the channel was deployed within the last 2 minutes
 * (`DashboardPanel` and `ChannelPanel.java:3353-3367`). Kept here so both WebUI
 * tables share one predicate and one class string.
 */

/** 2-minute window, matching Java's `Calendar.add(MINUTE, -2)` check. */
export const RECENT_DEPLOY_MS = 120_000;

/**
 * True when `deployedDate` is within {@link RECENT_DEPLOY_MS} of `now`. Pure —
 * callers pass `Date.now()` so this stays testable.
 */
export function isRecentlyDeployed(deployedDate: string | null | undefined, now: number): boolean {
  if (!deployedDate) return false;
  return now - new Date(deployedDate).getTime() < RECENT_DEPLOY_MS;
}

/** Khaki cell classes for a recently-deployed "Last Deployed" cell (Java `Color(240,230,140)` + black). */
export const RECENT_DEPLOY_CELL_CLASS =
  "bg-[rgb(240,230,140)] dark:bg-yellow-900/40 text-gray-800 dark:text-yellow-200 font-medium";
