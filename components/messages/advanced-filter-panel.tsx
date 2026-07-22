"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { ContentSearchElement, MetaDataSearchElement } from "@/lib/types";
import { castMetaDataValue } from "@/lib/api/api-messages";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { HoverTooltip } from "@/components/hover-tooltip";

/** Field hover tooltips ported from Java MessageBrowserAdvancedFilter. */
const TIP = {
  serverId:
    "The GUID of the message in the BridgeLink database. This can be retrieved from the Meta Data tab in the Message Browser.",
  contentSearch:
    "Search specific message content. This process could take a long time depending on the amount of message content currently stored. Any message content that was encrypted by this channel will not be searchable.",
  connectors:
    "Include messages from the selected connectors. Connectors that were removed from this channel are not available to select. Messages for removed connectors will only be included if all connectors are selected. If a connector's name has changed, messages before the name change will still be included.",
  metaDataSearch:
    "Search on custom metadata stored for this channel. Note that if Ignore Case is unchecked, case sensitivity depends on the database collation.",
  hasAttachment: "If checked, only messages with attachments will be included.",
  hasError: "If checked, only messages with errors will be included.",
} as const;

// ── Content Type codes (from Java ContentType enum) ──────────────────────────
// Order mirrors Java ContentType.getDisplayValues(): message types, then map
// types (Source Map last among maps), then error types. Codes are unchanged.

export const CONTENT_TYPE_OPTIONS = [
  { code: 1, label: "Raw" },
  { code: 2, label: "Processed Raw" },
  { code: 3, label: "Transformed" },
  { code: 4, label: "Encoded" },
  { code: 5, label: "Sent" },
  { code: 6, label: "Response" },
  { code: 7, label: "Response Transformed" },
  { code: 8, label: "Processed Response" },
  { code: 9, label: "Connector Map" },
  { code: 10, label: "Channel Map" },
  { code: 11, label: "Response Map" },
  { code: 15, label: "Source Map" },
  { code: 12, label: "Processing Error" },
  { code: 13, label: "Postprocessor Error" },
  { code: 14, label: "Response Error" },
] as const;

// ── Operator options per metadata column type ────────────────────────────────

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  STRING: [
    { value: "EQUAL", label: "=" },
    { value: "NOT_EQUAL", label: "!=" },
    { value: "CONTAINS", label: "Contains" },
    { value: "DOES_NOT_CONTAIN", label: "Does Not Contain" },
    { value: "STARTS_WITH", label: "Starts With" },
    { value: "DOES_NOT_START_WITH", label: "Does Not Start With" },
    { value: "ENDS_WITH", label: "Ends With" },
    { value: "DOES_NOT_END_WITH", label: "Does Not End With" },
  ],
  NUMBER: [
    { value: "EQUAL", label: "=" },
    { value: "NOT_EQUAL", label: "!=" },
    { value: "LESS_THAN", label: "<" },
    { value: "LESS_THAN_OR_EQUAL", label: "<=" },
    { value: "GREATER_THAN", label: ">" },
    { value: "GREATER_THAN_OR_EQUAL", label: ">=" },
  ],
  BOOLEAN: [
    { value: "EQUAL", label: "=" },
    { value: "NOT_EQUAL", label: "!=" },
  ],
  TIMESTAMP: [
    { value: "EQUAL", label: "=" },
    { value: "NOT_EQUAL", label: "!=" },
    { value: "LESS_THAN", label: "<" },
    { value: "LESS_THAN_OR_EQUAL", label: "<=" },
    { value: "GREATER_THAN", label: ">" },
    { value: "GREATER_THAN_OR_EQUAL", label: ">=" },
  ],
};

// ── Connector info (metaDataId → name) ───────────────────────────────────────

export interface ConnectorInfo {
  metaDataId: number;
  name: string;
}

