/**
 * API lookups — Dynamic Lookup Gateway (DLG) group + value management.
 *
 * The DLG extension uses Jackson (plain JSON), NOT XStream.
 * All requests use skipNormalize: true to bypass XStream normalization.
 */

import { request } from "./api-core";
import { getPluginProperties, setPluginProperties } from "./api-extensions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LookupGroupExtra {
  groupId: number;
  jsonIndexMode: "NONE" | "FIELD";
  /** Comma/newline-separated JSON field paths, e.g. "email,address.city" */
  indexedJsonFields: string;
}

export interface LookupGroup {
  id: number;
  name: string;
  description: string;
  version: string;
  cacheSize: number;
  cachePolicy: "LRU" | "FIFO";
  valueType: "TEXT" | "JSON";
  statisticsEnabled: boolean;
  createdDate: string;
  updatedDate: string;
  extra?: LookupGroupExtra;
}

export interface LookupGroupRequest {
  name: string;
  description: string;
  version: string;
  cacheSize: number;
  cachePolicy: "LRU" | "FIFO";
  valueType: "TEXT" | "JSON";
  statisticsEnabled: boolean;
  extra?: {
    jsonIndexMode: "NONE" | "FIELD";
    indexedJsonFields?: string;
  };
}

export interface LookupValue {
  keyValue: string;
  valueData: string;
  createdDate: string;
  updatedDate: string;
}

export interface LookupSearchFilter {
  keyFilter?: string;
  valueFilter?: string;
  keyFilterMode?: "PREFIX" | "CONTAINS" | "EXACT" | "PATTERN";
}

