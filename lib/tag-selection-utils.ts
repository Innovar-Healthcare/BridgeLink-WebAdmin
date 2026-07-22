/**
 * Pure helpers for the Tags settings tab multi-select / tri-state behavior.
 *
 * Mirrors the Java client `SettingsPanelTags.java`:
 *   - computeChannelStates  ← tagSelectionChanged() intersection/union tri-state (543-592)
 *   - applyChannelToggle    ← channels TableModelListener apply-to-all-selected (490-515)
 *   - applyBulkSelect       ← Select All / Deselect All over visible rows (405-435)
 *   - validateRename        ← TagNameCellEditor.valueChanged blank/duplicate revert incl. case-only self-rename (650-664)
 *   - computeRangeSelection ← MULTIPLE_INTERVAL_SELECTION shift-range
 *   - resolveSelectionAfterRemove ← removeTag adjacent-row reselection clamp (620-637)
 *   - nextNewTagColor       ← ColorUtil.getNewColor() process-wide rotating counter
 *
 * All helpers are pure and immutable: they return the SAME object reference for any tag
 * they do not change, so the component's dirty-signature comparison stays cheap.
 */

import { TAG_COLOR_PALETTE } from "@/components/tag-chip";

export type ChannelCheckState = "checked" | "unchecked" | "partial";

// ─── Tag name validation (from ChannelTag.java MAX_NAME_LENGTH + MirthFieldConstraints) ───

export const MAX_NAME_LENGTH = 24;
// Mirror Java's ChannelTag.INVALID_NAME_PATTERN = /[^a-zA-Z_0-9\-\s]/ exactly. Java's `\s`
// is ASCII-only (` \t\n\x0b\f\r`); JS's `\s` also matches Unicode whitespace (NBSP, etc.),
// so a pasted NBSP would survive the WebUI filter but be stripped by the server's fixName —
// a silent post-save name divergence L18). Spell out the ASCII whitespace set.
const INVALID_PATTERN = /[^a-zA-Z0-9_\- \t\n\x0b\f\r]/g;

/** Strip disallowed characters and clamp to the max length (mirrors the Java field constraint). */
export function fixName(name: string): string {
  return name.replace(INVALID_PATTERN, "").slice(0, MAX_NAME_LENGTH);
}

/**
 * Tri-state for each channel given the currently selected tags:
 *   - "checked"   → channel is in EVERY selected tag (intersection)
 *   - "partial"   → channel is in SOME but not all selected tags (union minus intersection)
 *   - "unchecked" → channel is in NONE of the selected tags (or no tags selected)
 */
export function computeChannelStates(
  selectedTags: ReadonlyArray<{ channelIds: ReadonlySet<string> }>,
  channelIds: Iterable<string>
): Map<string, ChannelCheckState> {
  const states = new Map<string, ChannelCheckState>();
  if (selectedTags.length === 0) {
    for (const id of channelIds) states.set(id, "unchecked");
    return states;
  }
  for (const id of channelIds) {
    let inCount = 0;
    for (const tag of selectedTags) {
      if (tag.channelIds.has(id)) inCount++;
    }
    states.set(
      id,
      inCount === 0 ? "unchecked" : inCount === selectedTags.length ? "checked" : "partial"
    );
  }
  return states;
}

/**
 * Add or remove a single channel id on every selected tag. Tags not selected — and selected
 * tags whose membership already matches `checked` — are returned by reference unchanged.
 */
export function applyChannelToggle<T extends { id: string; channelIds: Set<string> }>(
  tags: T[],
  selectedIds: ReadonlySet<string>,
  channelId: string,
  checked: boolean
): T[] {
  return tags.map((tag) => {
    if (!selectedIds.has(tag.id)) return tag;
    if (tag.channelIds.has(channelId) === checked) return tag;
    const next = new Set(tag.channelIds);
    if (checked) next.add(channelId);
    else next.delete(channelId);
    return { ...tag, channelIds: next };
  });
}

/**
 * Add or remove a set of channel ids (the visible/filtered rows) on every selected tag.
 * Used by Select All / Deselect All. Unchanged tags are returned by reference.
 */
