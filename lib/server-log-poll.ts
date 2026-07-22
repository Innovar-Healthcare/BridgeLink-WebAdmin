/**
 * Pure helpers for the Dashboard Server Log poll → buffer merge.
 *
 * The Server Log tab keeps a client-side buffer that it tops up on each poll.
 * Two watermarks govern it:
 *  - the poll watermark (highest id fetched) so we only request newer entries, and
 *  - the cleared floor (highest id present when the user last hit "Clear") so
 *    cleared entries stay hidden across channel switches and navigation.
 *
 * Both are error-prone (see the bugs these functions fix), so the logic lives
 * here as pure functions and is unit-tested independently of the React effect.
 */
import type { ServerLogItem } from "@/lib/types";

/**
 * Highest log id seen so far, given a poll response. Leaves the watermark
 * unchanged on an empty response — advancing it (e.g. reducing `[]` with a seed
 * of 0) would coerce `undefined` → `0`, which both changes the request shape
 * (`lastLogId=0` instead of omitted) and defeats the `?? floor` fallback in the
 * Clear handler.
 */
export function advanceServerLogWatermark(
  current: number | undefined,
  newItems: ServerLogItem[]
): number | undefined {
  if (newItems.length === 0) return current;
  return newItems.reduce((max, item) => Math.max(max, item.id), current ?? 0);
}

/**
 * Merge a poll response into the displayed buffer: drop entries at/below the
 * cleared floor, prepend the survivors (newest first), and cap at `size`.
 * Returns `prev` unchanged when nothing survives the floor, so React can bail
 * out of the re-render.
 */
export function mergeServerLogEntries(
  prev: ServerLogItem[],
  newItems: ServerLogItem[],
  clearedFloor: number,
  size: number
): ServerLogItem[] {
  const fresh = newItems.filter((item) => item.id > clearedFloor);
  if (fresh.length === 0) return prev;
  return [...fresh, ...prev].slice(0, size);
}

/**
 * New cleared floor after a Clear. Monotonic: Clear can only ever hide more,
 * never lower the floor. Without the `Math.max`, clearing while a quiet channel
 * is selected (whose slice watermark sits below the prior floor) would drop the
 * floor and resurrect previously-cleared rows on the next refresh.
 */
export function raiseClearedFloor(prev: number, watermark: number | undefined): number {
  return Math.max(prev, watermark ?? 0);
}

/**
 * Raise the cleared floor for a single view `key`, returning a new map. The floor
 * is keyed by the current selection (empty string = unified, a channel id, or a
 * comma-joined multi/group set), so clearing one view leaves other views' floors
 * untouched — clearing channel A's log doesn't clear channel B's. Monotonic per
 * key (see raiseClearedFloor).
 */
export function clearViewFloor(
  floors: Record<string, number>,
  key: string,
  watermark: number | undefined
): Record<string, number> {
  return { ...floors, [key]: raiseClearedFloor(floors[key] ?? 0, watermark) };
}
