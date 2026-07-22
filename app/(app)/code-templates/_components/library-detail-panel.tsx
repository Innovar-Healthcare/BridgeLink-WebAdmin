"use client";

import { useState } from "react";
import type { CodeTemplateLibrary } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";

type ChannelCol = "checkbox" | "name";

const CHANNEL_COLS: ColDef<ChannelCol>[] = [
  {
    key: "checkbox",
    label: "",
    defaultWidth: 32,
    minWidth: 28,
    defaultVisible: true,
    canHide: false,
  },
  { key: "name", label: "Channel Name", defaultWidth: 320, minWidth: 100, defaultVisible: true },
];

interface ChannelRow {
  id: string;
  name: string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Compute the initial checked state for a channel row from the library's
 * enabledChannelIds / disabledChannelIds / includeNewChannels fields.
 *
 * Logic mirrors Java's setLibraryChannels():
 *   - [New Channels] row  → `includeNewChannels`
 *   - other channel       → explicitly in enabledChannelIds
 *                           OR (not in disabledChannelIds AND includeNewChannels)
 */
export function isChannelEnabled(channelId: string, library: CodeTemplateLibrary): boolean {
  const { includeNewChannels = false, enabledChannelIds = [], disabledChannelIds = [] } = library;
  if (channelId === "[New Channels]") return includeNewChannels;
  return (
    enabledChannelIds.includes(channelId) ||
    (!disabledChannelIds.includes(channelId) && includeNewChannels)
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LibraryDetailPanelProps {
  library: CodeTemplateLibrary;
  channels: Map<string, string>;
  onUpdate: (patch: Partial<CodeTemplateLibrary>) => void;
}

export function LibraryDetailPanel({ library, channels, onUpdate }: LibraryDetailPanelProps) {
  const { viewDensity } = useCompactMode();
  const [channelFilter, setChannelFilter] = useState("");
  const filterLower = channelFilter.toLowerCase();
  const channelColConfig = useColumnConfig(CHANNEL_COLS, "bl-library-channels-cols-v1");
  const channelSortState = useSortable<ChannelCol>("name", "asc");

  /**
   * Build the full ordered list: [New Channels] always first, then channels
   * sorted by name, filtered by channelFilter (but [New Channels] is never filtered).
   */
  const allChannelRows: Array<{ id: string; name: string }> = [
    { id: "[New Channels]", name: "[New Channels]" },
    ...Array.from(channels.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];

  const visibleRows = allChannelRows.filter(
    ({ id, name }) =>
      id === "[New Channels]" || !filterLower || name.toLowerCase().includes(filterLower)
  );

  /**
   * Toggle a single channel's enabled state and recompute the three library fields.
   */
  function toggleChannel(channelId: string, checked: boolean) {
    const enabledChannelIds: string[] = [];
    const disabledChannelIds: string[] = [];
    let includeNewChannels = library.includeNewChannels ?? false;

    if (channelId === "[New Channels]") {
      includeNewChannels = checked;
    }

    // Recompute for all real channels
    for (const { id } of allChannelRows) {
      if (id === "[New Channels]") continue;
      const nowChecked = id === channelId ? checked : isChannelEnabled(id, library);
      if (nowChecked) {
        enabledChannelIds.push(id);
      } else {
        disabledChannelIds.push(id);
      }
    }

    onUpdate({ includeNewChannels, enabledChannelIds, disabledChannelIds });
  }

  /**
   * Select / Deselect all *visible* rows (filter-aware).
   * [New Channels] is always toggled along with the rest.
   */
  function setAllVisible(checked: boolean) {
    const visibleIds = new Set(visibleRows.map((r) => r.id));
    const enabledChannelIds: string[] = [];
    const disabledChannelIds: string[] = [];
    let includeNewChannels = library.includeNewChannels ?? false;

    for (const { id } of allChannelRows) {
      if (id === "[New Channels]") {
        if (visibleIds.has(id)) includeNewChannels = checked;
        continue;
      }
      const nowChecked = visibleIds.has(id) ? checked : isChannelEnabled(id, library);
      if (nowChecked) enabledChannelIds.push(id);
      else disabledChannelIds.push(id);
    }

    onUpdate({ includeNewChannels, enabledChannelIds, disabledChannelIds });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top: name + description */}
      <div className="flex flex-col gap-3 p-4 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Library Settings</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-400 w-24 text-right shrink-0">
            Name:
          </label>
          <input
            type="text"
            value={library.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className={`border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 text-sm flex-1 max-w-sm focus:outline-none focus:ring-1 focus:ring-blue-400 ${densityHeight(viewDensity)}`}
          />
        </div>
        <div className="flex items-start gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-400 w-24 text-right shrink-0 mt-1">
            Description:
          </label>
          <Textarea
            density={viewDensity}
            value={library.description ?? ""}
            onChange={(e) => onUpdate({ description: e.target.value })}
            rows={5}
            className="border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1.5 text-sm flex-1 resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>

      {/* Bottom: channel association table */}
      <div className="flex-1 overflow-hidden flex flex-col p-4 min-h-0">
        {/* Section header */}
        <div className="flex items-center justify-between mb-2 shrink-0">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Channels</span>
          <div className="flex items-center gap-3 text-xs text-blue-600 dark:text-blue-400">
            <button onClick={() => setAllVisible(true)} className="hover:underline">
              Select All
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button onClick={() => setAllVisible(false)} className="hover:underline">
              Deselect All
            </button>
            <span className="text-gray-300 dark:text-gray-600 ml-1">|</span>
            <span className="text-gray-500 dark:text-gray-400 ml-1">Filter:</span>
            <input
              type="text"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              placeholder="Search channels…"
              className="border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-0.5 text-xs w-36 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* Channel table */}
        <DataTable<ChannelRow, ChannelCol>
          variant="sortable"
          cols={CHANNEL_COLS}
          rows={channelSortState.sorted(visibleRows, (r) => {
            switch (channelSortState.sort.key) {
              case "name":
                return r.name;
              case "checkbox":
                return isChannelEnabled(r.id, library) ? 1 : 0;
              default:
                return undefined;
            }
          })}
          colConfig={channelColConfig}
          sortState={channelSortState}
          rowKey={(r) => r.id}
          onRowClick={(r) => toggleChannel(r.id, !isChannelEnabled(r.id, library))}
          empty="No channels found."
          containerClassName="flex-1 min-h-0"
          renderCell={(row, col) => {
            const checked = isChannelEnabled(row.id, library);
            const isNewChannels = row.id === "[New Channels]";
            if (col === "checkbox") {
              return (
                <span onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleChannel(row.id, e.target.checked)}
                    className="accent-blue-600 w-3.5 h-3.5"
                    title={
                      isNewChannels
                        ? "If selected, any new channels that are created or imported will automatically have this library's code templates included."
                        : undefined
                    }
                  />
                </span>
              );
            }
            return <span className={isNewChannels ? "font-medium" : undefined}>{row.name}</span>;
          }}
        />
      </div>
    </div>
  );
}
