"use client";

import React, {
  Suspense,
  startTransition,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useSearchParams } from "next/navigation";
import { getUsers, getEventCount } from "@/lib/api-client";
import type { EventFilter } from "@/lib/api-client";
import type { ServerEvent, User } from "@/lib/types";
import { toast } from "sonner";
import {
  buildEventFilter,
  runEventSearch,
  runEventPage,
  pagesForCount,
  clampPageInput,
  type EventFilterState,
  type EventSearchDeps,
} from "./_lib/event-search";
import { useContainerWidth } from "@/lib/hooks/use-container-width";
import {
  type EventCol,
  EVENT_COLS,
  formatEventTime,
  getStoredEventPageSize,
  LOCAL_STORAGE_EVENT_PAGE_SIZE_KEY,
} from "./_lib/event-columns";

import { PageHeader } from "@/components/page-header";
import { ColumnPicker } from "@/components/column-picker";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { SortableHeaderCell } from "@/components/sortable-header-cell";
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
import { DockableToolbar } from "@/components/dockable-toolbar";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useColumnConfig, type ColStateMap } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { useMounted } from "@/lib/hooks/use-mounted";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { useSessionState } from "@/lib/hooks/use-session-state";
import { EventDetailPanel } from "./_components/event-detail-panel";
import { EventFilterBar } from "./_components/event-filter-bar";
import { EventTableRow } from "./_components/event-table-row";
import { formatEventUser } from "./_components/event-user";
import { EventsActionPanel } from "./_components/events-action-panel";
import { ExportEventsDialog } from "./_dialogs/export-events-dialog";
// ─── Page ─────────────────────────────────────────────────────────────────────

