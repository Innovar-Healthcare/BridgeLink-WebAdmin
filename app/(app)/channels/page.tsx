"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  useChannels,
  useDashboard,
  useTagMap,
  useConfigMap,
  resolveConfigVar,
  useCodeTemplatesPrefetch,
} from "@/lib/hooks/use-cache";
import { useSortable } from "@/lib/hooks/use-sortable";
import { useMounted } from "@/lib/hooks/use-mounted";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import { useExpandState } from "@/lib/hooks/use-expand-state";
import { useContainerWidth } from "@/lib/hooks/use-container-width";
import { loadAdminPrefs } from "@/components/settings/admin-tab";
import type { Channel, ChannelGroup } from "@/lib/types";
import { computeFooterCounts } from "@/lib/channel-footer-counts";
import { SortableHeaderCell, numericCellWidth } from "@/components/sortable-header-cell";
import {
  TableContainer,
  Table,
  TableColGroup,
  TableHead,
  TableHeadRow,
  TableBody,
  TableLoading,
  TableEmpty,
} from "@/components/data-table";
import type { ColStateMap } from "@/lib/hooks/use-column-config";
import { GroupTagFilterBar } from "@/components/group-tag-filter-bar";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { useSessionState, useSessionSet } from "@/lib/hooks/use-session-state";
import { useTagDisplayMode } from "@/lib/hooks/use-tag-display-mode";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { deployChannels, setChannelsEnabled } from "@/lib/api-client";
import { type ChanCol, CHAN_COLS, DEFAULT_GROUP_ID } from "./_lib/channel-columns";
import { compareGroups } from "@/lib/channel-group-sort";
import { Download, RefreshCw } from "lucide-react";
import { ColumnPicker } from "@/components/column-picker";
import { Button } from "@/components/ui/button";
import { exportChannelsCsv } from "./_lib/csv-export";
import {
  type EnrichedChannel,
  buildStatusMap,
  statVal,
  channelsInGroup,
  isChannelEnabled,
  channelLastModified,
  channelDataType,
  channelSortValue,
} from "./_lib/channel-helpers";
import {
  useChannelOperations,
  type ConfirmDialogState,
  type EnableReportState,
} from "./_lib/use-channel-operations";
import { GroupRow } from "./_components/group-row";
import { ChannelRow } from "./_components/channel-row";
import { ChannelsPageHeader } from "./_components/channels-page-header";
import { type ExportChannelSpec } from "./_dialogs/export-channels-dialog";
import { type ExportGroupSpec } from "./_dialogs/export-groups-dialog";
import { ChannelsDialogs } from "./_components/channels-dialogs";
import { ChannelsDockableToolbar } from "./_components/channels-dockable-toolbar";
import { ChannelsFooterControls } from "./_components/channels-footer-controls";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useRepoChanges } from "@/lib/hooks/use-repo-changes";

