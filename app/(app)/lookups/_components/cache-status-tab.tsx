"use client";

import { useState, useEffect, useCallback, startTransition, type MutableRefObject } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Loader2, AlertCircle } from "lucide-react";
import type { CacheTabActions } from "./lookups-action-panel";
import {
  getLookupGroupStatistics,
  resetLookupGroupStatistics,
  clearLookupGroupCache,
} from "@/lib/api-client";
import type { LookupGroup, GroupStatisticsResponse } from "@/lib/api-client";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "yyyy-MM-dd hh:mm a");
  } catch {
    return iso;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium align-top text-sm border-b border-border">
        {label}
      </dt>
      <dd className="py-2 text-gray-900 dark:text-gray-100 text-sm border-b border-border">
        {value}
      </dd>
    </>
  );
}

const STAT_LIST_CLS =
  "grid grid-cols-[11rem_1fr] [&>dt:nth-last-of-type(1)]:border-0 [&>dd:nth-last-of-type(1)]:border-0";

// ─── Chart colors ─────────────────────────────────────────────────────────────

const COLORS = {
  hits: "#22c55e",
  misses: "#ef4444",
  current: "#3b82f6",
  max: "#94a3b8",
};

const PIE_COLORS = [COLORS.hits, COLORS.misses];

// ─── Cache Status Tab ─────────────────────────────────────────────────────────

interface CacheStatusTabProps {
  group: LookupGroup;
  actionsRef?: MutableRefObject<CacheTabActions>;
  onActionsChanged?: () => void;
}

