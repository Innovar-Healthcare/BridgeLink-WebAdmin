"use client";

/**
 * Import Code Template Button
 *
 * Rendered in the Code Template editor action row (below Monaco editor).
 * Opens ImportCodeTemplateDialog — no props needed, manages its own state.
 * Registered via registerCodeTemplateImportButton() in the plugin index.
 */

import { useState } from "react";
import { Download } from "lucide-react";
import { ImportCodeTemplateDialog } from "./import-code-template-dialog";

export function ImportCodeTemplateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 px-3 py-1 text-sm bg-white dark:bg-gray-800 dark:text-gray-300 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <Download className="w-3.5 h-3.5" />
        Import from Repo
      </button>
      <ImportCodeTemplateDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
