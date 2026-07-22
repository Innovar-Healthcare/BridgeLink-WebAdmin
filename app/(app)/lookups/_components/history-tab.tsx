"use client";

import { useState, useEffect, useCallback, startTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
} from "lucide-react";
import { searchLookupGroupAudit } from "@/lib/api-client";
import type { LookupGroup, LookupAuditEntry } from "@/lib/api-client";
import { getUsers } from "@/lib/api/api-users";
import type { User } from "@/lib/types";
import { format } from "date-fns";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "yyyy-MM-dd hh:mm a");
  } catch {
    return iso;
  }
}

function truncate(s: string | null | undefined, max = 60): string {
  if (!s) return "—";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

const ACTION_OPTIONS = [
  { value: "", label: "All Actions" },
  { value: "CREATE", label: "CREATE" },
  { value: "UPDATE", label: "UPDATE" },
  { value: "DELETE", label: "DELETE" },
  { value: "DELETE_ALL", label: "DELETE_ALL" },
  { value: "IMPORT", label: "IMPORT" },
  { value: "CLEAR_ALL", label: "CLEAR_ALL" },
];

const ACTION_BADGE: Record<string, string> = {
  CREATE: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  UPDATE: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  DELETE: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  DELETE_ALL: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  IMPORT: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
  CLEAR_ALL: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200, 500, 1000] as const;
const DEFAULT_PAGE_SIZE = 25;

// User-id sentinels matching the Java client's HistoryPanel user dropdown.
const ALL_USERS = ""; // no userId filter
const SYSTEM_USER_ID = "0";

// ─── Column infrastructure ───────────────────────────────────────────────────

type HistCol = "key" | "action" | "oldValue" | "newValue" | "user" | "timestamp";

const HIST_COLS: ColDef<HistCol>[] = [
  {
    key: "key",
    label: "Key",
    defaultWidth: 200,
    minWidth: 80,
    defaultVisible: true,
    canHide: false,
  },
  {
    key: "action",
    label: "Action",
    defaultWidth: 100,
    minWidth: 60,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "oldValue",
    label: "Old Value",
    defaultWidth: 250,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "newValue",
    label: "New Value",
    defaultWidth: 250,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "user",
    label: "User",
    defaultWidth: 120,
    minWidth: 60,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "timestamp",
    label: "Timestamp",
    defaultWidth: 170,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
];

// ─── History Tab ──────────────────────────────────────────────────────────────

interface HistoryTabProps {
  group: LookupGroup;
}

interface ActiveFilters {
  keyFilter: string;
  actionFilter: string;
  userId: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FILTERS: ActiveFilters = {
  keyFilter: "",
  actionFilter: "",
  userId: ALL_USERS,
  startDate: "",
  endDate: "",
};

export function HistoryTab({ group }: HistoryTabProps) {
  const [entries, setEntries] = useState<LookupAuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colConfig = useColumnConfig(HIST_COLS, "bl-lookups-history-cols-v1");
  const sortState = useSortable<HistCol>("timestamp", "desc");
  const { viewDensity } = useCompactMode();

  // User filter options. Mirrors HistoryPanel.updateCachedUserMap:
  // "All Users" → no filter, "System" (id 0), then each user by username.
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    getUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  // Form fields (uncommitted)
  const [keyFilter, setKeyFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [userId, setUserId] = useState(ALL_USERS);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Committed / active filters
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(EMPTY_FILTERS);

  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const [pageInput, setPageInput] = useState("1");
  // Keep the page input box in sync with the committed page (adjust during render).
  const [prevPage, setPrevPage] = useState(page);
  if (page !== prevPage) {
    setPrevPage(page);
    setPageInput(String(page + 1));
  }

  const runSearch = useCallback(
    async (filters: ActiveFilters, pageNum: number, size: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await searchLookupGroupAudit(group.id, {
          offset: pageNum * size,
          limit: size,
          keyValue: filters.keyFilter || undefined,
          action: filters.actionFilter || undefined,
          userId: filters.userId || undefined,
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
        });
        setEntries(res.entries ?? []);
        setTotalCount(res.totalEntries ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [group.id]
  );

  // Auto-load on group change: reset form/filter state and fetch the first page.
  useEffect(() => {
    startTransition(() => {
      setPage(0);
      setKeyFilter("");
      setActionFilter("");
      setUserId(ALL_USERS);
      setStartDate("");
      setEndDate("");
      setActiveFilters(EMPTY_FILTERS);
      runSearch(EMPTY_FILTERS, 0, pageSize);
    });
  }, [group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch() {
    const filters: ActiveFilters = { keyFilter, actionFilter, userId, startDate, endDate };
    setActiveFilters(filters);
    setPage(0);
    runSearch(filters, 0, pageSize);
  }

  function handleClear() {
    setKeyFilter("");
    setActionFilter("");
    setUserId(ALL_USERS);
    setStartDate("");
    setEndDate("");
    setActiveFilters(EMPTY_FILTERS);
    setPage(0);
    runSearch(EMPTY_FILTERS, 0, pageSize);
  }

  function goToPage(n: number) {
    const clamped = Math.max(0, Math.min(n, totalPages - 1));
    setPage(clamped);
    runSearch(activeFilters, clamped, pageSize);
  }

  function handlePageSizeChange(newSize: number) {
    setPageSize(newSize);
    setPage(0);
    runSearch(activeFilters, 0, newSize);
  }

  function applyPageJump() {
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) {
      setPageInput(String(page + 1));
      return;
    }
    const clamped = Math.max(1, Math.min(n, totalPages));
    setPageInput(String(clamped));
    goToPage(clamped - 1);
  }

  const hasNextPage = (page + 1) * pageSize < totalCount;
  const selectH = densityHeight(viewDensity);
  const selectCls = `${selectH} rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`;

  const sortedEntries = sortState.sorted(entries, (e) => {
    switch (sortState.sort.key) {
      case "key":
        return e.keyValue;
      case "action":
        return e.action;
      case "oldValue":
        return e.oldValue ?? "";
      case "newValue":
        return e.newValue ?? "";
      case "user":
        return e.userName ?? "";
      case "timestamp":
        return e.timestamp;
      default:
        return undefined;
    }
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div
        className={`px-4 ${viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5"} border-b border-border flex items-center gap-2 shrink-0 flex-wrap`}
      >
        <Input
          type="date"
          density={viewDensity}
          className="text-sm w-36"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          title="Start date"
        />
        <Input
          type="date"
          density={viewDensity}
          className="text-sm w-36"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          title="End date"
        />
        <Input
          density={viewDensity}
          className="text-sm w-40"
          placeholder="Key filter…"
          value={keyFilter}
          onChange={(e) => setKeyFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <select
          className={selectCls}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          {ACTION_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          title="Filter by user"
        >
          <option value={ALL_USERS}>All Users</option>
          <option value={SYSTEM_USER_ID}>System</option>
          {users.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.username}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={handleSearch} disabled={loading}>
          <Search className="w-3.5 h-3.5 mr-1.5" />
          Search
        </Button>
        <Button size="sm" variant="outline" onClick={handleClear} disabled={loading}>
          <X className="w-3.5 h-3.5 mr-1.5" />
          Clear
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <DataTable<LookupAuditEntry, HistCol>
        variant="sortable"
        cols={HIST_COLS}
        rows={sortedEntries}
        colConfig={colConfig}
        sortState={sortState}
        rowKey={(e) => e.id}
        loading={loading && entries.length === 0}
        empty="No audit entries found."
        containerClassName="flex-1 min-h-0"
        cellMono={{ key: true, oldValue: true, newValue: true }}
        renderCell={(entry, col) => {
          switch (col) {
            case "key":
              return <span title={entry.keyValue}>{entry.keyValue}</span>;
            case "action":
              return (
                <span
                  className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium ${ACTION_BADGE[entry.action] ?? "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                >
                  {entry.action}
                </span>
              );
            case "oldValue":
              return <span title={entry.oldValue ?? ""}>{truncate(entry.oldValue)}</span>;
            case "newValue":
              return <span title={entry.newValue ?? ""}>{truncate(entry.newValue)}</span>;
            case "user":
              return entry.userName || "—";
            case "timestamp":
              return fmtDate(entry.timestamp);
          }
        }}
      />

      {/* Pagination bar */}
      <div
        className={`px-4 ${viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5"} border-t border-border bg-white dark:bg-gray-900 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 shrink-0`}
      >
        <div className="flex items-center gap-2">
          <span>Page size:</span>
          <select
            className={selectCls}
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            disabled={loading}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>
            {entries.length > 0
              ? `Results ${page * pageSize + 1}–${page * pageSize + entries.length} of ${totalCount.toLocaleString()}`
              : loading
                ? ""
                : "No results"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(0)}
            disabled={page === 0 || loading}
            title="First page"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(page - 1)}
            disabled={page === 0 || loading}
            title="Previous page"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="flex items-center gap-1">
            <span className="text-xs">Page</span>
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={applyPageJump}
              onKeyDown={(e) => e.key === "Enter" && applyPageJump()}
              density={viewDensity}
              className="h-6 w-12 text-xs text-center px-1"
              disabled={loading}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">of {totalPages}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(page + 1)}
            disabled={!hasNextPage || loading}
            title="Next page"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(totalPages - 1)}
            disabled={!hasNextPage || loading || page === totalPages - 1}
            title="Last page"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
