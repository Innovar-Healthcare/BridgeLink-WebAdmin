"use client";

import { useState } from "react";
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
import { exportAllEvents } from "@/lib/api-client";

/**
 * ExportEventsDialog — server-side export of all events.
 *
 * Mirrors Java's Frame.doExportAllEvents():
 *   1. Confirm: "Are you sure you would like to export all events?"
 *   2. Call POST /events/_export
 *   3. Show the server file path where the export was written
 */
export function ExportEventsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  type Phase = "confirm" | "exporting" | "success" | "error";
  const [phase, setPhase] = useState<Phase>("confirm");
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(v: boolean) {
    if (!v && phase !== "exporting") {
      resetAndClose();
    }
  }

  function resetAndClose() {
    setPhase("confirm");
    setExportPath(null);
    setError(null);
    onClose();
  }

  async function handleExport() {
    setPhase("exporting");
    setError(null);
    try {
      const path = await exportAllEvents();
      setExportPath(path);
      setPhase("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          if (phase === "exporting") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (phase === "exporting") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Export All Events</DialogTitle>
          <DialogDescription>Export all events to a file on the server.</DialogDescription>
        </DialogHeader>

        {phase === "confirm" && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Are you sure you would like to export all events? An export file will be placed in the
            exports directory on the server.
          </p>
        )}

        {phase === "exporting" && (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-600 dark:text-gray-400">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Exporting events...
          </div>
        )}

        {phase === "success" && exportPath && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Events have been exported to the following server path:
            </p>
            <code className="text-sm bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded border border-border break-all">
              {exportPath}
            </code>
          </div>
        )}

        {phase === "error" && error && (
          <div className="px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded whitespace-pre-wrap">
            {error}
          </div>
        )}

        <DialogFooter>
          {phase === "confirm" && (
            <>
              <Button variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button onClick={handleExport}>Export</Button>
            </>
          )}
          {phase === "exporting" && (
            <Button variant="outline" disabled>
              Cancel
            </Button>
          )}
          {(phase === "success" || phase === "error") && (
            <Button variant="outline" onClick={resetAndClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
