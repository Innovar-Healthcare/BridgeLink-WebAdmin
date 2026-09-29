import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ConnectorMessage, Message } from "@/lib/types";
import type { MessageFilter } from "@/lib/api/api-messages";
import {
  searchMessages,
  auditExportMessages,
  auditExportMessagesSuccess,
} from "@/lib/api/api-messages";
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
    // Audit: record export intent before any data is fetched, mirroring the Export Results
    // dialog's auditExportMessages call so a CSV pull leaves the same "Export all messages"
    // server event as the full export wizard. The event name is set server-side; an empty
    // attribute map matches the Java MessageExportDialog "initiated" call. Caller has already
    // refused unless an explicit search has run (Java isChannelMessagesPanelFirstLoadSearch
    // gate), so this only fires for a legitimate export.
    await auditExportMessages({});

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

    // Audit: record the successful export using the same attribute schema as Export Results,
    // so the server event log carries one consistent "Successfully exported messages" shape
    // regardless of which export path was used. CSV is a WebUI-only quick export with no Java
    // analog, so contentType is tagged "CSV" and the server-path/compression/encryption fields
    // carry their not-applicable defaults. exportCount is the message count (not the CSV row
    // count, which explodes each message into one row per connector) so the number is consistent
    // with the Server/My Computer export events an auditor sees alongside it.
    await auditExportMessagesSuccess({
      rootPath: "",
      filePattern: "bridgelink-messages-${currentDate}.csv",
      exportCount: String(allMessages.length),
      contentType: "CSV",
      encrypted: "false",
      includeAttachments: "false",
      compressionFormat: "",
      passwordProtected: "false",
    });

    toast.success(`Exported ${rows.length} rows.`, { id: toastId });
  } catch (err) {
    toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`, {
      id: toastId,
    });
  }
}