export function applyBulkSelect<T extends { id: string; channelIds: Set<string> }>(
  tags: T[],
  selectedIds: ReadonlySet<string>,
  channelIds: Iterable<string>,
  checked: boolean
): T[] {
  // Materialize once — `channelIds` may be a single-use iterator (e.g. Map.keys()).
  const ids = Array.from(channelIds);
  return tags.map((tag) => {
    if (!selectedIds.has(tag.id)) return tag;
    const next = new Set(tag.channelIds);
    let changed = false;
    for (const cid of ids) {
      if (checked && !next.has(cid)) {
        next.add(cid);
        changed = true;
      } else if (!checked && next.has(cid)) {
        next.delete(cid);
        changed = true;
      }
    }
    return changed ? { ...tag, channelIds: next } : tag;
  });
}

/**
 * Validate an inline tag rename. Returns the fixed name on success, or `{ ok: false }` when the
 * edit must be reverted. Mirrors Java `TagNameCellEditor.valueChanged` (SettingsPanelTags.java):
 *   - reverts a blank/whitespace-only name;
 *   - reverts a case-insensitive duplicate of ANY row — including the edited row's own current
 *     value, so a case-only self-rename (`Foo`→`foo`) reverts L15). At commit time the
 *     edited tag's stored `name` still holds the OLD value, so scanning all rows compares against
 *     it exactly as Java does.
 * Whitespace is NOT trimmed L16): a trailing/leading space is a legal persisted Java
 * name (space is in the allowed character class), so `"Foo "` is returned verbatim.
 */
export function validateRename(
  tags: ReadonlyArray<{ id: string; name: string }>,
  editingId: string,
  newName: string
): { ok: true; name: string } | { ok: false } {
  const fixed = fixName(newName);
  // Blank check only (Java StringUtils.isBlank) — don't strip surrounding whitespace from a
  // name that is otherwise non-blank.
  if (!fixed.trim()) return { ok: false };
  const lower = fixed.toLowerCase();
  // `editingId` is accepted for call-site clarity but intentionally NOT used to exclude the
  // edited row — Java scans every row (against the row's still-old value), reverting a
  // case-only self-rename. ESLint `after-used` keeps this non-final param from being flagged.
  const duplicate = tags.some((t) => t.name.toLowerCase() === lower);
  if (duplicate) return { ok: false };
  return { ok: true, name: fixed };
}

/**
 * Contiguous range selection over the currently displayed (sorted) tag order, anchored at the
 * last plain/ctrl click. With no resolvable anchor, falls back to selecting just the clicked row.
 */
export function computeRangeSelection(
  sortedIds: readonly string[],
  anchorId: string | null,
  clickedId: string
): Set<string> {
  const clickedIdx = sortedIds.indexOf(clickedId);
  if (clickedIdx < 0) return new Set();
  const anchorIdx = anchorId == null ? -1 : sortedIds.indexOf(anchorId);
  if (anchorIdx < 0) return new Set([clickedId]);
  const lo = Math.min(anchorIdx, clickedIdx);
  const hi = Math.max(anchorIdx, clickedIdx);
  return new Set(sortedIds.slice(lo, hi + 1));
}

/**
 * After removing all selected tags, pick the adjacent surviving tag to select — mirrors Java
 * removeTag's clamp: select the row now occupying the first-removed view index, or the last
 * surviving row if that index is past the end. Returns null when nothing survives.
 */
export function resolveSelectionAfterRemove(
  sortedIds: readonly string[],
  selectedIds: ReadonlySet<string>
): { remaining: string[]; nextSelectedId: string | null } {
  const remaining = sortedIds.filter((id) => !selectedIds.has(id));
  if (remaining.length === 0) return { remaining, nextSelectedId: null };
  const firstRemovedIdx = sortedIds.findIndex((id) => selectedIds.has(id));
  const idx = Math.min(Math.max(firstRemovedIdx, 0), remaining.length - 1);
  return { remaining, nextSelectedId: remaining[idx] };
}

// ─── New-tag color rotation (mirrors ColorUtil.getNewColor's process-wide static counter) ───

let newTagColorCounter = 0;

/**
 * Returns the next color in the palette, advancing a module-level counter that persists across
 * adds/removes within a page session (resets on full reload) — the closest analog to Java's
 * per-process static `selection++`. Call only from event handlers, never inside a setState
 * updater (StrictMode double-invokes updaters and would double-advance the counter).
 */
export function nextNewTagColor(): string {
  return TAG_COLOR_PALETTE[newTagColorCounter++ % TAG_COLOR_PALETTE.length];
}
