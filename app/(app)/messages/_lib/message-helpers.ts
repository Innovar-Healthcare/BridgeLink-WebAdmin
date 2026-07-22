import { format } from "date-fns";
import type { MessageFilter } from "@/lib/api-client";
import {
  emptyAdvancedFilter,
  type AdvancedFilterState,
  type MetaDataColumnInfo,
} from "@/components/messages/advanced-filter-panel";

export interface UrlFilterParams {
  messageId: string | null;
  minMessageId: string | null;
  maxMessageId: string | null;
  metaDataColumn: string | null;
  metaDataValue: string | null;
  metaDataOperator: string | null;
}

/**
 * Build an AdvancedFilterState from URL query parameters.
 * Starts from emptyAdvancedFilter() — resets any prior session state.
 * Returns null when no filter params are present.
 */
export function buildAdvancedFilterFromUrl(
  params: UrlFilterParams,
  metaDataColumns: MetaDataColumnInfo[]
): AdvancedFilterState | null {
  const { messageId, minMessageId, maxMessageId, metaDataColumn, metaDataValue, metaDataOperator } =
    params;

  const hasAny = !!(messageId || minMessageId || maxMessageId || metaDataColumn);
  if (!hasAny) return null;

  const filter = emptyAdvancedFilter();

  // Message ID range — messageId is shorthand for exact match; explicit min/max override it
  if (messageId) {
    const n = Number(messageId);
    if (Number.isFinite(n)) {
      filter.minMessageId = messageId;
      filter.maxMessageId = messageId;
    }
  }
  if (minMessageId) {
    const n = Number(minMessageId);
    if (Number.isFinite(n)) filter.minMessageId = minMessageId;
  }
  if (maxMessageId) {
    const n = Number(maxMessageId);
    if (Number.isFinite(n)) filter.maxMessageId = maxMessageId;
  }

  // Metadata search row — only when both column and value are provided AND the
  // column actually exists on the selected channel. Searching a column the
  // channel does not have makes the server throw (500), so an unknown column is
  // dropped rather than passed through by literal name. This mirrors the Java
  // client, where the column can only be chosen from the channel's real columns.
  if (metaDataColumn && metaDataValue) {
    const lowerParam = metaDataColumn.toLowerCase();
    const matched = metaDataColumns.find((c) => c.name.toLowerCase() === lowerParam);
    if (matched) {
      filter.metaDataSearchRows = [
        {
          columnName: matched.name,
          operator: metaDataOperator ?? "EQUAL",
          value: metaDataValue,
          ignoreCase: false,
          columnType: matched.type,
        },
      ];
    }
  }

  return filter;
}

export function formatTs(ts?: string) {
  if (!ts) return "\u2014";
  try {
    return format(new Date(ts), "yyyy-MM-dd HH:mm:ss.SSS");
  } catch {
    return ts;
  }
}

export function formatDateOnly(d: Date) {
  return format(d, "yyyy-MM-dd");
}

/** Human-readable summary of a MessageFilter for the PHI "Queried PHI" audit attribute.
 *  Approximates Java MessageFilter.toString() via MessageFilterToStringStyle. */
export function stringifyMessageFilter(filter: MessageFilter): string {
  const parts: string[] = [];
  if (filter.maxMessageId != null) parts.push(`maxMessageId=${filter.maxMessageId}`);
  if (filter.minMessageId != null) parts.push(`minMessageId=${filter.minMessageId}`);
  if (filter.startDate) parts.push(`startDate=${new Date(filter.startDate.time).toISOString()}`);
  if (filter.endDate) parts.push(`endDate=${new Date(filter.endDate.time).toISOString()}`);
  if (filter.textSearch) parts.push(`textSearch=${filter.textSearch}`);
  if (filter.textSearchRegex) parts.push(`textSearchRegex=true`);
  if (filter.statuses?.length) parts.push(`statuses=[${filter.statuses.join(",")}]`);
  if (filter.originalIdLower != null) parts.push(`originalIdLower=${filter.originalIdLower}`);
  if (filter.originalIdUpper != null) parts.push(`originalIdUpper=${filter.originalIdUpper}`);
  if (filter.importIdLower != null) parts.push(`importIdLower=${filter.importIdLower}`);
  if (filter.importIdUpper != null) parts.push(`importIdUpper=${filter.importIdUpper}`);
  if (filter.serverId) parts.push(`serverId=${filter.serverId}`);
  if (filter.sendAttemptsLower != null) parts.push(`sendAttemptsLower=${filter.sendAttemptsLower}`);
  if (filter.sendAttemptsUpper != null) parts.push(`sendAttemptsUpper=${filter.sendAttemptsUpper}`);
  if (filter.attachment) parts.push(`attachment=true`);
  if (filter.error) parts.push(`error=true`);
  if (filter.metaDataSearch?.length) {
    const mds = filter.metaDataSearch.map(
      (el) => `${el.columnName} ${el.operator} ${String(el.value)}`
    );
    parts.push(`metaDataSearch=[${mds.join(", ")}]`);
  }
  if (filter.contentSearch?.length) {
    parts.push(`contentSearch=[${filter.contentSearch.length} criteria]`);
  }
  return `MessageFilter[${parts.join(", ")}]`;
}
