import type { DashboardStatus } from "@/lib/types";

/**
 * Rolled-up group status + the orange STARTED downgrade rule, mirroring
 * BridgeLink's `DashboardTableNode` (`updateGroupStatusRow` / `isStarted`).
 *
 * The Java client renders a channel/group whose state is STARTED with a green
 * bullet only when every child connector (recursively) is also STARTED;
 * otherwise the bullet is orange. Group rows additionally collapse the set of
 * child channel states into a single rolled-up state, or "Mixed" / "N/A".
 */

/**
 * True when every status in the list (and recursively every descendant) is
 * STARTED. Mirrors Java `DashboardTableNode.isStarted` — an empty list is
 * considered started (vacuously true).
 */
export function allDescendantsStarted(statuses?: DashboardStatus[]): boolean {
  return (statuses ?? []).every(
    (s) => s.state === "STARTED" && allDescendantsStarted(s.childStatuses)
  );
}

export interface GroupStatusRollup {
  /** Display label/tooltip — a state name, or "Mixed" / "N/A". */
  label: string;
  /** State key used for color lookup (see StatusBadge `colorStatus`). */
  colorStatus: string;
}

/**
 * Compute the rolled-up Status cell for a group of channels, mirroring Java
 * `DashboardTableNode.updateGroupStatusRow`:
 * - one unique state → that state;
 * - exactly two states that form a transitional pair → STARTED+STARTING→STARTING,
 *   STOPPED+STOPPING→STOPPING, PAUSED+PAUSING→PAUSING;
 * - no channels → "N/A";
 * - anything else (≥3 states, or a non-transitional 2-state mix) → "Mixed" (orange).
 *
 * For a resolved STARTED group, the bullet downgrades to orange when any channel
 * has an unstarted child connector (uses STARTING as the orange color key).
 */
export function rollupGroupStatus(channels: DashboardStatus[]): GroupStatusRollup {
  const states = new Set(channels.map((c) => c.state));

  let resolved: string | null = null;
  if (states.size === 1) {
    resolved = states.values().next().value ?? null;
  } else if (states.size === 2) {
    if (states.has("STARTED") && states.has("STARTING")) resolved = "STARTING";
    else if (states.has("STOPPED") && states.has("STOPPING")) resolved = "STOPPING";
    else if (states.has("PAUSED") && states.has("PAUSING")) resolved = "PAUSING";
  }

  if (resolved === "STARTED") {
    const fullyStarted = channels.every((c) => allDescendantsStarted(c.childStatuses));
    return { label: "STARTED", colorStatus: fullyStarted ? "STARTED" : "STARTING" };
  }
  if (resolved !== null) {
    return { label: resolved, colorStatus: resolved };
  }
  if (states.size === 0) {
    // Java uses a black bullet for N/A; the WebUI has no black bullet, so the
    // gray (UNKNOWN) fallback is used — a documented minor divergence.
    return { label: "N/A", colorStatus: "UNKNOWN" };
  }
  // Orange "Mixed" — reuse the STARTING orange color key.
  return { label: "Mixed", colorStatus: "STARTING" };
}
