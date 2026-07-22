"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { AlertTriangle, XCircle, ChevronRight, ChevronDown } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import {
  parseCodeTemplatesFromXml,
  parseCodeTemplateLibrariesFromXml,
} from "@/lib/api/parse-code-template-xml";
import {
  buildImportRows,
  computeConflicts,
  resolveImportResult,
  hasIdMatch,
  hasUnresolvedConflicts,
  hasUnassignedConflicts,
  hasNonUnassignedConflicts,
  type ImportRow,
  type ConflictInfo,
} from "./import-conflict-utils";

interface ImportCodeTemplateDialogProps {
  open: boolean;
  mode: "template" | "library";
  /** Current libraries — used for conflict detection and the library selector in template mode. */
  libraries: CodeTemplateLibrary[];
  /** Current templates — used for conflict detection. */
  templates: Map<string, CodeTemplate>;
  onClose: () => void;
  onImported: (result: { libraries: CodeTemplateLibrary[]; templates: CodeTemplate[] }) => void;
  /** Pre-parsed data — when provided, skips the file-pick step and goes straight to review.
   *  Used by channel import to embed code template library import in its flow. */
  initialData?: { libraries: CodeTemplateLibrary[]; templates: CodeTemplate[] };
}

export function ImportCodeTemplateDialog({
  open,
  mode,
  libraries,
  templates,
  onClose,
  onImported,
  initialData,
}: ImportCodeTemplateDialogProps) {
  const [step, setStep] = useState<"pick-file" | "review">("pick-file");
  const [file, setFile] = useState<File | null>(null);
  const [targetLibraryId, setTargetLibraryId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Parsed data (immutable after parsing)
  const [parsedLibraries, setParsedLibraries] = useState<CodeTemplateLibrary[]>([]);
  const [parsedTemplates, setParsedTemplates] = useState<CodeTemplate[]>([]);

  // Mutable rows for the review step
  const [rows, setRows] = useState<ImportRow[]>([]);

  // Collapsed libraries in tree view
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Reset/initialize state when the dialog transitions open or closed. Done
  // during render (the React "adjusting state when a prop changes" idiom) rather
  // than in an effect, which avoids the cascading-render warning from
  // set-state-in-effect. Initialized to false (not `open`) so an already-open
  // mount still fires the transition and runs the initialData review-step init.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setStep("pick-file");
      setFile(null);
      setError(null);
      setTargetLibraryId("");
      setParsedLibraries([]);
      setParsedTemplates([]);
      setRows([]);
      setCollapsed(new Set());
    } else if (initialData) {
      // Pre-parsed data provided — skip file-pick and go straight to review
      setParsedLibraries(initialData.libraries);
      setParsedTemplates(initialData.templates);
      setRows(buildImportRows(initialData.libraries, initialData.templates, mode));
      setCollapsed(new Set());
      setStep("review");
    }
  }

  // Default the target library to the first available once libraries have
  // loaded (they may arrive asynchronously after the dialog opens). This is a
  // self-correcting render-time adjustment: it stops firing once a library is
  // selected.
  if (open && !initialData && mode === "template" && libraries.length > 0 && !targetLibraryId) {
    setTargetLibraryId(libraries[0].id);
  }

  // Compute conflicts from current row state
  const conflicts = useMemo(
    () => computeConflicts(rows, libraries, templates, mode),
    [rows, libraries, templates, mode]
  );

  const unresolvedConflicts = useMemo(() => hasUnresolvedConflicts(conflicts), [conflicts]);

  // --- Step 1: Parse file and advance to review ---
  async function handleParseAndAdvance() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const xml = await file.text();

      let libs: CodeTemplateLibrary[] = [];
      let tmpls: CodeTemplate[] = [];

      if (mode === "template") {
        tmpls = parseCodeTemplatesFromXml(xml);
        if (tmpls.length === 0) {
          setError("No code templates found in the file.");
          return;
        }
      } else {
        const result = parseCodeTemplateLibrariesFromXml(xml);
        libs = result.libraries;
        tmpls = result.templates;
        if (libs.length === 0) {
          setError("No code template libraries found in the file.");
          return;
        }
      }

      setParsedLibraries(libs);
      setParsedTemplates(tmpls);
      setRows(buildImportRows(libs, tmpls, mode));
      setCollapsed(new Set());
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // --- Step 2: Import ---
  function handleImport() {
    const result = resolveImportResult(
      rows,
      parsedLibraries,
      parsedTemplates,
      libraries,
      templates,
      mode,
      mode === "template" ? targetLibraryId : undefined
    );
    onImported(result);
    onClose();
  }

  // --- Row mutation helpers ---
  const updateRow = useCallback((id: string, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const selectAll = useCallback((selected: boolean) => {
    setRows((prev) => prev.map((r) => ({ ...r, selected })));
  }, []);

  const overwriteAll = useCallback(
    (overwrite: boolean) => {
      setRows((prev) =>
        prev.map((r) => (hasIdMatch(r, libraries, templates) ? { ...r, overwrite } : r))
      );
    },
    [libraries, templates]
  );

  const toggleCollapse = useCallback((libId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(libId)) next.delete(libId);
      else next.add(libId);
      return next;
    });
  }, []);

  // --- Render ---
  const isTemplateMode = mode === "template";
  const isPickStep = step === "pick-file";

  const title = isTemplateMode ? "Import Code Templates" : "Import Libraries";

  if (isPickStep) {
    return (
      <FormDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
        title={title}
        onSubmit={handleParseAndAdvance}
        submitLabel="Next"
        submitDisabled={!file || (isTemplateMode && !targetLibraryId)}
        saving={loading}
        error={error}
        maxWidth="sm:max-w-md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {isTemplateMode
              ? "Select a BridgeLink code template XML file to import."
              : "Select a BridgeLink code template library XML file to import."}
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

          {isTemplateMode && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Assign to Library
              </label>
              <select
                value={targetLibraryId}
                onChange={(e) => setTargetLibraryId(e.target.value)}
                className="rounded border border-border bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300"
              >
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Imported templates will be added to this library.
              </p>
            </div>
          )}
        </div>
      </FormDialog>
    );
  }

  // Step 2: Review & Conflict Resolution
  const anyHasIdMatch = rows.some((r) => hasIdMatch(r, libraries, templates));

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={title}
      onSubmit={handleImport}
      submitLabel="Import"
      submitDisabled={unresolvedConflicts || rows.every((r) => !r.selected)}
      error={error}
      maxWidth="sm:max-w-3xl"
      footerLeft={
        !initialData ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setStep("pick-file");
              setError(null);
            }}
          >
            &larr; Back
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {/* Bulk controls */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Select:</span>
            <button
              type="button"
              className="text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => selectAll(true)}
            >
              All
            </button>
            <span className="text-gray-400">|</span>
            <button
              type="button"
              className="text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => selectAll(false)}
            >
              None
            </button>
          </div>
          {anyHasIdMatch && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500 dark:text-gray-400">Overwrite:</span>
              <button
                type="button"
                className="text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => overwriteAll(true)}
              >
                All
              </button>
              <span className="text-gray-400">|</span>
              <button
                type="button"
                className="text-blue-600 dark:text-blue-400 hover:underline"
                onClick={() => overwriteAll(false)}
              >
                None
              </button>
            </div>
          )}
        </div>

        {/* Template mode: library selector */}
        {isTemplateMode && (
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-600 dark:text-gray-400 whitespace-nowrap">Assign to:</label>
            <select
              value={targetLibraryId}
              onChange={(e) => setTargetLibraryId(e.target.value)}
              className="flex-1 rounded border border-border bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-700 dark:text-gray-300"
            >
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Table header */}
        <div className="grid grid-cols-[28px_1fr_80px_40px] items-center gap-1 px-1 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-border pb-1">
          <span />
          <span>Name</span>
          <span className="text-center">Overwrite</span>
          <span className="text-center">Status</span>
        </div>

        {/* Table body */}
        <div className="max-h-[400px] overflow-y-auto border border-border rounded">
          {rows.map((row) => {
            // Hide children of collapsed libraries
            if (
              row.kind === "template" &&
              row.parentLibraryId &&
              collapsed.has(row.parentLibraryId)
            ) {
              return null;
            }

            const conflict = conflicts.get(row.id);
            const idMatch = hasIdMatch(row, libraries, templates);

            return (
              <ImportRowView
                key={row.id}
                row={row}
                conflict={conflict ?? { type: "none", matchedId: null, message: "" }}
                idMatch={idMatch}
                isLibraryMode={!isTemplateMode}
                isCollapsed={collapsed.has(row.id)}
                onToggleCollapse={() => toggleCollapse(row.id)}
                onUpdate={updateRow}
              />
            );
          })}
        </div>

        {/* Warning banner */}
        {unresolvedConflicts && (
          <div className="flex flex-col gap-1 rounded bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            {hasUnassignedConflicts(conflicts) && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                One or more code templates cannot be imported because their parent library does not
                exist and is not selected for import. Select the parent library to proceed.
              </div>
            )}
            {hasNonUnassignedConflicts(conflicts) && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                One or more libraries / code templates have conflicts. Enable overwrite or deselect
                the conflicting items to proceed.
              </div>
            )}
          </div>
        )}
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface ImportRowViewProps {
  row: ImportRow;
  conflict: ConflictInfo;
  idMatch: boolean;
  isLibraryMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onUpdate: (id: string, patch: Partial<ImportRow>) => void;
}

