/**
 * Helpers for the stuck-channel signal on the dashboard.
 *
 * A channel reports `lifecycleOverdue` when it has been STOPPING or STARTING longer than the
 * server's stop grace period; `stateSince` says when it entered that state. Both are 26.9+
 * fields and absent on older servers, in which case nothing here fires.
 */

/** Human duration since an ISO timestamp, e.g. "45s", "3m 12s", "2h 05m". Empty when unknown. */
export function formatDurationSince(
  isoSince: string | undefined,
  now: number = Date.now()
): string {
  if (!isoSince) return "";
  const since = Date.parse(isoSince);
  if (Number.isNaN(since)) return "";
  const totalSeconds = Math.max(0, Math.floor((now - since) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** Epoch millis → "3m 12s" style duration, for the threads report's own timestamps. */
export function formatDurationBetween(fromMillis: number, toMillis: number): string {
  return formatDurationSince(new Date(fromMillis).toISOString(), toMillis);
}

/**
 * The tooltip for the overdue indicator. STARTING is worded differently on purpose: a long
 * start is usually recovery working through a backlog, and halting it trades a possible
 * duplicate for the interruption, so it is not offered as the first move.
 */
export function overdueTooltip(state: string | undefined, elapsed: string): string {
  const forHow = elapsed ? ` for ${elapsed}` : "";
  if (state === "STARTING") {
    return `Starting${forHow}, longer than the stop grace period. Recovery may still be working through a backlog; open Thread Diagnostics to see what it is doing before halting.`;
  }
  return `Stopping${forHow}, longer than the stop grace period. A thread is not finishing; open Thread Diagnostics to see which one, or halt the channel.`;
}
