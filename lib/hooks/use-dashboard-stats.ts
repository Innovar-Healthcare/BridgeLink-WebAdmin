"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useDocumentVisible } from "@/lib/hooks/use-document-visible";
import { logWarn } from "@/lib/dev-logger";
import type { DashboardStatus } from "@/lib/types";
import type { ColDef } from "@/lib/hooks/use-column-config";
import { isExtensionEnabled } from "@/lib/api-client";
import { stat } from "@/app/(app)/dashboard/_components/dashboard-row";
import type { DashCol } from "@/app/(app)/dashboard/_components/dashboard-row";
import {
  fetchTrendSummaries,
  type TrendEntry,
  type TrendWindow,
  TREND_WINDOWS,
  TREND_COL_PREFIX,
  trendColLabel,
} from "@/app/(app)/dashboard/_lib/trend-utils";
import { userScopedKey } from "@/lib/auth";
import { registerCacheTeardown } from "@/lib/logout";
import { loadAdminPrefs } from "@/components/settings/admin-tab";

// Module-level — survives component remounts (e.g. navigating away and back)
// so trend data is not re-fetched just because the user visited another page.
let trendLastFetchedAt = 0;
// The data must share the throttle's lifetime: if only the timestamp survived a
// remount, the throttle would skip the refetch while the data itself was gone —
// blank trend columns and 0 in the per-hour cards until the next poll tick after
// the window elapsed review finding).
let trendCache: Map<string, TrendEntry> = new Map();

/** Reset the module-level trend cache (per-channel stats). Registered so it is
 *  cleared on login, logout, idle-logout, and 401 — otherwise the next user on a
 *  shared tab is seeded with the prior session's trend numbers. */
export function clearTrendCache(): void {
  trendCache = new Map();
  trendLastFetchedAt = 0;
}
registerCacheTeardown(clearTrendCache);

// ─── Column definitions ─────────────────────────────────────────────────────

