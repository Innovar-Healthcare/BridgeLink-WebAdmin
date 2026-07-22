"use client";

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  Suspense,
  startTransition,
} from "react";
import { useSplitResize } from "@/lib/hooks/use-split-resize";
import { useSessionState } from "@/lib/hooks/use-session-state";
import { userScopedKey } from "@/lib/auth";
import { getCache, updateDashboard } from "@/lib/cache-store";
import { useCacheSelector } from "@/lib/hooks/use-cache";
import { getDashboardStatuses } from "@/lib/api/api-dashboard";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  getChannelIdsAndNames,
  getConnectorNames,
  getMetaDataColumns,
  searchMessageCount,
  toXStreamCalendar,
} from "@/lib/api-client";
import type { SendMessageInitialData } from "@/components/messages/send-message-dialog";
import type { MessageFilter } from "@/lib/api-client";
import type { ConnectorMessage, Message } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { startOfDay, endOfDay } from "date-fns";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import type { ColDef } from "@/lib/hooks/use-column-config";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { buildAdvancedFilterFromUrl } from "./_lib/message-helpers";
import { selectConnector } from "./_lib/message-selection";
import { runMessageSearch, runMessagePage, type MessageSearchDeps } from "./_lib/message-search";
import {
  useMessageActions,
  type ConfirmDialogState,
  type RemoveAllTarget,
} from "./_lib/use-message-actions";
import {
  useUrlFilterParams,
  hasSensitiveUrlParams,
  stripSensitiveUrlParams,
} from "./_lib/use-url-filter-params";
import {
  LOCAL_STORAGE_PAGE_SIZE_KEY,
  LOCAL_STORAGE_VIEWER_LAYOUT_KEY,
  getStoredPageSize,
  getStoredViewerLayout,
  META_COL_PREFIX,
  STATIC_MSG_COLS,
  hasAdvancedCriteria,
} from "./_lib/message-columns";
import { saveAdminPref, loadAdminPrefs } from "@/components/settings/admin-tab";
import type { MsgCol } from "./_lib/message-columns";
import {
  applyAdvancedFilter,
  emptyAdvancedFilter,
  hasMetaDataSearchErrors,
  reconcileConnectorSelection,
  DELETED_CONNECTORS_METADATA_ID,
  DELETED_CONNECTORS_LABEL,
} from "@/components/messages/advanced-filter-panel";
import type {
  AdvancedFilterState,
  ConnectorInfo,
  MetaDataColumnInfo,
} from "@/components/messages/advanced-filter-panel";
import { ContentViewer } from "@/components/messages/content-viewer";
import { toast } from "sonner";
import type { ContentViewerLayout } from "@/components/messages/content-viewer";
import { CurrentSearchSummary } from "./_components/current-search-summary";
import { MessageFilterBar } from "./_components/message-filter-bar";
import { MessageTable } from "./_components/message-table";
import { MessagesPageDialogs } from "./_components/messages-page-dialogs";
import { MessagesActionPanel } from "./_components/messages-action-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";

