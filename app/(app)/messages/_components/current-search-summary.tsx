import type { MessageFilter } from "@/lib/api-client";
import type { AdvancedFilterState } from "@/components/messages/advanced-filter-panel";

export function CurrentSearchSummary({
  filter,
  channelName,
  advancedFilter,
}: {
  filter: MessageFilter;
  channelName: string;
  advancedFilter: AdvancedFilterState;
}) {
  const parts: string[] = [];

  if (channelName) parts.push(`Channel: ${channelName}`);

  if (filter.startDate) {
    parts.push(`Start: ${new Date(filter.startDate.time).toLocaleString()}`);
  }
  if (filter.endDate) {
    parts.push(`End: ${new Date(filter.endDate.time).toLocaleString()}`);
  }
  if (filter.statuses?.length) {
    parts.push(`Status: ${filter.statuses.join(", ")}`);
  }
  if (filter.textSearch) {
    const regex = filter.textSearchRegex ? " (Regex)" : "";
    parts.push(`Text: "${filter.textSearch}"${regex}`);
  }
  if (filter.minMessageId != null || filter.maxMessageId != null) {
    const min = filter.minMessageId ?? "...";
    const max = filter.maxMessageId ?? "...";
    parts.push(`Message ID: ${min} - ${max}`);
  }
  if (advancedFilter.originalIdLower || advancedFilter.originalIdUpper) {
    parts.push(
      `Original ID: ${advancedFilter.originalIdLower || "..."} - ${advancedFilter.originalIdUpper || "..."}`
    );
  }
  if (advancedFilter.importIdLower || advancedFilter.importIdUpper) {
    parts.push(
      `Import ID: ${advancedFilter.importIdLower || "..."} - ${advancedFilter.importIdUpper || "..."}`
    );
  }
  if (advancedFilter.serverId.trim()) {
    parts.push(`Server: ${advancedFilter.serverId}`);
  }
  if (advancedFilter.hasAttachment) parts.push("Has Attachment");
  if (advancedFilter.hasError) parts.push("Has Error");
  if (advancedFilter.selectedConnectors !== null) {
    parts.push(`Connectors: ${advancedFilter.selectedConnectors.length} selected`);
  }
  if (advancedFilter.contentSearchRows.length > 0) {
    parts.push(`Content Search: ${advancedFilter.contentSearchRows.length} criteria`);
  }
  if (advancedFilter.metaDataSearchRows.length > 0) {
    parts.push(`Metadata Search: ${advancedFilter.metaDataSearchRows.length} criteria`);
  }

  if (parts.length === 0) return null;

  return (
    <div className="px-6 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-border">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          Current Search
        </span>
        {parts.map((part, i) => (
          <span
            key={i}
            className="inline-flex items-center px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 border border-border rounded"
          >
            {part}
          </span>
        ))}
      </div>
    </div>
  );
}