const DEFAULT_GROUP_NAME = "[Default Group]";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChannelsPage() {
  const router = useRouter();
  const {
    channels,
    channelGroups,
    channelMetadata,
    channelRevisionDeltas,
    channelCodeTemplatesChanged,
    channelLocalIds,
    channelTags,
    refreshedAt,
    loading,
    refreshing,
    error,
    refresh,
  } = useChannels();
  const { statuses: dashStatuses, refresh: refreshDashboard } = useDashboard();
  useCodeTemplatesPrefetch();
  const configMap = useConfigMap();
  const tagMap = useTagMap(channelTags);
  const mounted = useMounted();
  const { tagDisplayMode, setTagDisplayMode } = useTagDisplayMode();
  const { viewDensity: globalDensity } = useCompactMode();
  const { isViewOnly } = usePermissions();
  const { channelIds: repoChangedChannelIds } = useRepoChanges();
  const channelsViewOnly = isViewOnly("Channels");
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();

  const [search, setSearch] = useSessionState("bl-filter-channels-search", "");
  const [groupMode, setGroupMode] = useSessionState("bl-filter-channels-group-mode", true);
  const [selectedTagNames, setSelectedTagNames] = useSessionSet("bl-filter-channels-tags");
  const [selectedGroupIds, setSelectedGroupIds] = useSessionSet("bl-filter-channels-groups");
  const [tagMode, setTagMode] = useSessionState<"or" | "and">("bl-filter-channels-tag-mode", "or");

  // ── Selection state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [opLoading, setOpLoading] = useState(false);

  // ── Confirm dialog state ──
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    description: "",
    confirmLabel: "Confirm",
    confirmVariant: "default",
    onConfirm: () => {},
  });

  // ── Enable-validation failure report ──
  const [enableReport, setEnableReport] = useState<EnableReportState>({
    open: false,
    failures: [],
  });

  // ── Dialog state ──
  const [importOpen, setImportOpen] = useState(false);
  const [importFromRepoOpen, setImportFromRepoOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [assignGroupOpen, setAssignGroupOpen] = useState(false);
  const [assignGroupIds, setAssignGroupIds] = useState<Set<string>>(new Set());
  const [editGroupOpen, setEditGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ChannelGroup | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState<string>("");
  const [cloneSourceName, setCloneSourceName] = useState<string>("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportChannelId, setExportChannelId] = useState<string>("");
  const [exportChannelName, setExportChannelName] = useState<string>("");
  const [exportChannelsOpen, setExportChannelsOpen] = useState(false);
  const [exportChannelsSpecs, setExportChannelsSpecs] = useState<ExportChannelSpec[]>([]);
  const [exportGroupsOpen, setExportGroupsOpen] = useState(false);
  const [exportGroupSpecs, setExportGroupSpecs] = useState<ExportGroupSpec[]>([]);
  const [importGroupOpen, setImportGroupOpen] = useState(false);
  const openImportGroup = useCallback(() => setImportGroupOpen(true), []);

  const { sort, toggle: sortToggle, sorted } = useSortable<ChanCol>("name");
  const { colState, orderedCols, visibleCols, setWidth, setVisible, moveCol, resetToDefaults } =
    useColumnConfig(CHAN_COLS, "bl-channels-cols-v14");

  const handleToggleCol = useCallback(
    (key: ChanCol) => {
      setVisible(key, !(colState[key]?.visible !== false));
    },
    [colState, setVisible]
  );

  // Build allGroups up-front so IDs are available as default-expanded keys
  const allGroups = useMemo<ChannelGroup[]>(() => {
    const groupedIds = new Set<string>();
    for (const g of channelGroups) (g.channels ?? []).forEach((c) => groupedIds.add(c.id));
    const ungroupedChannels = channels.filter((ch) => !groupedIds.has(ch.id));
    const defaultGroup: ChannelGroup = {
      id: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      channels: ungroupedChannels.map((ch) => ({ id: ch.id }) as Channel),
    };
    return [...channelGroups, defaultGroup];
  }, [channelGroups, channels]);

  const namedGroupsExist = allGroups.some((g) => g.id !== DEFAULT_GROUP_ID);

  // Groups expanded by default; persisted across tab navigation
  const [expandedGroups, toggleGroup, setAllGroups, , hasSavedGroupExpandState] = useExpandState(
    "bl-channels-groups",
    () => (loadAdminPrefs().defaultGroupsCollapsed ? [] : allGroups.map((g) => g.id))
  );

  // Auto-open any new group IDs that appear after data loads — but only when
  // there is no saved state (i.e., first visit). If the user has previously
  // collapsed groups we must not override their preference.
  const seededGroupsRef = React.useRef(new Set<string>());
  useEffect(() => {
    if (loadAdminPrefs().defaultGroupsCollapsed) return;
    if (hasSavedGroupExpandState) return;
    const newIds = allGroups.map((g) => g.id).filter((id) => !seededGroupsRef.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => seededGroupsRef.current.add(id));
    setAllGroups(allGroups.map((g) => g.id));
  }, [allGroups, setAllGroups, hasSavedGroupExpandState]);

  // Enrich channels with live runtime stats from shared dashboard cache
  const enriched = useMemo<EnrichedChannel[]>(() => {
    const statusMap = buildStatusMap(dashStatuses);
    return channels.map((ch) => {
      const ds = statusMap.get(ch.id);
      return {
        ...ch,
        deployedState: ds?.state,
        deployedDate: ds?.deployedDate,
        received: ds ? statVal(ds.statistics, "RECEIVED") : undefined,
        errored: ds ? statVal(ds.statistics, "ERROR") : undefined,
      };
    });
  }, [channels, dashStatuses]);

  // Map from channel ID → enriched channel — used by export to preserve server order
  const enrichedById = useMemo<Map<string, EnrichedChannel>>(() => {
    const m = new Map<string, EnrichedChannel>();
    for (const ch of enriched) m.set(ch.id, ch);
    return m;
  }, [enriched]);

  // Map channel ID → listening port (only for listener-type source connectors)
  const portMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) {
      const lcp = (ch.sourceConnector?.properties as Record<string, unknown> | undefined)
        ?.listenerConnectorProperties as Record<string, unknown> | undefined;
      const raw = lcp?.port != null ? String(lcp.port) : "";
      const port = resolveConfigVar(raw, configMap);
      if (port) map.set(ch.id, port);
    }
    return map;
  }, [channels, configMap]);

  // Dropdown options for tag and group multi-select filters
  const tagOptions = useMemo(
    () =>
      [...channelTags]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((t) => ({ value: String(t.name), label: String(t.name) })),
    [channelTags]
  );

  const groupOptions = useMemo(
    () =>
      [...allGroups]
        .sort((a, b) =>
          a.id === DEFAULT_GROUP_ID
            ? 1
            : b.id === DEFAULT_GROUP_ID
              ? -1
              : (a.name ?? "").localeCompare(b.name ?? "")
        )
        .map((g) => ({
          value: g.id,
          label: g.id === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : (g.name ?? g.id),
        })),
    [allGroups]
  );

  // Set of channel IDs that pass the group filter (null = no group filter active)
  const groupFilteredIds = useMemo<Set<string> | null>(() => {
    if (selectedGroupIds.size === 0) return null;
    const ids = new Set<string>();
    for (const g of allGroups) {
      if (selectedGroupIds.has(g.id)) (g.channels ?? []).forEach((c) => ids.add(c.id));
    }
    return ids;
  }, [allGroups, selectedGroupIds]);

  // Filter
  const anyFilter = !!(search.trim() || selectedTagNames.size > 0 || selectedGroupIds.size > 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((ch) => {
      if (
        q &&
        !(
          String(ch.name).toLowerCase().includes(q) ||
          ch.id.toLowerCase().includes(q) ||
          ch.sourceConnector?.transportName?.toLowerCase().includes(q) ||
          channelDataType(ch).toLowerCase().includes(q) ||
          String(portMap.get(ch.id) ?? "").includes(q) ||
          (tagMap.get(ch.id) ?? []).some((t) => String(t.name).toLowerCase().includes(q))
        )
      )
        return false;
      if (selectedTagNames.size > 0) {
        const chTags = tagMap.get(ch.id) ?? [];
        const match =
          tagMode === "and"
            ? [...selectedTagNames].every((n) => chTags.some((t) => String(t.name) === n))
            : chTags.some((t) => selectedTagNames.has(String(t.name)));
        if (!match) return false;
      }
      if (groupFilteredIds && !groupFilteredIds.has(ch.id)) return false;
      return true;
    });
  }, [enriched, search, tagMap, portMap, selectedTagNames, tagMode, groupFilteredIds]);

  // Sort
  const sortedChannels = useMemo(
    () =>
      // `sorted` skips the accessor entirely when no key is set, so the "name"
      // fallback is only a type placeholder and never actually drives a sort.
      sorted(filtered, (ch) =>
        channelSortValue(ch, sort.key ?? "name", {
          metadataMap: channelMetadata,
          revisionDeltas: channelRevisionDeltas,
          localIds: channelLocalIds,
          portMap,
        })
      ),
    [filtered, sort, sorted, channelMetadata, channelRevisionDeltas, channelLocalIds, portMap]
  );

  // Map group id → filtered+sorted channels for that group
  const groupChannelMap = useMemo(() => {
    const map = new Map<string, EnrichedChannel[]>();
    for (const g of allGroups) map.set(g.id, channelsInGroup(g, sortedChannels));
    return map;
  }, [allGroups, sortedChannels]);

  // Map group id → ALL (unfiltered) channels for that group
  const allGroupChannelMap = useMemo(() => {
    const map = new Map<string, EnrichedChannel[]>();
    for (const g of allGroups) map.set(g.id, channelsInGroup(g, enriched));
    return map;
  }, [allGroups, enriched]);

  // Groups sorted according to the active column sort
  const sortedGroups = useMemo(() => {
    const getValue = (group: ChannelGroup): string | number => {
      const chans = allGroupChannelMap.get(group.id) ?? [];
      const displayName =
        group.id === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : (group.name ?? group.id);
      switch (sort.key) {
        case "name":
          return displayName;
        case "received":
          return chans.reduce((s, c) => s + (c.received ?? 0), 0);
        case "errored":
          return chans.reduce((s, c) => s + (c.errored ?? 0), 0);
        case "dests":
          return chans.reduce((s, c) => s + (c.destinationConnectors?.length ?? 0), 0);
        case "revDelta":
          return chans.reduce((s, c) => s + (channelRevisionDeltas.get(c.id) ?? 0), 0);
        case "status":
          return chans.filter((c) => isChannelEnabled(c, channelMetadata)).length;
        case "lastModified":
          return chans.reduce((best, c) => {
            const d = channelLastModified(c, channelMetadata) ?? "";
            return d > best ? d : best;
          }, "");
        case "lastDeployed":
          return chans.reduce((best, c) => {
            const d = c.deployedDate ?? "";
            return d > best ? d : best;
          }, "");
        default:
          return displayName;
      }
    };
    return [...allGroups].sort((a, b) => compareGroups(a, b, sort, getValue, DEFAULT_GROUP_ID));
  }, [allGroups, sort, allGroupChannelMap, channelRevisionDeltas, channelMetadata]);

  // Footer "N of M" counts for Groups / Channels / Enabled — mirrors Java
  // ChannelPanel.updateModel (ChannelPanel.java:2853-2912). See computeFooterCounts.
  const footerCounts = useMemo(
    () => computeFooterCounts(channels, filtered, allGroups, anyFilter),
    [filtered, channels, allGroups, anyFilter]
  );

  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(tableContainerRef);

  // Minimum widths driven by the widest value currently in each numeric column.
  const dataMinWidths = useMemo(() => {
    let maxReceived = 0,
      maxErrored = 0;
    for (const ch of enriched) {
      maxReceived = Math.max(maxReceived, ch.received ?? 0);
      maxErrored = Math.max(maxErrored, ch.errored ?? 0);
    }
    return {
      received: numericCellWidth(maxReceived.toLocaleString().length, globalDensity),
      errored: numericCellWidth(maxErrored.toLocaleString().length, globalDensity),
    };
  }, [enriched, globalDensity]);

  const colWidths = useMemo<Record<ChanCol, number>>(() => {
    const widths = {} as Record<ChanCol, number>;
    let fixedWidth = 0;
    for (const c of visibleCols) {
      if (!c.flexible) {
        let w: number;
        if (c.resizable === false) {
          // Fixed columns: use tightWidth/compactWidth/defaultWidth as the base, but grow
          // automatically to fit data content (e.g. large message counts).
          const base =
            globalDensity === "compact"
              ? (c.tightWidth ?? c.compactWidth ?? c.defaultWidth)
              : globalDensity === "default"
                ? (c.compactWidth ?? c.defaultWidth)
                : c.defaultWidth;
          const dataMin = dataMinWidths[c.key as keyof typeof dataMinWidths] ?? 0;
          w = Math.max(base, dataMin);
        } else {
          // Resizable columns: respect user-dragged width but grow with data content.
          const stored =
            colState[c.key]?.width ??
            (globalDensity === "compact"
              ? (c.tightWidth ?? c.compactWidth ?? c.defaultWidth)
              : globalDensity === "default"
                ? (c.compactWidth ?? c.defaultWidth)
                : c.defaultWidth);
          const dataMin = dataMinWidths[c.key as keyof typeof dataMinWidths] ?? 0;
          w = Math.max(stored, dataMin);
        }
        widths[c.key] = w;
        fixedWidth += w;
      }
    }
    // Flexible column (Name) fills remaining space, at least its stored width.
    // If the user has explicitly resized this column, respect their choice instead of
    // auto-expanding — prevents the "jump" bug where the column snaps past the cursor.
    //
    // innerTableWidth is computed from fixedWidth (density-accurate compact widths) and
    // containerWidth directly — NOT from totalTableWidth, which used defaultWidth for fixed
    // cols and caused the table to jump on the first drag in compact/default density mode.
    for (const c of visibleCols) {
      if (c.flexible) {
        const stored = colState[c.key]?.width ?? c.defaultWidth;
        const userResized = colState[c.key]?.userResized === true;
        const innerTableWidth = Math.max(stored + fixedWidth, containerWidth);
        widths[c.key] = userResized ? stored : Math.max(stored, innerTableWidth - fixedWidth);
      }
    }
    return widths;
  }, [visibleCols, colState, containerWidth, globalDensity, dataMinWidths]);

  // ── Table width / name-column stretch ───────────────────────────────────
  // Derived from colWidths so that totalTableWidth reflects actual rendered widths
  // (including density-accurate compact/tight widths for fixed columns).
  const totalTableWidth = visibleCols.reduce((sum, c) => sum + colWidths[c.key], 0);
  const tableWidth = Math.max(totalTableWidth, containerWidth);

  // ── Selection helpers (click-based multi-select matching dashboard) ──

  const handleRowClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      const isMetaKey = e.metaKey || e.ctrlKey;

      if (e.shiftKey && lastClickedId) {
        setSelectedIds((prev) => {
          const next = new Set(prev);

          if (groupMode) {
            // Build a flat list mirroring the visual rendering order (group header + channels).
            // If the shift-click range crosses a group boundary (group header falls within the
            // slice), select all channels in that group. Otherwise select only the sliced channels.
            type FlatEntry =
              | { kind: "group"; id: string }
              | { kind: "channel"; channelId: string; groupId: string };

            const flatFull: FlatEntry[] = [];
            for (const g of sortedGroups) {
              const chans = groupChannelMap.get(g.id) ?? [];
              if (anyFilter && chans.length === 0) continue;
              flatFull.push({ kind: "group", id: g.id });
              for (const ch of chans) {
                flatFull.push({ kind: "channel", channelId: ch.id, groupId: g.id });
              }
            }

            const aIdx = flatFull.findIndex(
              (entry) => entry.kind === "channel" && entry.channelId === lastClickedId
            );
            const bIdx = flatFull.findIndex(
              (entry) => entry.kind === "channel" && entry.channelId === id
            );

            if (aIdx === -1 || bIdx === -1) {
              if (!isMetaKey) next.clear();
              next.add(id);
            } else {
              const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
              const slice = flatFull.slice(lo, hi + 1);

              const groupsWithHeaders = new Set<string>();
              for (const entry of slice) {
                if (entry.kind === "group") groupsWithHeaders.add(entry.id);
              }

              if (!isMetaKey) next.clear();

              for (const entry of slice) {
                if (entry.kind === "channel" && !groupsWithHeaders.has(entry.groupId)) {
                  next.add(entry.channelId);
                }
              }
              for (const groupId of groupsWithHeaders) {
                for (const ch of groupChannelMap.get(groupId) ?? []) {
                  next.add(ch.id);
                }
              }
            }
          } else {
            // Flat mode: simple index-based range in sortedChannels order
            const flat = sortedChannels.map((c) => c.id);
            const a = flat.indexOf(lastClickedId);
            const b = flat.indexOf(id);

            if (a === -1 || b === -1) {
              if (!isMetaKey) next.clear();
              next.add(id);
            } else {
              const [lo, hi] = a < b ? [a, b] : [b, a];
              if (!isMetaKey) next.clear();
              flat.slice(lo, hi + 1).forEach((cid) => next.add(cid));
            }
          }

          return next;
        });
      } else if (isMetaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else {
        // Plain click — select only this one
        setSelectedIds(new Set([id]));
      }

      setLastClickedId(id);
      setSelectedGroupId(null);
    },
    [lastClickedId, groupMode, sortedGroups, groupChannelMap, anyFilter, sortedChannels]
  );

  function handleGroupRowClick(groupId: string) {
    setSelectedGroupId(groupId);
    setSelectedIds(new Set());
  }

  const effectiveSelectedIds = useMemo<Set<string>>(() => {
    if (selectedIds.size > 0 || !selectedGroupId) return selectedIds;
    const ids = allGroups.find((g) => g.id === selectedGroupId)?.channels?.map((c) => c.id);
    return ids ? new Set(ids) : selectedIds;
  }, [selectedIds, selectedGroupId, allGroups]);

  const someSelected = effectiveSelectedIds.size > 0;

  // Context-aware button state derivations
  const selectedChannelsArr = enriched.filter((ch) => effectiveSelectedIds.has(ch.id));
  const anySelectedEnabled = selectedChannelsArr.some((ch) =>
    isChannelEnabled(ch, channelMetadata)
  );
  const anySelectedDisabled = selectedChannelsArr.some(
    (ch) => !isChannelEnabled(ch, channelMetadata)
  );
  const allSelectedDisabled =
    selectedChannelsArr.length > 0 &&
    selectedChannelsArr.every((ch) => !isChannelEnabled(ch, channelMetadata));

  // — Action-visibility guards (Java parity with ChannelPanel.updateTasks).
  // Selection in the Web UI is mutually exclusive: when a group row is clicked,
  // selectedIds is cleared and selectedGroupId is set, and vice versa. These flags
  // expose that distinction to the action panel.
  const allGroupsSelected =
    selectedGroupId !== null && selectedGroupId !== DEFAULT_GROUP_ID && selectedIds.size === 0;

  // ── Channel operations (extracted to hook) ──

  const {
    handleDeploy,
    handleDeployAll,
    handleEnable,
    handleDisable,
    handleDelete,
    handleExport,
    handleClone,
    openEditGroup,
    openDeleteGroup,
    openExportGroup,
    handleExportGroups,
    channelRowActions,
    handleEditGroupFromPanel,
    handleExportGroupFromPanel,
  } = useChannelOperations({
    channels,
    allGroups,
    enrichedById,
    channelMetadata,
    selectedIds: effectiveSelectedIds,
    setSelectedIds,
    selectedChannelsArr,
    anySelectedEnabled,
    anySelectedDisabled,
    setOpLoading,
    setConfirmDialog,
    setEnableReport,
    setExportGroupSpecs,
    setExportGroupsOpen,
    setExportChannelId,
    setExportChannelName,
    setExportOpen,
    setExportChannelsSpecs,
    setExportChannelsOpen,
    setCloneSourceId,
    setCloneSourceName,
    setCloneOpen,
    setAssignGroupOpen,
    setAssignGroupIds,
    setEditingGroup,
    setEditGroupOpen,
    refresh,
    refreshDashboard,
  });

  // ── Lifted toolbar callbacks ──

  const handleEditClick = useCallback(() => {
    const id = [...selectedIds][0];
    if (id) router.push(`/channels/${id}/edit`);
  }, [selectedIds, router]);

  const handleViewMessagesClick = useCallback(() => {
    const id = [...effectiveSelectedIds][0];
    if (id) channelRowActions.onViewMessages(id);
  }, [effectiveSelectedIds, channelRowActions]);

  const handleNewClick = useCallback(() => {
    let groupId: string | null = selectedGroupId;
    if (!groupId && selectedIds.size > 0) {
      const firstId = [...selectedIds][0];
      for (const [gid, chans] of allGroupChannelMap) {
        if (chans.some((c) => c.id === firstId)) {
          groupId = gid;
          break;
        }
      }
    }
    const path =
      groupId && groupId !== DEFAULT_GROUP_ID
        ? `/channels/new?groupId=${encodeURIComponent(groupId)}`
        : "/channels/new";
    router.push(path);
  }, [router, selectedGroupId, selectedIds, allGroupChannelMap]);
  const handleImportClick = useCallback(() => setImportOpen(true), []);
  const handleImportFromRepoClick = useCallback(() => setImportFromRepoOpen(true), []);
  const handleNewGroupClick = useCallback(() => setNewGroupOpen(true), []);
  const handleAssignGroupClick = useCallback(() => {
    setAssignGroupIds(selectedIds);
    setAssignGroupOpen(true);
  }, [selectedIds]);
  const handleEditGroupClick = useCallback(
    () => handleEditGroupFromPanel(selectedGroupId ?? undefined),
    [handleEditGroupFromPanel, selectedGroupId]
  );
  const handleExportGroupClick = useCallback(
    () => handleExportGroupFromPanel(selectedGroupId ?? undefined),
    [handleExportGroupFromPanel, selectedGroupId]
  );

  const selectedGroupChans = selectedGroupId ? (allGroupChannelMap.get(selectedGroupId) ?? []) : [];
  const selectedGroupHasEnabledChannels = selectedGroupChans.some((ch) =>
    isChannelEnabled(ch, channelMetadata)
  );

  const handleDeployAllInGroupClick = useCallback(() => {
    if (!selectedGroupId) return;
    const ids = (allGroupChannelMap.get(selectedGroupId) ?? [])
      .filter((ch) => isChannelEnabled(ch, channelMetadata))
      .map((ch) => ch.id);
    if (ids.length === 0) {
      toast.info("No enabled channels to deploy");
      return;
    }
    setOpLoading(true);
    void deployChannels(ids)
      .then(() => Promise.all([refresh(), refreshDashboard()]))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setOpLoading(false));
    router.push("/dashboard");
  }, [
    selectedGroupId,
    allGroupChannelMap,
    channelMetadata,
    setOpLoading,
    refresh,
    refreshDashboard,
    router,
  ]);

  const handleEnableAllInGroupClick = useCallback(async () => {
    if (!selectedGroupId) return;
    const ids = (allGroupChannelMap.get(selectedGroupId) ?? []).map((ch) => ch.id);
    if (ids.length === 0) return;
    setOpLoading(true);
    try {
      await setChannelsEnabled(ids, true);
      await refresh();
      toast.success(`Enabled ${ids.length} channel(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpLoading(false);
    }
  }, [selectedGroupId, allGroupChannelMap, setOpLoading, refresh]);

  const handleDisableAllInGroupClick = useCallback(async () => {
    if (!selectedGroupId) return;
    const ids = (allGroupChannelMap.get(selectedGroupId) ?? []).map((ch) => ch.id);
    if (ids.length === 0) return;
    setOpLoading(true);
    try {
      await setChannelsEnabled(ids, false);
      await refresh();
      toast.success(`Disabled ${ids.length} channel(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpLoading(false);
    }
  }, [selectedGroupId, allGroupChannelMap, setOpLoading, refresh]);

  const handleDeleteGroupClick = useCallback(() => {
    const group = allGroups.find((g) => g.id === selectedGroupId);
    if (group) openDeleteGroup(group);
  }, [selectedGroupId, allGroups, openDeleteGroup]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedGroupId(null);
  }, []);

  // ── Render ──

  return (
    <div className="flex flex-col h-full">
      {/* ── Sticky header zone (never scrolls) ── */}
      <div className="shrink-0">
        <ChannelsPageHeader refreshedAt={refreshedAt ?? null} mounted={mounted} />
      </div>
      {/* end shrink-0 */}

      {/* Content area: dockable action panel + main content */}
      <div
        className={`flex flex-1 min-h-0 ${toolbarPos === "top" || toolbarPos === "bottom" ? "flex-col" : "flex-row"}`}
      >
        {/* Dockable action toolbar */}
        <ChannelsDockableToolbar
          positions={["left", "top"]}
          toolbarPos={toolbarPos}
          setToolbarPosition={setToolbarPosition}
          opLoading={opLoading}
          someSelected={someSelected}
          selectedIds={effectiveSelectedIds}
          selectedGroupId={selectedGroupId}
          anySelectedEnabled={anySelectedEnabled}
          anySelectedDisabled={anySelectedDisabled}
          allSelectedDisabled={allSelectedDisabled}
          allChannelsSelected={selectedIds.size > 0 && selectedGroupId === null}
          allGroupsSelected={allGroupsSelected}
          filterEnabled={selectedTagNames.size > 0}
          groupMode={groupMode}
          allGroups={allGroups}
          viewOnly={channelsViewOnly}
          onDeploy={handleDeploy}
          onDeployAll={handleDeployAll}
          onEnable={handleEnable}
          onDisable={handleDisable}
          onEdit={handleEditClick}
          onViewMessages={handleViewMessagesClick}
          onNew={handleNewClick}
          onImport={handleImportClick}
          onImportFromRepo={handleImportFromRepoClick}
          onExport={handleExport}
          onClone={handleClone}
          onDelete={handleDelete}
          onNewGroup={handleNewGroupClick}
          onAssignGroup={handleAssignGroupClick}
          onEditGroup={handleEditGroupClick}
          onImportGroups={openImportGroup}
          onExportGroup={handleExportGroupClick}
          onExportAllGroups={handleExportGroups}
          selectedGroupHasEnabledChannels={selectedGroupHasEnabledChannels}
          onDeployAllInGroup={handleDeployAllInGroupClick}
          onEnableAllInGroup={handleEnableAllInGroupClick}
          onDisableAllInGroup={handleDisableAllInGroupClick}
          onDeleteGroup={handleDeleteGroupClick}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Search + filters */}
          <GroupTagFilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Filter by name, ID, source type, port, or tag…"
            groupOptions={groupOptions}
            selectedGroupIds={selectedGroupIds}
            onGroupChange={setSelectedGroupIds}
            tagOptions={tagOptions}
            selectedTagNames={selectedTagNames}
            onTagChange={setSelectedTagNames}
            tagMode={tagMode}
            onTagModeChange={setTagMode}
            className="shrink-0"
            actions={
              <>
                <ColumnPicker
                  cols={orderedCols}
                  colState={colState}
                  onToggle={handleToggleCol}
                  onReset={resetToDefaults}
                  onMove={moveCol}
                />
                <Button
                  variant="outline"
                  className="h-auto p-1.5"
                  onClick={() =>
                    exportChannelsCsv(visibleCols, sortedChannels, {
                      metadataMap: channelMetadata,
                      revisionDeltas: channelRevisionDeltas,
                      codeTemplatesChanged: channelCodeTemplatesChanged,
                      localIds: channelLocalIds,
                      portMap,
                    })
                  }
                  disabled={refreshing || sortedChannels.length === 0}
                  title="Export visible data as CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  className="h-auto px-2.5 py-1.5 text-xs font-normal gap-1.5"
                  onClick={refresh}
                  disabled={refreshing}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </>
            }
          />

          <ApiErrorAlert error={error} className="mx-6 mt-4" />

          <div className={`flex-1 min-h-0 ${pagePadding(globalDensity)} flex flex-col`}>
            <TableContainer ref={tableContainerRef} className="flex-1 min-h-0">
              <Table style={{ width: tableWidth, minWidth: totalTableWidth }}>
                <TableColGroup
                  cols={visibleCols}
                  colState={
                    Object.fromEntries(
                      visibleCols.map((c) => [c.key, { width: colWidths[c.key], visible: true }])
                    ) as ColStateMap<ChanCol>
                  }
                />
                <TableHead>
                  <TableHeadRow>
                    {visibleCols.map((col) => (
                      <SortableHeaderCell
                        key={col.key}
                        col={col.key}
                        colDef={col}
                        width={colWidths[col.key]}
                        current={sort.key}
                        dir={sort.dir}
                        onSort={sortToggle}
                        onResize={setWidth}
                      />
                    ))}
                  </TableHeadRow>
                </TableHead>
                <TableBody>
                  {loading && channels.length === 0 ? (
                    <TableLoading colSpan={visibleCols.length} />
                  ) : !loading && filtered.length === 0 && !error ? (
                    <TableEmpty colSpan={visibleCols.length}>
                      <EmptyState
                        message="No channels found."
                        filterMessage="No channels match the current filters."
                        hasFilter={anyFilter}
                      />
                    </TableEmpty>
                  ) : groupMode ? (
                    sortedGroups.map((group) => {
                      const groupChans = groupChannelMap.get(group.id) ?? [];
                      const allGroupChans = allGroupChannelMap.get(group.id) ?? [];
                      if (anyFilter && groupChans.length === 0) return null;
                      const isExpanded = expandedGroups.has(group.id);
                      return (
                        <React.Fragment key={group.id}>
                          <GroupRow
                            group={group}
                            displayChannels={groupChans}
                            allChannels={allGroupChans}
                            expanded={isExpanded}
                            onToggle={() => toggleGroup(group.id)}
                            onSelect={() => handleGroupRowClick(group.id)}
                            selected={selectedGroupId === group.id}
                            visibleCols={visibleCols}
                            metadataMap={channelMetadata}
                            onEdit={openEditGroup}
                            onDelete={openDeleteGroup}
                            onExport={openExportGroup}
                            density={globalDensity}
                            onDeployAll={(g) => {
                              const ids = (allGroupChannelMap.get(g.id) ?? [])
                                .filter((ch) => isChannelEnabled(ch, channelMetadata))
                                .map((ch) => ch.id);
                              if (ids.length === 0) {
                                toast.info("No enabled channels to deploy");
                                return;
                              }
                              setOpLoading(true);
                              void deployChannels(ids)
                                .then(() => Promise.all([refresh(), refreshDashboard()]))
                                .catch((e) =>
                                  toast.error(e instanceof Error ? e.message : String(e))
                                )
                                .finally(() => setOpLoading(false));
                              router.push("/dashboard");
                            }}
                            onEnableAll={async (g) => {
                              const ids = (allGroupChannelMap.get(g.id) ?? []).map((ch) => ch.id);
                              if (ids.length === 0) return;
                              setOpLoading(true);
                              try {
                                await setChannelsEnabled(ids, true);
                                await refresh();
                                toast.success(`Enabled ${ids.length} channel(s)`);
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : String(e));
                              } finally {
                                setOpLoading(false);
                              }
                            }}
                            onDisableAll={async (g) => {
                              const ids = (allGroupChannelMap.get(g.id) ?? []).map((ch) => ch.id);
                              if (ids.length === 0) return;
                              setOpLoading(true);
                              try {
                                await setChannelsEnabled(ids, false);
                                await refresh();
                                toast.success(`Disabled ${ids.length} channel(s)`);
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : String(e));
                              } finally {
                                setOpLoading(false);
                              }
                            }}
                          />
                          {isExpanded &&
                            groupChans.map((ch) => (
                              <ChannelRow
                                key={ch.id}
                                channel={ch}
                                indent
                                tagMap={tagMap}
                                visibleCols={visibleCols}
                                mounted={mounted}
                                metadataMap={channelMetadata}
                                revisionDeltas={channelRevisionDeltas}
                                codeTemplatesChanged={channelCodeTemplatesChanged}
                                localIds={channelLocalIds}
                                repoChangedIds={repoChangedChannelIds}
                                selected={selectedIds.has(ch.id)}
                                onRowClick={handleRowClick}
                                actions={channelRowActions}
                                portMap={portMap}
                                tagDisplayMode={tagDisplayMode}
                                density={globalDensity}
                                groupMode={groupMode}
                                namedGroupsExist={namedGroupsExist}
                              />
                            ))}
                        </React.Fragment>
                      );
                    })
                  ) : (
                    sortedChannels.map((ch) => (
                      <ChannelRow
                        key={ch.id}
                        channel={ch}
                        tagMap={tagMap}
                        visibleCols={visibleCols}
                        mounted={mounted}
                        metadataMap={channelMetadata}
                        revisionDeltas={channelRevisionDeltas}
                        codeTemplatesChanged={channelCodeTemplatesChanged}
                        localIds={channelLocalIds}
                        repoChangedIds={repoChangedChannelIds}
                        selected={selectedIds.has(ch.id)}
                        onRowClick={handleRowClick}
                        actions={channelRowActions}
                        portMap={portMap}
                        tagDisplayMode={tagDisplayMode}
                        density={globalDensity}
                        groupMode={groupMode}
                        namedGroupsExist={namedGroupsExist}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <ChannelsFooterControls
              loading={loading}
              groupMode={groupMode}
              setGroupMode={setGroupMode}
              allGroups={allGroups}
              counts={footerCounts}
              someSelected={someSelected}
              effectiveSelectedCount={effectiveSelectedIds.size}
              onClearSelection={handleClearSelection}
              setAllGroups={setAllGroups}
              tagDisplayMode={tagDisplayMode}
              setTagDisplayMode={setTagDisplayMode}
            />
          </div>
        </div>

        {/* Dockable action toolbar (right/bottom) */}
        <ChannelsDockableToolbar
          positions={["right", "bottom"]}
          toolbarPos={toolbarPos}
          setToolbarPosition={setToolbarPosition}
          opLoading={opLoading}
          someSelected={someSelected}
          selectedIds={effectiveSelectedIds}
          selectedGroupId={selectedGroupId}
          anySelectedEnabled={anySelectedEnabled}
          anySelectedDisabled={anySelectedDisabled}
          allSelectedDisabled={allSelectedDisabled}
          allChannelsSelected={selectedIds.size > 0 && selectedGroupId === null}
          allGroupsSelected={allGroupsSelected}
          filterEnabled={selectedTagNames.size > 0}
          groupMode={groupMode}
          allGroups={allGroups}
          viewOnly={channelsViewOnly}
          onDeploy={handleDeploy}
          onDeployAll={handleDeployAll}
          onEnable={handleEnable}
          onDisable={handleDisable}
          onEdit={handleEditClick}
          onViewMessages={handleViewMessagesClick}
          onNew={handleNewClick}
          onImport={handleImportClick}
          onImportFromRepo={handleImportFromRepoClick}
          onExport={handleExport}
          onClone={handleClone}
          onDelete={handleDelete}
          onNewGroup={handleNewGroupClick}
          onAssignGroup={handleAssignGroupClick}
          onEditGroup={handleEditGroupClick}
          onImportGroups={openImportGroup}
          onExportGroup={handleExportGroupClick}
          onExportAllGroups={handleExportGroups}
          selectedGroupHasEnabledChannels={selectedGroupHasEnabledChannels}
          onDeployAllInGroup={handleDeployAllInGroupClick}
          onEnableAllInGroup={handleEnableAllInGroupClick}
          onDisableAllInGroup={handleDisableAllInGroupClick}
          onDeleteGroup={handleDeleteGroupClick}
        />
      </div>

      <ChannelsDialogs
        channels={channels}
        channelGroups={channelGroups}
        refresh={refresh}
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        importGroupOpen={importGroupOpen}
        setImportGroupOpen={setImportGroupOpen}
        importFromRepoOpen={importFromRepoOpen}
        setImportFromRepoOpen={setImportFromRepoOpen}
        newGroupOpen={newGroupOpen}
        setNewGroupOpen={setNewGroupOpen}
        assignGroupOpen={assignGroupOpen}
        setAssignGroupOpen={setAssignGroupOpen}
        assignGroupIds={assignGroupIds}
        editGroupOpen={editGroupOpen}
        setEditGroupOpen={setEditGroupOpen}
        editingGroup={editingGroup}
        setEditingGroup={setEditingGroup}
        cloneOpen={cloneOpen}
        setCloneOpen={setCloneOpen}
        cloneSourceId={cloneSourceId}
        cloneSourceName={cloneSourceName}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        exportChannelId={exportChannelId}
        exportChannelName={exportChannelName}
        exportChannelsOpen={exportChannelsOpen}
        setExportChannelsOpen={setExportChannelsOpen}
        exportChannelsSpecs={exportChannelsSpecs}
        exportGroupsOpen={exportGroupsOpen}
        setExportGroupsOpen={setExportGroupsOpen}
        exportGroupSpecs={exportGroupSpecs}
        confirmDialog={confirmDialog}
        setConfirmDialog={setConfirmDialog}
        enableReport={enableReport}
        setEnableReport={setEnableReport}
      />
    </div>
  );
}