const DASH_COLS_BASE: ColDef<DashCol>[] = [
  {
    key: "state",
    label: "Status",
    tooltip:
      "The status of the deployed channel. Possible values are deploying, undeploying, started, starting, pausing, paused, stopping, and stopped.",
    defaultWidth: 110,
    compactWidth: 82,
    tightWidth: 70,
    minWidth: 110,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "name",
    label: "Name",
    tooltip: "The name of the deployed channel or connector.",
    defaultWidth: 300,
    minWidth: 60,
    defaultVisible: true,
    canHide: false,
    align: "left",
    flexible: true,
  },
  {
    key: "channelId",
    label: "Channel ID",
    defaultWidth: 310,
    tightWidth: 270,
    minWidth: 270,
    defaultVisible: false,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "revDelta",
    label: "Rev Δ",
    tooltip:
      "The number of times this channel was saved since it was deployed. Rev Δ = Channel Revision − Deployed Revision. This value will be highlighted if it is greater than 0, or if any code templates linked to this channel have changed.",
    defaultWidth: 90,
    compactWidth: 72,
    tightWidth: 66,
    minWidth: 90,
    defaultVisible: true,
    canHide: true,
    align: "center",
    resizable: false,
  },
  {
    key: "lastDeployed",
    label: "Last Deployed",
    tooltip:
      "The time this channel was last deployed. This value will be highlighted if it is within the last two minutes.",
    defaultWidth: 150,
    compactWidth: 140,
    tightWidth: 124,
    minWidth: 150,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "port",
    label: "Port",
    defaultWidth: 70,
    compactWidth: 65,
    tightWidth: 54,
    minWidth: 70,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "connection",
    label: "Connection",
    defaultWidth: 120,
    tightWidth: 100,
    minWidth: 120,
    defaultVisible: true,
    canHide: true,
    align: "left",
    resizable: false,
  },
  {
    key: "received",
    label: "Received",
    tooltip: "The number of messages received and accepted by this channel's source connector.",
    defaultWidth: 110,
    compactWidth: 96,
    minWidth: 90,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "filtered",
    label: "Filtered",
    tooltip:
      "The number of messages filtered out by this channel's source connector or any destination connector.",
    defaultWidth: 100,
    compactWidth: 92,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "queued",
    label: "Queued",
    tooltip:
      "The number of messages currently queued by all destination connectors in this channel.",
    defaultWidth: 100,
    compactWidth: 90,
    minWidth: 75,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "sent",
    label: "Sent",
    tooltip:
      "The number of messages that have been sent by all of the destination connectors in this channel.",
    defaultWidth: 90,
    compactWidth: 65,
    minWidth: 65,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "errored",
    label: "Errored",
    tooltip:
      "The number of messages that errored in this channel. This value will be highlighted if it is greater than 0.",
    defaultWidth: 100,
    compactWidth: 90,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
];

const DASH_COLS_TREND: ColDef<DashCol>[] = [
  {
    key: "rcvPerHr",
    label: "Rcv/hr",
    defaultWidth: 90,
    compactWidth: 82,
    tightWidth: 70,
    minWidth: 70,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "queueDelta",
    label: "Queue Δ/hr",
    defaultWidth: 125,
    compactWidth: 115,
    tightWidth: 98,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
  {
    key: "errPerHr",
    label: "Err/hr",
    defaultWidth: 80,
    compactWidth: 72,
    tightWidth: 60,
    minWidth: 65,
    defaultVisible: true,
    canHide: true,
    align: "right",
    resizable: false,
  },
];

// ─── Types ──────────────────────────────────────────────────────────────────

export type StatsMode = "current" | "lifetime";

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages dashboard statistics and trend data:
 * - Message Trends extension enabled check
 * - Column definitions (base + trend columns when extension is enabled)
 * - Trend summary loading via API
 * - Aggregate summary stats (totals + hourly rates)
 * - Current vs Lifetime statistics mode (mirrors Java DashboardPanel radio buttons)
 */
export function useDashboardStats(statuses: DashboardStatus[], lastRefresh: Date | null) {
  const visible = useDocumentVisible();

  // ── Stats mode (current vs lifetime) ────────────────────────────────────
  const [statsMode, setStatsModeState] = useState<StatsMode>(() => {
    try {
      const stored = sessionStorage.getItem(userScopedKey("bl-dashboard-stats-mode"));
      return stored === "lifetime" ? "lifetime" : "current";
    } catch (e) {
      logWarn("DashboardStats", "Failed to read stats mode from storage", e);
      return "current";
    }
  });

  const setStatsMode = (mode: StatsMode) => {
    setStatsModeState(mode);
    try {
      sessionStorage.setItem(userScopedKey("bl-dashboard-stats-mode"), mode);
    } catch (e) {
      logWarn("DashboardStats", "Failed to save stats mode to storage", e);
    }
  };

  // ── Trend window ────────────────────────────────────────────────────────
  const [trendWindow, setTrendWindowState] = useState<TrendWindow>(() => {
    try {
      const stored = sessionStorage.getItem(userScopedKey("bl-dashboard-trend-window"));
      return (TREND_WINDOWS.find((w) => w.key === stored)?.key ?? "1h") as TrendWindow;
    } catch (e) {
      logWarn("DashboardStats", "Failed to read trend window from storage", e);
      return "1h";
    }
  });

  const setTrendWindow = (window: TrendWindow) => {
    trendLastFetchedAt = 0; // force immediate refetch
    setTrendWindowState(window);
    try {
      sessionStorage.setItem(userScopedKey("bl-dashboard-trend-window"), window);
    } catch (e) {
      logWarn("DashboardStats", "Failed to save trend window to storage", e);
    }
  };

  // Unit label for the active trend window ("/ hr", "/ 4h", "/ day", …). Shared by the
  // summary cards and the per-channel trend column headers so they stay consistent.
  const unitLabel = TREND_WINDOWS.find((w) => w.key === trendWindow)?.unitLabel ?? "/ hr";

  // ── Message Trends extension ────────────────────────────────────────────
  const [messageTrendsEnabled, setMessageTrendsEnabled] = useState(false);
  useEffect(() => {
    isExtensionEnabled("Message Trends")
      .then(setMessageTrendsEnabled)
      .catch(() => setMessageTrendsEnabled(false));
  }, []);

  // ── Refresh tick (triggers trend refetch when dashboard data changes) ──
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRefreshTick((t) => t + 1);
  }, [lastRefresh]);

  // ── Column definitions ──────────────────────────────────────────────────
  // Trend column headers track the active window's unit label ("Rcv / 4h", "Err / day", …)
  // so the table and the summary cards agree for non-1h windows.
  const DASH_COLS = useMemo<ColDef<DashCol>[]>(() => {
    if (!messageTrendsEnabled) return DASH_COLS_BASE;
    const trendCols = DASH_COLS_TREND.map((c) => ({
      ...c,
      label: trendColLabel(
        TREND_COL_PREFIX[c.key as keyof typeof TREND_COL_PREFIX] ?? c.label,
        unitLabel
      ),
    }));
    return [...DASH_COLS_BASE, ...trendCols];
  }, [messageTrendsEnabled, unitLabel]);

  // ── Trend summary ──────────────────────────────────────────────────────
  // Seeded from the module cache so a remount within the throttle window shows
  // the previous data instead of blanks.
  const [trendSummary, setTrendSummary] = useState<Map<string, TrendEntry>>(() => trendCache);
  const [trendLoading, setTrendLoading] = useState(false);
  const trendAcRef = useRef<AbortController | null>(null);

  const channelIds = useMemo(
    () =>
      statuses.filter((s) => s.statusType === "CHANNEL" || !s.statusType).map((s) => s.channelId),
    [statuses]
  );

  // Abort in-flight trend request only when the trend window changes or on unmount.
  // Poll ticks (refreshTick) must NOT abort an in-flight request — doing so causes the
  // request to be cancelled every interval on a slow server, and the throttle timestamp
  // (set at start) then blocks the immediate retry for another full interval.
  useEffect(() => {
    return () => {
      trendAcRef.current?.abort();
      trendAcRef.current = null;
    };
  }, [trendWindow]);

  useEffect(() => {
    if (!messageTrendsEnabled || channelIds.length === 0 || !visible) return;

    // Skip if a request is already in-flight — the stale-data guard (ac.signal.aborted)
    // already prevents out-of-order writes, so no concurrent bulk requests are needed.
    if (trendAcRef.current) return;

    const refreshSecs = loadAdminPrefs().dashboardRefreshInterval ?? 0;
    const now = Date.now();
    // Skip if we fetched recently — avoid a bulk request on every navigation or poll tick.
    // Always fetch on first load (trendLastFetchedAt === 0) or when the interval has elapsed.
    if (
      trendLastFetchedAt > 0 &&
      refreshSecs > 0 &&
      now - trendLastFetchedAt < refreshSecs * 1000
    ) {
      return;
    }

    const ac = new AbortController();
    trendAcRef.current = ac;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrendLoading(true);
    fetchTrendSummaries(channelIds, trendWindow, ac.signal)
      .then((result) => {
        // Guard against stale data: only write results from the current request.
        if (!ac.signal.aborted) {
          trendLastFetchedAt = Date.now(); // set on COMPLETION so an aborted fetch doesn't consume the throttle window
          trendCache = result;
          setTrendSummary(result);
        }
      })
      .catch(() => {
        /* trend data is non-fatal; suppress to avoid masking primary stats */
      })
      .finally(() => {
        if (trendAcRef.current === ac) {
          trendAcRef.current = null;
        }
        // Only clear loading when this request finished normally. If it was aborted by a
        // window change, a replacement fetch is already in progress — clearing loading here
        // would flash the UI back to a non-loading state mid-flight.
        if (!ac.signal.aborted) {
          setTrendLoading(false);
        }
      });
    // No cleanup abort here — the effect above owns abort on window change / unmount.
  }, [refreshTick, messageTrendsEnabled, channelIds, trendWindow, visible]);

  // ── Summary stats ──────────────────────────────────────────────────────
  const totalReceived = useMemo(
    () =>
      statuses.reduce(
        (s, c) =>
          s + stat(statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics, "RECEIVED"),
        0
      ),
    [statuses, statsMode]
  );
  const totalSent = useMemo(
    () =>
      statuses.reduce(
        (s, c) => s + stat(statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics, "SENT"),
        0
      ),
    [statuses, statsMode]
  );
  const totalErrored = useMemo(
    () =>
      statuses.reduce(
        (s, c) => s + stat(statsMode === "lifetime" ? c.lifetimeStatistics : c.statistics, "ERROR"),
        0
      ),
    [statuses, statsMode]
  );
  // Queued is the destination outbound queue depth (DashboardStatus.queued),
  // a current-snapshot value that does not toggle with Current/Lifetime mode.
  const totalQueued = useMemo(() => statuses.reduce((s, c) => s + (c.queued ?? 0), 0), [statuses]);

  const { hrReceived, hrSent, hrErrored, hrQueue } = useMemo(() => {
    const trendValues = [...trendSummary.values()];
    return {
      hrReceived: trendValues.reduce((s, e) => s + e.receivedPerHour, 0),
      hrSent: trendValues.reduce((s, e) => s + e.sentPerHour, 0),
      hrErrored: trendValues.reduce((s, e) => s + e.errPerHour, 0),
      hrQueue: trendValues.reduce((s, e) => s + e.queueDelta, 0),
    };
  }, [trendSummary]);

  return {
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
  };
}
