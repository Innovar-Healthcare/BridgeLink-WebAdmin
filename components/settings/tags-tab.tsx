"use client";

/**
 * Tags Settings tab — mirrors Java's SettingsPanelTags.java.
 *
 * Two-panel layout:
 *   Top:    Tags table (Name, Color, Channel Count) with Add/Remove
 *   Bottom: Channels list with tri-state checkboxes for tag assignment
 *
 * API: GET /server/channelTags      → load tags
 *      GET /channels/idsAndNames    → load channel list
 *      PUT /server/channelTags      → save tags
 */

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Plus, Tags, Trash2 } from "lucide-react";

import { toast } from "sonner";
import { getChannelIdsAndNames, getChannelTags, setChannelTags } from "@/lib/api-client";
import { generateUUID } from "@/lib/utils";
import type { ChannelTag } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "./settings-section";
import { SettingsTabScroll } from "./settings-tab-scroll";
import { ColorPickerButton } from "./color-picker-button";
import { tagColorToHex, hexToXStreamColor, type TagColor } from "@/components/tag-chip";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import {
  computeChannelStates,
  applyChannelToggle,
  applyBulkSelect,
  validateRename,
  computeRangeSelection,
  resolveSelectionAfterRemove,
  nextNewTagColor,
  fixName,
  MAX_NAME_LENGTH,
  type ChannelCheckState,
} from "@/lib/tag-selection-utils";

// ─── Column definitions ──────────────────────────────────────────────────────

type TagsCol = "name" | "color" | "channelCount";

const TAGS_COLS: ColDef<TagsCol>[] = [
  { key: "name", label: "Name", defaultWidth: 240, minWidth: 100, defaultVisible: true },
  { key: "color", label: "Color", defaultWidth: 90, minWidth: 70, defaultVisible: true },
  {
    key: "channelCount",
    label: "Channel Count",
    defaultWidth: 100,
    minWidth: 80,
    defaultVisible: true,
  },
];

type ChannelCol = "checkbox" | "name";

const CHANNEL_COLS: ColDef<ChannelCol>[] = [
  { key: "checkbox", label: "", defaultWidth: 40, minWidth: 30, defaultVisible: true },
  { key: "name", label: "Name", defaultWidth: 400, minWidth: 100, defaultVisible: true },
];

interface ChannelRow {
  id: string;
  name: string;
  state: ChannelCheckState;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface EditableTag {
  id: string;
  name: string;
  color: string; // hex "#rrggbb"
  channelIds: Set<string>;
}

function tagToEditable(tag: ChannelTag): EditableTag {
  return {
    id: tag.id,
    name: tag.name,
    color: tagColorToHex(tag.backgroundColor as TagColor),
    channelIds: new Set(tag.channelIds ?? []),
  };
}

function editableToChannelTag(t: EditableTag): ChannelTag {
  return {
    id: t.id,
    name: t.name,
    backgroundColor: hexToXStreamColor(t.color),
    channelIds: Array.from(t.channelIds),
  };
}

// ─── Tri-State Checkbox ──────────────────────────────────────────────────────

function TriStateCheckbox({
  state,
  onChange,
  disabled,
}: {
  state: "checked" | "unchecked" | "partial";
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === "partial";
    }
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "checked"}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="accent-blue-600 cursor-pointer"
    />
  );
}

// ─── Actions interface for dockable toolbar ─────────────────────────────────

