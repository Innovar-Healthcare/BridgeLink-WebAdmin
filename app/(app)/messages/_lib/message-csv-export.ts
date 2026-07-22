import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ConnectorMessage, Message } from "@/lib/types";
import type { MessageFilter } from "@/lib/api/api-messages";
import { searchMessages } from "@/lib/api/api-messages";
import type { MsgCol } from "./message-columns";
import { getCellValue } from "./message-columns";
import { downloadCsv } from "@/lib/download";
import { toast } from "sonner";

const EXPORT_BATCH_SIZE = 500;

function buildRows(visibleCols: ColDef<MsgCol>[], messages: Message[]): string[][] {
  const rows: string[][] = [];
  for (const msg of messages) {
    const entries = Object.entries(msg.connectorMessages ?? {}).sort(
      ([a], [b]) => Number(a) - Number(b)
    );
    for (const [, cm] of entries) {
      rows.push(
        visibleCols.map((c) => {
          const val = getCellValue(c.key, cm as ConnectorMessage, msg);
          return val != null ? String(val) : "";
        })
      );
    }
  }
  return rows;
}

/** Fetch all messages matching the filter and export as a CSV file. */
export async function exportMessagesCsv(
  visibleCols: ColDef<MsgCol>[],
  channelId: string,
  filter: MessageFilter
): Promise<void> {
  const toastId = toast.loading("Exporting... 0 rows fetched");

  try {
    let allMessages: Message[] = [];
    let offset = 0;

    for (;;) {
      const page = await searchMessages(channelId, filter, {
        offset,
        limit: EXPORT_BATCH_SIZE,
        includeContent: false,
      });
      if (page.length === 0) break;
      allMessages = allMessages.concat(page);
      offset += page.length;
      toast.loading(`Exporting... ${allMessages.length} rows fetched`, { id: toastId });
      if (page.length < EXPORT_BATCH_SIZE) break;
    }

    if (allMessages.length === 0) {
      toast.info("No messages to export.", { id: toastId });
      return;
    }

    const headers = visibleCols.map((c) => c.label);
    const rows = buildRows(visibleCols, allMessages);
    downloadCsv("bridgelink-messages", headers, rows);
    toast.success(`Exported ${rows.length} rows.`, { id: toastId });
  } catch (err) {
    toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`, {
      id: toastId,
    });
  }
}
