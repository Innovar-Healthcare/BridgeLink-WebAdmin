"use client";

/**
 * Import Channel From Repo Dialog
 *
 * Shows all channels tracked in the version-history repo, lets the user
 * pick one or more via checkboxes, then imports them into BridgeLink.
 *
 * Import flow (mirrors Java's ImportChannelDialog):
 *   1. GET /plugins/version-history/channel_on_repo  → channel list
 *   2. GET /channels/idsAndNames                     → existing channel IDs
 *   3a. Single selection: fetch the channel XML, then open it in the
 *       New Channel editor for review — nothing is saved until the user clicks
 *       Save (mirrors the Java client opening an imported channel in the editor).
 *   3b. Bulk selection: for each channel, fetch its XML and POST /channels
 *       immediately (create only) — reviewing many at once is impractical.
 *
 * Matches Java behavior: channels that already exist by ID are SKIPPED with an
 * error — the dialog does NOT overwrite existing channels.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { getChannelIdsAndNames, createChannelFromXml } from "@/lib/api/api-channels";
import { setPendingChannelImport } from "@/lib/channel-import-store";

import {
  getChannelsOnRepo,
  getEntityContentAtRevision,
  MODE_CHANNEL,
  type RepoItemMetadata,
} from "../api-version-history";

// ─── Component ────────────────────────────────────────────────────────────────

interface ImportChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportChannelDialog({ open, onOpenChange }: ImportChannelDialogProps) {
  const router = useRouter();
  const [channels, setChannels] = useState<RepoItemMetadata[]>([]);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  // Load channel list when dialog opens
  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoading(true);
      setError(null);
      setSelected(new Set());
      setImportErrors([]);
      try {
        const [list, existing] = await Promise.all([getChannelsOnRepo(), getChannelIdsAndNames()]);
        setChannels(list);
        setExistingIds(new Set(existing.keys()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load channels");
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  if (!open) return null;

  const filtered = channels.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));

  function toggleAll() {
    // Only select channels that don't already exist in BridgeLink
    const importable = filtered.filter((c) => !existingIds.has(c.id));
    if (selected.size === importable.length && importable.every((c) => selected.has(c.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importable.map((c) => c.id)));
    }
  }

  function toggle(id: string) {
    if (existingIds.has(id)) return; // cannot select channels that already exist
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    if (selected.size === 0) return;

    //: a single selection opens the channel in the editor for review
    // before saving (mirrors the Java client, which opens an imported channel in
    // the editor). Bulk selections still import immediately — reviewing many
    // channels one at a time would be impractical, matching the Java client's
    // single-vs-multi import behavior.
    if (selected.size === 1) {
      const id = [...selected][0];
      const meta = channels.find((c) => c.id === id);
      setImporting(true);
      setImportErrors([]);
      try {
        const xml = await getEntityContentAtRevision(id, "HEAD", MODE_CHANNEL);
        // Repo channels that already exist by ID cannot be selected, so an import
        // is always a create — open the New Channel editor for review.
        setPendingChannelImport({ xml, mode: "new" });
        router.push("/channels/new");
        onOpenChange(false);
      } catch (e) {
        setImporting(false);
        setImportErrors([
          `${meta?.name ?? id}: ${e instanceof Error ? e.message : "Import failed"}`,
        ]);
      }
      return;
    }

    setImporting(true);
    setImportErrors([]);
    const errors: string[] = [];

    for (const id of selected) {
      const meta = channels.find((c) => c.id === id);
      if (!meta) continue;
      // Double-check the channel still doesn't exist (it may have been created since dialog opened)
      if (existingIds.has(id)) {
        errors.push(`${meta.name}: Channel already exists in BridgeLink`);
        continue;
      }
      try {
        const xml = await getEntityContentAtRevision(id, "HEAD", MODE_CHANNEL);
        await createChannelFromXml(xml);
      } catch (e) {
        errors.push(`${meta.name}: ${e instanceof Error ? e.message : "Import failed"}`);
      }
    }

    setImporting(false);
    if (errors.length === 0) {
      toast.success(
        `Imported ${selected.size} channel${selected.size !== 1 ? "s" : ""} successfully`
      );
      onOpenChange(false);
    } else {
      setImportErrors(errors);
      const succeeded = selected.size - errors.length;
      if (succeeded > 0) {
        toast.success(`Partially imported — ${succeeded} succeeded`);
      }
    }
  }

  const importableCount = filtered.filter((c) => !existingIds.has(c.id)).length;
  const allImportableSelected =
    importableCount > 0 &&
    filtered.filter((c) => !existingIds.has(c.id)).every((c) => selected.has(c.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            Import Channel From Repo
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col px-5 py-3 gap-3 min-h-0">
          <ApiErrorAlert error={error} />

          {/* Search + Select All */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter channels…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={toggleAll}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              {allImportableSelected ? "Deselect All" : "Select All"}
            </button>
          </div>

          {/* Channel list */}
          <div className="flex-1 overflow-y-auto border border-border rounded min-h-0">
            {loading && (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                No channels found in repository
              </p>
            )}
            {!loading &&
              filtered.map((c) => {
                const alreadyExists = existingIds.has(c.id);
                return (
                  <FormCheckbox
                    key={c.id}
                    label={
                      <div className="min-w-0">
                        <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
                          {c.name}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                          {c.id}
                          {alreadyExists && (
                            <span className="ml-2 text-red-500 dark:text-red-400">
                              (already exists — cannot import)
                            </span>
                          )}
                        </div>
                      </div>
                    }
                    checked={!alreadyExists && selected.has(c.id)}
                    disabled={alreadyExists}
                    onChange={() => toggle(c.id)}
                    className={`px-3 py-2 border-b border-border last:border-0 ${
                      alreadyExists ? "opacity-50" : "hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  />
                );
              })}
          </div>

          {importErrors.length > 0 && (
            <div className="text-xs text-red-600 dark:text-red-400 space-y-1 max-h-24 overflow-y-auto">
              {importErrors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-gray-50 dark:bg-gray-700/50">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {selected.size} of {importableCount} importable selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0 || importing}
              onClick={() => void handleImport()}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