export interface LookupSearchResponse {
  groupId: number;
  groupName: string;
  totalCount: number;
  values: LookupValue[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export type LookupAuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "DELETE_ALL"
  | "IMPORT"
  | "CLEAR_ALL";

export interface LookupAuditEntry {
  id: number;
  groupId: number;
  keyValue: string;
  action: LookupAuditAction;
  oldValue: string | null;
  newValue: string | null;
  userName: string;
  timestamp: string;
}

export interface LookupAuditResponse {
  groupId: number;
  totalEntries: number;
  entries: LookupAuditEntry[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface CacheStatistics {
  statsSupported: boolean;
  evictionPolicy: string;
  currentEntryCount: number;
  configuredMaxEntries: number;
  hitCount: number;
  missCount: number;
  loadSuccessCount: number;
  loadExceptionCount: number;
  totalLoadTime: number;
  evictionCount: number;
  hitRatio: number;
  missRatio: number;
  totalLoadTimeFormatted: string;
}

export interface GroupStatisticsResponse {
  groupId: number;
  totalLookups: number;
  cacheHits: number;
  lastAccessed: string | null;
  resetDate: string | null;
  cacheStatistics: CacheStatistics | null;
}

export interface ExportLookupGroupResponse {
  group: LookupGroup;
  values: Record<string, string>;
  exportDate: string;
}

export interface ImportLookupGroupResponse {
  status: "success" | "error";
  groupId: number;
  importedCount: number;
  errors: string[];
}

// ─── Group API ────────────────────────────────────────────────────────────────

export async function getLookupGroups(): Promise<LookupGroup[]> {
  return request<LookupGroup[]>("/v1/lookups/groups", { skipNormalize: true });
}

export async function createLookupGroup(group: LookupGroupRequest): Promise<LookupGroup> {
  return request<LookupGroup>("/v1/lookups/groups", {
    method: "POST",
    body: JSON.stringify(group),
    skipNormalize: true,
  });
}

export async function updateLookupGroup(
  id: number,
  group: LookupGroupRequest
): Promise<LookupGroup> {
  return request<LookupGroup>(`/v1/lookups/groups/${id}`, {
    method: "PUT",
    body: JSON.stringify(group),
    skipNormalize: true,
  });
}

export async function deleteLookupGroup(id: number): Promise<void> {
  return request<void>(`/v1/lookups/groups/${id}`, {
    method: "DELETE",
    skipNormalize: true,
  });
}

// ─── Import / Export ──────────────────────────────────────────────────────────

/**
 * Imports a lookup group's metadata only. Mirrors the Java Swing client, which
 * always sends `values: {}` here and populates values via `importLookupValues`
 * afterwards (see GroupPanel.java:233-305). Sending values inline silently
 * skips them for JSON-type groups against the current server build.
 */
export async function importLookupGroup(
  payload: {
    group: LookupGroupRequest;
    values?: Record<string, string>;
  },
  updateIfExists = true
): Promise<ImportLookupGroupResponse> {
  return request<ImportLookupGroupResponse>(
    `/v1/lookups/groups/import?updateIfExists=${updateIfExists}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      skipNormalize: true,
    }
  );
}

export async function exportLookupGroup(id: number): Promise<ExportLookupGroupResponse> {
  return request<ExportLookupGroupResponse>(`/v1/lookups/groups/${id}/export`, {
    skipNormalize: true,
  });
}

// ─── Value API ────────────────────────────────────────────────────────────────

/** Returns the value for a key, or throws if not found (404). */
export async function getLookupValue(groupId: number, key: string): Promise<LookupValue> {
  return request<LookupValue>(`/v1/lookups/groups/${groupId}/values/${encodeURIComponent(key)}`, {
    skipNormalize: true,
  });
}

export async function searchLookupValues(
  groupId: number,
  filter: LookupSearchFilter,
  offset = 0,
  limit = 25
): Promise<LookupSearchResponse> {
  return request<LookupSearchResponse>(
    `/v1/lookups/groups/${groupId}/values/search?offset=${offset}&limit=${limit}`,
    {
      method: "POST",
      body: JSON.stringify(filter),
      skipNormalize: true,
    }
  );
}

export async function setLookupValue(groupId: number, key: string, value: string): Promise<void> {
  return request<void>(`/v1/lookups/groups/${groupId}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
    skipNormalize: true,
  });
}

export async function deleteLookupValue(groupId: number, key: string): Promise<void> {
  return request<void>(`/v1/lookups/groups/${groupId}/values/${encodeURIComponent(key)}`, {
    method: "DELETE",
    skipNormalize: true,
  });
}

export async function importLookupValues(
  groupId: number,
  values: Record<string, string>,
  clearExisting = false
): Promise<void> {
  return request<void>(`/v1/lookups/groups/${groupId}/values?clearExist=${clearExisting}`, {
    method: "POST",
    body: JSON.stringify({ values }),
    skipNormalize: true,
  });
}

/**
 * Number of values sent per import request. Mirrors the Java Swing client's
 * `batchSize` in ValuePanel.handleImportCsv (ValuePanel.java:839), which splits
 * large imports into chunks and sends one POST per chunk.
 */
export const LOOKUP_IMPORT_BATCH_SIZE = 100;

/**
 * Imports lookup values in batches of {@link LOOKUP_IMPORT_BATCH_SIZE}, sending
 * one `importLookupValues` request per batch. Mirrors the Java Swing client,
 * which chunks large Group/Value imports and shows a progress dialog instead of
 * sending the whole file in a single request.
 *
 * `clearExisting` is applied only to the FIRST batch — exactly as Java does
 * (`clearExisting && isFirstBatch`); otherwise each batch would wipe the values
 * loaded by the previous one. Subsequent batches always append.
 *
 * Cancellation (`isCancelled`) is checked between batches, matching Java's
 * `isCancelled()` placement. An in-flight batch is not aborted, and a cancelled
 * import leaves the already-imported batches in place (also matching Java).
 */
export async function importLookupValuesChunked(
  groupId: number,
  values: Record<string, string>,
  clearExisting: boolean,
  opts?: {
    onProgress?: (imported: number, total: number) => void;
    isCancelled?: () => boolean;
  }
): Promise<{ imported: number; cancelled: boolean }> {
  const entries = Object.entries(values);
  const total = entries.length;
  let imported = 0;
  let isFirstBatch = true;

  for (let i = 0; i < entries.length; i += LOOKUP_IMPORT_BATCH_SIZE) {
    if (opts?.isCancelled?.()) {
      return { imported, cancelled: true };
    }
    const batch = Object.fromEntries(entries.slice(i, i + LOOKUP_IMPORT_BATCH_SIZE));
    await importLookupValues(groupId, batch, clearExisting && isFirstBatch);
    isFirstBatch = false;
    imported += Object.keys(batch).length;
    opts?.onProgress?.(imported, total);
  }

  return { imported, cancelled: false };
}

// ─── Advanced JSON Search ─────────────────────────────────────────────────────

export type JsonOperator =
  | "EQUAL"
  | "NOT_EQUAL"
  | "GREATER_THAN"
  | "LESS_THAN"
  | "GREATER_OR_EQUAL"
  | "LESS_OR_EQUAL"
  | "CONTAINS"
  | "NOT_CONTAINS";

export type JsonValueType = "STRING" | "NUMBER" | "BOOLEAN";

export interface JsonCondition {
  field: string;
  op: JsonOperator;
  valueType: JsonValueType;
  value: string;
}

export interface AdvancedJsonFilter {
  keyPattern?: string;
  conditions: JsonCondition[];
}

export async function searchLookupValuesAdvanced(
  groupId: number,
  filter: AdvancedJsonFilter,
  offset = 0,
  limit = 25
): Promise<LookupSearchResponse> {
  return request<LookupSearchResponse>(
    `/v1/lookups/groups/${groupId}/values/search-advanced?offset=${offset}&limit=${limit}`,
    { method: "POST", body: JSON.stringify(filter), skipNormalize: true }
  );
}

// ─── Advanced Search saved filters ─────────────────────────────────────────────

/**
 * A named, persisted Advanced Search filter. Mirrors the Java client's
 * SavedFilterEntry { name, state }. Stored server-side as a single global list
 * (shared across all lookup groups and interchangeable with the Java client),
 * so the Web UI reads/writes the exact same JSON shape.
 */
export interface SavedFilter {
  name: string;
  filter: AdvancedJsonFilter;
}

/** Plugin name passed to get/setPluginProperties (matches Java LookupProperties). */
export const LOOKUP_PLUGIN_NAME = "Lookup Table Management System";
/** Property key the Java client stores saved filters under. */
const SAVED_FILTERS_KEY = "dynamiclookup.advancedSearch.savedFilters";

/**
 * On-the-wire entry shape: the Java client wraps the filter under `state`
 * (not `filter`). `op`/`valueType` are serialized as enum names; `value` may
 * arrive as a JSON number/boolean since Java stores it as an untyped Object.
 */
interface SavedFilterWire {
  name: string;
  state?: {
    keyPattern?: string | null;
    conditions?: Array<{
      field?: string;
      op?: JsonOperator;
      valueType?: JsonValueType;
      value?: unknown;
    }>;
  };
}

function wireToSavedFilter(entry: SavedFilterWire): SavedFilter {
  const conditions: JsonCondition[] = (entry.state?.conditions ?? []).map((c) => ({
    field: c.field ?? "",
    op: c.op ?? "EQUAL",
    valueType: c.valueType ?? "STRING",
    value: c.value == null ? "" : String(c.value),
  }));
  const keyPattern = entry.state?.keyPattern?.trim();
  return {
    name: entry.name,
    filter: { ...(keyPattern ? { keyPattern } : {}), conditions },
  };
}

function savedFilterToWire(sf: SavedFilter): SavedFilterWire {
  const { keyPattern, conditions } = sf.filter;
  return {
    name: sf.name,
    state: {
      ...(keyPattern && keyPattern.trim() ? { keyPattern: keyPattern.trim() } : {}),
      conditions: conditions.map((c) => ({
        field: c.field,
        op: c.op,
        valueType: c.valueType,
        value: c.value,
      })),
    },
  };
}

/** Loads the global saved-filter list from the server plugin property. */
export async function getSavedAdvancedFilters(): Promise<SavedFilter[]> {
  const props = await getPluginProperties(LOOKUP_PLUGIN_NAME);
  const raw = props[SAVED_FILTERS_KEY];
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as SavedFilterWire[];
    return Array.isArray(parsed) ? parsed.map(wireToSavedFilter) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the global saved-filter list, preserving the other co-located
 * plugin properties (e.g. dynamiclookup.audit.prune.*) via read-modify-write.
 */
export async function saveSavedAdvancedFilters(filters: SavedFilter[]): Promise<void> {
  const props = await getPluginProperties(LOOKUP_PLUGIN_NAME);
  props[SAVED_FILTERS_KEY] = JSON.stringify(filters.map(savedFilterToWire));
  await setPluginProperties(LOOKUP_PLUGIN_NAME, props);
}

// ─── Statistics & Cache ───────────────────────────────────────────────────────

export async function getLookupGroupStatistics(groupId: number): Promise<GroupStatisticsResponse> {
  return request<GroupStatisticsResponse>(`/v1/lookups/groups/${groupId}/statistics`, {
    skipNormalize: true,
  });
}

export async function resetLookupGroupStatistics(groupId: number): Promise<void> {
  return request<void>(`/v1/lookups/groups/${groupId}/statistics/reset`, {
    method: "POST",
    skipNormalize: true,
  });
}

export async function clearLookupGroupCache(groupId: number): Promise<void> {
  return request<void>(`/v1/lookups/groups/${groupId}/cache/clear`, {
    method: "POST",
    skipNormalize: true,
  });
}

// ─── Audit / History ─────────────────────────────────────────────────────────

/**
 * Filter criteria for an audit-history search. Mirrors the Java
 * `HistoryFilterState` shape consumed by `POST /audit/search`.
 *
 * - `userId` is the numeric user id as a string (`"0"` = System); omit for all users.
 * - `startDate`/`endDate` are ISO local datetimes, e.g. `"2025-06-01T00:00:00"`.
 */
export interface LookupAuditFilter {
  keyValue?: string;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Searches a lookup group's audit history. Mirrors the Java Swing client
 * (`HistoryPanel.loadPage` → `LookupServiceClient.searchAuditEntries`), which
 * calls `POST /v1/lookups/groups/{id}/audit/search?offset=N&limit=N` with a
 * `HistoryFilterState` JSON body. The plain `GET /audit` endpoint only honors
 * `offset`/`limit` and ignores every filter, so it must not be used here.
 *
 * `startDate`/`endDate` are date-only strings (`yyyy-MM-dd`) from the filter
 * inputs; they are widened to a full-day ISO range to match the Java client's
 * combined date + time pickers. Empty filter fields are omitted from the body.
 */
export async function searchLookupGroupAudit(
  groupId: number,
  params: {
    offset?: number;
    limit?: number;
    keyValue?: string;
    action?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<LookupAuditResponse> {
  const qs = new URLSearchParams();
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.limit != null) qs.set("limit", String(params.limit));
  const query = qs.toString() ? `?${qs.toString()}` : "";

  const filter: LookupAuditFilter = {};
  if (params.keyValue) filter.keyValue = params.keyValue;
  if (params.action) filter.action = params.action;
  if (params.userId) filter.userId = params.userId;
  if (params.startDate) filter.startDate = `${params.startDate}T00:00:00`;
  if (params.endDate) filter.endDate = `${params.endDate}T23:59:59`;

  return request<LookupAuditResponse>(`/v1/lookups/groups/${groupId}/audit/search${query}`, {
    method: "POST",
    body: JSON.stringify(filter),
    skipNormalize: true,
  });
}
