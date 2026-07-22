"use client";

/**
 * Import Code Template From Repo Dialog
 *
 * Shows a tree of Libraries → Templates from the version-history repo.
 * User selects individual templates; on Import, they pick a target BridgeLink
 * library and the templates are added to it.
 *
 * Import flow (mirrors Java's ImportCodeTemplateDialog):
 *   Step 1 — Template selection:
 *     GET /plugins/version-history/libraries_and_templates  → library/template tree
 *     GET /codeTemplates                                    → existing template IDs
 *   Step 2 — Library picker:
 *     GET /codeTemplateLibraries                            → existing BridgeLink libraries
 *     User picks the target library
 *   Step 3 — Import:
 *     For each selected template:
 *       Check if ID already exists → skip with error (matches Java behavior)
 *       GET /plugins/version-history/content?id=<id>&revision=HEAD&mode=MODE_CODE_TEMPLATE
 *     POST /codeTemplateLibraries/_bulkUpdate to save all templates into target library
 *
 * Matches Java behavior:
 *   - Templates that already exist by ID are SKIPPED with "Template already exists"
 *   - User always picks a target BridgeLink library (Java's ImportDialog sub-dialog)
 */

import { startTransition, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCodeTemplateLibraries,
  getCodeTemplates,
  bulkUpdateCodeTemplates,
  parseCodeTemplateFromXml,
} from "@/lib/api/api-code-templates";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";

import {
  getLibrariesAndTemplates,
  getEntityContentAtRevision,
  MODE_CODE_TEMPLATE,
  type LibraryMetadata,
  type RepoItemMetadata,
} from "../api-version-history";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "select" | "pick-library" | "importing" | "done";

interface ImportResult {
  succeeded: number;
  failed: number;
  errors: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ImportCodeTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportCodeTemplateDialog({ open, onOpenChange }: ImportCodeTemplateDialogProps) {
  // Step 1 state: repo tree
  const [repoLibraries, setRepoLibraries] = useState<LibraryMetadata[]>([]);
  const [repoTemplates, setRepoTemplates] = useState<RepoItemMetadata[]>([]);
  const [existingTemplateIds, setExistingTemplateIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()); // template IDs
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // library IDs

  // Step 2 state: library picker
  const [blLibraries, setBlLibraries] = useState<CodeTemplateLibrary[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [librariesLoading, setLibrariesLoading] = useState(false);

  // Step 3 state: import progress
  const [step, setStep] = useState<Step>("select");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Load repo tree when dialog opens. Wrapped in startTransition so the React Compiler
  // doesn't flag the synchronous setState reset in an effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      setLoading(true);
      setError(null);
      setSelected(new Set());
      setStep("select");
      setImportResult(null);
      Promise.all([getLibrariesAndTemplates(), getCodeTemplates()])
        .then(([{ libraries, templates }, existingTemplates]) => {
          setRepoLibraries(libraries);
          setRepoTemplates(templates);
          setExistingTemplateIds(new Set(existingTemplates.map((t) => t.id)));
          // Expand all libraries by default
          setExpanded(new Set(libraries.map((l) => l.id)));
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load templates"))
        .finally(() => setLoading(false));
    });
  }, [open]);

  if (!open) return null;

  // ── Filter helpers ──────────────────────────────────────────────────────────

  function templateMatchesFilter(t: RepoItemMetadata) {
    return !filter || t.name.toLowerCase().includes(filter.toLowerCase());
  }

  function filteredTemplates(lib: LibraryMetadata) {
    return lib.codeTemplateIds
      .map((id) => repoTemplates.find((t) => t.id === id))
      .filter((t): t is RepoItemMetadata => !!t && templateMatchesFilter(t));
  }

  const visibleLibraries = repoLibraries.filter((lib) => filteredTemplates(lib).length > 0);

  const allVisibleTemplateIds = visibleLibraries.flatMap((lib) =>
    filteredTemplates(lib).map((t) => t.id)
  );
  const importableVisible = allVisibleTemplateIds.filter((id) => !existingTemplateIds.has(id));
  const allSelected =
    importableVisible.length > 0 && importableVisible.every((id) => selected.has(id));

