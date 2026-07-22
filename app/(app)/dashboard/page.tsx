"use client";

import React, { useMemo, useCallback, useEffect, useState, type MouseEvent } from "react";
import type { DashboardStatus, ChannelGroup } from "@/lib/types";
import {
  useDashboard,
  useChannels,
  useTagMap,
  useConfigMap,
  resolveConfigVar,
} from "@/lib/hooks/use-cache";
import { useSortable } from "@/lib/hooks/use-sortable";
import { useMounted } from "@/lib/hooks/use-mounted";
import { useDocumentVisible } from "@/lib/hooks/use-document-visible";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import { useExpandState } from "@/lib/hooks/use-expand-state";
import { useDashboardResize } from "@/lib/hooks/use-dashboard-resize";
import { useDashboardStats } from "@/lib/hooks/use-dashboard-stats";
import { useDashboardFilters } from "@/lib/hooks/use-dashboard-filters";
import { useDashboardActions } from "@/lib/hooks/use-dashboard-actions";
import { DashboardBottomPanel } from "@/components/dashboard-bottom-panel";
import { ApiErrorAlert } from "@/components/api-error-alert";
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
import { SendMessageDialog } from "@/components/messages/send-message-dialog";
import { LayoutList } from "lucide-react";
import {
  ClearStatisticsDialog,
  RemoveAllMessagesDialog,
  QueueDisabledWarningDialog,
} from "./_components/dashboard-dialogs";
import { DashboardStatsPanel } from "./_components/dashboard-stats-panel";
import { DashboardActionPanel } from "./_components/dashboard-action-panel";
import { DependencyWarningDialog } from "./_components/dependency-warning-dialog";
import { DashboardPageHeader } from "./_components/dashboard-page-header";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { DashboardRow, rowKey, stat, type DashCol } from "./_components/dashboard-row";
import { useDashboardRowProps } from "./_lib/use-dashboard-row-props";
import { useConnectionLabels } from "./_lib/use-connection-labels";
import { GroupRow } from "./_components/group-row";
import { loadAdminPrefs } from "@/components/settings/admin-tab";
import { useTagDisplayMode } from "@/lib/hooks/use-tag-display-mode";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { DashboardViewToggles } from "./_components/dashboard-view-toggles";
import { DashboardFilterActions } from "./_components/dashboard-filter-actions";
import { DashboardDeploymentSummary } from "./_components/dashboard-deployment-summary";
import { useConnectorToolbar } from "./_lib/use-connector-toolbar";
import { compareGroups } from "@/lib/channel-group-sort";

