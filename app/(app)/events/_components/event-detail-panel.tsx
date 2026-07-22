"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { ServerEvent } from "@/lib/types";
import { DataTable } from "@/components/data-table";
import { ValueDetailDialog } from "@/components/value-detail-dialog";
import { CELL_PREVIEW_CHARS, truncate } from "@/lib/value-format";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import {
  getEventChannelIdWithMessageId,
  getEventChannelName,
  getEventPatientId,
} from "../_lib/event-columns";
import { formatEventUser } from "./event-user";

type AttrCol = "name" | "value";

const ATTR_COLS: ColDef<AttrCol>[] = [
  { key: "name", label: "Name", defaultWidth: 180, minWidth: 80, defaultVisible: true },
  { key: "value", label: "Value", defaultWidth: 180, minWidth: 80, defaultVisible: true },
];

interface AttrRow {
  name: string;
  value: string;
}

interface EventDetailPanelProps {
  event: ServerEvent;
  userMap: Map<number, string>;
  formatEventTime: (ev: ServerEvent) => string;
  onClose: () => void;
}

export function EventDetailPanel({
  event,
  userMap,
  formatEventTime,
  onClose,
}: EventDetailPanelProps) {
  const uid = event.userId as unknown as number | undefined;
  const username = formatEventUser(uid, userMap);
  const attrColConfig = useColumnConfig(ATTR_COLS, "bl-event-attributes-cols-v1");
  const attrSortState = useSortable<AttrCol>("name", "asc");
  const [attrDialog, setAttrDialog] = useState<AttrRow | null>(null);

  const attrRows: AttrRow[] = event.attributes
    ? Object.entries(event.attributes).map(([name, value]) => ({
        name,
        value: value ?? "—",
      }))
    : [];

  const fields = [
    { label: "ID", value: event.id },
    { label: "Date & Time", value: formatEventTime(event) },
    { label: "Level", value: <StatusBadge status={event.level} variant="eventLevel" /> },
    { label: "Outcome", value: <StatusBadge status={event.outcome} variant="eventOutcome" /> },
    { label: "Name", value: event.name },
    { label: "User", value: username },
    { label: "IP Address", value: event.ipAddress ?? "—" },
    { label: "Server ID", value: event.serverId ?? "—" },
    {
      label: "Channel",
      value: getEventChannelName(event) ?? getEventChannelIdWithMessageId(event) ?? "—",
    },
    ...(getEventPatientId(event)
      ? [{ label: "Patient ID", value: getEventPatientId(event)! }]
      : []),
  ];

  return (
    <div className="w-1/2 border-l border-border bg-white dark:bg-gray-900 overflow-auto flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Info className="w-4 h-4 text-blue-500" />
          Event Details
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 text-lg leading-none"
        >
          ×
        </button>
      </div>
      <div className="px-4 py-4 space-y-3 text-sm">
        {fields.map(({ label, value }) => (
          <div key={label} className="flex gap-3">
            <div className="w-28 shrink-0 text-gray-500 dark:text-gray-400 font-medium">
              {label}
            </div>
            <div className="text-gray-800 dark:text-gray-200 break-all">{value}</div>
          </div>
        ))}

        {/* Attributes table (mirrors Java "Name / Value" panel) */}
        <div className="mt-4">
          <div className="text-gray-500 dark:text-gray-400 font-medium mb-2 text-xs uppercase tracking-wide">
            Attributes
          </div>
          {attrRows.length > 0 ? (
            <DataTable<AttrRow, AttrCol>
              variant="sortable"
              cols={ATTR_COLS}
              rows={attrSortState.sorted(attrRows, (r) => {
                switch (attrSortState.sort.key) {
                  case "name":
                    return r.name;
                  case "value":
                    return r.value;
                  default:
                    return undefined;
                }
              })}
              colConfig={attrColConfig}
              sortState={attrSortState}
              rowKey={(r) => r.name}
              onRowDoubleClick={(row) => setAttrDialog(row)}
              cellMono={{ name: true }}
              // Safari shows a native tooltip over ellipsis-clipped text (WebKit-only;
              // Chrome never does). Empty title is a best-effort suppression; the real
              // safeguard is truncate() below, which bounds the rendered value — and any
              // Safari tooltip — to a small preview. Full value is on double-click.
              cellTitle={() => ""}
              renderCell={(row, col) =>
                col === "value" ? truncate(row.value, CELL_PREVIEW_CHARS) : row[col]
              }
            />
          ) : (
            <div className="text-xs text-gray-400 dark:text-gray-500 italic">
              There are no attributes for this event.
            </div>
          )}
        </div>
      </div>

      <ValueDetailDialog
        open={attrDialog !== null}
        onOpenChange={(open) => {
          if (!open) setAttrDialog(null);
        }}
        title={attrDialog?.name ?? ""}
        value={attrDialog?.value ?? ""}
      />
    </div>
  );
}
