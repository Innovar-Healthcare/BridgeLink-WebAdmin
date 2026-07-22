"use client";

/**
 * DashboardBottomPanel — the resizable tabbed panel below the channel table.
 *
 * Tabs (mirroring the Java JSplitPane / JTabbedPane):
 *  1. Server Log       — GET /extensions/serverlog/               (built-in, always shown)
 *  2. Connection Log   — GET /extensions/dashboardstatus/connectionLogs (built-in)
 *  3. Global Maps      — POST /extensions/globalmapviewer/maps/_getAllMaps (built-in)
 *  4. Message Trends   — GET /statistics/timeseries/channels/{id} (optional plugin)
 *
 * Polling:
 *  - Server Log + Connection Log: fetch incrementally on each `refreshTick` change
 *    (parent increments tick on each dashboard refresh).
 *  - Global Maps: fetch on tab selection.
 *  - Message Trends: fetch on selection change or manual refresh.
 */

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServerLogTab } from "@/components/dashboard-bottom-panel/server-log-tab";
import { ConnectionLogTab } from "@/components/dashboard-bottom-panel/connection-log-tab";
import {
  GlobalMapsTab,
  deserializeXStreamValue,
} from "@/components/dashboard-bottom-panel/global-maps-tab";
import { TrendsTab } from "@/components/dashboard-bottom-panel/trends-tab";
import {
  getServerLogs,
  getConnectionLogs,
  getGlobalMaps,
  getChannelTimeseries,
  getConnectorTimeseries,
} from "@/lib/api-client";
import type { ConnectionLogItem, MessageStatisticsTimeseries, ServerLogItem } from "@/lib/types";
import { useCacheSelector } from "@/lib/hooks/use-cache";
import { useSessionState } from "@/lib/hooks/use-session-state";
import {
  advanceServerLogWatermark,
  clearViewFloor,
  mergeServerLogEntries,
} from "@/lib/server-log-poll";
import {
  TIME_RANGES,
  DEFAULT_RANGE,
  DEFAULT_INTERVAL,
  allowedIntervalsForRange,
} from "@/components/dashboard-bottom-panel/trend-config";
import type { TrendView } from "@/components/dashboard-bottom-panel/trend-config";