  // ── Step 1 actions ──────────────────────────────────────────────────────────

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importableVisible));
    }
  }

  function toggleTemplate(id: string) {
    if (existingTemplateIds.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleLibrary(lib: LibraryMetadata) {
    const importableIds = filteredTemplates(lib)
      .filter((t) => !existingTemplateIds.has(t.id))
      .map((t) => t.id);
    const allLibSelected =
      importableIds.length > 0 && importableIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allLibSelected) {
        importableIds.forEach((id) => next.delete(id));
      } else {
        importableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleExpand(libId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(libId)) next.delete(libId);
      else next.add(libId);
      return next;
    });
  }

  // ── Step 1 → Step 2: proceed to library picker ─────────────────────────────

  async function proceedToLibraryPicker() {
    setLibrariesLoading(true);
    setStep("pick-library");
    try {
      const libs = await getCodeTemplateLibraries();
      const sorted = [...libs].sort((a, b) =>
        (a.name ?? "").toLowerCase().localeCompare((b.name ?? "").toLowerCase())
      );
      setBlLibraries(sorted);
      setSelectedLibraryId(sorted[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load libraries");
      setStep("select");
    } finally {
      setLibrariesLoading(false);
    }
  }

  // ── Step 2 → Step 3: import ─────────────────────────────────────────────────

  async function handleImport() {
    const targetLibrary = blLibraries.find((l) => l.id === selectedLibraryId);
    if (!targetLibrary) return;

    setStep("importing");
    const errors: string[] = [];
    const templatesToAdd: CodeTemplate[] = [];

    for (const templateId of selected) {
      const repoTemplate = repoTemplates.find((t) => t.id === templateId);
      if (!repoTemplate) continue;

      // Mirrors Java: "Template already exists" check
      if (existingTemplateIds.has(templateId)) {
        errors.push(`${repoTemplate.name}: Template already exists`);
        continue;
      }

      try {
        const xml = await getEntityContentAtRevision(templateId, "HEAD", MODE_CODE_TEMPLATE);
        const template = parseCodeTemplateFromXml(xml);
        if (!template) throw new Error("Failed to parse template XML");
        templatesToAdd.push(template);
      } catch (e) {
        errors.push(`${repoTemplate.name}: ${e instanceof Error ? e.message : "Import failed"}`);
      }
    }

    if (templatesToAdd.length > 0) {
      try {
        // Fetch current server state of all libraries so we can merge cleanly
        const currentLibraries = await getCodeTemplateLibraries();
        const libMap = new Map(currentLibraries.map((l) => [l.id, { ...l }]));

        // Ensure the target library is in the map (it should be)
        const target = libMap.get(selectedLibraryId) ?? targetLibrary;
        target.codeTemplateIds = [...(target.codeTemplateIds ?? [])];
        for (const t of templatesToAdd) {
          if (!target.codeTemplateIds.includes(t.id)) {
            target.codeTemplateIds.push(t.id);
          }
        }
        libMap.set(selectedLibraryId, target);

        // Force-overwrite: version-history import, not the interactive panel save
        // (which prompts on revision conflict —.
        await bulkUpdateCodeTemplates(
          {
            libraries: Array.from(libMap.values()),
            removedLibraryIds: [],
            updatedCodeTemplates: templatesToAdd,
            removedCodeTemplateIds: [],
          },
          true
        );
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "Bulk update failed");
      }
    }

    setImportResult({
      succeeded:
        templatesToAdd.length -
        (errors.filter((e) => e.includes("Bulk update")).length > 0 ? templatesToAdd.length : 0),
      failed: errors.length,
      errors,
    });
    setStep("done");
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const totalSelected = selected.size;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            Import Code Template From Repo
          </h2>
          {step !== "importing" && (
            <button
              onClick={() => onOpenChange(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          )}
        </div>

        {/* ── Step 1: Template selection ── */}
        {step === "select" && (
          <>
            <div className="flex-1 overflow-hidden flex flex-col px-5 py-3 gap-3 min-h-0">
              <ApiErrorAlert error={error} />

              {/* Search + Select All */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter templates…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="flex-1 border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  onClick={toggleSelectAll}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  {allSelected ? "Deselect All" : "Select All"}
                </button>
              </div>

              {/* Tree list */}
              <div className="flex-1 overflow-y-auto border border-border rounded min-h-0">
                {loading && (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                )}
                {!loading && visibleLibraries.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                    No templates found in repository
                  </p>
                )}
                {!loading &&
                  visibleLibraries.map((lib) => {
                    const templates = filteredTemplates(lib);
                    const importableTemplates = templates.filter(
                      (t) => !existingTemplateIds.has(t.id)
                    );
                    const isExpanded = expanded.has(lib.id);
                    const libSelected =
                      importableTemplates.length > 0 &&
                      importableTemplates.every((t) => selected.has(t.id));
                    const libPartial = !libSelected && templates.some((t) => selected.has(t.id));

                    return (
                      <div key={lib.id} className="border-b border-border last:border-0">
                        {/* Library row */}
                        <div className="flex items-center gap-1 px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <button
                            onClick={() => toggleExpand(lib.id)}
                            className="p-0.5 text-gray-400 dark:text-gray-500"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <input
                            type="checkbox"
                            checked={libSelected}
                            disabled={importableTemplates.length === 0}
                            ref={(el) => {
                              if (el) el.indeterminate = libPartial;
                            }}
                            onChange={() => toggleLibrary(lib)}
                            className="accent-blue-600 w-4 h-4 shrink-0"
                          />
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 ml-1">
                            {lib.name}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
                            ({importableTemplates.length}/{templates.length} importable)
                          </span>
                        </div>

                        {/* Template rows */}
                        {isExpanded &&
                          templates.map((t) => {
                            const alreadyExists = existingTemplateIds.has(t.id);
                            return (
                              <FormCheckbox
                                key={t.id}
                                label={
                                  <>
                                    <span className="truncate">{t.name}</span>
                                    {alreadyExists && (
                                      <span className="text-[11px] text-red-500 dark:text-red-400 shrink-0">
                                        already exists
                                      </span>
                                    )}
                                  </>
                                }
                                checked={!alreadyExists && selected.has(t.id)}
                                disabled={alreadyExists}
                                onChange={() => toggleTemplate(t.id)}
                                className={`pl-10 pr-3 py-1.5 ${
                                  alreadyExists
                                    ? "opacity-50"
                                    : "hover:bg-gray-50 dark:hover:bg-gray-700"
                                }`}
                              />
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-gray-50 dark:bg-gray-700/50">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {totalSelected} template{totalSelected !== 1 ? "s" : ""} selected
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={totalSelected === 0}
                  onClick={() => void proceedToLibraryPicker()}
                >
                  Next: Select Library →
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Library picker ── */}
        {step === "pick-library" && (
          <>
            <div className="flex-1 flex flex-col px-5 py-4 gap-4 min-h-0">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Import{" "}
                <strong>
                  {totalSelected} template{totalSelected !== 1 ? "s" : ""}
                </strong>{" "}
                into which library?
              </p>
              {librariesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : blLibraries.length === 0 ? (
                <p className="text-sm text-red-500 dark:text-red-400">
                  No libraries found in BridgeLink. Create a library first.
                </p>
              ) : (
                <select
                  value={selectedLibraryId}
                  onChange={(e) => setSelectedLibraryId(e.target.value)}
                  className="w-full border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {blLibraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-gray-50 dark:bg-gray-700/50">
              <Button variant="outline" size="sm" onClick={() => setStep("select")}>
                ← Back
              </Button>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!selectedLibraryId || librariesLoading}
                onClick={() => void handleImport()}
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Import
              </Button>
            </div>
          </>
        )}

        {/* ── Step 3: Importing… ── */}
        {step === "importing" && (
          <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 gap-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Importing {totalSelected} template{totalSelected !== 1 ? "s" : ""}…
            </p>
          </div>
        )}

        {/* ── Step 4: Done ── */}
        {step === "done" && importResult && (
          <>
            <div className="flex-1 flex flex-col px-5 py-4 gap-3 min-h-0 overflow-y-auto">
              {importResult.failed === 0 ? (
                <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                  ✓ Successfully imported {importResult.succeeded} template
                  {importResult.succeeded !== 1 ? "s" : ""}.
                </p>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                  ⚠ Import completed: {importResult.succeeded} succeeded, {importResult.failed}{" "}
                  failed.
                </p>
              )}
              {importResult.errors.length > 0 && (
                <div className="text-xs text-red-600 dark:text-red-400 space-y-1 max-h-40 overflow-y-auto border border-red-200 dark:border-red-800 rounded p-2">
                  {importResult.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-border bg-gray-50 dark:bg-gray-700/50">
              <Button
                size="sm"
                onClick={() => {
                  if (importResult.succeeded > 0) {
                    toast.success(
                      `Imported ${importResult.succeeded} template${importResult.succeeded !== 1 ? "s" : ""} successfully`
                    );
                  }
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
