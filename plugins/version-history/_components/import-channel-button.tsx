"use client";

/**
 * Import Channel Button
 *
 * Rendered in the Channel Editor header action row.
 * Opens ImportChannelDialog — no props needed, manages its own state.
 * Registered via registerChannelEditorImportButton() in the plugin index.
 */

import { useState } from "react";
import { Download } from "lucide-react";
import { ImportChannelDialog } from "./import-channel-dialog";

export function ImportChannelButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
      >
        <Download className="w-3.5 h-3.5" />
        Import from Repo
      </button>
      <ImportChannelDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
