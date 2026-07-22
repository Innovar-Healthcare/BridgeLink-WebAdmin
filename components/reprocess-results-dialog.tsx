"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";

// ─── Column definitions ──────────────────────────────────────────────────────

type ReprocessCol = "destination" | "included";

const REPROCESS_COLS: ColDef<ReprocessCol>[] = [
  {
    key: "destination",
    label: "Destination",
    defaultWidth: 380,
    minWidth: 100,
    defaultVisible: true,
  },
  { key: "included", label: "Included", defaultWidth: 70, minWidth: 60, defaultVisible: true },
];

export interface ReprocessOptions {
  replace: boolean;
  reprocessMetaDataIds: number[] | null;
}

interface ReprocessOptionsDialogProps {
  channelName: string;
  /** Destination connectors (metaDataId > 0) for this channel. */
  destinations: { metaDataId: number; name: string }[];
  /** Show the REPROCESSALL confirmation step (true for bulk reprocess, false for single). */
  showWarning: boolean;
  /**
   * Single-message reprocess: the selected connector's metaDataId. When > 0 and it matches a
   * destination, only that destination is pre-checked (Java ReprocessMessagesDialog when
   * selectedMetaDataId > 0). Source/none (`0`/`null`/undefined) and bulk pre-check all.
   */
  preselectedDestinationId?: number | null;
  onClose: () => void;
  onConfirm: (options: ReprocessOptions) => void;
}

export function ReprocessOptionsDialog({
  channelName,
  destinations,
  showWarning,
  preselectedDestinationId,
  onClose,
  onConfirm,
}: ReprocessOptionsDialogProps) {
  const colConfig = useColumnConfig(REPROCESS_COLS, "bl-reprocess-results-cols-v1");
  const sortState = useSortable<ReprocessCol>("destination", "asc");
  const [replace, setReplace] = useState(false);
  const [included, setIncluded] = useState<Set<number>>(() => {
    // Single-message reprocess pre-checks only the selected destination; the source/none case
    // and bulk reprocess pre-check all destinations (Java makeIncludedDestinationsTable).
    if (
      preselectedDestinationId != null &&
      preselectedDestinationId > 0 &&
      destinations.some((d) => d.metaDataId === preselectedDestinationId)
    ) {
      return new Set([preselectedDestinationId]);
    }
    return new Set(destinations.map((d) => d.metaDataId));
  });
  const [confirmStep, setConfirmStep] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleDestination(metaDataId: number) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(metaDataId)) next.delete(metaDataId);
      else next.add(metaDataId);
      return next;
    });
  }

  function selectAll() {
    setIncluded(new Set(destinations.map((d) => d.metaDataId)));
  }

  function deselectAll() {
    setIncluded(new Set());
  }

  function handleOk() {
    if (included.size === 0) return;
    if (showWarning && !confirmStep) {
      setConfirmStep(true);
      return;
    }
    if (showWarning && confirmText !== "REPROCESSALL") return;
    setSaving(true);
    const ids =
      included.size === destinations.length ? null : Array.from(included).sort((a, b) => a - b);
    onConfirm({ replace, reprocessMetaDataIds: ids });
  }

  const btnBase =
    "px-6 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 disabled:opacity-40";

  return (
    <Dialog
      open={true}
      onOpenChange={(v) => {
        if (!v && !saving) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[520px] flex flex-col p-0 gap-0"
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        {/* Header — title changes between steps */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {confirmStep ? "Reprocess Results" : "Reprocessing Options"}
          </DialogTitle>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── REPROCESSALL confirmation step ── */}
        {confirmStep ? (
          <>
            <div className="px-4 py-4 flex flex-col gap-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                This will reprocess all messages that match the current search criteria for{" "}
                <span className="font-medium">{channelName}</span>. Type{" "}
                <span className="font-mono font-semibold">REPROCESSALL</span> and click OK to
                continue.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmText === "REPROCESSALL") handleOk();
                }}
                placeholder="Type REPROCESSALL to confirm"
                autoFocus
                className="w-full px-3 py-1.5 text-sm border border-border rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-center gap-3 px-4 py-3 border-t border-border">
              <button
                type="button"
                onClick={handleOk}
                disabled={confirmText !== "REPROCESSALL" || saving}
                className={btnBase}
              >
                {saving ? "Reprocessing\u2026" : "OK"}
              </button>
              <button type="button" onClick={onClose} disabled={saving} className={btnBase}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {/* ── Main options dialog ── */}
            <div className="px-4 py-4 flex flex-col gap-4">
              {/* Overwrite checkbox */}
              <FormCheckbox
                label="Overwrite existing messages and update statistics"
                checked={replace}
                onChange={setReplace}
              />

              {/* Destination selection */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Reprocess through the following destinations:
                  </span>
                  <span className="text-sm">
                    <button
                      type="button"
                      onClick={selectAll}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Select All
                    </button>
                    <span className="text-gray-400 mx-1">|</span>
                    <button
                      type="button"
                      onClick={deselectAll}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Deselect All
                    </button>
                  </span>
                </div>

                <div className="max-h-[260px] overflow-y-auto">
                  <DataTable
                    variant="sortable"
                    cols={REPROCESS_COLS}
                    rows={sortState.sorted(destinations, (d) => {
                      switch (sortState.sort.key) {
                        case "destination":
                          return d.name;
                        case "included":
                          return included.has(d.metaDataId) ? 1 : 0;
                        default:
                          return undefined;
                      }
                    })}
                    colConfig={colConfig}
                    sortState={sortState}
                    rowKey={(d) => d.metaDataId}
                    onRowClick={(d) => toggleDestination(d.metaDataId)}
                    cellAlign={{ included: "center" }}
                    empty="No destinations available"
                    renderCell={(dest, col) => {
                      if (col === "destination") return dest.name;
                      return (
                        <input
                          type="checkbox"
                          checked={included.has(dest.metaDataId)}
                          onChange={() => toggleDestination(dest.metaDataId)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-border"
                        />
                      );
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-3 px-4 py-3 border-t border-border">
              <button
                type="button"
                onClick={handleOk}
                disabled={included.size === 0}
                className={btnBase}
              >
                OK
              </button>
              <button type="button" onClick={onClose} className={btnBase}>
                Cancel
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * @deprecated Use ReprocessOptionsDialog instead.
 * Kept temporarily for backwards compatibility.
 */
export const ReprocessResultsDialog = ReprocessOptionsDialog;