/**
 * Synthetic metaDataId for the "Deleted Connectors" pseudo-entry. Java uses a `null` map key
 * (MessageBrowser.java: `connectors.put(null, "Deleted Connectors")`); metaDataId is a `number`
 * here, so -1 stands in — it never collides with a real connector id (source is 0, destinations
 * are positive) and is filtered out of every consumer that keys on `metaDataId > 0`.
 */
export const DELETED_CONNECTORS_METADATA_ID = -1;
export const DELETED_CONNECTORS_LABEL = "Deleted Connectors";

/**
 * Reconcile a persisted connector selection against the channel's actual roster.
 *
 * `selectedConnectors` is sessionStorage-persisted, but metaDataIds are channel-specific — a
 * selection carried over from another channel (or a stale reload) can reference ids the current
 * channel doesn't have. Java sidesteps this by rebuilding the connector table per channel; we
 * instead drop ids absent from the roster and collapse to `null` ("all selected") when the result
 * is empty or already covers the whole roster. Returns the original reference when nothing changed
 * so callers can skip a redundant state write.
 */
export function reconcileConnectorSelection(
  selected: number[] | null,
  roster: ConnectorInfo[]
): number[] | null {
  if (selected === null) return null;
  const ids = new Set(roster.map((c) => c.metaDataId));
  const kept = selected.filter((id) => ids.has(id));
  if (kept.length === 0 || kept.length === roster.length) return null;
  return kept.length === selected.length ? selected : kept;
}

// ── Metadata column info ─────────────────────────────────────────────────────

export interface MetaDataColumnInfo {
  name: string;
  type: string; // "STRING" | "NUMBER" | "BOOLEAN" | "TIMESTAMP"
}

// ── Advanced filter state ────────────────────────────────────────────────────

export interface AdvancedFilterState {
  /** Which connectors to include (null = all) */
  selectedConnectors: number[] | null;
  /** ID ranges */
  minMessageId: string;
  maxMessageId: string;
  originalIdLower: string;
  originalIdUpper: string;
  importIdLower: string;
  importIdUpper: string;
  /** Server */
  serverId: string;
  /** Send attempts */
  sendAttemptsLower: string;
  sendAttemptsUpper: string;
  /** Boolean flags */
  hasAttachment: boolean;
  hasError: boolean;
  /** Content search rows */
  contentSearchRows: { contentCode: number; search: string }[];
  /** Metadata search rows */
  metaDataSearchRows: {
    columnName: string;
    operator: string;
    value: string;
    ignoreCase: boolean;
    columnType: string;
  }[];
}

export function emptyAdvancedFilter(): AdvancedFilterState {
  return {
    selectedConnectors: null,
    minMessageId: "",
    maxMessageId: "",
    originalIdLower: "",
    originalIdUpper: "",
    importIdLower: "",
    importIdUpper: "",
    serverId: "",
    sendAttemptsLower: "",
    sendAttemptsUpper: "",
    hasAttachment: false,
    hasError: false,
    contentSearchRows: [],
    metaDataSearchRows: [],
  };
}

/**
 * Build MessageFilter fields from the AdvancedFilterState.
 * Returns only the fields that have values.
 *
 * `connectors` is the channel's full connector roster (including the synthetic "Deleted Connectors"
 * entry) — required to compute the included/excluded split. It defaults to `[]` so callers that
 * don't filter on connectors still work.
 */