export interface TagsTabActions {
  save: () => void;
  refresh: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface TagsTabProps {
  onDirty?: (isDirty: boolean) => void;
  saveRef?: { current: () => Promise<void> };
  actionsRef?: React.MutableRefObject<TagsTabActions>;
  onActionsChanged?: () => void;
}

export function TagsTab({ onDirty, saveRef, actionsRef, onActionsChanged }: TagsTabProps) {
  const tagsColConfig = useColumnConfig(TAGS_COLS, "bl-settings-tags-cols-v1");
  const tagsSortState = useSortable<TagsCol>("name", "asc");
  const channelsColConfig = useColumnConfig(CHANNEL_COLS, "bl-settings-tags-channels-cols-v1");
  const channelsSortState = useSortable<ChannelCol>("name", "asc");
  const [tags, setTags] = useState<EditableTag[]>([]);
  // Clean baseline is the empty set, not "" — otherwise `dirty` is true from mount
  // (`"[]" !== ""`) and, after a failed load, stays true forever, arming a Save that
  // would PUT an authoritative empty set and wipe every server-side tag.
  const [originalJson, setOriginalJson] = useState(() => JSON.stringify([]));
  // Gates every savable path on a successful load. Only a successful `load()` flips this
  // true; a failed *initial* load leaves it false (Save blocked, `tags` never populated),
  // while a failed *refresh* after a prior success keeps it true because `tags` still holds
  // the previously-loaded non-empty data (saving that is safe, mirrors Java keeping the
  // table on refresh failure). Mirrors Java: Save is enabled only by an edit after a
  // successful `doRefresh` (SettingsPanelTags.doSave).
  const [loadedOk, setLoadedOk] = useState(false);
  const [channels, setChannels] = useState<Map<string, string>>(new Map());
  // Multi-select (mirrors Java MULTIPLE_INTERVAL_SELECTION). `anchorTagId` is the last
  // plain/ctrl click, used as the fixed end of a shift-range.
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [anchorTagId, setAnchorTagId] = useState<string | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const tagsToJson = useCallback(
    (t: EditableTag[]) =>
      JSON.stringify(
        t.map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          channelIds: Array.from(tag.channelIds).sort(),
        }))
      ),
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tagData, channelData] = await Promise.all([getChannelTags(), getChannelIdsAndNames()]);
      const editable = tagData
        .map(tagToEditable)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      setTags(editable);
      setOriginalJson(tagsToJson(editable));
      setLoadedOk(true);
      setChannels(channelData);
      // Mirrors Java's setRowSelectionInterval(0, 0) — select the first tag on load.
      const firstId = editable.length > 0 ? editable[0].id : null;
      setSelectedTagIds(firstId ? new Set([firstId]) : new Set());
      setAnchorTagId(firstId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, [tagsToJson]);

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  // Never report dirty (and never allow save) until a load has succeeded — a failed load
  // must not be able to stage an empty/partial authoritative save.
  const dirty = loadedOk && tagsToJson(tags) !== originalJson;

  // Notify parent of dirty state changes
  // (onDirty intentionally omitted from deps — only fire when dirty value itself changes)

  // onDirty intentionally omitted from deps — only fire when dirty value itself changes
  useEffect(() => {
    onDirty?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // ── Selected tags (multi-select) ──
  const selectedTags = useMemo(
    () => tags.filter((t) => selectedTagIds.has(t.id)),
    [tags, selectedTagIds]
  );
  const hasSelection = selectedTagIds.size > 0;

  // ── Sorted tag rows — one source of truth for both the table render and shift-range
  // selection (the range must be computed over the on-screen order). ──
  const { sorted: sortTags, sort: tagsSort } = tagsSortState;
  const sortedTags = useMemo(
    () =>
      sortTags(tags, (t) => {
        switch (tagsSort.key) {
          case "name":
            return t.name;
          case "color":
            return t.color;
          case "channelCount":
            return t.channelIds.size;
          default:
            return undefined;
        }
      }),
    [tags, sortTags, tagsSort.key]
  );
  const sortedTagIds = useMemo(() => sortedTags.map((t) => t.id), [sortedTags]);

  // ── Channel checkbox tri-state (mirrors Java tagSelectionChanged): checked = in every
  // selected tag, partial = in some, unchecked = in none. ──
  const channelStates = useMemo(
    () => computeChannelStates(selectedTags, channels.keys()),
    [selectedTags, channels]
  );

  // ── Filtered channels ──
  const filteredChannels = useMemo(() => {
    const entries = Array.from(channels.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: "base" })
    );
    if (!channelFilter.trim()) return entries;
    const filter = channelFilter.toLowerCase();
    return entries.filter(([, name]) => name.toLowerCase().includes(filter));
  }, [channels, channelFilter]);

  // ── Handlers ──

  // Row click selection (mirrors Java MULTIPLE_INTERVAL_SELECTION):
  //   ctrl/cmd → toggle the clicked tag; shift → contiguous range from the anchor;
  //   plain     → select only the clicked tag. The anchor follows plain/ctrl clicks.
  const handleTagClick = (clickedId: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedTagIds((prev) => {
        const next = new Set(prev);
        if (next.has(clickedId)) next.delete(clickedId);
        else next.add(clickedId);
        return next;
      });
      setAnchorTagId(clickedId);
    } else if (e.shiftKey) {
      setSelectedTagIds(computeRangeSelection(sortedTagIds, anchorTagId, clickedId));
    } else {
      setSelectedTagIds(new Set([clickedId]));
      setAnchorTagId(clickedId);
    }
  };

  const addTag = () => {
    let num = 1;
    let name: string;
    do {
      name = `Tag ${num++}`;
    } while (tags.some((t) => t.name.toLowerCase() === name.toLowerCase()));

    // Read+advance the module-level color counter here in the event handler — never inside
    // a setState updater, which StrictMode double-invokes (would double-advance the counter).
    const newTag: EditableTag = {
      id: generateUUID(),
      name,
      color: nextNewTagColor(),
      channelIds: new Set(),
    };
    setTags((prev) => [...prev, newTag]);
    setSelectedTagIds(new Set([newTag.id]));
    setAnchorTagId(newTag.id);
  };

  const removeTag = () => {
    if (!hasSelection) return;
    const { nextSelectedId } = resolveSelectionAfterRemove(sortedTagIds, selectedTagIds);
    setTags((prev) => prev.filter((t) => !selectedTagIds.has(t.id)));
    setSelectedTagIds(nextSelectedId ? new Set([nextSelectedId]) : new Set());
    setAnchorTagId(nextSelectedId);
  };

  const updateTag = (id: string, updates: Partial<EditableTag>) => {
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const toggleChannel = (channelId: string, checked: boolean) => {
    if (!hasSelection) return;
    setTags((prev) => applyChannelToggle(prev, selectedTagIds, channelId, checked));
  };

  const selectAllChannels = () => {
    if (!hasSelection) return;
    const visibleIds = filteredChannels.map(([id]) => id);
    setTags((prev) => applyBulkSelect(prev, selectedTagIds, visibleIds, true));
  };

  const deselectAllChannels = () => {
    if (!hasSelection) return;
    const visibleIds = filteredChannels.map(([id]) => id);
    setTags((prev) => applyBulkSelect(prev, selectedTagIds, visibleIds, false));
  };

  // ── Name editing ──
  const startEditName = (tag: EditableTag) => {
    setEditingTagId(tag.id);
    setEditingName(tag.name);
  };

  // Mirrors Java TagNameCellEditor.valueChanged: blank or a case-insensitive duplicate of
  // another tag reverts the edit (no change); a valid unique name is applied.
  const commitEditName = () => {
    if (!editingTagId) return;
    const result = validateRename(tags, editingTagId, editingName);
    if (result.ok) updateTag(editingTagId, { name: result.name });
    setEditingTagId(null);
  };

  // ── Save ──

  // Pure save — throws on error; no UI state changes. Used by the navigation guard.
  async function doSave() {
    // Defense in depth: even if the guard were somehow armed, never PUT what a failed
    // load produced. `setChannelTags` is authoritative — an empty/partial set wipes the
    // server.
    if (!loadedOk) return;
    const apiTags = tags.map(editableToChannelTag);
    await setChannelTags(apiTags);
    setOriginalJson(tagsToJson(tags));
  }

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await doSave();
      toast.success("Tags saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save tags");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, onActionsChanged]);

  // Expose the imperative save/actions handles to the parent. Written in a deps-less
  // effect (not during render) to satisfy react-hooks/refs. Declared after the handlers
  // it references; the parent's re-render from onActionsChanged is deferred until the
  // full effect flush completes, so it always observes fresh handles.
  useEffect(() => {
    if (saveRef) saveRef.current = doSave;
    if (actionsRef) {
      actionsRef.current = {
        save: handleSave,
        refresh: load,
        dirty,
        saving,
        loading,
      };
    }
  });

  const { viewDensity } = useCompactMode();
  const outerPad =
    viewDensity === "comfortable" ? "p-6" : viewDensity === "compact" ? "p-2" : "p-4";
  const outerSpacing =
    viewDensity === "comfortable"
      ? "space-y-4"
      : viewDensity === "compact"
        ? "space-y-2"
        : "space-y-3";
  const filterGap =
    viewDensity === "comfortable"
      ? "gap-3 mb-2"
      : viewDensity === "compact"
        ? "gap-2 mb-1"
        : "gap-2 mb-1.5";

  if (loading) {
    return (
      <div className={`${outerPad} ${outerSpacing}`}>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <SettingsTabScroll contentClassName={`${outerPad} ${outerSpacing}`}>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}

        {/* ── Tags Table ── */}
        <SettingsSection title="Tags" icon={Tags}>
          <div className="flex gap-3">
            <div className="flex-1">
              <DataTable<EditableTag, TagsCol>
                variant="sortable"
                cols={TAGS_COLS}
                rows={sortedTags}
                colConfig={tagsColConfig}
                sortState={tagsSortState}
                rowKey={(t) => t.id}
                selectedRowIds={selectedTagIds}
                onRowClick={(t, e) => handleTagClick(t.id, e)}
                cellAlign={{ color: "center", channelCount: "center" }}
                empty="No tags. Click Add to create one."
                renderCell={(tag, col) => {
                  if (col === "name") {
                    return (
                      <span onDoubleClick={() => startEditName(tag)} className="block w-full">
                        {editingTagId === tag.id ? (
                          <Input
                            density={viewDensity}
                            value={editingName}
                            onChange={(e) => setEditingName(fixName(e.target.value))}
                            onBlur={commitEditName}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEditName();
                              if (e.key === "Escape") setEditingTagId(null);
                            }}
                            maxLength={MAX_NAME_LENGTH}
                            autoFocus
                            className="h-6 text-sm px-1 py-0"
                          />
                        ) : (
                          <span className="text-gray-800 dark:text-gray-200">{tag.name}</span>
                        )}
                      </span>
                    );
                  }
                  if (col === "color") {
                    return (
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-center"
                      >
                        <ColorPickerButton
                          value={tag.color}
                          onChange={(hex) => updateTag(tag.id, { color: hex })}
                          size={20}
                        />
                      </span>
                    );
                  }
                  return tag.channelIds.size;
                }}
              />
            </div>

            {/* Add/Remove buttons */}
            <div className="flex flex-col gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={addTag} className="w-[70px]">
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
              <Button variant="outline" size="sm" onClick={removeTag} disabled={!hasSelection}>
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Remove
              </Button>
            </div>
          </div>
        </SettingsSection>

        {/* ── Channels List ── */}
        <SettingsSection title="Channels">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Channel selections will be applied to the currently selected tags.
          </div>
          <div className={`flex items-center ${filterGap}`}>
            <span className="text-sm text-gray-600 dark:text-gray-400">Filter:</span>
            <Input
              density={viewDensity}
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              disabled={!hasSelection}
              className="w-[350px]"
              placeholder="Filter channels..."
            />
            <button
              type="button"
              disabled={!hasSelection}
              onClick={selectAllChannels}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:text-gray-400 dark:disabled:text-gray-600 disabled:no-underline"
            >
              Select All
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button
              type="button"
              disabled={!hasSelection}
              onClick={deselectAllChannels}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:text-gray-400 dark:disabled:text-gray-600 disabled:no-underline"
            >
              Deselect All
            </button>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            <DataTable<ChannelRow, ChannelCol>
              variant="sortable"
              cols={CHANNEL_COLS}
              rows={channelsSortState.sorted(
                filteredChannels.map(([id, name]) => ({
                  id,
                  name,
                  state: channelStates.get(id) ?? "unchecked",
                })),
                (r) => {
                  switch (channelsSortState.sort.key) {
                    case "name":
                      return r.name;
                    case "checkbox":
                      return r.state === "checked" ? 1 : r.state === "partial" ? 0.5 : 0;
                    default:
                      return undefined;
                  }
                }
              )}
              colConfig={channelsColConfig}
              sortState={channelsSortState}
              rowKey={(r) => r.id}
              cellAlign={{ checkbox: "center" }}
              empty={channels.size === 0 ? "No channels found." : "No channels match the filter."}
              renderCell={(row, col) => {
                if (col === "checkbox") {
                  return (
                    <TriStateCheckbox
                      state={row.state}
                      onChange={(checked) => toggleChannel(row.id, checked)}
                      disabled={!hasSelection}
                    />
                  );
                }
                return row.name;
              }}
            />
          </div>
        </SettingsSection>
      </SettingsTabScroll>
    </div>
  );
}