function EventsPageInner() {
  const mounted = useMounted();
  const { viewDensity: globalDensity } = useCompactMode();
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const searchParams = useSearchParams();

  // Data state
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<ServerEvent | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Stable row-click handler (toggle selection) so the memoized EventTableRow
  // rows skip re-rendering when unrelated state changes.
  const handleEventRowClick = useCallback((ev: ServerEvent) => {
    setSelectedEvent((prev) => (prev?.id === ev.id ? null : ev));
  }, []);

  // Pagination — page size from a per-user local override, falling back to the
  // global "Event browser page size" Administrator setting.
  const [pageSize, setPageSize] = useState(getStoredEventPageSize);
  const [pageSizeInput, setPageSizeInput] = useState(() => String(getStoredEventPageSize()));
  const [page, setPage] = useState(0);

  // ── Count (lazy, on-demand — mirrors Messages browser) ──
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const totalPages = totalCount !== null ? Math.ceil(totalCount / pageSize) : null;

  // Page-jump input — synced to page (1-based display). Adjusted during render
  // (guarded by previous `page`) so the input reflects the new page in the same commit.
  const [pageInput, setPageInput] = useState("1");
  const [prevPage, setPrevPage] = useState(page);
  if (page !== prevPage) {
    setPrevPage(page);
    setPageInput(String(page + 1));
  }

  // ── Apply page size (mirrors the Messages browser) ──
  const applyPageSize = useCallback(() => {
    const n = Number(pageSizeInput);
    if (n > 0 && n <= 999) {
      // setPageSize triggers the [pageSize] effect, which re-searches from page 0.
      setPageSize(n);
      localStorage.setItem(LOCAL_STORAGE_EVENT_PAGE_SIZE_KEY, String(n));
    } else {
      // Reject invalid input — restore the displayed value to the active size.
      setPageSizeInput(String(pageSize));
    }
  }, [pageSizeInput, pageSize]);

  // Filters
  const [levels, setLevels] = useState<Record<string, boolean>>({
    INFORMATION: false,
    WARNING: false,
    ERROR: false,
  });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // "All Day" mode (default on, mirrors the Messages browser): date inputs are
  // date-only and the range covers whole days (end snapped to 23:59:59.999).
  // Persisted per session so the user's preferred entry mode survives navigation.
  const [allDay, setAllDay] = useSessionState("bl-filter-events-all-day", true);
  // Seed the name filter from the ?name= query param so deep-links (e.g. the Data
  // Pruner "View Events" action) land pre-filtered. useSearchParams is hydration-safe.
  const [nameFilter, setNameFilter] = useState(() => searchParams.get("name") ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [serverFilter, setServerFilter] = useState("");
  const [attrFilter, setAttrFilter] = useState("");

  // Users map
  const [userMap, setUserMap] = useState<Map<number, string>>(new Map());
  const [userList, setUserList] = useState<User[]>([]);

  // Column config
  const { colState, orderedCols, visibleCols, setWidth, setVisible, moveCol, resetToDefaults } =
    useColumnConfig(EVENT_COLS, "bl-events-cols-v2");
  const { sort, toggle: sortToggle, sorted } = useSortable<EventCol>("dateTime", "desc");

  const handleResize = useCallback((key: EventCol, w: number) => setWidth(key, w), [setWidth]);
  const handleToggleCol = useCallback(
    (key: EventCol) => {
      setVisible(key, !(colState[key]?.visible !== false));
    },
    [colState, setVisible]
  );

  useEffect(() => {
    getUsers()
      .then((users: User[]) => {
        const m = new Map<number, string>();
        for (const u of users) m.set(u.id, u.username);
        setUserMap(m);
        setUserList(users);
      })
      .catch(() => {
        toast.error("Failed to load user list — usernames may not display");
      });
  }, []);

  const activeLevels = useMemo(
    () =>
      Object.entries(levels)
        .filter(([, v]) => v)
        .map(([k]) => k),
    [levels]
  );

  // The filter pinned at search start. maxEventId bounds the search session so
  // paging stays stable while new events arrive (mirrors EventBrowser.java and the
  // Messages browser's activeFilterRef). goToPage reuses it instead of rebuilding
  // from live UI state.
  const activeFilterRef = useRef<EventFilter | null>(null);
  // Monotonic token incremented on every fetch. In-flight responses compare against
  // it and bail before writing state — discards stale/out-of-order results so a slow
  // earlier response can't overwrite a newer one.
  const searchSeqRef = useRef(0);

  // Snapshot the current filter UI state for buildEventFilter.
  const filterState = useMemo<EventFilterState>(
    () => ({
      activeLevels,
      startDate,
      endDate,
      allDay,
      nameFilter,
      outcomeFilter,
      userFilter,
      ipFilter,
      serverFilter,
      attrFilter,
    }),
    [
      activeLevels,
      startDate,
      endDate,
      allDay,
      nameFilter,
      outcomeFilter,
      userFilter,
      ipFilter,
      serverFilter,
      attrFilter,
    ]
  );

  // Bundle the refs + state setters the search helpers write through. Rebuilt
  // only when pageSize changes; the refs and useState setters are stable.
  const searchDeps = useMemo<EventSearchDeps>(
    () => ({
      seqRef: searchSeqRef,
      activeFilterRef,
      pageSize,
      setLoading,
      setError,
      setEvents,
      setHasNextPage,
      setPage,
      setSelectedEvent,
    }),
    [pageSize]
  );

  // Explicit/new-session search: pin a fresh maxEventId + filter, then fetch.
  // Reset the total count — user must re-click Count for the new filter session.
  // `override` lets callers (e.g. clearFilters) search a known filter without
  // waiting for not-yet-applied state.
  const search = useCallback(
    (pageNum = 0, override?: EventFilter) => {
      setTotalCount(null);
      return runEventSearch(override ?? buildEventFilter(filterState), pageNum, searchDeps);
    },
    [filterState, searchDeps]
  );

  // Pagination reuses the pinned session: same maxEventId, no count refetch.
  const goToPage = useCallback(
    (pageNum: number) => runEventPage(pageNum, searchDeps),
    [searchDeps]
  );

  // Lazy count against the pinned session filter (same maxEventId, same bounds).
  // Returns the fetched count (or null on failure / no active session) so callers
  // can clamp synchronously instead of waiting on the totalCount state update.
  const fetchCount = useCallback(async (): Promise<number | null> => {
    if (!activeFilterRef.current) return null;
    setCountLoading(true);
    try {
      const c = await getEventCount(activeFilterRef.current);
      setTotalCount(c);
      return c;
    } catch {
      setTotalCount(null);
      return null;
    } finally {
      setCountLoading(false);
    }
  }, []);

  // Count button: fetch the total, then re-normalize if the current page now sits
  // past the last page (e.g. count fetched while on a stale out-of-bounds page).
  const handleCount = useCallback(async () => {
    const c = await fetchCount();
    if (c !== null) {
      const pages = pagesForCount(c, pageSize);
      if (page > pages - 1) goToPage(pages - 1);
    }
  }, [fetchCount, page, pageSize, goToPage]);

  // Jump to a typed page number; clamps to [1, totalPages]. When the count isn't
  // known yet, fetch it first so an out-of-range page never triggers a search
  //. countLoading guards the Enter-then-blur double fire.
  async function applyPageJump() {
    if (countLoading) return;
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) {
      setPageInput(String(page + 1));
      return;
    }
    let pages = totalPages;
    if (pages === null) {
      const c = await fetchCount();
      pages = c !== null ? pagesForCount(c, pageSize) : null;
    }
    const clamped = clampPageInput(n, pages);
    setPageInput(String(clamped));
    if (clamped - 1 !== page) goToPage(clamped - 1);
  }

  // Search on mount and when page size changes — never on filter typing.
  useEffect(() => {
    startTransition(() => {
      search(0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  const sortedEvents = useMemo(
    () =>
      sorted(events, (ev) => {
        switch (sort.key) {
          case "level":
            return ev.level ?? "";
          case "dateTime": {
            // Sort on eventTime only — never the audit-insertion `dateTime`,
            // matching Java (EventBrowser sorts/displays on getEventTime()).
            const t = ev.eventTime;
            return t ? new Date(t).getTime() : 0;
          }
          case "name":
            return ev.name ?? "";
          case "serverId":
            return ev.serverId ?? "";
          case "user":
            // Sort on the displayed "id (name)" string so order matches the cell.
            return formatEventUser(ev.userId, userMap);
          case "outcome":
            return ev.outcome ?? "";
          case "ipAddress":
            return ev.ipAddress ?? "";
          case "channelName":
            return ev.channelName ?? "";
          case "channelMessageId":
            return ev.channelId ?? "";
          default:
            return "";
        }
      }),
    [events, sort, sorted, userMap]
  );

  // ── Table sizing ────────────────────────────────────────────────────────────
  const totalTableWidth = visibleCols.reduce(
    (sum, c) => sum + (colState[c.key]?.width ?? c.defaultWidth),
    0
  );
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(tableContainerRef);

  const nameColWidth =
    colState["name"]?.width ?? EVENT_COLS.find((c) => c.key === "name")!.defaultWidth;
  const surplus = Math.max(0, containerWidth - totalTableWidth);
  const effectiveColWidths = useMemo<Record<EventCol, number>>(() => {
    const widths = {} as Record<EventCol, number>;
    for (const c of visibleCols) {
      widths[c.key] =
        c.key === "name" ? nameColWidth + surplus : (colState[c.key]?.width ?? c.defaultWidth);
    }
    return widths;
  }, [visibleCols, colState, nameColWidth, surplus]);
  const tableWidth = surplus > 0 ? totalTableWidth + surplus : totalTableWidth;

  const hasActiveFilters =
    activeLevels.length > 0 ||
    startDate ||
    endDate ||
    nameFilter ||
    outcomeFilter ||
    userFilter ||
    ipFilter ||
    serverFilter ||
    attrFilter;

  function clearFilters() {
    setLevels({ INFORMATION: false, WARNING: false, ERROR: false });
    setStartDate("");
    setEndDate("");
    setNameFilter("");
    setOutcomeFilter("");
    setUserFilter("");
    setIpFilter("");
    setServerFilter("");
    setAttrFilter("");
    // Search an empty session now; the override avoids reading not-yet-applied state.
    search(0, {});
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Events"
        actions={
          <div className="flex items-center gap-2">
            <ColumnPicker
              cols={orderedCols}
              colState={colState}
              onToggle={handleToggleCol}
              onReset={resetToDefaults}
              onMove={moveCol}
            />
            <Button variant="outline" size="sm" onClick={() => search(0)} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {toolbarPos === "top" && (
        <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
          <EventsActionPanel position={toolbarPos} onExportAll={() => setExportOpen(true)} />
        </DockableToolbar>
      )}

      {/* Filter bar */}
      <EventFilterBar
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        allDay={allDay}
        onAllDayChange={setAllDay}
        nameFilter={nameFilter}
        onNameFilterChange={setNameFilter}
        levels={levels}
        onLevelsChange={setLevels}
        showAdvanced={showAdvanced}
        onToggleAdvanced={() => setShowAdvanced((v) => !v)}
        outcomeFilter={outcomeFilter}
        onOutcomeFilterChange={setOutcomeFilter}
        userFilter={userFilter}
        onUserFilterChange={setUserFilter}
        ipFilter={ipFilter}
        onIpFilterChange={setIpFilter}
        serverFilter={serverFilter}
        onServerFilterChange={setServerFilter}
        attrFilter={attrFilter}
        onAttrFilterChange={setAttrFilter}
        userList={userList}
        hasActiveFilters={!!hasActiveFilters}
        onClearFilters={clearFilters}
        onSearch={() => search(0)}
        loading={loading}
        page={page}
        pageSize={pageSize}
        resultCount={events.length}
        hasNextPage={hasNextPage}
        onPageChange={goToPage}
        pageSizeInput={pageSizeInput}
        onPageSizeInputChange={setPageSizeInput}
        onApplyPageSize={applyPageSize}
        totalCount={totalCount}
        totalPages={totalPages}
        countLoading={countLoading}
        onCount={handleCount}
        pageInput={pageInput}
        onPageInputChange={setPageInput}
        onApplyPageJump={applyPageJump}
      />

      <ApiErrorAlert error={error} />

      {/* Toolbar + split layout: table + detail panel */}
      <div className={`flex flex-1 min-h-0 ${toolbarPos === "bottom" ? "flex-col" : "flex-row"}`}>
        {toolbarPos === "left" && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <EventsActionPanel position={toolbarPos} onExportAll={() => setExportOpen(true)} />
          </DockableToolbar>
        )}

        <div className="flex flex-1 overflow-hidden">
          <div
            className={`flex flex-col overflow-hidden ${selectedEvent ? "w-1/2" : "flex-1"} transition-all`}
          >
            <div className={`flex-1 overflow-auto ${pagePadding(globalDensity)}`}>
              <TableContainer ref={tableContainerRef} style={{ width: "100%", overflowX: "auto" }}>
                <Table style={{ width: tableWidth, minWidth: totalTableWidth }}>
                  <TableColGroup
                    cols={visibleCols}
                    colState={
                      Object.fromEntries(
                        visibleCols.map((c) => [
                          c.key,
                          { width: effectiveColWidths[c.key], visible: true },
                        ])
                      ) as ColStateMap<EventCol>
                    }
                  />
                  <TableHead>
                    <TableHeadRow>
                      {visibleCols.map((col) => (
                        <SortableHeaderCell
                          key={col.key}
                          col={col.key}
                          colDef={col}
                          width={effectiveColWidths[col.key]}
                          current={sort.key}
                          dir={sort.dir}
                          onSort={sortToggle}
                          onResize={handleResize}
                        />
                      ))}
                    </TableHeadRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      <TableLoading colSpan={visibleCols.length} />
                    ) : events.length === 0 && !error ? (
                      <TableEmpty colSpan={visibleCols.length}>No events found.</TableEmpty>
                    ) : (
                      sortedEvents.map((ev) => (
                        <EventTableRow
                          key={ev.id}
                          ev={ev}
                          visibleCols={visibleCols}
                          userMap={userMap}
                          mounted={mounted}
                          selected={selectedEvent?.id === ev.id}
                          onClick={handleEventRowClick}
                          onOpenDetail={setSelectedEvent}
                          density={globalDensity}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
          </div>

          {selectedEvent && (
            <EventDetailPanel
              event={selectedEvent}
              userMap={userMap}
              formatEventTime={formatEventTime}
              onClose={() => setSelectedEvent(null)}
            />
          )}
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <EventsActionPanel position={toolbarPos} onExportAll={() => setExportOpen(true)} />
          </DockableToolbar>
        )}
      </div>

      <ExportEventsDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

export default function EventsPage() {
  // useSearchParams requires a Suspense boundary to keep the route from opting
  // the whole tree into client-side rendering at build time.
  return (
    <Suspense fallback={null}>
      <EventsPageInner />
    </Suspense>
  );
}