export function applyAdvancedFilter(
  state: AdvancedFilterState,
  connectors: ConnectorInfo[] = []
): {
  includedMetaDataIds?: number[];
  excludedMetaDataIds?: number[];
  minMessageId?: number;
  maxMessageId?: number;
  originalIdLower?: number;
  originalIdUpper?: number;
  importIdLower?: number;
  importIdUpper?: number;
  serverId?: string;
  sendAttemptsLower?: number;
  sendAttemptsUpper?: number;
  attachment?: boolean;
  error?: boolean;
  contentSearch?: ContentSearchElement[];
  metaDataSearch?: MetaDataSearchElement[];
} {
  const result: ReturnType<typeof applyAdvancedFilter> = {};

  // Connector filter — mirrors Java MessageBrowserAdvancedFilter.applySelectionsToFilter +
  // getMetaDataIds: all selected → set neither field; a partial selection that INCLUDES "Deleted
  // Connectors" → excludedMetaDataIds (the unselected real ids); a partial selection WITHOUT it →
  // includedMetaDataIds (the selected real ids). `null` here is the WebUI's "all selected" marker.
  const selected = state.selectedConnectors;
  if (selected !== null && (connectors.length === 0 || selected.length !== connectors.length)) {
    if (selected.includes(DELETED_CONNECTORS_METADATA_ID)) {
      const excluded = connectors
        .map((c) => c.metaDataId)
        .filter((id) => id !== DELETED_CONNECTORS_METADATA_ID && !selected.includes(id));
      if (excluded.length > 0) result.excludedMetaDataIds = excluded;
    } else {
      result.includedMetaDataIds = selected.filter((id) => id !== DELETED_CONNECTORS_METADATA_ID);
    }
  }

  // ID ranges
  if (state.minMessageId) result.minMessageId = Number(state.minMessageId);
  if (state.maxMessageId) result.maxMessageId = Number(state.maxMessageId);
  if (state.originalIdLower) result.originalIdLower = Number(state.originalIdLower);
  if (state.originalIdUpper) result.originalIdUpper = Number(state.originalIdUpper);
  if (state.importIdLower) result.importIdLower = Number(state.importIdLower);
  if (state.importIdUpper) result.importIdUpper = Number(state.importIdUpper);

  // Server
  if (state.serverId.trim()) result.serverId = state.serverId.trim();

  // Send attempts
  const saLower = state.sendAttemptsLower ? Number(state.sendAttemptsLower) : null;
  const saUpper = state.sendAttemptsUpper ? Number(state.sendAttemptsUpper) : null;
  if (saLower != null && saUpper != null && saLower > saUpper) {
    // Java behavior: if lower > upper, both are set to null
  } else {
    // Java treats a lower bound <= 0 as unset, but accepts an explicit upper
    // bound of 0 (= "0 or fewer send attempts"); only the lower is gated > 0.
    if (saLower != null && saLower > 0) result.sendAttemptsLower = saLower;
    if (saUpper != null && saUpper >= 0) result.sendAttemptsUpper = saUpper;
  }

  // Boolean flags
  if (state.hasAttachment) result.attachment = true;
  if (state.hasError) result.error = true;

  // Content search
  const contentSearchMap = new Map<number, string[]>();
  for (const row of state.contentSearchRows) {
    if (!row.search.trim()) continue;
    const existing = contentSearchMap.get(row.contentCode);
    if (existing) {
      existing.push(row.search.trim());
    } else {
      contentSearchMap.set(row.contentCode, [row.search.trim()]);
    }
  }
  if (contentSearchMap.size > 0) {
    result.contentSearch = Array.from(contentSearchMap.entries()).map(([code, searches]) => ({
      contentCode: code,
      searches,
    }));
  }

  // Metadata search — cast/normalize each value to match Java
  // MetaDataColumnType.castValue (STRING truncated to 255, BOOLEAN normalized,
  // NUMBER/TIMESTAMP validated). Invalid rows are blocked before search via
  // hasMetaDataSearchErrors, so the raw fallback here is never actually sent.
  const metaDataRows = state.metaDataSearchRows.filter((r) => r.value.trim() !== "");
  if (metaDataRows.length > 0) {
    result.metaDataSearch = metaDataRows.map((r) => {
      const cast = castMetaDataValue(r.value, r.columnType);
      return {
        columnName: r.columnName,
        operator: r.operator,
        value: cast.ok ? cast.value : r.value.trim(),
        ignoreCase: r.ignoreCase,
        columnType: r.columnType,
      };
    });
  }

  return result;
}

/**
 * Validation error for a single metadata-search row, or null when valid/empty.
 * Mirrors Java MessageBrowserAdvancedFilter's per-cell castValue check.
 */
