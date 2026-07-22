"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { getAllAlertsXml } from "@/lib/api-client";
import { parseAlertXml } from "@/lib/alerts-xml";
import { downloadBlob } from "@/lib/download";

/**
 * ExportAlertsDialog — fetches all alerts as XML and downloads them as a ZIP.
 *
 * Mirrors Java's Frame.doExportAlerts(): one getAlerts() call (GET /alerts/, op getAlerts)
 * returns every alert, and each is serialized to its own file. Java writes a directory; in the
 * browser we bundle the per-alert XML into a single ZIP download instead.
 */
export function ExportAlertsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  type Phase = "fetching" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("fetching");
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  // Reset synchronous progress state when the dialog transitions to open. Done
  // during render (the React "adjusting state when a prop changes" idiom) rather
  // than in the effect below, which avoids the cascading-render warning from
  // set-state-in-effect. The async fetch stays in the effect — its setState
  // calls run inside an async IIFE, which is not flagged.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPhase("fetching");
      setProgress(0);
      setTotal(0);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    cancelled.current = false;

    void (async () => {
      try {
        // 1. One getAlerts() call returns every alert as a single <list> of <alertModel>.
        const listXml = await getAllAlertsXml();
        if (cancelled.current) return;

        // 2. Split the list into individual alertModel XML strings (one file per alert).
        //    An empty alert set serializes as <list/> with no <alertModel> children, which
        //    parseAlertXml (strict, for the import-file case) rejects — treat that as nothing
        //    to export rather than surfacing the parser's message.
        let results;
        try {
          results = parseAlertXml(listXml);
        } catch (err) {
          if (err instanceof Error && /No alertModel/.test(err.message)) {
            setError("No alerts to export.");
            setPhase("error");
            return;
          }
          throw err;
        }
        setTotal(results.length);
        setProgress(results.length);

        // 3. Bundle into ZIP — load fflate on demand. fflate pulls no Node-core
        // polyfills (unlike jszip, whose readable-stream dep dragged eval-class
        // code into the client bundle) —.
        const { zipSync, strToU8 } = await import("fflate");
        const files: Record<string, Uint8Array> = {};
        for (const { name, xml } of results) {
          const safeName = name.replace(/[/\\:*?"<>|]/g, "_");
          files[`${safeName}.xml`] = strToU8(xml);
        }

        const blob = new Blob([zipSync(files)], { type: "application/zip" });
        downloadBlob(blob, "bridgelink-alerts-export.zip");

        setPhase("done");
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [open]);

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          cancelled.current = true;
          onClose();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        onInteractOutside={(e) => {
          if (phase === "fetching") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (phase === "fetching") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Export All Alerts</DialogTitle>
          <DialogDescription>Download all alerts as a ZIP file.</DialogDescription>
        </DialogHeader>

        {phase === "fetching" && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Fetching alerts... ({progress}/{total})
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {phase === "done" && (
          <p className="text-sm text-gray-600 dark:text-gray-400 py-2">
            Exported {total} alert{total !== 1 ? "s" : ""} successfully.
          </p>
        )}

        {phase === "error" && error && (
          <div className="px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded whitespace-pre-wrap">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {phase === "done" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