function MessagesPageInner() {
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const { viewDensity: globalDensity } = useCompactMode();

  // ── Channel pre-selection from URL param (?channelId=<uuid>) ──
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialChannelId = searchParams.get("channelId") ?? "";
  const initialMetaDataId = searchParams.get("metaDataId");

  // ── Advanced filter pre-population from URL params ──
  const { params: urlFilterParams, hasAny: hasUrlFilterParams } = useUrlFilterParams();

  // ── Channel list ──
  const [channels, setChannels] = useState<Map<string, string>>(new Map());
  // URL param takes priority; fall back to session-persisted channel, then first in list.
  const [selectedChannelId, setSelectedChannelId] = useState(() => {
    if (initialChannelId) return initialChannelId;
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(userScopedKey("bl-filter-messages-channel"));
      if (saved) return saved;
    }
    return "";
  });
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");

  // Channel's authoritative connector roster for the advanced-filter checkboxes + reprocess/send
  // fallbacks — fetched from GET /channels/{id}/connectorNames on channel load, with the
  // synthetic "Deleted Connectors" pseudo-entry appended (mirrors Java MessageBrowser.loadChannel).
  const [connectorInfos, setConnectorInfos] = useState<ConnectorInfo[]>([]);
  // The channel whose connector roster is currently loaded into connectorInfos. The channel-open
  // auto-search waits until this equals selectedChannelId so the connector include/exclude split is
  // computed against the real roster — never an empty/stale one that would silently drop the filter
  // (which also feeds Remove/Reprocess Results). Comparing ids (not a boolean) avoids an
  // effect-ordering race on channel switch. Empty string = not loaded / no channel.
  const [connectorsChannel, setConnectorsChannel] = useState("");
  const [metaDataColumns, setMetaDataColumns] = useState<MetaDataColumnInfo[]>([]);
  // True once getMetaDataColumns has resolved or rejected for the selected channel.
  // Manual Search is disabled until this is true so isCURESPHILoggingOn is final
  // before we decide whether to run the PHI query audit (Finding 5,.
  const [metaColumnsReady, setMetaColumnsReady] = useState(false);

  // ── CURES PHI audit — auto-detect from metadata columns (Java MessageBrowser:352-358) ──
  const isCURESPHILoggingOn = useMemo(
    () => metaDataColumns.some((col) => col.name.toLowerCase() === "patient_id"),
    [metaDataColumns]
  );

  // ── Column infrastructure ──
  // Combine static columns with dynamic metadata columns for the current channel
  // ── Sorted and filtered channel list for combobox ──
  const sortedFilteredChannels = useMemo(() => {
    const sorted = Array.from(channels.entries()).sort(([, a], [, b]) => a.localeCompare(b));
    if (!channelSearch.trim()) return sorted;
    const lower = channelSearch.toLowerCase();
    return sorted.filter(([, name]) => name.toLowerCase().includes(lower));
  }, [channels, channelSearch]);

  const allMsgCols = useMemo<ColDef<MsgCol>[]>(() => {
    if (metaDataColumns.length === 0) return STATIC_MSG_COLS;
    const metaCols: ColDef<MsgCol>[] = metaDataColumns.map((mc) => ({
      key: `${META_COL_PREFIX}${mc.name}`,
      label: mc.name,
      defaultWidth: 120,
      minWidth: 60,
      defaultVisible: true,
      canHide: true,
      // NUMBER columns right-align (mirrors MessageBrowserTableColumnFactory#configureCustomColumn).
      align: mc.type === "NUMBER" ? ("right" as const) : undefined,
    }));
    return [...STATIC_MSG_COLS, ...metaCols];
  }, [metaDataColumns]);

  // Metadata column type by full column key ("meta:<name>"), for type-aware cell rendering.
  const metaColTypes = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const mc of metaDataColumns) map[`${META_COL_PREFIX}${mc.name}`] = mc.type;
    return map;
  }, [metaDataColumns]);

  const { colState, orderedCols, visibleCols, setWidth, setVisible, moveCol, resetToDefaults } =
    useColumnConfig(allMsgCols, "bl-messages-cols-v1");

  // ── Reprocess destinations ──
  // Mirrors Java: DashboardPanel.getDestinationConnectorNames reads all channel destinations
  // from the dashboard status tree (childStatuses), not from the message being reprocessed.
  // This ensures destinations are shown even when a message failed at the source and never
  // reached any destination connectors.
  const reprocessDestinations = useMemo<ConnectorInfo[]>(() => {
    const { dashboardStatuses, channelMap } = getCache();
    const channelStatus = dashboardStatuses.find((s) => s.channelId === selectedChannelId);
    if (channelStatus?.childStatuses?.length) {
      const fromDashboard = channelStatus.childStatuses
        .filter((c) => c.statusType === "DESTINATION_CONNECTOR" && (c.metaDataId ?? 0) > 0)
        .map((c) => ({ metaDataId: c.metaDataId!, name: c.name }));
      if (fromDashboard.length > 0) return fromDashboard;
    }
    // Next-best authoritative source: the cached channel's saved destination connectors. Used
    // when the dashboard isn't loaded yet, so "select all → null" collapses against the true
    // destination set rather than only the destinations present on the current result page.
    const fromChannel = channelMap.get(selectedChannelId)?.destinationConnectors;
    if (fromChannel?.length) {
      return fromChannel
        .filter((d) => d.metaDataId > 0)
        .map((d) => ({ metaDataId: d.metaDataId, name: d.name }));
    }
    // Last resort: the channel's connectorNames roster (authoritative — the "Deleted Connectors"
    // sentinel at metaDataId -1 and the source at 0 are excluded by the metaDataId > 0 filter).
    return connectorInfos.filter((c) => c.metaDataId > 0);
  }, [selectedChannelId, connectorInfos]);

  // ── Deployed state ──
  // Mirrors Java MessageBrowser.isChannelDeployed: a channel is deployed iff it appears in the
  // dashboard statuses (GET /channels/statuses returns only deployed channels). Read reactively so
  // the toolbar re-enables once the lazy load below populates statuses. Java gates Send (task 1)
  // and Reprocess Results/Msg (tasks 7-8) on this; we additionally gate the WebUI-only Resend Msg
  // since it re-sends content to the channel like Send. See MessageBrowser.java:411-414,1934-1937.
  const dashboardStatuses = useCacheSelector((s) => s.dashboardStatuses);
  const selectedChannelStatus = dashboardStatuses.find((s) => s.channelId === selectedChannelId);
  const isChannelDeployed = !!selectedChannelStatus;

  // ── Messages list ──
  const [messages, setMessages] = useState<Message[]>([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(getStoredPageSize);
  const [pageSizeInput, setPageSizeInput] = useState(String(getStoredPageSize()));
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Count ──
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const totalPages = totalCount !== null ? Math.ceil(totalCount / pageSize) : null;

  // ── Page jump input ──
  const [pageInput, setPageInput] = useState(String(page + 1));
  // Keep the page-jump input in sync with the committed page (adjust during render).
  const [prevPage, setPrevPage] = useState(page);
  if (page !== prevPage) {
    setPrevPage(page);
    setPageInput(String(page + 1));
  }

  // ── Filters (session-persisted across navigation) ──
  const [startDate, setStartDate] = useSessionState("bl-filter-messages-start-date", "");
  const [endDate, setEndDate] = useSessionState("bl-filter-messages-end-date", "");
  const [allDay, setAllDay] = useSessionState("bl-filter-messages-all-day", true);
  const [statuses, setStatuses] = useSessionState<string[]>("bl-filter-messages-statuses", []);
  const [textSearch, setTextSearch] = useSessionState("bl-filter-messages-text", "");
  const [textSearchRegex, setTextSearchRegex] = useSessionState(
    "bl-filter-messages-text-regex",
    false
  );

  // ── Advanced filter ──
  const [advancedExpanded, setAdvancedExpanded] = useSessionState(
    "bl-filter-messages-advanced-expanded",
    false
  );
  const [advancedFilter, setAdvancedFilter] = useSessionState<AdvancedFilterState>(
    "bl-filter-messages-advanced",
    emptyAdvancedFilter()
  );
  // Tracks whether the one-shot URL-param apply effect has fired; gates the auto-search
  // so the first search always includes the pre-populated filter when params are present.
  const [urlParamsApplied, setUrlParamsApplied] = useState(!hasUrlFilterParams);

  // ── Active filter (what was actually searched) ──
  const activeFilterRef = useRef<MessageFilter | null>(null);
  const activeChannelRef = useRef<string>("");
  // Render mirrors of the pinned filter/channel (set by the search helper alongside the refs).
  // Render reads these — never *Ref.current — so the React Compiler doesn't flag ref-in-render.
  const [activeFilter, setActiveFilter] = useState<MessageFilter | null>(null);
  const [activeChannel, setActiveChannel] = useState("");
  /** True during auto-search on channel change; false for user-initiated searches.
   *  Mirrors Java isChannelMessagesPanelFirstLoadSearch — skips PHI audit on initial load. */
  const isFirstLoadSearchRef = useRef(false);
  /** True once the user has run an explicit (non-first-load) search in the current channel.
   *  Gates export: the channel-open auto-load pins a (default) filter, so "filter is null" is not
   *  a valid "no search yet" proxy — mirrors Java refusing export while
   *  isChannelMessagesPanelFirstLoadSearch is true (MessageExportDialog.java:185-186). Ref for the
   *  Export CSV click handler; state mirror for the Export Results dialog's isFirstLoad prop. */
  const userHasSearchedRef = useRef(false);
  const [userHasSearched, setUserHasSearched] = useState(false);
  /** Monotonic token incremented on every new message selection. In-flight getMessage /
   *  auditAccessedPHIMessage calls compare against this to detect staleness and bail
   *  before writing state — prevents wrong-patient PHI display on slow fetches. */
  const selectionSeqRef = useRef(0);
  /** Monotonic token for search/pagination — prevents a slow in-flight search from
   *  overwriting results from a newer, faster search (wrong-channel PHI race). */
  const searchSeqRef = useRef(0);

  // ── Selected message + content viewer ──
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [fullMessage, setFullMessage] = useState<Message | null>(null);
  const [selectedConnectorMetaDataId, setSelectedConnectorMetaDataId] = useState<number | null>(
    null
  );
  const [collapsedMessageIds, setCollapsedMessageIds] = useState<Set<number>>(new Set());
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");
  const [viewerLayout, setViewerLayout] = useState<ContentViewerLayout>(getStoredViewerLayout);
  const {
    splitPct,
    containerRef,
    onResizerMouseDown: handleResizerMouseDown,
  } = useSplitResize({
    orientation: viewerLayout === "bottom" ? "vertical" : "horizontal",
  });

  // ── Actions ──
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendInitialData, setSendInitialData] = useState<SendMessageInitialData | undefined>(
    undefined
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [removeAllTarget, setRemoveAllTarget] = useState<RemoveAllTarget | null>(null);
  const [reprocessMode, setReprocessMode] = useState<"single" | "bulk" | null>(null);
  const [removeResultsConfirmOpen, setRemoveResultsConfirmOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [textSearchWarnOpen, setTextSearchWarnOpen] = useState(false);

  // ── Persist selected channel across navigation ──
  useEffect(() => {
    if (selectedChannelId) {
      try {
        sessionStorage.setItem(userScopedKey("bl-filter-messages-channel"), selectedChannelId);
      } catch {
        /* ignore */
      }
    }
  }, [selectedChannelId]);

  // ── Load channels once ──
  useEffect(() => {
    startTransition(() => setChannelsLoading(true));
    getChannelIdsAndNames()
      .catch(() => new Map<string, string>())
      .then((map) => {
        // Supplement with names from the dashboard status cache for users who have
        // Dashboard permission but not Channels permission (getChannelIdsAndNames
        // may return empty or fail for those users).
        if (map.size === 0) {
          const { dashboardStatuses } = getCache();
          for (const s of dashboardStatuses) {
            if (s.channelId && s.name) map.set(s.channelId, s.name);
          }
        }
        setChannels(map);
        // If a channelId was provided via URL param and it exists → keep it.
        // Otherwise check if the session-restored value is valid; if not, fall back to first.
        if (!initialChannelId || !map.has(initialChannelId)) {
          const current = !initialChannelId
            ? (sessionStorage.getItem(userScopedKey("bl-filter-messages-channel")) ?? "")
            : "";
          if (!current || !map.has(current)) {
            // Use the first alphabetically sorted channel so it matches what the user
            // sees at the top of the dropdown. (map insertion order is server-defined.)
            // firstId is undefined when the channel list is empty (e.g. no Channels
            // permission) — clear any stale session value in that case.
            const firstId = Array.from(map.entries()).sort(([, a], [, b]) =>
              a.localeCompare(b)
            )[0]?.[0];
            setSelectedChannelId(firstId ?? "");
          }
        }
      })
      .finally(() => setChannelsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lazy-load dashboard statuses so reprocess destinations are always available ──
  // Mirrors Java: DashboardPanel.getDestinationConnectorNames reads from dashboard
  // status tree, not from message data. Fetch once on mount if cache is empty.
  useEffect(() => {
    if (getCache().dashboardStatuses.length === 0) {
      getDashboardStatuses()
        .then((statuses) => {
          if (statuses?.length) updateDashboard(statuses);
        })
        .catch(() => {}); // non-fatal — falls back to connectorInfos from search results
    }
  }, []);

  // ── Persist page size (both the quick-override key and the admin pref) ──
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_PAGE_SIZE_KEY, String(pageSize));
      saveAdminPref("messageBrowserPageSize", pageSize);
    }
  }, [pageSize]);

  // ── Persist viewer layout (side-by-side vs top/bottom) per ──
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_VIEWER_LAYOUT_KEY, viewerLayout);
    }
  }, [viewerLayout]);

  // ── Pre-filter to specific connector from URL param (?metaDataId=<id>) ──
  // One-shot: overrides session-restored advanced filter on mount when navigating
  // from the dashboard via double-click or context menu on a connector row.
  // When hasUrlFilterParams is true this effect is superseded by the one below, which
  // handles selectedConnectors itself and sets urlParamsApplied to unblock the auto-search.
  const appliedUrlMetaDataRef = useRef(false);
  useEffect(() => {
    if (appliedUrlMetaDataRef.current || initialMetaDataId === null || hasUrlFilterParams) return;
    appliedUrlMetaDataRef.current = true;
    setAdvancedFilter((prev) => ({ ...prev, selectedConnectors: [Number(initialMetaDataId)] }));
  }, [initialMetaDataId, setAdvancedFilter, hasUrlFilterParams]);

  // ── Pre-populate advanced filter from URL params (messageId / metaDataColumn / etc.) ──
  // One-shot: resets to emptyAdvancedFilter then applies URL-specified fields.
  // Gates on metaDataColumns when metaDataColumn param is present so columnType is available.
  const appliedUrlFilterRef = useRef(false);
  useEffect(() => {
    if (appliedUrlFilterRef.current) return;
    // Also run when the URL carries only PHI-shaped metadata params that don't
    // build a filter (e.g. a value with no column) so they still get scrubbed.
    if (!hasUrlFilterParams && !hasSensitiveUrlParams(searchParams)) return;
    if (!selectedChannelId || channelsLoading) return;
    // Wait for the channel's metadata columns to finish loading (resolved OR
    // rejected) before applying a metaDataColumn param, so buildAdvancedFilterFromUrl
    // can validate the column against the channel's real columns. Gating on
    // metaColumnsReady (not `.length === 0`) also lets a zero-column / fetch-failed
    // channel proceed and scrub, instead of blocking forever.
    if (urlFilterParams.metaDataColumn && !metaColumnsReady) return;

    appliedUrlFilterRef.current = true;
    // Disable the sibling metaDataId effect: the scrub below flips hasUrlFilterParams
    // to false, which would otherwise let that effect re-fire. selectedConnectors is
    // applied here from initialMetaDataId, so nothing is lost.
    appliedUrlMetaDataRef.current = true;

    // Strip PHI-shaped metadata-search params (metaDataColumn/Value/Operator) from the
    // address bar/history once consumed into filter state, so a patient value in
    // metaDataValue does not persist in the URL. Non-PHI deep links (messageId ranges,
    // channelId) are left intact and shareable.
    const scrubUrl = () => {
      if (hasSensitiveUrlParams(searchParams)) {
        router.replace(`${pathname}${stripSensitiveUrlParams(searchParams)}`, { scroll: false });
      }
    };

    const built = buildAdvancedFilterFromUrl(urlFilterParams, metaDataColumns);
    if (!built) {
      startTransition(() => setUrlParamsApplied(true));
      scrubUrl();
      return;
    }
    if (initialMetaDataId !== null) built.selectedConnectors = [Number(initialMetaDataId)];
    startTransition(() => {
      setAdvancedFilter(built);
      setAdvancedExpanded(true);
      setUrlParamsApplied(true);
    });
    scrubUrl();
  }, [
    hasUrlFilterParams,
    selectedChannelId,
    channelsLoading,
    metaDataColumns,
    metaColumnsReady,
    urlFilterParams,
    initialMetaDataId,
    setAdvancedFilter,
    setAdvancedExpanded,
    searchParams,
    router,
    pathname,
  ]);

  // ── Build MessageFilter from UI state ──
  const buildFilter = useCallback((): MessageFilter => {
    const filter: MessageFilter = {};

    if (startDate) {
      if (allDay) {
        // All Day: start = beginning of the selected date
        const d = new Date(startDate);
        filter.startDate = toXStreamCalendar(startOfDay(d));
      } else {
        filter.startDate = toXStreamCalendar(new Date(startDate));
      }
    }
    if (endDate) {
      if (allDay) {
        // All Day: end = end of the selected date (23:59:59.999)
        const d = new Date(endDate);
        filter.endDate = toXStreamCalendar(endOfDay(d));
      } else {
        filter.endDate = toXStreamCalendar(new Date(endDate));
      }
    }
    if (textSearch.trim()) {
      filter.textSearch = textSearch.trim();
      if (textSearchRegex) {
        filter.textSearchRegex = true;
      }
      // Java MessageBrowser.java:585-596 — a quick text search also scans every
      // STRING-typed custom metadata column, so the server matches values stored
      // in those columns (not just message content).
      const stringCols = metaDataColumns.filter((c) => c.type === "STRING").map((c) => c.name);
      if (stringCols.length > 0) {
        filter.textSearchMetaDataColumns = stringCols;
      }
    }
    if (statuses.length > 0) {
      filter.statuses = [...statuses];
    }

    // Merge advanced filter fields (connectorInfos = full roster for the included/excluded split)
    const advanced = applyAdvancedFilter(advancedFilter, connectorInfos);
    Object.assign(filter, advanced);

    return filter;
  }, [
    startDate,
    endDate,
    allDay,
    textSearch,
    textSearchRegex,
    statuses,
    advancedFilter,
    metaDataColumns,
    connectorInfos,
  ]);

  // ── Search deps (refs + setters for the search helpers) ──
  // Rebuilt only when the values that feed the CURES audit logic change; refs
  // and useState setters are stable and don't need to be listed.
  const searchDeps = useMemo<MessageSearchDeps>(
    () => ({
      seqRef: searchSeqRef,
      activeFilterRef,
      activeChannelRef,
      setActiveFilter,
      setActiveChannel,
      isFirstLoadSearchRef,
      userHasSearchedRef,
      setUserHasSearched,
      channels,
      isCURESPHILoggingOn,
      pageSize,
      setLoading,
      setError,
      setMessages,
      setHasNextPage,
      setPage,
      setSelectedMessage,
      setFullMessage,
      setContentError,
    }),
    [channels, isCURESPHILoggingOn, pageSize]
  );

  // ── Search ──
  const search = useCallback(
    (pageNum = 0) => {
      if (!selectedChannelId) return;
      // Synchronous resets so the UI clears immediately regardless of how fast
      // the in-flight search resolves.
      setSelectedMessage(null);
      setFullMessage(null);
      setContentError("");
      setSelectedConnectorMetaDataId(null);
      setCollapsedMessageIds(new Set());
      setTotalCount(null);
      return runMessageSearch(selectedChannelId, buildFilter(), pageNum, searchDeps);
    },
    [selectedChannelId, buildFilter, searchDeps]
  );

  // ── Auto-search when channel changes ──
  // Guard on !channelsLoading so we never fire with a stale/unvalidated channel ID
  // from sessionStorage. The channel list effect validates the ID and sets
  // channelsLoading=false only after that validation is complete.
  // When URL filter params are present, also wait for urlParamsApplied so the first
  // search always includes the pre-populated advanced filter. Also wait for the connector roster
  // (connectorsChannel === selectedChannelId) so the include/exclude split is computed against the
  // real roster, not an empty one — this filter also drives Remove/Reprocess Results).
  useEffect(() => {
    if (
      selectedChannelId &&
      !channelsLoading &&
      urlParamsApplied &&
      connectorsChannel === selectedChannelId
    ) {
      isFirstLoadSearchRef.current = true;
      // A fresh channel auto-load is not a user search — refuse export until the user searches.
      // The ref resets immediately (read by the Export CSV click handler); the state mirror is
      // reset inside runMessageSearch's first-load branch (a setState here would be a synchronous
      // set-state-in-effect).
      userHasSearchedRef.current = false;
      startTransition(() => {
        search(0);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannelId, channelsLoading, urlParamsApplied, connectorsChannel]);

  // ── Fetch metadata columns when channel changes ──
  useEffect(() => {
    if (!selectedChannelId) {
      startTransition(() => {
        setMetaDataColumns([]);
        setMetaColumnsReady(false);
      });
      return;
    }
    // Reset so manual Search is blocked until the fetch resolves. This ensures
    // isCURESPHILoggingOn is final before we decide whether to record a PHI
    // query audit Finding 5).
    startTransition(() => setMetaColumnsReady(false));
    getMetaDataColumns(selectedChannelId)
      .then((cols) => {
        setMetaDataColumns(cols.map((c) => ({ name: c.name, type: c.type })));
      })
      .catch(() => {
        setMetaDataColumns([]);
      })
      .finally(() => {
        setMetaColumnsReady(true);
      });
  }, [selectedChannelId]);

  // ── Fetch the channel's authoritative connector list when the channel changes ──
  // Mirrors Java Frame.doShowMessages (mirthClient.getConnectorNames) + MessageBrowser.loadChannel
  // (appends "Deleted Connectors"). This — not the search-result scan — is the source for the
  // advanced-filter connector checkboxes, so the list is complete and stable across paging/searching
  // and the included/excluded selection algebra has the full roster to work against.
  useEffect(() => {
    if (!selectedChannelId) {
      startTransition(() => {
        setConnectorInfos([]);
        setConnectorsChannel("");
      });
      return;
    }
    let cancelled = false;
    getConnectorNames(selectedChannelId)
      .then((list) => {
        if (cancelled) return;
        const roster: ConnectorInfo[] = [
          ...list,
          { metaDataId: DELETED_CONNECTORS_METADATA_ID, name: DELETED_CONNECTORS_LABEL },
        ];
        setConnectorInfos(roster);
        // Drop any persisted connector ids that don't belong to this channel's roster.
        setAdvancedFilter((prev) => {
          const next = reconcileConnectorSelection(prev.selectedConnectors, roster);
          return next === prev.selectedConnectors ? prev : { ...prev, selectedConnectors: next };
        });
      })
      .catch(() => {
        // Non-fatal: with no roster the advanced-filter connector section stays hidden (= "all
        // connectors"), and reprocess destinations fall back to the dashboard/cached-channel tiers.
        if (!cancelled) setConnectorInfos([]);
      })
      .finally(() => {
        // Open the auto-search gate whether the fetch succeeded or failed (degrade to all-connectors).
        if (!cancelled) setConnectorsChannel(selectedChannelId);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChannelId, setAdvancedFilter]);

  // ── Page navigation ──
  const goToPage = useCallback(
    (pageNum: number) => runMessagePage(pageNum, searchDeps),
    [searchDeps]
  );

  // ── Count (lazy) ──
  const handleCount = useCallback(async () => {
    if (!activeFilterRef.current || !activeChannelRef.current) return;
    setCountLoading(true);
    try {
      const count = await searchMessageCount(activeChannelRef.current, activeFilterRef.current);
      setTotalCount(count);
    } catch {
      setTotalCount(null);
    } finally {
      setCountLoading(false);
    }
  }, []);

  // ── Apply page size ──
  function applyPageSize() {
    const n = Number(pageSizeInput);
    if (n > 0 && n <= 500) {
      setPageSize(n);
      // Re-search from page 0 with new page size
      // (will happen automatically because search depends on pageSize)
    }
  }

  // ── Jump to page ──
  function applyPageJump() {
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) {
      setPageInput(String(page + 1));
      return;
    }
    const clamped = Math.max(1, totalPages ? Math.min(n, totalPages) : n);
    setPageInput(String(clamped));
    if (clamped - 1 !== page) goToPage(clamped - 1);
  }

  // ── Reset filters ──
  function resetFilters() {
    setStartDate("");
    setEndDate("");
    setAllDay(true);
    setStatuses([]);
    setTextSearch("");
    setTextSearchRegex(false);
    setAdvancedFilter(emptyAdvancedFilter());
  }

  // ── Select a specific connector row → fetch full message content if needed ──
  async function handleSelectConnector(msg: Message, cm: ConnectorMessage) {
    await selectConnector(msg, cm, {
      seqRef: selectionSeqRef,
      selectedMessageId: selectedMessage?.messageId,
      channels,
      isCURESPHILoggingOn,
      fullMessage,
      setSelectedConnectorMetaDataId,
      setSelectedMessage,
      setFullMessage,
      setContentError,
      setContentLoading,
    });
  }

  // ── Toggle message expand/collapse ──
  function toggleMessageExpand(messageId: number, e: React.MouseEvent) {
    e.stopPropagation();
    setCollapsedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function toggleStatus(s: string) {
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  // ── Action handlers (toolbar / context menu / dialogs) ──
  const {
    handleSendMessage,
    handleReprocessMessage,
    handleResendMessage,
    handleOpenFreshSend,
    handleRemoveMessage,
    handleRemoveAllMessages,
    handleRemoveResults,
    doRemoveResults,
    handleReprocessResults,
    handleExportCsv,
    doReprocess,
  } = useMessageActions({
    selectedChannelId,
    selectedMessage,
    fullMessage,
    selectedConnectorMetaDataId,
    isCURESPHILoggingOn,
    channels,
    selectedChannelState: selectedChannelStatus?.state,
    page,
    reprocessMode,
    visibleCols,
    activeFilterRef,
    userHasSearchedRef,
    search,
    setActionLoading,
    setActionError,
    setReprocessMode,
    setSendInitialData,
    setSendDialogOpen,
    setConfirmDialog,
    setRemoveAllTarget,
    setRemoveResultsConfirmOpen,
    setSelectedMessage,
    setFullMessage,
    setSelectedConnectorMetaDataId,
  });

  const advancedActive = hasAdvancedCriteria(advancedFilter);
  const hasActiveFilters =
    startDate !== "" ||
    endDate !== "" ||
    !allDay ||
    statuses.length > 0 ||
    textSearch !== "" ||
    textSearchRegex ||
    advancedActive;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Message Browser"
        subtitle={selectedChannelId ? (channels.get(selectedChannelId) ?? selectedChannelId) : ""}
      />

      {toolbarPos === "top" && (
        <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
          <MessagesActionPanel
            position={toolbarPos}
            selectedChannelId={selectedChannelId}
            selectedMessage={selectedMessage}
            hasResults={messages.length > 0}
            actionLoading={actionLoading}
            isChannelDeployed={isChannelDeployed}
            onSend={handleOpenFreshSend}
            onImport={() => setImportDialogOpen(true)}
            onExport={() => setExportDialogOpen(true)}
            onExportCsv={handleExportCsv}
            onRemoveAll={handleRemoveAllMessages}
            onRemoveResults={handleRemoveResults}
            onRemove={handleRemoveMessage}
            onReprocessResults={handleReprocessResults}
            onReprocess={handleReprocessMessage}
            onResend={handleResendMessage}
          />
        </DockableToolbar>
      )}

      <MessageFilterBar
        channels={channels}
        channelsLoading={channelsLoading}
        selectedChannelId={selectedChannelId}
        onSelectChannel={(id) => {
          setSelectedChannelId(id);
          setPage(0);
          setChannelDropdownOpen(false);
          setChannelSearch("");
          // Connector selection is channel-specific (metaDataIds mean different things per channel),
          // so reset it to "all" on an interactive switch — mirrors Java rebuilding the connector
          // table per channel. Other advanced fields (dates, ids, etc.) intentionally persist.
          setAdvancedFilter((prev) =>
            prev.selectedConnectors === null ? prev : { ...prev, selectedConnectors: null }
          );
        }}
        sortedFilteredChannels={sortedFilteredChannels}
        channelSearch={channelSearch}
        onChannelSearchChange={setChannelSearch}
        channelDropdownOpen={channelDropdownOpen}
        onChannelDropdownOpenChange={setChannelDropdownOpen}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        allDay={allDay}
        onAllDayChange={setAllDay}
        textSearch={textSearch}
        onTextSearchChange={setTextSearch}
        textSearchRegex={textSearchRegex}
        onTextSearchRegexChange={setTextSearchRegex}
        statuses={statuses}
        onToggleStatus={toggleStatus}
        advancedActive={advancedActive}
        advancedExpanded={advancedExpanded}
        onToggleAdvanced={() => setAdvancedExpanded((prev) => !prev)}
        advancedFilter={advancedFilter}
        onAdvancedFilterChange={setAdvancedFilter}
        connectorInfos={connectorInfos}
        metaDataColumns={metaDataColumns}
        onSearch={() => {
          // Java MessageBrowserAdvancedFilter blocks the search on an invalid
          // metadata-search value; mirror that by surfacing the inline errors.
          if (hasMetaDataSearchErrors(advancedFilter)) {
            setAdvancedExpanded(true);
            toast.error("Fix the invalid metadata search value(s) before searching.");
            return;
          }
          if (textSearch.trim() && loadAdminPrefs().textSearchWarning) {
            setTextSearchWarnOpen(true);
          } else {
            search(0);
          }
        }}
        onReset={resetFilters}
        loading={loading}
        metaColumnsReady={metaColumnsReady}
        hasActiveFilters={hasActiveFilters}
        pageSizeInput={pageSizeInput}
        onPageSizeInputChange={setPageSizeInput}
        onApplyPageSize={applyPageSize}
        onCount={handleCount}
        countLoading={countLoading}
        totalCount={totalCount}
        hasFilter={activeFilter !== null}
      />

      {/* Current Search summary */}
      {activeFilter && (
        <CurrentSearchSummary
          filter={activeFilter}
          channelName={channels.get(activeChannel) ?? activeChannel}
          advancedFilter={advancedFilter}
        />
      )}

      <ApiErrorAlert error={error || actionError} className="mx-6 mt-3" />

      {/* Toolbar + main content */}
      <div className={`flex flex-1 min-h-0 ${toolbarPos === "bottom" ? "flex-col" : "flex-row"}`}>
        {toolbarPos === "left" && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <MessagesActionPanel
              position={toolbarPos}
              selectedChannelId={selectedChannelId}
              selectedMessage={selectedMessage}
              hasResults={messages.length > 0}
              actionLoading={actionLoading}
              isChannelDeployed={isChannelDeployed}
              onSend={handleOpenFreshSend}
              onImport={() => setImportDialogOpen(true)}
              onExport={() => setExportDialogOpen(true)}
              onExportCsv={handleExportCsv}
              onRemoveAll={handleRemoveAllMessages}
              onRemoveResults={handleRemoveResults}
              onRemove={handleRemoveMessage}
              onReprocessResults={handleReprocessResults}
              onReprocess={handleReprocessMessage}
              onResend={handleResendMessage}
            />
          </DockableToolbar>
        )}

        <div
          ref={containerRef}
          className={`flex flex-1 min-h-0 min-w-0 overflow-hidden ${pagePadding(globalDensity)} ${viewerLayout === "bottom" ? "flex-col" : "flex-row"}`}
        >
          {/* Message table */}
          <div
            className="flex flex-col overflow-hidden"
            style={
              selectedMessage
                ? { [viewerLayout === "bottom" ? "height" : "width"]: `${splitPct}%` }
                : { flex: 1 }
            }
          >
            <MessageTable
              messages={messages}
              metaColTypes={metaColTypes}
              visibleCols={visibleCols}
              orderedCols={orderedCols}
              colState={colState}
              setWidth={setWidth}
              setVisible={setVisible}
              moveCol={moveCol}
              resetToDefaults={resetToDefaults}
              page={page}
              pageSize={pageSize}
              hasNextPage={hasNextPage}
              totalCount={totalCount}
              totalPages={totalPages}
              pageInput={pageInput}
              onPageInputChange={setPageInput}
              onApplyPageJump={applyPageJump}
              onGoToPage={goToPage}
              loading={loading}
              selectedMessage={selectedMessage}
              selectedConnectorMetaDataId={selectedConnectorMetaDataId}
              collapsedMessageIds={collapsedMessageIds}
              onSelectConnector={handleSelectConnector}
              onToggleExpand={toggleMessageExpand}
              viewerLayout={viewerLayout}
              onViewerLayoutToggle={() =>
                setViewerLayout((l) => (l === "right" ? "bottom" : "right"))
              }
              selectedChannelId={selectedChannelId}
              isChannelDeployed={isChannelDeployed}
              onSearch={() => search(page)}
              onSendDialog={handleOpenFreshSend}
              onImportDialog={() => setImportDialogOpen(true)}
              onExportDialog={() => setExportDialogOpen(true)}
              onExportCsv={handleExportCsv}
              onRemoveAllMessages={handleRemoveAllMessages}
              onRemoveResults={handleRemoveResults}
              onRemoveMessage={handleRemoveMessage}
              onReprocessResults={handleReprocessResults}
              onReprocessMessage={handleReprocessMessage}
              onResendMessage={handleResendMessage}
              error={error}
            />
          </div>

          {/* Resize handle */}
          {selectedMessage && (
            <div
              onMouseDown={handleResizerMouseDown}
              className={cn(
                "shrink-0 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors",
                viewerLayout === "bottom"
                  ? "h-1 w-full cursor-row-resize"
                  : "w-1 h-full cursor-col-resize"
              )}
            />
          )}

          {/* Content viewer */}
          {selectedMessage && (
            <ContentViewer
              connectorMessage={
                selectedConnectorMetaDataId !== null
                  ? (fullMessage?.connectorMessages?.[selectedConnectorMetaDataId] ?? null)
                  : null
              }
              fullMessage={fullMessage}
              contentLoading={contentLoading}
              layout={viewerLayout}
              error={contentError || undefined}
              onClose={() => {
                setSelectedMessage(null);
                setFullMessage(null);
                setContentError("");
                setSelectedConnectorMetaDataId(null);
              }}
            />
          )}
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <MessagesActionPanel
              position={toolbarPos}
              selectedChannelId={selectedChannelId}
              selectedMessage={selectedMessage}
              hasResults={messages.length > 0}
              actionLoading={actionLoading}
              isChannelDeployed={isChannelDeployed}
              onSend={handleOpenFreshSend}
              onImport={() => setImportDialogOpen(true)}
              onExport={() => setExportDialogOpen(true)}
              onExportCsv={handleExportCsv}
              onRemoveAll={handleRemoveAllMessages}
              onRemoveResults={handleRemoveResults}
              onRemove={handleRemoveMessage}
              onReprocessResults={handleReprocessResults}
              onReprocess={handleReprocessMessage}
              onResend={handleResendMessage}
            />
          </DockableToolbar>
        )}
      </div>

      <MessagesPageDialogs
        connectorInfos={connectorInfos}
        sendDialogOpen={sendDialogOpen}
        onSendDialogOpenChange={setSendDialogOpen}
        selectedChannelName={channels.get(selectedChannelId) ?? selectedChannelId}
        onSend={handleSendMessage}
        sendInitialData={sendInitialData}
        importDialogOpen={importDialogOpen}
        onImportDialogOpenChange={setImportDialogOpen}
        selectedChannelId={selectedChannelId}
        onImported={() => search(page)}
        exportDialogOpen={exportDialogOpen}
        onExportDialogOpenChange={setExportDialogOpen}
        messageFilter={activeFilter}
        pageSize={pageSize}
        hasMessages={messages.length > 0}
        isFirstLoad={!userHasSearched}
        confirmDialog={confirmDialog}
        onConfirmDialogCancel={() => setConfirmDialog(null)}
        removeAllTarget={removeAllTarget}
        onRemoveAllClose={() => setRemoveAllTarget(null)}
        onRemoveAllDone={() => {
          setRemoveAllTarget(null);
          setSelectedMessage(null);
          setFullMessage(null);
          setSelectedConnectorMetaDataId(null);
          setMessages([]);
          setTotalCount(null);
        }}
        removeResultsConfirmOpen={removeResultsConfirmOpen}
        onRemoveResultsConfirm={doRemoveResults}
        onRemoveResultsCancel={() => setRemoveResultsConfirmOpen(false)}
        removeResultsChannelName={channels.get(selectedChannelId) ?? selectedChannelId}
        reprocessMode={reprocessMode}
        onReprocessClose={() => setReprocessMode(null)}
        onReprocessConfirm={doReprocess}
        reprocessChannelName={channels.get(selectedChannelId) ?? selectedChannelId}
        reprocessDestinations={reprocessDestinations}
        reprocessPreselectedDestinationId={selectedConnectorMetaDataId}
      />

      {textSearchWarnOpen && (
        <TextSearchWarnDialog
          onConfirm={(dontShow) => {
            if (dontShow) saveAdminPref("textSearchWarning", false);
            setTextSearchWarnOpen(false);
            search(0);
          }}
          onCancel={() => setTextSearchWarnOpen(false)}
        />
      )}
    </div>
  );
}

function TextSearchWarnDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (dontShowAgain: boolean) => void;
  onCancel: () => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  return (
    <ConfirmDialog
      title="Text Search"
      confirmLabel="Search"
      confirmVariant="default"
      description={
        <div className="flex flex-col gap-3">
          <p>
            Searching message content can be slow for large result sets. The search will scan all
            matching messages.
          </p>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="rounded"
            />
            Don&apos;t show this warning again
          </label>
        </div>
      }
      onConfirm={() => onConfirm(dontShow)}
      onCancel={onCancel}
    />
  );
}

// Wrap in Suspense so useSearchParams() doesn't cause a CSR bailout during
// static pre-rendering (Next.js App Router requirement).
export default function MessagesPage() {
  return (
    <Suspense>
      <MessagesPageInner />
    </Suspense>
  );
}