const DEFAULT_GROUP_ID = "Default Group";
const DEFAULT_GROUP_NAME = "[Default Group]";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  // ── Data hooks ──────────────────────────────────────────────────────────
  const {
    statuses,
    connectorStates,
    refreshedAt: lastRefresh,
    loading,
    refreshing,
    error,
    refresh: load,
  } = useDashboard();
  const { channelGroups, channelTags, channels, loading: channelsLoading } = useChannels();
  const configMap = useConfigMap();
  const tagMap = useTagMap(channelTags);
  const mounted = useMounted();
  const { tagDisplayMode, setTagDisplayMode } = useTagDisplayMode();
  const { viewDensity: globalDensity } = useCompactMode();
  const { isViewOnly } = usePermissions();
  const dashboardViewOnly = isViewOnly("Dashboard");

  // ── Auto-refresh (interval from Settings → Administrator) ────────────────
  const [refreshSecs, setRefreshSecs] = useState(() => loadAdminPrefs().dashboardRefreshInterval);
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const visible = useDocumentVisible();

  useEffect(() => {
    const onStorage = () => {
      const p = loadAdminPrefs();
      setRefreshSecs(p.dashboardRefreshInterval);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Poll only while the tab is visible. A hidden tab makes zero requests; on
  // becoming visible again we fire an immediate catch-up refresh, then resume
  // the interval. (The mount refresh in useDashboard dedupes against the
  // immediate load via the in-flight guard, so there's no double initial fetch.)
  useEffect(() => {
    if (!refreshSecs || refreshSecs <= 0) return; // manual mode: no polling
    if (!visible) return;
    load();
    const id = setInterval(load, refreshSecs * 1000);
    return () => clearInterval(id);
  }, [refreshSecs, load, visible]);

  // ── Extracted hooks ─────────────────────────────────────────────────────
  const {
    bottomHeight,
    bottomCollapsed,
    setBottomCollapsed,
    statsHidden,
    setStatsHidden,
    statsCollapsed,
    setStatsCollapsed,
    containerWidth,
    tableContainerRef,
    onDragHandleMouseDown,
  } = useDashboardResize();

  // ── Groups (computed before filters need them) ──────────────────────────
  const allGroups = useMemo<ChannelGroup[]>(() => {
    const groupedIds = new Set<string>();
    for (const g of channelGroups) (g.channels ?? []).forEach((c) => groupedIds.add(c.id));
    const defaultIds = statuses
      .filter((s) => s.statusType === "CHANNEL" || !s.statusType)
      .filter((s) => !groupedIds.has(s.channelId))
      .map((s) => ({ id: s.channelId }));
    return [
      ...channelGroups,
      { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, channels: defaultIds },
    ];
  }, [channelGroups, statuses]);

  const {
    statsMode,
    setStatsMode,
    trendWindow,
    setTrendWindow,
    unitLabel,
    messageTrendsEnabled,
    trendSummary,
    trendLoading,
    refreshTick,
    DASH_COLS,
    totalReceived,
    totalSent,
    totalErrored,
    totalQueued,
    hrReceived,
    hrSent,
    hrErrored,
    hrQueue,
  } = useDashboardStats(statuses, lastRefresh);

  const {
    groupMode,
    setGroupMode,
    search,
    setSearch,
    selectedTagNames,
    setSelectedTagNames,
    selectedGroupIds,
    setSelectedGroupIds,
    tagMode,
    setTagMode,
    tagOptions,
    groupOptions,
    filteredStatuses,
  } = useDashboardFilters(statuses, channelTags, allGroups, tagMap);

  const {
    selectedChannelId,
    selectedConnectorId,
    onSelectChannel,
    sendDialogTarget,
    setSendDialogTarget,
    showQueueDisabledWarning,
    setShowQueueDisabledWarning,
    clearStatsTarget,
    setClearStatsTarget,
    removeAllTarget,
    setRemoveAllTarget,
    depPrompt,
    handleViewMessages,
    handleOpenSendMessage,
    handleDashboardSendMessage,
    handleClearStats,
    handleRemoveAllMessages,
    handleStopConnector,
    handleStartConnector,
    handleChannelAction,
    handleGroupAction,
    handleGroupClearStats,
    handleGroupClearStatsForSelection,
    handleGroupRemoveAllMessagesForSelection,
  } = useDashboardActions(statuses, load);

  // ── Multi-select state ─────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedConnector, setSelectedConnector] = useState<{
    channelId: string;
    metaDataId: number;
  } | null>(null);

  // Prune selections for channels no longer present (e.g. after undeploy).
  // Adjust state during render (guarded by previous `statuses`) instead of in an
  // effect, so the pruned selection is reflected in the same commit.
  const [prevStatuses, setPrevStatuses] = useState(statuses);
  if (statuses !== prevStatuses) {
    setPrevStatuses(statuses);
    const liveIds = new Set(
      statuses.filter((s) => s.statusType === "CHANNEL" || !s.statusType).map((s) => s.channelId)
    );
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => liveIds.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
    // Prune selectedConnector if its parent channel is no longer present.
    if (selectedConnector && !statuses.some((s) => s.channelId === selectedConnector.channelId)) {
      setSelectedConnector(null);
    }
  }

  // Prune selectedGroupId if that group no longer exists. Idempotent (once null,
  // the condition no longer fires), so safe to adjust during render.
  if (selectedGroupId && !allGroups.some((g) => g.id === selectedGroupId)) {
    setSelectedGroupId(null);
  }

  // ── Sort + Columns ──────────────────────────────────────────────────────
  const { sort, toggle: sortToggle, sorted } = useSortable<DashCol>("name");
  const { colState, orderedCols, setWidth, setVisible, moveCol, resetToDefaults, visibleCols } =
    useColumnConfig(DASH_COLS, "bl-dashboard-cols-v10");

  const handleResize = useCallback((key: DashCol, w: number) => setWidth(key, w), [setWidth]);
  const handleToggleCol = useCallback(
    (key: DashCol) => {
      setVisible(key, !(colState[key]?.visible !== false));
    },
    [colState, setVisible]
  );

  // ── Expand state ────────────────────────────────────────────────────────
  const [expandedGroups, toggleGroup, setAllGroups, collapseAllGroups, hasSavedGroupExpandState] =
    useExpandState("bl-dashboard-groups", () =>
      loadAdminPrefs().defaultGroupsCollapsed ? [] : allGroups.map((g) => g.id)
    );
  const [expanded, toggleExpand, setAllExpanded, collapseAllExpanded] = useExpandState(
    "bl-dashboard-rows",
    () => []
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;
      switch (e.key) {
        case "r":
        case "R":
          e.preventDefault();
          load();
          break;
        case "e":
        case "E":
          e.preventDefault();
          setAllExpanded(statuses.flatMap(collectKeys));
          setAllGroups(allGroups.map((g) => g.id));
          break;
        case "c":
        case "C":
          e.preventDefault();
          collapseAllExpanded();
          collapseAllGroups();
          break;
        case "Escape":
          if (selectedIds.size > 0 || selectedGroupId !== null || selectedConnector !== null) {
            e.preventDefault();
            setSelectedIds(new Set());
            setSelectedGroupId(null);
            setSelectedConnector(null);
          }
          break;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    load,
    statuses,
    allGroups,
    setAllExpanded,
    setAllGroups,
    collapseAllExpanded,
    collapseAllGroups,
    selectedIds,
    selectedGroupId,
  ]);

  const seededGroupsRef = React.useRef(new Set<string>());
  useEffect(() => {
    if (loadAdminPrefs().defaultGroupsCollapsed) return;
    if (hasSavedGroupExpandState) return;
    const newIds = allGroups.map((g) => g.id).filter((id) => !seededGroupsRef.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => seededGroupsRef.current.add(id));
    setAllGroups(allGroups.map((g) => g.id));
  }, [allGroups, setAllGroups, hasSavedGroupExpandState]);

  // ── Sorting ─────────────────────────────────────────────────────────────
  const portMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) {
      const lcp = (ch.sourceConnector?.properties as Record<string, unknown> | undefined)
        ?.listenerConnectorProperties as Record<string, unknown> | undefined;
      if (!lcp) continue;
      const raw =
        typeof lcp.port === "number"
          ? String(lcp.port)
          : typeof lcp.port === "string"
            ? lcp.port
            : "";
      const port = resolveConfigVar(raw, configMap);
      if (port) map.set(ch.id, port);
    }
    return map;
  }, [channels, configMap]);

  // Precomputed once per tick so the Connection sort comparator is O(1).
  const connectionLabelMap = useConnectionLabels(connectorStates);

  const sortedStatuses = useMemo(
    () =>
      sorted(filteredStatuses, (s) => {
        const src = statsMode === "lifetime" ? s.lifetimeStatistics : s.statistics;
        switch (sort.key) {
          case "name":
            return s.name;
          case "state":
            return s.state;
          case "revDelta":
            return s.deployedRevisionDelta ?? 0;
          case "lastDeployed":
            return s.deployedDate ?? "";
          case "port":
            return portMap.get(s.channelId) ?? "";
          case "connection":
            return connectionLabelMap.get(s.channelId) ?? "";
          case "received":
            return stat(src, "RECEIVED");
          case "filtered":
            return stat(src, "FILTERED");
          case "queued":
            return s.queued ?? 0;
          case "sent":
            return stat(src, "SENT");
          case "errored":
            return stat(src, "ERROR");
          case "rcvPerHr":
            return trendSummary.get(s.channelId)?.receivedPerHour ?? -1;
          case "errPerHr":
            return trendSummary.get(s.channelId)?.errPerHour ?? -1;
          case "queueDelta":
            return trendSummary.get(s.channelId)?.queueDelta ?? -Infinity;
          default:
            return s.name;
        }
      }),
    [filteredStatuses, sort, sorted, trendSummary, portMap, connectionLabelMap, statsMode]
  );

  const groupStatusMap = useMemo(() => {
    const map = new Map<string, DashboardStatus[]>();
    const channelStatuses = sortedStatuses.filter(
      (s) => s.statusType === "CHANNEL" || !s.statusType
    );
    for (const g of allGroups) {
      const ids = new Set((g.channels ?? []).map((c) => c.id));
      map.set(
        g.id,
        channelStatuses.filter((s) => ids.has(s.channelId))
      );
    }
    return map;
  }, [allGroups, sortedStatuses]);

  const sortedGroups = useMemo(() => {
    const getValue = (group: ChannelGroup): string | number => {
      const chans = groupStatusMap.get(group.id) ?? [];
      const displayName =
        group.id === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : (group.name ?? group.id);
      switch (sort.key) {
        case "name":
          return displayName;
        case "received":
          return chans.reduce(
            (s, c) =>
              s + stat(statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics, "RECEIVED"),
            0
          );
        case "filtered":
          return chans.reduce(
            (s, c) =>
              s + stat(statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics, "FILTERED"),
            0
          );
        case "queued":
          return chans.reduce((s, c) => s + (c.queued ?? 0), 0);
        case "sent":
          return chans.reduce(
            (s, c) =>
              s + stat(statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics, "SENT"),
            0
          );
        case "errored":
          return chans.reduce(
            (s, c) =>
              s + stat(statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics, "ERROR"),
            0
          );
        case "rcvPerHr":
          return chans.reduce(
            (s, c) => s + (trendSummary.get(c.channelId)?.receivedPerHour ?? 0),
            0
          );
        case "errPerHr":
          return chans.reduce((s, c) => s + (trendSummary.get(c.channelId)?.errPerHour ?? 0), 0);
        case "queueDelta":
          return chans.reduce((s, c) => s + (trendSummary.get(c.channelId)?.queueDelta ?? 0), 0);
        default:
          return displayName;
      }
    };
    return [...allGroups].sort((a, b) => compareGroups(a, b, sort, getValue, DEFAULT_GROUP_ID));
  }, [allGroups, sort, groupStatusMap, trendSummary, statsMode]);

  function collectKeys(s: DashboardStatus): string[] {
    return [rowKey(s), ...(s.childStatuses ?? []).flatMap(collectKeys)];
  }

  // Minimum widths driven by the widest value currently in each numeric column.
  // Columns grow automatically as message counts increase.
  const dataMinWidths = useMemo(() => {
    // Build a lookup map once for O(1) access in the group aggregate pass below.
    // Filter to channel-level statuses only (same filter as groupStatusMap) so that
    // connector rows sharing the same channelId don't overwrite channel stats in the map.
    const statusById = new Map(
      statuses
        .filter((s) => s.statusType === "CHANNEL" || !s.statusType)
        .map((s) => [s.channelId, s])
    );

    let maxReceived = 0,
      maxFiltered = 0,
      maxQueued = 0,
      maxSent = 0,
      maxErrored = 0;
    for (const s of statuses) {
      // Queued is a current-snapshot field on DashboardStatus.queued (destination
      // outbound queue depth) — not part of the statistics map. Read it independently
      // of `st` so a missing statistics object doesn't suppress queue-column sizing.
      maxQueued = Math.max(maxQueued, s.queued ?? 0);
      const st = s.statistics;
      if (!st) continue;
      maxReceived = Math.max(maxReceived, st.RECEIVED ?? 0);
      maxFiltered = Math.max(maxFiltered, st.FILTERED ?? 0);
      maxSent = Math.max(maxSent, st.SENT ?? 0);
      maxErrored = Math.max(maxErrored, st.ERROR ?? 0);
    }
    // Group rows display aggregated sums which can exceed any individual channel value.
    // Include group totals so columns are wide enough to fit group stats without truncation.
    for (const g of allGroups) {
      let gReceived = 0,
        gFiltered = 0,
        gQueued = 0,
        gSent = 0,
        gErrored = 0;
      for (const ch of g.channels ?? []) {
        const s = statusById.get(ch.id);
        if (!s) continue;
        // Queued is mode-independent; sum it before the statistics-map guard.
        gQueued += s.queued ?? 0;
        const src = statsMode === "lifetime" ? s.lifetimeStatistics : s.statistics;
        if (!src) continue;
        gReceived += src.RECEIVED ?? 0;
        gFiltered += src.FILTERED ?? 0;
        gSent += src.SENT ?? 0;
        gErrored += src.ERROR ?? 0;
      }
      maxReceived = Math.max(maxReceived, gReceived);
      maxFiltered = Math.max(maxFiltered, gFiltered);
      maxQueued = Math.max(maxQueued, gQueued);
      maxSent = Math.max(maxSent, gSent);
      maxErrored = Math.max(maxErrored, gErrored);
    }
    let maxRcvPerHrChars = 0,
      maxErrPerHrChars = 0,
      maxQueueDeltaChars = 0;
    for (const e of trendSummary.values()) {
      maxRcvPerHrChars = Math.max(maxRcvPerHrChars, e.receivedPerHour.toLocaleString().length);
      maxErrPerHrChars = Math.max(maxErrPerHrChars, e.errPerHour.toLocaleString().length);
      // queueDelta renders with a leading "+" for positive values
      const dStr =
        e.queueDelta > 0 ? `+${e.queueDelta.toLocaleString()}` : e.queueDelta.toLocaleString();
      maxQueueDeltaChars = Math.max(maxQueueDeltaChars, dStr.length);
    }
    // Also consider group trend aggregates for trend columns.
    for (const g of allGroups) {
      let gRcv = 0,
        gErr = 0,
        gQueueDelta = 0;
      for (const ch of g.channels ?? []) {
        const e = trendSummary.get(ch.id);
        if (!e) continue;
        gRcv += e.receivedPerHour;
        gErr += e.errPerHour;
        gQueueDelta += e.queueDelta;
      }
      maxRcvPerHrChars = Math.max(maxRcvPerHrChars, gRcv.toLocaleString().length);
      maxErrPerHrChars = Math.max(maxErrPerHrChars, gErr.toLocaleString().length);
      const dStr =
        gQueueDelta > 0 ? `+${gQueueDelta.toLocaleString()}` : gQueueDelta.toLocaleString();
      maxQueueDeltaChars = Math.max(maxQueueDeltaChars, dStr.length);
    }
    return {
      received: numericCellWidth(maxReceived.toLocaleString().length, globalDensity),
      filtered: numericCellWidth(maxFiltered.toLocaleString().length, globalDensity),
      queued: numericCellWidth(maxQueued.toLocaleString().length, globalDensity),
      sent: numericCellWidth(maxSent.toLocaleString().length, globalDensity),
      errored: numericCellWidth(maxErrored.toLocaleString().length, globalDensity),
      rcvPerHr: numericCellWidth(maxRcvPerHrChars, globalDensity),
      errPerHr: numericCellWidth(maxErrPerHrChars, globalDensity),
      queueDelta: numericCellWidth(maxQueueDeltaChars, globalDensity),
    };
  }, [statuses, trendSummary, globalDensity, allGroups, statsMode]);

  const colWidths = useMemo<Record<DashCol, number>>(() => {
    const widths = {} as Record<DashCol, number>;
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

  // ── Multi-select row click handler ────────────────────────────────────
  // Click: select one (clears others). Cmd/Ctrl+Click: toggle. Shift+Click: range.
  // Connector clicks only update the bottom panel — they don't participate in multi-select.
  //
  // In group mode, shift-click range is computed from a flat list that interleaves
  // group header markers with channel entries. A group is expanded to ALL its channels
  // only when its header row falls within the selected range — i.e. the selection crosses
  // a group boundary. Shift-selecting within a single group selects only those channels.
  const handleRowClick = useCallback(
    (channelId: string, connectorId: string | undefined, e: MouseEvent) => {
      // Always update bottom panel
      onSelectChannel(channelId, connectorId);

      // Connector clicks: single-select the connector, clear channel/group selection
      if (connectorId !== undefined) {
        setSelectedConnector({ channelId, metaDataId: Number(connectorId) });
        setSelectedIds(new Set());
        setSelectedGroupId(null);
        setLastClickedId(null);
        return;
      }

      // Channel clicks: clear any active connector selection
      setSelectedConnector(null);

      const isMetaKey = e.metaKey || e.ctrlKey;

      if (e.shiftKey && lastClickedId) {
        // Range select
        setSelectedIds((prev) => {
          const next = new Set(prev);

          if (groupMode) {
            // Build a flat list that mirrors the visual rendering order, including
            // group header rows. A group header in the slice means the range crossed
            // a group boundary → expand that whole group. Channels whose group header
            // is NOT in the slice are added individually (intra-group partial select).
            type FlatEntry =
              | { kind: "group"; id: string }
              | { kind: "channel"; channelId: string; groupId: string };

            const flatFull: FlatEntry[] = [];
            for (const g of sortedGroups) {
              flatFull.push({ kind: "group", id: g.id });
              for (const s of groupStatusMap.get(g.id) ?? []) {
                flatFull.push({ kind: "channel", channelId: s.channelId, groupId: g.id });
              }
            }

            const aIdx = flatFull.findIndex(
              (entry) => entry.kind === "channel" && entry.channelId === lastClickedId
            );
            const bIdx = flatFull.findIndex(
              (entry) => entry.kind === "channel" && entry.channelId === channelId
            );

            if (aIdx === -1 || bIdx === -1) {
              if (!isMetaKey) next.clear();
              next.add(channelId);
            } else {
              const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
              const slice = flatFull.slice(lo, hi + 1);

              // Collect groups whose header row appears in the slice
              const groupsWithHeaders = new Set<string>();
              for (const entry of slice) {
                if (entry.kind === "group") groupsWithHeaders.add(entry.id);
              }

              if (!isMetaKey) next.clear();

              // Add individual channels; skip those whose group is being fully expanded
              for (const entry of slice) {
                if (entry.kind === "channel" && !groupsWithHeaders.has(entry.groupId)) {
                  next.add(entry.channelId);
                }
              }
              // Expand groups whose headers fell in the range
              for (const groupId of groupsWithHeaders) {
                for (const s of groupStatusMap.get(groupId) ?? []) {
                  next.add(s.channelId);
                }
              }
            }
          } else {
            // Flat mode: simple index-based range in sortedStatuses order
            const flat = sortedStatuses
              .filter((s) => s.statusType === "CHANNEL" || !s.statusType)
              .map((s) => s.channelId);

            const a = flat.indexOf(lastClickedId);
            const b = flat.indexOf(channelId);

            if (a === -1 || b === -1) {
              if (!isMetaKey) next.clear();
              next.add(channelId);
            } else {
              const [lo, hi] = a < b ? [a, b] : [b, a];
              if (!isMetaKey) next.clear();
              flat.slice(lo, hi + 1).forEach((id) => next.add(id));
            }
          }
          return next;
        });
      } else if (isMetaKey) {
        // Toggle
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(channelId)) next.delete(channelId);
          else next.add(channelId);
          return next;
        });
      } else {
        // Plain click — select only this one
        setSelectedIds(new Set([channelId]));
      }
      setLastClickedId(channelId);
      setSelectedGroupId(null);
    },
    [onSelectChannel, lastClickedId, sortedStatuses, groupMode, sortedGroups, groupStatusMap]
  );

  const handleGroupRowClick = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedIds(new Set());
    setSelectedConnector(null);
    setLastClickedId(null);
  }, []);

  // ── Shared row props ────────────────────────────────────────────────────
  // Memoized (extracted hook) so DashboardRow (React.memo) skips re-rendering on
  // idle ticks — the page still re-renders twice per poll (the `refreshing` flag),
  // but with stable props the rows reconcile zero work.
  const sharedRowProps = useDashboardRowProps({
    expanded,
    onToggle: toggleExpand,
    tagMap,
    tagDisplayMode,
    visibleCols,
    mounted,
    selectedIds,
    selectedConnector,
    onRowClick: handleRowClick,
    statsMode,
    portMap,
    connectorStates,
    trendSummary,
    trendLoading,
    onChannelAction: handleChannelAction,
    onGroupAction: handleGroupAction,
    onViewMessages: handleViewMessages,
    onSendMessage: handleOpenSendMessage,
    onClearStats: handleClearStats,
    onRemoveAllMessages: handleRemoveAllMessages,
    onGroupClearStats: handleGroupClearStatsForSelection,
    onGroupRemoveAllMessages: handleGroupRemoveAllMessagesForSelection,
    onStopConnector: handleStopConnector,
    // (selection-aware context-menu handlers come from useDashboardActions)
    onStartConnector: handleStartConnector,
    globalDensity,
    setShowQueueDisabledWarning,
  });

  // ── Batch-action derived state (for toolbar) ─────────────────────────
  // States during which the channel is mid-transition between deployed and undeployed.
  // Java: `DashboardPanel.updatePopupMenu` (lines 524-526) hides every task except Refresh
  // for rows in these states.
  const MID_DEPLOY_STATES = ["DEPLOYING", "UNDEPLOYING"];
  // States during which the channel is mid-transition between two operating states.
  // Java treats Remove-All-Messages, Halt, and Undeploy specially for these.
  const HALTABLE_STATES = [
    "DEPLOYING",
    "UNDEPLOYING",
    "STARTING",
    "STOPPING",
    "PAUSING",
    "SYNCING",
    "UNKNOWN",
  ];
  // When a group is selected, expand to all channels in that group for toolbar operations.
  // When channels are selected directly, use the raw set unchanged.
  const effectiveSelectedIds = useMemo<Set<string>>(() => {
    if (selectedIds.size > 0) return selectedIds;
    if (!selectedGroupId) return selectedIds;
    const chans = groupStatusMap.get(selectedGroupId);
    if (!chans) return selectedIds;
    return new Set(chans.map((s) => s.channelId));
  }, [selectedIds, selectedGroupId, groupStatusMap]);

  const selectedStatuses = useMemo(
    () =>
      statuses.filter(
        (s) =>
          (s.statusType === "CHANNEL" || !s.statusType) && effectiveSelectedIds.has(s.channelId)
      ),
    [statuses, effectiveSelectedIds]
  );
  const startableIds = selectedStatuses
    .filter((s) => s.state === "STOPPED" || s.state === "PAUSED")
    .map((s) => s.channelId);
  const stoppableIds = selectedStatuses
    .filter((s) => s.state === "STARTED" || s.state === "PAUSED")
    .map((s) => s.channelId);
  const pausableIds = selectedStatuses.filter((s) => s.state === "STARTED").map((s) => s.channelId);
  // Halt is hidden during DEPLOYING/UNDEPLOYING (mid-deploy lockout).
  const haltableIds = selectedStatuses
    .filter(
      (s) => HALTABLE_STATES.includes(s.state ?? "") && !MID_DEPLOY_STATES.includes(s.state ?? "")
    )
    .map((s) => s.channelId);
  // Remove-All-Messages is hidden for any channel in a haltable state.
  const removableIds = selectedStatuses
    .filter((s) => !HALTABLE_STATES.includes(s.state ?? ""))
    .map((s) => s.channelId);
  // Undeploy is hidden when the channel is in a haltable non-SYNCING state.
  const undeployableIds = selectedStatuses
    .filter((s) => !HALTABLE_STATES.includes(s.state ?? "") || s.state === "SYNCING")
    .map((s) => s.channelId);
  // Clear Stats / View Messages / Send Message are hidden during mid-deploy lockout.
  const interactableIds = selectedStatuses
    .filter((s) => !MID_DEPLOY_STATES.includes(s.state ?? ""))
    .map((s) => s.channelId);
  const allSelectedIds = selectedStatuses.map((s) => s.channelId);

  const { actionPanelProps } = useConnectorToolbar({
    selectedConnector,
    statuses,
    effectiveSelectedIds,
    selectedIds,
    selectedStatuses,
    startableIds,
    stoppableIds,
    pausableIds,
    haltableIds,
    removableIds,
    undeployableIds,
    interactableIds,
    allSelectedIds,
    statsMode,
    dashboardViewOnly,
    handleViewMessages,
    handleStartConnector,
    handleStopConnector,
    handleGroupAction,
    handleClearStats,
    handleGroupClearStats,
    handleOpenSendMessage,
    handleRemoveAllMessages,
    setShowQueueDisabledWarning,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DashboardPageHeader lastRefresh={lastRefresh ?? null} mounted={mounted} />

      {/* Summary stats */}
      {!statsHidden && (
        <DashboardStatsPanel
          statsCollapsed={statsCollapsed}
          setStatsCollapsed={setStatsCollapsed}
          statsMode={statsMode}
          messageTrendsEnabled={messageTrendsEnabled}
          trendLoading={trendLoading}
          unitLabel={unitLabel}
          totalReceived={totalReceived}
          totalSent={totalSent}
          totalErrored={totalErrored}
          totalQueued={totalQueued}
          hrReceived={hrReceived}
          hrSent={hrSent}
          hrErrored={hrErrored}
          hrQueue={hrQueue}
        />
      )}

      {/* Content area: dockable action toolbar + main content */}
      <div
        className={`flex flex-1 min-h-0 ${toolbarPos === "top" || toolbarPos === "bottom" ? "flex-col" : "flex-row"}`}
      >
        {/* Dockable action toolbar (left/top) */}
        {(toolbarPos === "left" || toolbarPos === "top") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <DashboardActionPanel position={toolbarPos} {...actionPanelProps} />
          </DockableToolbar>
        )}

        {/* Main content */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          {/* Search + filters */}
          <GroupTagFilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Filter by name, ID, or tag…"
            groupOptions={groupOptions}
            selectedGroupIds={selectedGroupIds}
            onGroupChange={setSelectedGroupIds}
            tagOptions={tagOptions}
            selectedTagNames={selectedTagNames}
            onTagChange={setSelectedTagNames}
            tagMode={tagMode}
            onTagModeChange={setTagMode}
            actions={
              <DashboardFilterActions
                statsHidden={statsHidden}
                onToggleStats={() => setStatsHidden(!statsHidden)}
                messageTrendsEnabled={messageTrendsEnabled}
                trendWindow={trendWindow}
                setTrendWindow={setTrendWindow}
                orderedCols={orderedCols}
                colState={colState}
                onToggleCol={handleToggleCol}
                onResetCols={resetToDefaults}
                onMoveCol={moveCol}
                visibleCols={visibleCols}
                sortedStatuses={sortedStatuses}
                loading={refreshing}
                statsMode={statsMode}
                portMap={portMap}
                connectorStates={connectorStates}
                trendSummary={trendSummary}
                onRefresh={load}
              />
            }
          />

          <ApiErrorAlert error={error} />

          {/* Channel table */}
          <div className={`flex-1 min-h-0 flex flex-col gap-2 ${pagePadding(globalDensity)}`}>
            <TableContainer ref={tableContainerRef} className="flex-1 min-h-0">
              <Table style={{ width: tableWidth, minWidth: totalTableWidth }}>
                <TableColGroup
                  cols={visibleCols}
                  colState={
                    Object.fromEntries(
                      visibleCols.map((c) => [c.key, { width: colWidths[c.key], visible: true }])
                    ) as ColStateMap<DashCol>
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
                        onResize={handleResize}
                      />
                    ))}
                  </TableHeadRow>
                </TableHead>
                <TableBody>
                  {loading && statuses.length === 0 ? (
                    <TableLoading colSpan={visibleCols.length} />
                  ) : !loading && sortedStatuses.length === 0 && !error ? (
                    <TableEmpty colSpan={visibleCols.length}>
                      <EmptyState
                        message="No deployed channels found. Deploy channels from the Channels tab to see them here."
                        filterMessage="No channels match your filter."
                        hasFilter={!!(search || selectedTagNames.size || selectedGroupIds.size)}
                        icon={
                          !search && !selectedTagNames.size && !selectedGroupIds.size ? (
                            <LayoutList className="w-10 h-10 opacity-40" />
                          ) : undefined
                        }
                      />
                    </TableEmpty>
                  ) : groupMode ? (
                    channelsLoading && allGroups.length === 0 ? (
                      <TableLoading colSpan={visibleCols.length} />
                    ) : (
                      sortedGroups.map((group) => {
                        const groupChans = groupStatusMap.get(group.id) ?? [];
                        if (groupChans.length === 0) return null;
                        const isExpanded = expandedGroups.has(group.id);
                        return (
                          <React.Fragment key={group.id}>
                            <GroupRow
                              group={group}
                              channels={groupChans}
                              expanded={isExpanded}
                              onToggle={() => toggleGroup(group.id)}
                              onSelect={() => handleGroupRowClick(group.id)}
                              selected={selectedGroupId === group.id}
                              visibleCols={visibleCols}
                              statsMode={statsMode}
                              trendSummary={trendSummary}
                              trendLoading={trendLoading}
                              onGroupAction={handleGroupAction}
                              onGroupClearStats={handleGroupClearStats}
                              globalDensity={globalDensity}
                            />
                            {isExpanded &&
                              groupChans.map((s) => (
                                <DashboardRow
                                  key={rowKey(s)}
                                  status={s}
                                  depth={0}
                                  inGroup
                                  {...sharedRowProps}
                                />
                              ))}
                          </React.Fragment>
                        );
                      })
                    )
                  ) : (
                    sortedStatuses.map((s) => (
                      <DashboardRow key={rowKey(s)} status={s} depth={0} {...sharedRowProps} />
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <div className="flex items-center justify-between px-1">
              {/* Deployment summary text */}
              <DashboardDeploymentSummary
                statuses={statuses}
                filteredStatuses={filteredStatuses}
                selectedIds={selectedIds}
                onClearSelection={() => {
                  setSelectedIds(new Set());
                  setSelectedConnector(null);
                  setSelectedGroupId(null);
                }}
              />
              {/* View toggle controls */}
              <DashboardViewToggles
                groupMode={groupMode}
                onSetGroupMode={setGroupMode}
                loading={refreshing}
                onExpandAll={() => {
                  setAllExpanded(statuses.flatMap(collectKeys));
                  setAllGroups(allGroups.map((g) => g.id));
                }}
                onCollapseAll={() => {
                  collapseAllExpanded();
                  collapseAllGroups();
                }}
                statsMode={statsMode}
                onSetStatsMode={setStatsMode}
                tagDisplayMode={tagDisplayMode}
                onSetTagDisplayMode={setTagDisplayMode}
              />
            </div>
          </div>

          {/* Drag handle — hidden when bottom panel is collapsed */}
          {!bottomCollapsed && (
            <div
              onMouseDown={onDragHandleMouseDown}
              className="shrink-0 h-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-blue-300 dark:hover:bg-blue-700 cursor-ns-resize transition-colors border-t border-b border-border"
              title="Drag to resize"
            />
          )}

          {/* Bottom panel */}
          <div
            className="shrink-0 border-t border-border overflow-hidden"
            style={{ height: bottomCollapsed ? 36 : bottomHeight }}
          >
            <DashboardBottomPanel
              messageTrendsEnabled={messageTrendsEnabled}
              refreshTick={refreshTick}
              selectedChannelId={selectedChannelId}
              selectedChannelIds={effectiveSelectedIds}
              selectedConnectorId={selectedConnectorId}
              collapsed={bottomCollapsed}
              onToggleCollapse={() => setBottomCollapsed((p) => !p)}
            />
          </div>
          {/* end main content */}
        </div>

        {/* Dockable action toolbar (right/bottom) */}
        {(toolbarPos === "right" || toolbarPos === "bottom") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <DashboardActionPanel position={toolbarPos} {...actionPanelProps} />
          </DockableToolbar>
        )}
      </div>

      {/* Dialogs */}
      {sendDialogTarget && (
        <SendMessageDialog
          open
          onOpenChange={(open) => {
            if (!open) setSendDialogTarget(null);
          }}
          channelName={sendDialogTarget.channelName}
          connectors={sendDialogTarget.connectors}
          onSend={handleDashboardSendMessage}
        />
      )}
      {showQueueDisabledWarning && (
        <QueueDisabledWarningDialog onClose={() => setShowQueueDisabledWarning(false)} />
      )}
      {clearStatsTarget && (
        <ClearStatisticsDialog
          channelId={clearStatsTarget.channelId}
          channelIds={clearStatsTarget.channelIds}
          channelName={clearStatsTarget.channelName}
          metaDataId={clearStatsTarget.metaDataId}
          onClose={() => setClearStatsTarget(null)}
          onDone={() => {
            setClearStatsTarget(null);
            load();
          }}
        />
      )}
      {removeAllTarget && (
        <RemoveAllMessagesDialog
          channels={removeAllTarget.channels}
          onClose={() => setRemoveAllTarget(null)}
          onDone={() => {
            setRemoveAllTarget(null);
            load();
          }}
        />
      )}
      {depPrompt && (
        <DependencyWarningDialog
          task={depPrompt.task}
          additionalChannels={depPrompt.additionalChannels}
          onResolve={depPrompt.onResolve}
        />
      )}
    </div>
  );
}