function ImportRowView({
  row,
  conflict,
  idMatch,
  isLibraryMode,
  isCollapsed,
  onToggleCollapse,
  onUpdate,
}: ImportRowViewProps) {
  const isLibrary = row.kind === "library";
  const isTemplate = row.kind === "template";
  const indent = isTemplate && isLibraryMode;

  return (
    <div
      className={`grid grid-cols-[28px_1fr_80px_40px] items-center gap-1 px-1 py-1 border-b border-border last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
        indent ? "pl-8" : ""
      }`}
    >
      {/* Select checkbox */}
      <div className="flex items-center justify-center">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onUpdate(row.id, { selected: e.target.checked })}
          className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
        />
      </div>

      {/* Name */}
      <div className="flex items-center gap-1 min-w-0">
        {isLibrary && isLibraryMode && (
          <button
            type="button"
            className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            onClick={onToggleCollapse}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {conflict.type === "name-conflict" ? (
          <input
            type="text"
            value={row.name}
            onChange={(e) => onUpdate(row.id, { name: e.target.value })}
            className={`flex-1 min-w-0 rounded border px-1.5 py-0.5 text-sm ${
              isLibrary ? "font-semibold" : ""
            } border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-red-400`}
          />
        ) : (
          <span
            className={`truncate text-sm ${isLibrary ? "font-semibold" : ""} text-gray-900 dark:text-gray-100`}
          >
            {row.name}
          </span>
        )}
      </div>

      {/* Overwrite checkbox */}
      <div className="flex items-center justify-center">
        {idMatch && (
          <input
            type="checkbox"
            checked={row.overwrite}
            onChange={(e) => onUpdate(row.id, { overwrite: e.target.checked })}
            className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
          />
        )}
      </div>

      {/* Conflict status */}
      <div className="flex items-center justify-center">
        {conflict.type === "id-match" && (
          <HoverTooltip content={conflict.message}>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </HoverTooltip>
        )}
        {(conflict.type === "name-conflict" || conflict.type === "unassigned") && (
          <HoverTooltip content={conflict.message}>
            <XCircle className="h-4 w-4 text-red-500" />
          </HoverTooltip>
        )}
      </div>
    </div>
  );
}