export interface DashboardBottomPanelProps {
  messageTrendsEnabled: boolean;
  /** Increments each time the dashboard refreshes — triggers log polls. */
  refreshTick: number;
  /** Currently selected channel ID (for Message Trends). */
  selectedChannelId?: string;
  /**
   * Full set of currently-selected channel IDs — a single click, a multi-select,
   * or every member channel of a selected group (the dashboard's
   * `effectiveSelectedIds`). Empty → unified view. Used by the Server Log tab to
   * send one `channelId` filter param per channel (mirrors core PR #160).
   */
  selectedChannelIds?: Set<string>;
  /** Currently selected connector metadata ID (for connector-level trends). */
  selectedConnectorId?: string;
  /** Whether the bottom panel is collapsed to just the tab bar. */
  collapsed?: boolean;
  /** Called when the user clicks the collapse/expand chevron. */
  onToggleCollapse?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeTimeWindow(rangeCode: string): { start: number; end: number } {
  const range = TIME_RANGES.find((r) => r.code === rangeCode) ?? TIME_RANGES[0];
  const endMs = Date.now();
  const startMs = endMs - range.minutes * 60 * 1000;
  return { start: Math.round(startMs / 1000), end: Math.round(endMs / 1000) };
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DashboardBottomPanel({
  messageTrendsEnabled,
  refreshTick,
  selectedChannelId,
  selectedChannelIds,
  selectedConnectorId,
  collapsed,
  onToggleCollapse,
}: DashboardBottomPanelProps) {
  // Stable, content-based key for the selected-channel set. The set's identity
  // changes on every poll (it is derived from the live status list), so effects
  // must depend on this string — not the set — to avoid re-firing each tick.
  const serverLogChannelKey = [...(selectedChannelIds ?? [])].sort().join(",");
  const serverLogChannelIds = useMemo(
    () => (serverLogChannelKey ? serverLogChannelKey.split(",") : []),
    [serverLogChannelKey]
  );
  type TabId = "serverlog" | "connlog" | "globalmaps" | "trends";
  const [activeTab, setActiveTab] = useState<TabId>("serverlog");

  // ── Server Log state ───────────────────────────────────────────────────────
  const [serverLogs, setServerLogs] = useState<ServerLogItem[]>([]);
  const [serverLogPaused, setServerLogPaused] = useState(false);
  const [serverLogSize, setServerLogSize] = useState(50);
  const serverLogLastId = useRef<number | undefined>(undefined);
  // Per-view cleared floors, keyed by the current selection (serverLogChannelKey:
  // "" for unified, a channel id, or a comma-joined multi/group set). "Clear" is a
  // client-side view watermark — the server keeps its buffer. On Clear we record the
  // highest id seen for the *current view* and drop fetched entries with id <= it, so
  // cleared rows stay cleared even when a selection change resets serverLogLastId and
  // re-pulls the slice. Because it is keyed per view, clearing one channel's log
  // leaves other channels' views untouched (a deliberate divergence from Swing's
  // single global watermark —. Persisted per-user so the cleared state
  // survives navigating away from the Dashboard and back (the panel unmounts on route
  // change). Like all useSessionState in this app it resets when the tab closes.
  const [serverLogClearedFloors, setServerLogClearedFloors] = useSessionState<
    Record<string, number>
  >("bl-dashboard-serverlog-cleared-floors", {});
  const serverLogClearedFloor = serverLogClearedFloors[serverLogChannelKey] ?? 0;
  const [selectedLog, setSelectedLog] = useState<ServerLogItem | null>(null);
  const [logDialogOpen, setLogDialogOpen] = useState(false);

  // ── Connection Log state ───────────────────────────────────────────────────
  const [connLogs, setConnLogs] = useState<ConnectionLogItem[]>([]);
  const [connLogPaused, setConnLogPaused] = useState(false);
  const [connLogSize, setConnLogSize] = useState(250);
  const connLogLastId = useRef<number | undefined>(undefined);

  // ── Global Maps state ──────────────────────────────────────────────────────
  const [mapRows, setMapRows] = useState<
    Array<{ serverId: string; channel: string; key: string; value: string }>
  >([]);
  const [mapFilter, setMapFilter] = useState("");
  const [mapLoading, setMapLoading] = useState(false);
  const [expandedValue, setExpandedValue] = useState<string | null>(null);
  const mapFetched = useRef(false);

  // ── Message Trends state ───────────────────────────────────────────────────
  const channels = useCacheSelector((s) => s.channels);
  const [trendData, setTrendData] = useState<MessageStatisticsTimeseries[]>([]);
  const [trendInterval, setTrendInterval] = useState(DEFAULT_INTERVAL);
  const [trendRange, setTrendRange] = useState(DEFAULT_RANGE);
  const [trendView, setTrendView] = useState<TrendView>("All");
  const [trendChartType, setTrendChartType] = useState<"line" | "stacked">("line");
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
  // Time window: epoch seconds
  const trendWindowRef = useRef<{ start: number; end: number } | null>(null);

  const chartTitle = useMemo(() => {
    if (!selectedChannelId) return undefined;
    const channel = channels.find((ch) => ch.id === selectedChannelId);
    if (!channel) return undefined;
    if (selectedConnectorId === undefined) {
      return `Message Volume for Channel: ${channel.name}`;
    }
    if (selectedConnectorId === "0") {
      return `Message Volume for Connector: Source`;
    }
    const metaId = Number(selectedConnectorId);
    const connector = channel.destinationConnectors?.find((c) => c.metaDataId === metaId);
    return `Message Volume for Connector: ${connector?.name ?? selectedConnectorId}`;
  }, [selectedChannelId, selectedConnectorId, channels]);

  // On range change: keep current interval if still valid, else pick first allowed (mirrors Java).
  const handleRangeChange = useCallback(
    (newRange: string) => {
      const allowed = allowedIntervalsForRange(newRange);
      if (!allowed.some((i) => i.code === trendInterval) && allowed.length > 0) {
        setTrendInterval(allowed[0].code);
      }
      setTrendRange(newRange);
    },
    [trendInterval]
  );

  // ── Server Log polling ─────────────────────────────────────────────────────
  // Reset log + lastId when the selected channel set changes so we re-pull a fresh
  // slice for the new selection. The cleared-floor (serverLogClearedId) is
  // intentionally NOT reset here, so entries cleared before the switch stay cleared.
  const prevServerLogChannelRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevServerLogChannelRef.current !== serverLogChannelKey) {
      prevServerLogChannelRef.current = serverLogChannelKey;
      setServerLogs([]);
      serverLogLastId.current = undefined;
    }
  }, [serverLogChannelKey]);

  useEffect(() => {
    if (collapsed || activeTab !== "serverlog" || serverLogPaused) return;
    const ac = new AbortController();
    (async () => {
      try {
        const newItems = await getServerLogs(
          serverLogSize,
          serverLogLastId.current,
          serverLogChannelIds,
          ac.signal
        );
        if (ac.signal.aborted || newItems.length === 0) return;
        // Advance the watermark so we never refetch, but only surface entries above
        // this view's cleared floor. Entries with id <= the floor were on screen (or
        // cleared) before the last Clear of this view, so they stay hidden across
        // channel switches and Dashboard navigation.
        serverLogLastId.current = advanceServerLogWatermark(serverLogLastId.current, newItems);
        setServerLogs((prev) =>
          mergeServerLogEntries(prev, newItems, serverLogClearedFloor, serverLogSize)
        );
      } catch {
        // Silently ignore poll/abort errors
      }
    })();
    return () => {
      ac.abort();
    };
  }, [
    refreshTick,
    serverLogPaused,
    serverLogSize,
    serverLogChannelIds,
    serverLogClearedFloor,
    collapsed,
    activeTab,
  ]);

  // ── Connection Log polling ─────────────────────────────────────────────────
  // Reset log + lastId when selected channel changes so we get fresh data for that channel
  const prevConnChannelRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevConnChannelRef.current !== selectedChannelId) {
      prevConnChannelRef.current = selectedChannelId;
      setConnLogs([]);
      connLogLastId.current = undefined;
    }
  }, [selectedChannelId]);

  useEffect(() => {
    if (collapsed || activeTab !== "connlog" || connLogPaused) return;
    const ac = new AbortController();
    (async () => {
      try {
        // If a channel is selected, filter to that channel; otherwise fetch all
        const newItems = await getConnectionLogs(
          connLogSize,
          connLogLastId.current,
          selectedChannelId,
          ac.signal
        );
        if (ac.signal.aborted || newItems.length === 0) return;
        const maxId = newItems.reduce((m, i) => Math.max(m, i.logId), connLogLastId.current ?? 0);
        connLogLastId.current = maxId;
        setConnLogs((prev) => {
          const combined = [...newItems, ...prev];
          return combined.slice(0, connLogSize);
        });
      } catch {
        // Silently ignore poll/abort errors
      }
    })();
    return () => {
      ac.abort();
    };
  }, [refreshTick, connLogPaused, connLogSize, selectedChannelId, collapsed, activeTab]);

  // ── Global Maps fetch (on tab activation or channel selection change) ────────

  const fetchGlobalMaps = useCallback(async (channelId?: string, signal?: AbortSignal) => {
    setMapLoading(true);
    try {
      // Always include global map; include selected channel's map if one is selected
      const channelIds = channelId ? [channelId] : [];
      const data = await getGlobalMaps(channelIds, true, signal);
      const rows: typeof mapRows = [];
      for (const [serverId, channelMap] of Object.entries(data ?? {})) {
        for (const [chanKey, keyVals] of Object.entries(channelMap ?? {})) {
          for (const [key, value] of Object.entries(keyVals ?? {})) {
            rows.push({
              serverId,
              channel: chanKey,
              key,
              value: deserializeXStreamValue(String(value)),
            });
          }
        }
      }
      rows.sort((a, b) => a.channel.localeCompare(b.channel) || a.key.localeCompare(b.key));
      setMapRows(rows);
      mapFetched.current = true;
    } catch {
      // ignore
    } finally {
      setMapLoading(false);
    }
  }, []);

  // Fetch on tab activation
  useEffect(() => {
    if (activeTab === "globalmaps" && !mapFetched.current) {
      const ac = new AbortController();
      fetchGlobalMaps(selectedChannelId, ac.signal);
      return () => {
        ac.abort();
      };
    }
  }, [activeTab, fetchGlobalMaps, selectedChannelId]);

  // Re-fetch when selected channel changes while on the tab
  const prevMapChannelRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (activeTab !== "globalmaps") return;
    if (prevMapChannelRef.current === selectedChannelId) return;
    prevMapChannelRef.current = selectedChannelId;
    const ac = new AbortController();
    fetchGlobalMaps(selectedChannelId, ac.signal);
    return () => {
      ac.abort();
    };
  }, [activeTab, selectedChannelId, fetchGlobalMaps]);

  // ── Message Trends fetch ───────────────────────────────────────────────────

  const fetchTrends = useCallback(
    async (
      channelId: string,
      connectorId: string | undefined,
      interval: string,
      rangeCode: string,
      signal?: AbortSignal
    ) => {
      const window = computeTimeWindow(rangeCode);
      trendWindowRef.current = window;
      setIsLive(true);
      setTrendLoading(true);
      setTrendError(null);
      try {
        const data = connectorId
          ? await getConnectorTimeseries(
              channelId,
              connectorId,
              window.start,
              window.end,
              interval,
              signal
            )
          : await getChannelTimeseries(channelId, window.start, window.end, interval, signal);
        if (signal?.aborted) return;
        setTrendData(data);
      } catch (e) {
        if (signal?.aborted) return;
        setTrendError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!signal?.aborted) setTrendLoading(false);
      }
    },
    []
  );

  // Re-fetch when selection, interval, or range changes
  useEffect(() => {
    if (activeTab !== "trends" || !selectedChannelId) return;
    const ac = new AbortController();
    startTransition(() => {
      fetchTrends(selectedChannelId, selectedConnectorId, trendInterval, trendRange, ac.signal);
    });
    return () => {
      ac.abort();
    };
  }, [activeTab, selectedChannelId, selectedConnectorId, trendInterval, trendRange, fetchTrends]);

  const shiftAcRef = useRef<AbortController | null>(null);
  function shiftTrendWindow(direction: -1 | 1) {
    if (!trendWindowRef.current) return;
    const range = TIME_RANGES.find((r) => r.code === trendRange) ?? TIME_RANGES[0];
    const shiftSec = Math.round((range.minutes * 60) / 2) * direction;
    const newStart = trendWindowRef.current.start + shiftSec;
    const newEnd = trendWindowRef.current.end + shiftSec;
    trendWindowRef.current = { start: newStart, end: newEnd };
    setIsLive(false);
    if (!selectedChannelId) return;
    // Abort any previous shift request
    shiftAcRef.current?.abort();
    const ac = new AbortController();
    shiftAcRef.current = ac;
    setTrendLoading(true);
    setTrendError(null);
    const fn = selectedConnectorId
      ? getConnectorTimeseries(
          selectedChannelId,
          selectedConnectorId,
          newStart,
          newEnd,
          trendInterval,
          ac.signal
        )
      : getChannelTimeseries(selectedChannelId, newStart, newEnd, trendInterval, ac.signal);
    fn.then((d) => {
      if (!ac.signal.aborted) setTrendData(d);
    })
      .catch((e) => {
        if (!ac.signal.aborted) setTrendError(String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setTrendLoading(false);
      });
  }

  // ── Tab definitions ────────────────────────────────────────────────────────

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "serverlog", label: "Server Log" },
    { id: "connlog", label: "Connection Log" },
    { id: "globalmaps", label: "Global Maps" },
    ...(messageTrendsEnabled ? [{ id: "trends" as TabId, label: "Message Trends" }] : []),
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as TabId)}
      className="h-full overflow-hidden bg-white dark:bg-gray-900"
    >
      {/* Tab bar */}
      <div className="flex shrink-0">
        <TabsList className="flex-1">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {onToggleCollapse && (
          <div className="flex items-center bg-[#1B3D6D] border-b border-[#0F2542] px-1">
            <button
              onClick={onToggleCollapse}
              title={collapsed ? "Expand panel" : "Collapse panel"}
              className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10"
            >
              {collapsed ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Tab content — hidden when panel is collapsed */}
      <div className={collapsed ? "hidden" : "flex-1 overflow-hidden min-h-0"}>
        {/* ── Server Log ── */}
        {activeTab === "serverlog" && (
          <ServerLogTab
            serverLogs={serverLogs}
            serverLogPaused={serverLogPaused}
            onTogglePause={() => setServerLogPaused((p) => !p)}
            serverLogSize={serverLogSize}
            onServerLogSizeChange={setServerLogSize}
            onClear={() => {
              // Raise this view's cleared floor to the current watermark (monotonic,
              // per-view — other views' floors untouched); keep the watermark so the
              // next poll fetches only new entries.
              setServerLogClearedFloors((prev) =>
                clearViewFloor(prev, serverLogChannelKey, serverLogLastId.current)
              );
              setServerLogs([]);
            }}
            selectedLog={selectedLog}
            logDialogOpen={logDialogOpen}
            onSelectLog={(log) => {
              setSelectedLog(log);
              setLogDialogOpen(true);
            }}
            onLogDialogOpenChange={setLogDialogOpen}
          />
        )}

        {/* ── Connection Log ── */}
        {activeTab === "connlog" && (
          <ConnectionLogTab
            connLogs={connLogs}
            connLogPaused={connLogPaused}
            onTogglePause={() => setConnLogPaused((p) => !p)}
            connLogSize={connLogSize}
            onConnLogSizeChange={setConnLogSize}
            connLogLastIdRef={connLogLastId}
            onClear={() => setConnLogs([])}
          />
        )}

        {/* ── Global Maps ── */}
        {activeTab === "globalmaps" && (
          <GlobalMapsTab
            mapRows={mapRows}
            mapFilter={mapFilter}
            onMapFilterChange={setMapFilter}
            mapLoading={mapLoading}
            expandedValue={expandedValue}
            onExpandedValueChange={setExpandedValue}
            onRefresh={() => {
              mapFetched.current = false;
              fetchGlobalMaps(selectedChannelId, undefined);
            }}
          />
        )}

        {/* ── Message Trends ── */}
        {activeTab === "trends" && messageTrendsEnabled && (
          <TrendsTab
            selectedChannelId={selectedChannelId}
            chartTitle={chartTitle}
            trendData={trendData}
            trendInterval={trendInterval}
            onTrendIntervalChange={setTrendInterval}
            trendRange={trendRange}
            onTrendRangeChange={handleRangeChange}
            trendView={trendView}
            onTrendViewChange={setTrendView}
            trendChartType={trendChartType}
            onTrendChartTypeChange={setTrendChartType}
            trendLoading={trendLoading}
            trendError={trendError}
            isLive={isLive}
            trendWindowRef={trendWindowRef}
            onRefresh={() => {
              if (selectedChannelId) {
                fetchTrends(selectedChannelId, selectedConnectorId, trendInterval, trendRange);
              }
            }}
            onShiftWindow={shiftTrendWindow}
          />
        )}
      </div>
    </Tabs>
  );
}