export function metaDataSearchRowError(row: { value: string; columnType: string }): string | null {
  if (row.value.trim() === "") return null;
  const cast = castMetaDataValue(row.value, row.columnType);
  return cast.ok ? null : cast.error;
}

/** True when any metadata-search row holds an invalid value (blocks search). */
export function hasMetaDataSearchErrors(state: AdvancedFilterState): boolean {
  return state.metaDataSearchRows.some((r) => metaDataSearchRowError(r) !== null);
}

// ── Panel Props ──────────────────────────────────────────────────────────────

interface AdvancedFilterPanelProps {
  state: AdvancedFilterState;
  onStateChange: (state: AdvancedFilterState) => void;
  connectors: ConnectorInfo[];
  metaDataColumns: MetaDataColumnInfo[];
}

export function AdvancedFilterPanel({
  state,
  onStateChange,
  connectors,
  metaDataColumns,
}: AdvancedFilterPanelProps) {
  const { viewDensity } = useCompactMode();
  const sectionSpacing =
    viewDensity === "comfortable"
      ? "space-y-5"
      : viewDensity === "compact"
        ? "space-y-3"
        : "space-y-4";
  const rowGap = viewDensity === "comfortable" ? "gap-3" : "gap-2";

  const update = useCallback(
    (patch: Partial<AdvancedFilterState>) => {
      onStateChange({ ...state, ...patch });
    },
    [state, onStateChange]
  );

  function handleReset() {
    onStateChange(emptyAdvancedFilter());
  }

  // ── Connector toggle ──

  function toggleConnector(metaDataId: number) {
    const current = state.selectedConnectors;
    // If null (all selected), switch to "all minus this one"
    if (current === null) {
      const all = connectors.map((c) => c.metaDataId);
      onStateChange({ ...state, selectedConnectors: all.filter((id) => id !== metaDataId) });
      return;
    }
    // Toggle
    if (current.includes(metaDataId)) {
      const next = current.filter((id) => id !== metaDataId);
      // If all are unchecked, reset to null (all selected)
      onStateChange({ ...state, selectedConnectors: next.length === 0 ? null : next });
      return;
    }
    const next = [...current, metaDataId];
    // If all are now checked, reset to null
    onStateChange({
      ...state,
      selectedConnectors: next.length === connectors.length ? null : next,
    });
  }

  function isConnectorChecked(metaDataId: number): boolean {
    return state.selectedConnectors === null || state.selectedConnectors.includes(metaDataId);
  }

  // ── Content search rows ──

  function addContentSearchRow() {
    update({
      contentSearchRows: [...state.contentSearchRows, { contentCode: 1, search: "" }],
    });
  }

  function removeContentSearchRow(idx: number) {
    update({
      contentSearchRows: state.contentSearchRows.filter((_, i) => i !== idx),
    });
  }

  function updateContentSearchRow(
    idx: number,
    patch: Partial<{ contentCode: number; search: string }>
  ) {
    update({
      contentSearchRows: state.contentSearchRows.map((r, i) =>
        i === idx ? { ...r, ...patch } : r
      ),
    });
  }

  // ── Metadata search rows ──

  function addMetaDataSearchRow() {
    const firstCol = metaDataColumns[0];
    if (!firstCol) return;
    update({
      metaDataSearchRows: [
        ...state.metaDataSearchRows,
        {
          columnName: firstCol.name,
          operator: "EQUAL",
          value: "",
          ignoreCase: false,
          columnType: firstCol.type,
        },
      ],
    });
  }

  function removeMetaDataSearchRow(idx: number) {
    update({
      metaDataSearchRows: state.metaDataSearchRows.filter((_, i) => i !== idx),
    });
  }

  function updateMetaDataSearchRow(
    idx: number,
    patch: Partial<{ columnName: string; operator: string; value: string; ignoreCase: boolean }>
  ) {
    update({
      metaDataSearchRows: state.metaDataSearchRows.map((r, i) => {
        if (i !== idx) return r;
        const updated = { ...r, ...patch };
        // When column changes, reset operator and value (matches Java behavior)
        if (patch.columnName && patch.columnName !== r.columnName) {
          updated.operator = "EQUAL";
          updated.value = "";
          const col = metaDataColumns.find((c) => c.name === patch.columnName);
          updated.ignoreCase = col?.type === "STRING" ? r.ignoreCase : false;
          updated.columnType = col?.type ?? "STRING";
        }
        return updated;
      }),
    });
  }

  function getColumnType(columnName: string): string {
    return metaDataColumns.find((c) => c.name === columnName)?.type ?? "STRING";
  }

  return (
    <div className={sectionSpacing}>
      {/* ── Connector Filter ── */}
      {connectors.length > 0 && (
        <section>
          <HoverTooltip content={TIP.connectors}>
            <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 w-fit">
              Connectors
            </Label>
          </HoverTooltip>
          <div className="flex flex-wrap gap-2 p-2 border rounded-md bg-gray-50/50 dark:bg-gray-800/50">
            {connectors.map((c) => (
              <FormCheckbox
                key={c.metaDataId}
                label={c.name}
                checked={isConnectorChecked(c.metaDataId)}
                onChange={() => toggleConnector(c.metaDataId)}
                size="xs"
              />
            ))}
          </div>
        </section>
      )}

      {/* ── ID Ranges ── */}
      <section>
        <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 block">
          ID Ranges
        </Label>
        <div className={`grid grid-cols-1 sm:grid-cols-3 ${rowGap}`}>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-500 dark:text-gray-400 shrink-0 w-20">
              Message ID
            </Label>
            <Input
              type="number"
              value={state.minMessageId}
              onChange={(e) => update({ minMessageId: e.target.value })}
              density={viewDensity}
              className="text-xs flex-1"
              placeholder="Min"
            />
            <Input
              type="number"
              value={state.maxMessageId}
              onChange={(e) => update({ maxMessageId: e.target.value })}
              density={viewDensity}
              className="text-xs flex-1"
              placeholder="Max"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-500 dark:text-gray-400 shrink-0 w-20">
              Original ID
            </Label>
            <Input
              type="number"
              value={state.originalIdLower}
              onChange={(e) => update({ originalIdLower: e.target.value })}
              density={viewDensity}
              className="text-xs flex-1"
              placeholder="Min"
            />
            <Input
              type="number"
              value={state.originalIdUpper}
              onChange={(e) => update({ originalIdUpper: e.target.value })}
              density={viewDensity}
              className="text-xs flex-1"
              placeholder="Max"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-500 dark:text-gray-400 shrink-0 w-20">
              Import ID
            </Label>
            <Input
              type="number"
              value={state.importIdLower}
              onChange={(e) => update({ importIdLower: e.target.value })}
              density={viewDensity}
              className="text-xs flex-1"
              placeholder="Min"
            />
            <Input
              type="number"
              value={state.importIdUpper}
              onChange={(e) => update({ importIdUpper: e.target.value })}
              density={viewDensity}
              className="text-xs flex-1"
              placeholder="Max"
            />
          </div>
        </div>
      </section>

      {/* ── Server & Send Attempts ── */}
      <section className={`grid grid-cols-1 sm:grid-cols-3 ${rowGap}`}>
        <div className="flex items-center gap-2">
          <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0 w-20">
            Server ID
          </Label>
          <HoverTooltip content={TIP.serverId}>
            <Input
              value={state.serverId}
              onChange={(e) => update({ serverId: e.target.value })}
              density={viewDensity}
              className="text-xs flex-1"
              placeholder="Server ID"
            />
          </HoverTooltip>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0 w-24">
            Send Attempts
          </Label>
          <Input
            type="number"
            min={0}
            value={state.sendAttemptsLower}
            onChange={(e) => update({ sendAttemptsLower: e.target.value })}
            density={viewDensity}
            className="text-xs flex-1"
            placeholder="Min"
          />
          <Input
            type="number"
            min={0}
            value={state.sendAttemptsUpper}
            onChange={(e) => update({ sendAttemptsUpper: e.target.value })}
            density={viewDensity}
            className="text-xs flex-1"
            placeholder="Max"
          />
        </div>
      </section>

      {/* ── Boolean Flags ── */}
      <section className="flex items-center gap-6">
        <FormCheckbox
          label="Has Attachment"
          checked={state.hasAttachment}
          onChange={(v) => update({ hasAttachment: v })}
          size="xs"
          tooltip={TIP.hasAttachment}
        />
        <FormCheckbox
          label="Has Error"
          checked={state.hasError}
          onChange={(v) => update({ hasError: v })}
          size="xs"
          tooltip={TIP.hasError}
        />
      </section>

      {/* ── Content Search ── */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <HoverTooltip content={TIP.contentSearch}>
            <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-fit">
              Content Search
            </Label>
          </HoverTooltip>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={addContentSearchRow}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add
          </Button>
        </div>
        {state.contentSearchRows.length > 0 ? (
          <div className="space-y-1.5">
            {state.contentSearchRows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={String(row.contentCode)}
                  onValueChange={(v) => updateContentSearchRow(idx, { contentCode: Number(v) })}
                >
                  <SelectTrigger density={viewDensity} className="w-52 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTENT_TYPE_OPTIONS.map((ct) => (
                      <SelectItem key={ct.code} value={String(ct.code)}>
                        {ct.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={row.search}
                  onChange={(e) => updateContentSearchRow(idx, { search: e.target.value })}
                  density={viewDensity}
                  className="text-xs flex-1"
                  placeholder="Search text..."
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-gray-400 hover:text-red-500"
                  onClick={() => removeContentSearchRow(idx)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">No content search criteria.</p>
        )}
      </section>

      {/* ── Metadata Search ── */}
      {metaDataColumns.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <HoverTooltip content={TIP.metaDataSearch}>
              <Label className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-fit">
                Metadata Search
              </Label>
            </HoverTooltip>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={addMetaDataSearchRow}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          </div>
          {state.metaDataSearchRows.length > 0 ? (
            <div className="space-y-1.5">
              {state.metaDataSearchRows.map((row, idx) => {
                const colType = getColumnType(row.columnName);
                const ops = OPERATOR_OPTIONS[colType] ?? OPERATOR_OPTIONS.STRING;
                const valueError = metaDataSearchRowError({
                  value: row.value,
                  columnType: colType,
                });
                return (
                  <div key={idx}>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={row.columnName}
                        onValueChange={(v) => updateMetaDataSearchRow(idx, { columnName: v })}
                      >
                        <SelectTrigger density={viewDensity} className="w-44 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {metaDataColumns.map((mc) => (
                            <SelectItem key={mc.name} value={mc.name}>
                              {mc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={row.operator}
                        onValueChange={(v) => updateMetaDataSearchRow(idx, { operator: v })}
                      >
                        <SelectTrigger density={viewDensity} className="w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ops.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={row.value}
                        onChange={(e) => updateMetaDataSearchRow(idx, { value: e.target.value })}
                        density={viewDensity}
                        aria-invalid={valueError != null}
                        className={`text-xs flex-1 ${valueError ? "border-red-500" : ""}`}
                        placeholder="Value..."
                      />
                      {colType === "STRING" && (
                        <FormCheckbox
                          label="Ignore Case"
                          checked={row.ignoreCase}
                          onChange={(v) => updateMetaDataSearchRow(idx, { ignoreCase: v })}
                          size="xs"
                          className="shrink-0"
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-gray-400 hover:text-red-500 shrink-0"
                        onClick={() => removeMetaDataSearchRow(idx)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {valueError && (
                      <p className="text-xs text-red-500 mt-0.5 ml-[12.5rem]">{valueError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No metadata search criteria.</p>
          )}
        </section>
      )}

      {/* ── Reset button ── */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleReset}>
          Reset Advanced
        </Button>
      </div>
    </div>
  );
}
