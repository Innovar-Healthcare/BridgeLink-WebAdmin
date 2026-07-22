import { getEvents, getMaxEventId } from "@/lib/api-client";
import type { EventFilter } from "@/lib/api-client";
import type { ServerEvent } from "@/lib/types";

/**
 * Events search orchestration, extracted from the page so the stale-response
 * guard and stable-pagination behavior are unit-testable without rendering
 * (mirrors messages/_lib/message-selection.ts).
 *
 * The key invariant — from EventBrowser.java and CLAUDE.md — is that a single
 * `maxEventId` bounds the whole search session: it is fetched once at search
 * start, pinned in `activeFilterRef`, and reused for every page turn so rows
 * don't repeat or skip as new events arrive on a busy server.
 */

/** The filter UI state, mapped to an EventFilter by buildEventFilter. */
export interface EventFilterState {
  activeLevels: string[];
  startDate: string;
  endDate: string;
  /** When true, the date range covers whole days (end snapped to 23:59:59.999). */
  allDay: boolean;
  nameFilter: string;
  outcomeFilter: string;
  userFilter: string;
  ipFilter: string;
  serverFilter: string;
  attrFilter: string;
}

/**
 * Map the current filter UI state to an EventFilter — without maxEventId,
 * offset, or limit, which are applied per fetch. `userId` is guarded with
 * Number.isFinite so a non-numeric/blank user filter never leaks NaN into the
 * request body.
 */
export function buildEventFilter(s: EventFilterState): EventFilter {
  const userIdNum = s.userFilter.trim() ? parseInt(s.userFilter.trim(), 10) : NaN;
  return {
    level: s.activeLevels.length > 0 ? s.activeLevels : undefined,
    startDate: s.startDate || undefined,
    endDate: s.endDate || undefined,
    allDay: s.allDay,
    name: s.nameFilter.trim() || undefined,
    outcome: s.outcomeFilter || undefined,
    userId: Number.isFinite(userIdNum) ? userIdNum : undefined,
    ipAddress: s.ipFilter.trim() || undefined,
    serverId: s.serverFilter.trim() || undefined,
    attributeSearch: s.attrFilter.trim() || undefined,
  };
}

/** Total page count for a known total (>= 1 even when the total is 0). */
export function pagesForCount(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

/**
 * Clamp a 1-based page request to [1, totalPages]. When the total page count is
 * unknown (count not yet fetched), only the lower bound is enforced.
 */
export function clampPageInput(requested1Based: number, totalPages: number | null): number {
  return Math.max(1, totalPages ? Math.min(requested1Based, totalPages) : requested1Based);
}

export interface EventSearchDeps {
  /** Monotonic token; bumped per fetch. In-flight fetches bail if it advances. */
  seqRef: { current: number };
  /** Filter pinned at search start (incl. maxEventId); reused by pagination. */
  activeFilterRef: { current: EventFilter | null };
  pageSize: number;
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
  setEvents: (v: ServerEvent[]) => void;
  /** True when the returned page is full (results.length >= pageSize), meaning
   *  there may be more pages. Avoids a separate count query on every search. */
  setHasNextPage: (v: boolean) => void;
  setPage: (v: number) => void;
  /** Cleared on every successful, non-stale response so the detail panel never
   *  shows an event no longer in the visible list after a search or page turn. */
  setSelectedEvent: (v: ServerEvent | null) => void;
}

/**
 * New-session search: fetch a fresh maxEventId, pin the filter, then fetch the
 * page. Stale responses (seq advanced by a newer call) are discarded before any
 * state write. hasNextPage is derived from the result length so no separate
 * count query is needed.
 */
export async function runEventSearch(
  filter: EventFilter,
  pageNum: number,
  deps: EventSearchDeps
): Promise<void> {
  const seq = ++deps.seqRef.current;
  deps.setLoading(true);
  deps.setError("");
  try {
    const maxEventId = await getMaxEventId();
    const pinned: EventFilter = { ...filter, maxEventId };
    deps.activeFilterRef.current = pinned;
    const data = await getEvents({
      ...pinned,
      offset: pageNum * deps.pageSize,
      limit: deps.pageSize,
    });
    if (seq !== deps.seqRef.current) return;
    deps.setEvents(data ?? []);
    deps.setHasNextPage((data?.length ?? 0) >= deps.pageSize);
    deps.setPage(pageNum);
    deps.setSelectedEvent(null);
  } catch (err) {
    if (seq !== deps.seqRef.current) return;
    deps.setError(err instanceof Error ? err.message : "Failed to load events");
  } finally {
    if (seq === deps.seqRef.current) deps.setLoading(false);
  }
}

/**
 * Pagination within the pinned session: reuse activeFilterRef (same maxEventId),
 * no new getMaxEventId, no count query.
 */
export async function runEventPage(pageNum: number, deps: EventSearchDeps): Promise<void> {
  const filter = deps.activeFilterRef.current;
  if (!filter) return;
  const seq = ++deps.seqRef.current;
  deps.setLoading(true);
  deps.setError("");
  try {
    const data = await getEvents({
      ...filter,
      offset: pageNum * deps.pageSize,
      limit: deps.pageSize,
    });
    if (seq !== deps.seqRef.current) return;
    deps.setEvents(data ?? []);
    deps.setHasNextPage((data?.length ?? 0) >= deps.pageSize);
    deps.setPage(pageNum);
    deps.setSelectedEvent(null);
  } catch (err) {
    if (seq !== deps.seqRef.current) return;
    deps.setError(err instanceof Error ? err.message : "Failed to load events");
  } finally {
    if (seq === deps.seqRef.current) deps.setLoading(false);
  }
}
