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
import { Input } from "@/components/ui/input";
import { updateAlertFromXml } from "@/lib/api-client";
import { generateUUID } from "@/lib/utils";
import type { AlertStatus } from "@/lib/types";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import {
  type ParsedAlert,
  parseAlertXml,
  replaceAlertId,
  replaceAlertName,
} from "@/lib/alerts-xml";

type ConflictAction = "overwrite" | "rename" | null;

/**
 * ImportAlertDialog — reads an alert XML file and imports alert(s).
 *
 * Mirrors Java's Frame.importAlert(): parses XML, checks for name conflicts,
 * offers overwrite/rename options, then creates or updates each alert.
 */
export function ImportAlertDialog({
  open,
  onClose,
  onImported,
  existingAlerts,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  existingAlerts: AlertStatus[];
}) {
  const { viewDensity } = useCompactMode();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Conflict resolution state
  const [parsedAlerts, setParsedAlerts] = useState<ParsedAlert[]>([]);
  const [conflictIndex, setConflictIndex] = useState(-1);
  const [conflictAction, setConflictAction] = useState<ConflictAction>(null);
  const [renameTo, setRenameTo] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"select" | "conflict" | "importing">("select");

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFile(null);

      setError(null);

      setParsedAlerts([]);

      setConflictIndex(-1);

      setConflictAction(null);

      setRenameTo("");

      setRenameError(null);
      setPhase("select");
    }
  }, [open]);

  /** Validate alert name: alphanumeric, hyphen, underscore, space only. Non-empty. */
  function validateName(name: string): string | null {
    if (!name.trim()) return "Alert name cannot be empty.";
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      return "Alert name can only contain letters, numbers, spaces, hyphens, and underscores.";
    }
    // Check if the new name also conflicts
    const exists = existingAlerts.some((a) => a.name.toLowerCase() === name.trim().toLowerCase());
    if (exists) return `An alert named "${name.trim()}" already exists.`;
    return null;
  }

  async function handleFileSelected() {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const rawXml = await file.text();
      const alerts = parseAlertXml(rawXml);
      if (alerts.length === 0) {
        setError("No alerts found in the file.");
        setLoading(false);
        return;
      }
      setParsedAlerts(alerts);
      // Start processing alerts, checking for conflicts
      processNextAlert(alerts, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  function processNextAlert(alerts: ParsedAlert[], index: number) {
    if (index >= alerts.length) {
      // All done — start importing
      void importAlerts(alerts);
      return;
    }

    const alert = alerts[index];
    const existing = existingAlerts.find((a) => a.name.toLowerCase() === alert.name.toLowerCase());

    if (existing) {
      // Name conflict — ask user
      setConflictIndex(index);
      setConflictAction(null);
      setRenameTo(alert.name);
      setRenameError(null);
      setPhase("conflict");
      setLoading(false);
    } else {
      // No conflict — assign new ID and continue
      alerts[index] = {
        ...alert,
        xml: replaceAlertId(alert.xml, generateUUID()),
      };
      processNextAlert(alerts, index + 1);
    }
  }

  function handleConflictOverwrite() {
    const alerts = [...parsedAlerts];
    const alert = alerts[conflictIndex];
    const existing = existingAlerts.find((a) => a.name.toLowerCase() === alert.name.toLowerCase());
    if (existing) {
      // Use the existing alert's ID to overwrite
      alerts[conflictIndex] = {
        ...alert,
        xml: replaceAlertId(alert.xml, existing.id),
        id: existing.id,
      };
    }
    setParsedAlerts(alerts);
    setPhase("select");
    setLoading(true);
    processNextAlert(alerts, conflictIndex + 1);
  }

  function handleConflictRename() {
    setConflictAction("rename");
    setRenameTo(parsedAlerts[conflictIndex].name);
    setRenameError(null);
  }

  function handleRenameConfirm() {
    const validationError = validateName(renameTo);
    if (validationError) {
      setRenameError(validationError);
      return;
    }

    const alerts = [...parsedAlerts];
    const alert = alerts[conflictIndex];
    const newId = generateUUID();
    alerts[conflictIndex] = {
      ...alert,
      name: renameTo.trim(),
      id: newId,
      xml: replaceAlertName(replaceAlertId(alert.xml, newId), renameTo.trim()),
    };
    setParsedAlerts(alerts);
    setConflictAction(null);
    setPhase("select");
    setLoading(true);
    processNextAlert(alerts, conflictIndex + 1);
  }

  async function importAlerts(alerts: ParsedAlert[]) {
    setPhase("importing");
    setLoading(true);
    setError(null);

    try {
      for (const alert of alerts) {
        // Every parsed alert already carries an id (generated for new alerts, the existing id on
        // overwrite), so a single PUT covers both cases — matching Java's always-updateAlert path.
        await updateAlertFromXml(alert.id, alert.xml);
      }
      onImported();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !loading) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          if (loading) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (loading) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Import Alert</DialogTitle>
          <DialogDescription>Select a BridgeLink alert XML file to import.</DialogDescription>
        </DialogHeader>

        {phase === "select" && !loading && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select a BridgeLink alert XML file to import.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xml"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-sm file:bg-white dark:file:bg-gray-700 file:hover:bg-gray-50 dark:file:hover:bg-gray-600 cursor-pointer"
            />
            {file && (
              <p className="text-xs text-gray-500 dark:text-gray-400">Selected: {file.name}</p>
            )}
            {error && (
              <div className="px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded whitespace-pre-wrap">
                {error}
              </div>
            )}
          </div>
        )}

        {phase === "select" && loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-600 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            Processing...
          </div>
        )}

        {phase === "conflict" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              An alert named &ldquo;{parsedAlerts[conflictIndex]?.name}&rdquo; already exists.
            </p>

            {conflictAction !== "rename" && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Would you like to overwrite the existing alert? Choose &ldquo;New&rdquo; to create a
                new alert with a different name.
              </p>
            )}

            {conflictAction === "rename" && (
              <div className="flex flex-col gap-2">
                <label className="text-sm text-gray-600 dark:text-gray-400">
                  Enter a new name for the alert:
                </label>
                <Input
                  value={renameTo}
                  onChange={(e) => {
                    setRenameTo(e.target.value);
                    setRenameError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameConfirm();
                  }}
                  density={viewDensity}
                  autoFocus
                />
                {renameError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{renameError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {phase === "importing" && (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-600 dark:text-gray-400">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            Importing alerts...
          </div>
        )}

        {phase === "importing" && error && (
          <div className="px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded whitespace-pre-wrap">
            {error}
          </div>
        )}

        <DialogFooter>
          {phase === "select" && !loading && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleFileSelected} disabled={!file}>
                Import
              </Button>
            </>
          )}

          {phase === "conflict" && conflictAction !== "rename" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button variant="outline" onClick={handleConflictRename}>
                New
              </Button>
              <Button onClick={handleConflictOverwrite}>Overwrite</Button>
            </>
          )}

          {phase === "conflict" && conflictAction === "rename" && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleRenameConfirm} disabled={!renameTo.trim()}>
                OK
              </Button>
            </>
          )}

          {(phase === "importing" || (phase === "select" && loading)) && (
            <Button variant="outline" disabled>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
