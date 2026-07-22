"use client";
import React, { memo } from "react";
import { toast } from "sonner";
import type { ServerEvent } from "@/lib/types";
import type { ColDef } from "@/lib/hooks/use-column-config";
import { StatusBadge } from "@/components/status-badge";
import { TableRow, TableCell } from "@/components/data-table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import {
  type EventCol,
  formatEventTime,
  getEventChannelIdWithMessageId,
  getEventChannelName,
  getEventPatientId,
} from "../_lib/event-columns";
import { formatEventUser } from "./event-user";

interface EventTableRowProps {
  ev: ServerEvent;
  visibleCols: ColDef<EventCol>[];
  userMap: Map<number, string>;
  mounted: boolean;
  selected: boolean;
  // Receives the row's event so the parent can pass ONE stable handler — a
  // per-row inline closure would defeat the React.memo wrapper below.
  onClick: (ev: ServerEvent) => void;
  onOpenDetail: (ev: ServerEvent) => void;
  density?: ViewDensity;
}

function EventTableRowImpl({
  ev,
  visibleCols,
  userMap,
  mounted,
  selected,
  onClick,
  onOpenDetail,
}: EventTableRowProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          variant={selected ? "selected" : "default"}
          onClick={() => onClick(ev)}
          style={{ cursor: "pointer" }}
        >
          {visibleCols.map((col) => {
            switch (col.key) {
              case "level":
                return (
                  <TableCell key={col.key}>
                    <StatusBadge status={ev.level} variant="eventLevel" />
                  </TableCell>
                );
              case "dateTime":
                return (
                  <TableCell key={col.key} mono suppressHydrationWarning>
                    {mounted ? formatEventTime(ev) : ""}
                  </TableCell>
                );
              case "name":
                return <TableCell key={col.key}>{ev.name ?? "—"}</TableCell>;
              case "serverId":
                return (
                  <TableCell key={col.key} mono>
                    {ev.serverId ?? "—"}
                  </TableCell>
                );
              case "user": {
                const uid = ev.userId;
                return <TableCell key={col.key}>{formatEventUser(uid, userMap)}</TableCell>;
              }
              case "outcome":
                return (
                  <TableCell key={col.key}>
                    <StatusBadge status={ev.outcome} variant="eventOutcome" />
                  </TableCell>
                );
              case "ipAddress":
                return (
                  <TableCell key={col.key} mono>
                    {ev.ipAddress ?? "—"}
                  </TableCell>
                );
              case "channelMessageId":
                return (
                  <TableCell key={col.key} mono>
                    {getEventChannelIdWithMessageId(ev) ?? "—"}
                  </TableCell>
                );
              case "channelName":
                return <TableCell key={col.key}>{getEventChannelName(ev) ?? "—"}</TableCell>;
              case "patientId":
                return <TableCell key={col.key}>{getEventPatientId(ev) ?? ""}</TableCell>;
              default:
                return <TableCell key={col.key} />;
            }
          })}
        </TableRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpenDetail(ev)}>View Event Details</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(String(ev.id));
            toast.success("Copied");
          }}
        >
          Copy Event ID
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!getEventPatientId(ev)}
          onSelect={() => {
            const pid = getEventPatientId(ev);
            if (pid) {
              void navigator.clipboard.writeText(pid);
              toast.success("Copied");
            }
          }}
        >
          Copy Patient ID
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Memoized so unchanged event rows don't reconcile on re-render. */
export const EventTableRow = memo(EventTableRowImpl);
