import type { SortDir } from "@/lib/hooks/use-sortable";

/**
 * Shared comparator for the group rows on the Channels and Dashboard tabs.
 *
 * [Default Group] pins to the top of the Name column (mirrors Java
 * ChannelTableNameEntry.compareTo): first on ascending, last on descending.
 * Other (numeric) columns sort naturally with no pin, matching the Java client.
 *
 * `getValue` returns the sort value for the active column; each page supplies
 * its own (the column sets differ between Channels and Dashboard).
 */
export function compareGroups<G extends { id: string }>(
  a: G,
  b: G,
  sort: { key: string | null; dir: SortDir },
  getValue: (group: G) => string | number,
  defaultGroupId: string
): number {
  const dir = sort.dir === "desc" ? -1 : 1;
  if (sort.key === "name") {
    if (a.id === defaultGroupId) return -dir;
    if (b.id === defaultGroupId) return dir;
  }
  const av = getValue(a);
  const bv = getValue(b);
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
  return String(av).localeCompare(String(bv)) * dir;
}