export function CacheStatusTab({ group, actionsRef, onActionsChanged }: CacheStatusTabProps) {
  const [stats, setStats] = useState<GroupStatisticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pendingResetStats, setPendingResetStats] = useState(false);
  const [pendingClearCache, setPendingClearCache] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionMsg(null);
    try {
      const data = await getLookupGroupStatistics(group.id);
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  function handleResetStats() {
    setPendingResetStats(true);
  }

  async function executeResetStats() {
    setError(null);
    setActionMsg(null);
    try {
      await resetLookupGroupStatistics(group.id);
      setActionMsg("Statistics reset successfully.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleClearCache() {
    setPendingClearCache(true);
  }

  async function executeClearCache() {
    setError(null);
    setActionMsg(null);
    try {
      await clearLookupGroupCache(group.id);
      setActionMsg("Cache cleared successfully.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Expose toolbar actions to parent
  const cacheEnabled =
    stats?.cacheStatistics != null && stats.cacheStatistics.configuredMaxEntries > 0;

  // Keep the imperative actions handle current. Written in a deps-less effect (not
  // during render) to satisfy react-hooks/refs. Placed after all referenced handlers
  // are declared so react-hooks/immutability doesn't flag use-before-declaration, and
  // before the onActionsChanged effect so the ref is fresh when the parent snapshots it.
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        resetStats: handleResetStats,
        clearCache: handleClearCache,
        cacheEnabled,
      };
    }
  });

  // Notify parent only when cacheEnabled changes so it can re-render the toolbar button state
  useEffect(() => {
    onActionsChanged?.();
  }, [cacheEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived chart data
  const cacheHits = stats?.cacheHits ?? 0;
  const totalLookups = stats?.totalLookups ?? 0;
  const cacheMisses = totalLookups - cacheHits;

  const lookupsData = [
    { name: "Cache Hits", value: cacheHits, fill: COLORS.hits },
    { name: "Misses", value: cacheMisses, fill: COLORS.misses },
  ];

  const entryData = cacheEnabled
    ? [
        {
          name: "Current Entries",
          value: stats!.cacheStatistics!.currentEntryCount,
          fill: COLORS.current,
        },
        {
          name: "Configured Max",
          value: stats!.cacheStatistics!.configuredMaxEntries,
          fill: COLORS.max,
        },
      ]
    : [];

  const cacheHitCount = stats?.cacheStatistics?.hitCount ?? 0;
  const cacheMissCount = stats?.cacheStatistics?.missCount ?? 0;
  const hasCacheHitMiss = cacheHitCount > 0 || cacheMissCount > 0;
  const pieData = [
    { name: "Hits", value: cacheHitCount },
    { name: "Misses", value: cacheMissCount },
  ];
  // Percentages shown in the legend rather than as external pie labels — external
  // labels overflow and clip on the left/right edge of the narrow chart column
  // (see. Derive misses from hits so the two always sum to 100%.
  const pieTotal = cacheHitCount + cacheMissCount;
  const hitsPct = pieTotal > 0 ? Math.round((cacheHitCount / pieTotal) * 100) : 0;
  const piePct: Record<string, number> = {
    Hits: hitsPct,
    Misses: pieTotal > 0 ? 100 - hitsPct : 0,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Feedback messages */}
      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {actionMsg && (
        <div className="mx-4 mt-3 rounded-md bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 px-3 py-2 text-sm text-green-700 dark:text-green-400 shrink-0">
          {actionMsg}
        </div>
      )}

      {/* Content */}
      {loading && !stats ? (
        <div className="flex items-center justify-center p-8 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading…
        </div>
      ) : stats ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="max-w-5xl space-y-6">
            {/* Row 1: Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* DB Statistics */}
              <div className="bg-white dark:bg-gray-800/60 border border-border rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
                  DB Statistics
                </h3>
                <dl className={STAT_LIST_CLS}>
                  <StatRow label="Group ID" value={stats.groupId} />
                  <StatRow
                    label="Total Lookups"
                    value={stats.totalLookups?.toLocaleString() ?? "—"}
                  />
                  <StatRow label="Cache Hits" value={stats.cacheHits?.toLocaleString() ?? "—"} />
                  <StatRow
                    label="Hit Rate"
                    value={totalLookups > 0 ? pct(cacheHits / totalLookups) : "—"}
                  />
                  <StatRow label="Last Accessed" value={fmtDate(stats.lastAccessed)} />
                  <StatRow label="Statistics Reset" value={fmtDate(stats.resetDate)} />
                </dl>
              </div>

              {/* Cache Performance */}
              <div className="bg-white dark:bg-gray-800/60 border border-border rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
                  Cache Performance
                </h3>
                {!stats.cacheStatistics || !cacheEnabled ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                    {group.cacheSize === 0
                      ? "Caching is disabled for this group (Cache Size = 0)."
                      : "No cache data available."}
                  </p>
                ) : !stats.cacheStatistics.statsSupported ? (
                  <div>
                    <dl className={`${STAT_LIST_CLS} mb-3`}>
                      <StatRow
                        label="Eviction Policy"
                        value={stats.cacheStatistics.evictionPolicy}
                      />
                      <StatRow
                        label="Entry Count"
                        value={`${stats.cacheStatistics.currentEntryCount.toLocaleString()} / ${stats.cacheStatistics.configuredMaxEntries.toLocaleString()}`}
                      />
                    </dl>
                    <p className="text-sm text-gray-400 dark:text-gray-500 italic">
                      Cache statistics are not supported for this eviction policy.
                    </p>
                  </div>
                ) : (
                  <dl className={STAT_LIST_CLS}>
                    <StatRow label="Eviction Policy" value={stats.cacheStatistics.evictionPolicy} />
                    <StatRow
                      label="Entry Count"
                      value={`${stats.cacheStatistics.currentEntryCount.toLocaleString()} / ${stats.cacheStatistics.configuredMaxEntries.toLocaleString()}`}
                    />
                    <StatRow
                      label="Hit Count"
                      value={stats.cacheStatistics.hitCount.toLocaleString()}
                    />
                    <StatRow
                      label="Miss Count"
                      value={stats.cacheStatistics.missCount.toLocaleString()}
                    />
                    <StatRow
                      label="Eviction Count"
                      value={stats.cacheStatistics.evictionCount.toLocaleString()}
                    />
                    <StatRow label="Hit Ratio" value={pct(stats.cacheStatistics.hitRatio)} />
                    <StatRow label="Miss Ratio" value={pct(stats.cacheStatistics.missRatio)} />
                    <StatRow
                      label="Total Load Time"
                      value={stats.cacheStatistics.totalLoadTimeFormatted}
                    />
                  </dl>
                )}
              </div>
            </div>

            {/* Row 2: Charts */}
            {totalLookups > 0 && (
              <div className="bg-white dark:bg-gray-800/60 border border-border rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">
                  Visualizations
                </h3>
                <div
                  className={`grid gap-6 ${cacheEnabled ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1 max-w-md"}`}
                >
                  {/* Lookups Breakdown */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 text-center">
                      Group Lookups Breakdown
                    </p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={lookupsData}
                        margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} width={40} allowDecimals={false} />
                        <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                          {lookupsData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Cache Entry Count */}
                  {cacheEnabled && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 text-center">
                        Cache Entry Count
                      </p>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart
                          data={entryData}
                          margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} width={50} allowDecimals={false} />
                          <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                          <Bar dataKey="value" name="Entries" radius={[4, 4, 0, 0]}>
                            {entryData.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Hit/Miss Pie Chart */}
                  {cacheEnabled && stats.cacheStatistics?.statsSupported && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 text-center">
                        Hit vs Miss Distribution
                      </p>
                      {hasCacheHitMiss ? (
                        <ResponsiveContainer width="100%" height={240}>
                          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={48}
                              outerRadius={72}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {pieData.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i]} />
                              ))}
                            </Pie>
                            <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                            <Legend
                              iconSize={10}
                              wrapperStyle={{ fontSize: 11 }}
                              formatter={(value: string) => `${value} ${piePct[value] ?? 0}%`}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[240px] text-xs text-gray-400 dark:text-gray-500 italic">
                          Hit/Miss data will appear after cache lookups occur.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {pendingResetStats && (
        <ConfirmDialog
          title="Reset Statistics"
          description="Reset statistics for this group? This cannot be undone."
          confirmLabel="Reset"
          onConfirm={() => {
            setPendingResetStats(false);
            void executeResetStats();
          }}
          onCancel={() => setPendingResetStats(false)}
        />
      )}

      {pendingClearCache && (
        <ConfirmDialog
          title="Clear Cache"
          description="Clear the in-memory cache for this group?"
          confirmLabel="Clear"
          onConfirm={() => {
            setPendingClearCache(false);
            void executeClearCache();
          }}
          onCancel={() => setPendingClearCache(false)}
        />
      )}
    </div>
  );
}
