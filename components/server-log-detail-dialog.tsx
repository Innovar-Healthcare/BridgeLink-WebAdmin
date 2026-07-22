"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogMaximizeButton,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDialogDragResize } from "@/lib/hooks/use-dialog-drag-resize";
import { cn } from "@/lib/utils";
import type { ServerLogItem } from "@/lib/types";

// ─── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Parse a UTC date string into a Date.
 * Handles formats the server sends:
 *   "yyyy-MM-dd HH:mm:ss.SSS"       → treat as UTC
 *   "yyyy-MM-dd HH:mm:ss.SSS UTC"   → strip " UTC" suffix, treat as UTC
 */
function parseUtcDateStr(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Strip trailing timezone label (e.g. " UTC", " GMT")
  const stripped = dateStr.replace(/\s+[A-Z]{2,5}$/, "").trim();
  // "2026-03-10 05:31:58.756" → "2026-03-10T05:31:58.756Z"
  const iso = stripped.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a UTC date string to local time, matching Java's SimpleDateFormat:
 * "yyyy-MM-dd HH:mm:ss.SSS"
 */
export function formatLogDateLocal(dateStr: string): string {
  if (!dateStr) return "";
  const d = parseUtcDateStr(dateStr);
  if (!d) return dateStr;

  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/**
 * Produce a single formatted log line matching the Java client's display format:
 *   [2026-03-09 22:31:58.756]  ERROR  (com.mirth.connect.connectors.tcp.TcpReceiver:746): message
 *
 * Exact spacing: two spaces between each segment; one space before message.
 */
export function formatLogLine(log: ServerLogItem): string {
  let line = "";

  const localDate = formatLogDateLocal(log.date);
  if (localDate) line += `[${localDate}]`;

  if (log.level) line += `  ${log.level}`;

  const loc = log.category
    ? log.lineNumber
      ? `(${log.category}:${log.lineNumber})`
      : `(${log.category})`
    : null;
  if (loc) line += `  ${loc}:`;

  if (log.message) line += ` ${log.message}`;

  return line;
}

/**
 * Produce full detail text including stack trace, matching Java's
 * ViewServerLogContentDialog which calls text.replaceAll("\\t", "\n\t").
 *
 * The server sends actual TAB characters (\t) between stack frames.
 * Java's replaceAll("\\t", "\n\t") matches literal tab chars — we do the same.
 */
export function formatLogDetail(log: ServerLogItem): string {
  let text = formatLogLine(log);

  if (log.throwableInformation) {
    // Replace actual tab characters with newline + tab to put each frame on its own line
    const trace = log.throwableInformation.replace(/\t/g, "\n\t");
    text += "\n" + trace;
  }

  return text;
}

// ─── Level badge ───────────────────────────────────────────────────────────────

function levelBadgeClass(level: string): string {
  switch (level) {
    case "ERROR":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800";
    case "WARN":
    case "WARNING":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800";
    case "INFO":
      return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 border border-border";
    case "DEBUG":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-border";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-border";
  }
}

// ─── Dialog component ──────────────────────────────────────────────────────────

interface ServerLogDetailDialogProps {
  log: ServerLogItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServerLogDetailDialog({ log, open, onOpenChange }: ServerLogDetailDialogProps) {
  const [copied, setCopied] = useState(false);
  const { contentProps, handleProps, maximize, enabled } = useDialogDragResize({
    open,
    defaultWidth: 860,
    defaultHeight: 480,
  });

  if (!log) return null;

  const detailText = formatLogDetail(log);

  function handleCopy() {
    void navigator.clipboard.writeText(detailText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...contentProps} aria-describedby={undefined}>
        <DialogHeader {...handleProps}>
          <DialogTitle className="flex items-center gap-2">
            <span>Log Information</span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded ${levelBadgeClass(log.level)}`}
            >
              {log.level || "—"}
            </span>
          </DialogTitle>
        </DialogHeader>
        {maximize.available ? (
          <DialogMaximizeButton maximized={maximize.isMaximized} onToggle={maximize.toggle} />
        ) : null}

        {/* Scrollable monospace content — overflow-auto on the container so scrollbars appear at the box edge */}
        <div
          className={cn(
            "overflow-auto border rounded-md bg-gray-50 dark:bg-gray-900 border-border",
            // Flex-fill when drag/resize is active; fixed height fallback on small viewports.
            enabled ? "flex-1 min-h-0" : "max-h-[60vh]"
          )}
        >
          <pre className="p-3 text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre min-w-max">
            {detailText}
          </pre>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between mt-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </Button>
          <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
