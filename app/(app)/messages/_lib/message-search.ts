import { searchMessages, getMaxMessageId, auditQueriedPHIMessage } from "@/lib/api-client";
import type { MessageFilter } from "@/lib/api-client";
import type { Message } from "@/lib/types";
import { stringifyMessageFilter } from "./message-helpers";

/**
 * Messages search orchestration, extracted from the page so the stale-response
 * guard is unit-testable without rendering (mirrors events/_lib/event-search.ts).
 *
 * The key invariant — from MessageBrowser.java — is that a single maxMessageId
 * bounds the whole search session: fetched once at search start, pinned in
 * activeFilterRef + activeChannelRef, and reused for every page turn so rows
 * don't repeat or skip as new messages arrive on a busy server.
 */

export interface MessageSearchDeps {
  /** Monotonic token; bumped per fetch. In-flight fetches bail if it advances. */
  seqRef: { current: number };
  /** Filter pinned at search start (incl. maxMessageId); reused by pagination. */
  activeFilterRef: { current: MessageFilter | null };
  /** Channel pinned at search start; reused by pagination. */
  activeChannelRef: { current: string };
  /**
   * Render mirrors of the pinned filter/channel. Set alongside the refs so JSX can read the
   * searched filter without touching a ref during render (react-hooks/refs). The refs remain the
   * source of truth for async/event-handler paths.
   */
  setActiveFilter: (v: MessageFilter | null) => void;
  setActiveChannel: (v: string) => void;
  /** True during auto-search on channel change; skips PHI audit on initial load. */
  isFirstLoadSearchRef: { current: boolean };
  /** Set true when an explicit (non-first-load) search runs; gates export. */
  userHasSearchedRef: { current: boolean };
  setUserHasSearched: (v: boolean) => void;
  channels: Map<string, string>;
  isCURESPHILoggingOn: boolean;
  pageSize: number;
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
  setMessages: (v: Message[]) => void;
  setHasNextPage: (v: boolean) => void;
  setPage: (v: number) => void;
  /** Clear message selection on a successful, non-stale response. */
  setSelectedMessage: (v: Message | null) => void;
  setFullMessage: (v: Message | null) => void;
  setContentError: (v: string) => void;
}

/**
 * New-session search: fetch a fresh maxMessageId, pin the filter, then fetch
 * the page. Stale responses (seq advanced by a newer call) are discarded before
 * any state write. CURES PHI "Queried PHI" audit runs before results are shown;
 * audit failure hides results and is also seq-guarded.
 */
export async function runMessageSearch(
  channelId: string,
  filter: MessageFilter,
  pageNum: number,
  deps: MessageSearchDeps
): Promise<void> {
  const seq = ++deps.seqRef.current;
  deps.setLoading(true);
  deps.setError("");
  try {
    const maxId = await getMaxMessageId(channelId);
    if (filter.maxMessageId == null) filter.maxMessageId = maxId;
    if (seq !== deps.seqRef.current) return; // stale — guard before pinning refs
    deps.activeFilterRef.current = filter;
    deps.activeChannelRef.current = channelId;
    deps.setActiveFilter(filter);
    deps.setActiveChannel(channelId);
    // An explicit (non-first-load) search enables export. The channel-open auto-load pins a filter
    // too, so this — not "filter is non-null" — is the "user has searched" signal (Java parity:
    // export is refused while isChannelMessagesPanelFirstLoadSearch is true). isFirstLoadSearchRef
    // is still true here for the auto-load; it isn't reset until the finally below.
    if (deps.isFirstLoadSearchRef.current) {
      // Auto-load only — reset the state mirror (the ref was already reset in the effect that
      // triggered this load) so export stays refused until the user searches in this channel.
      deps.userHasSearchedRef.current = false;
      deps.setUserHasSearched(false);
    } else {
      deps.userHasSearchedRef.current = true;
      deps.setUserHasSearched(true);
    }

    const msgs = await searchMessages(channelId, filter, {
      offset: pageNum * deps.pageSize,
      limit: deps.pageSize,
      includeContent: false,
    });

    if (seq !== deps.seqRef.current) return; // stale — guard before audit

    // ── CURES PHI audit: "Queried PHI" (Java MessageBrowser.auditSearch:697-721) ──
    // Audit must complete before results are displayed; failure hides the result list.
    if (deps.isCURESPHILoggingOn && !deps.isFirstLoadSearchRef.current) {
      const channelName = deps.channels.get(channelId) ?? "";
      const auditAttrs: Record<string, string> = {
        channel: `Channel[id=${channelId},name=${channelName}]`,
        filter: stringifyMessageFilter(filter),
      };
      if (filter.metaDataSearch?.length) {
        for (const el of filter.metaDataSearch) {
          if (el.columnName === "PATIENT_ID" && el.operator === "EQUAL") {
            auditAttrs.patientId = String(el.value ?? "");
          }
        }
      }
      try {
        await auditQueriedPHIMessage(auditAttrs);
      } catch (auditErr) {
        if (seq !== deps.seqRef.current) return; // stale
        deps.setError(
          "Could not record required PHI query audit; results hidden. " +
            (auditErr instanceof Error ? auditErr.message : "")
        );
        return;
      }
      if (seq !== deps.seqRef.current) return; // stale after audit success
    }

    deps.setMessages(msgs ?? []);
    deps.setPage(pageNum);
    deps.setHasNextPage((msgs?.length ?? 0) >= deps.pageSize);
    // The advanced-filter connector list is NOT derived from results — it comes from the
    // authoritative GET /channels/{id}/connectorNames fetch on channel load, so the
    // checkbox list is complete and stable across paging/searching.
  } catch (err) {
    if (seq !== deps.seqRef.current) return;
    deps.setError(err instanceof Error ? err.message : "Failed to load messages");
  } finally {
    deps.isFirstLoadSearchRef.current = false;
    if (seq === deps.seqRef.current) deps.setLoading(false);
  }
}

/**
 * Pagination within the pinned session: reuse activeFilterRef/activeChannelRef
 * (same maxMessageId), no new getMaxMessageId, no count query. Clears message
 * selection on a successful, non-stale response (mirrors Messages goToPage behavior).
 */
export async function runMessagePage(pageNum: number, deps: MessageSearchDeps): Promise<void> {
  const filter = deps.activeFilterRef.current;
  const channelId = deps.activeChannelRef.current;
  if (!filter || !channelId) return;
  const seq = ++deps.seqRef.current;
  deps.setLoading(true);
  deps.setError("");
  try {
    const msgs = await searchMessages(channelId, filter, {
      offset: pageNum * deps.pageSize,
      limit: deps.pageSize,
      includeContent: false,
    });
    if (seq !== deps.seqRef.current) return;
    deps.setMessages(msgs ?? []);
    deps.setPage(pageNum);
    deps.setHasNextPage((msgs?.length ?? 0) >= deps.pageSize);
    deps.setSelectedMessage(null);
    deps.setFullMessage(null);
    deps.setContentError("");
  } catch (err) {
    if (seq !== deps.seqRef.current) return;
    deps.setError(err instanceof Error ? err.message : "Failed to load messages");
  } finally {
    if (seq === deps.seqRef.current) deps.setLoading(false);
  }
}
