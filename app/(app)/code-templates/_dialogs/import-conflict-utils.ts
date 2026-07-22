/**
 * Pure functions for conflict detection and resolution during code template
 * library / template import.
 *
 * Conflict rules (mirrors Java CodeTemplateImportDialog):
 *  - ID match: imported item shares an ID with an existing item → warning.
 *    User may tick "Overwrite" to replace the existing item.
 *  - Name conflict: imported item shares a name (case-insensitive) with an
 *    existing item that will NOT be overwritten → error. User must rename
 *    or enable overwrite.
 */

import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictType = "none" | "id-match" | "name-conflict" | "unassigned";

export interface ImportRow {
  /** Original ID from the parsed XML. */
  id: string;
  /** Editable display name. */
  name: string;
  /** Whether this row represents a library or a template. */
  kind: "library" | "template";
  /** For templates: the library ID this template belongs to. null for libraries. */
  parentLibraryId: string | null;
  /** Whether the user wants to import this item. */
  selected: boolean;
  /** Whether the user wants to overwrite the existing item (only meaningful for id-match). */
  overwrite: boolean;
}

export interface ConflictInfo {
  type: ConflictType;
  /** The ID of the existing item that caused the conflict (null when none). */
  matchedId: string | null;
  /** Human-readable explanation shown in the UI. */
  message: string;
}

// ---------------------------------------------------------------------------
// Build initial import rows
// ---------------------------------------------------------------------------

/**
 * Build the initial `ImportRow[]` from parsed XML data.
 *
 * In "library" mode the rows form a tree: library → child templates.
 * In "template" mode the rows are a flat list of templates only (the user
 * picks a target library separately via a dropdown).
 */
export function buildImportRows(
  parsedLibraries: CodeTemplateLibrary[],
  parsedTemplates: CodeTemplate[],
  mode: "library" | "template"
): ImportRow[] {
  const rows: ImportRow[] = [];

  if (mode === "library") {
    for (const lib of parsedLibraries) {
      rows.push({
        id: lib.id,
        name: lib.name,
        kind: "library",
        parentLibraryId: null,
        selected: true,
        overwrite: false,
      });
      // Add child templates that belong to this library
      const childIds = new Set(lib.codeTemplateIds);
      for (const tmpl of parsedTemplates) {
        if (childIds.has(tmpl.id)) {
          rows.push({
            id: tmpl.id,
            name: tmpl.name,
            kind: "template",
            parentLibraryId: lib.id,
            selected: true,
            overwrite: false,
          });
        }
      }
    }
  } else {
    // Template mode — flat list
    for (const tmpl of parsedTemplates) {
      rows.push({
        id: tmpl.id,
        name: tmpl.name,
        kind: "template",
        parentLibraryId: null,
        selected: true,
        overwrite: false,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Compute conflicts for every row based on the current selection, overwrite,
 * and name state.  Returns a Map keyed by the row's `id`.
 *
 * The caller should invoke this inside a `useMemo` so it recomputes whenever
 * `rows`, `existingLibraries`, or `existingTemplates` change.
 */
export function computeConflicts(
  rows: ImportRow[],
  existingLibraries: CodeTemplateLibrary[],
  existingTemplates: Map<string, CodeTemplate>,
  mode: "library" | "template" = "library"
): Map<string, ConflictInfo> {
  const result = new Map<string, ConflictInfo>();

  // Build lookup maps for existing items
  const existingLibById = new Map<string, CodeTemplateLibrary>();
  const existingLibByName = new Map<string, CodeTemplateLibrary>(); // lowercase name → lib
  for (const lib of existingLibraries) {
    existingLibById.set(lib.id, lib);
    existingLibByName.set(lib.name.toLowerCase(), lib);
  }

  const existingTmplByName = new Map<string, CodeTemplate>(); // lowercase name → template
  for (const [, tmpl] of existingTemplates) {
    existingTmplByName.set(tmpl.name.toLowerCase(), tmpl);
  }

  // Track IDs that will be overwritten (so their names don't count as conflicts)
  const overwrittenIds = new Set<string>();
  for (const row of rows) {
    if (row.selected && row.overwrite) {
      overwrittenIds.add(row.id);
    }
  }

  // Track names among selected import rows for inter-import duplicate detection
  // (two imported items with the same name that are both selected)
  const selectedImportLibNames = new Map<string, string[]>(); // lowercase name → [ids]
  const selectedImportTmplNames = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.selected) continue;
    const lowerName = row.name.toLowerCase();
    const map = row.kind === "library" ? selectedImportLibNames : selectedImportTmplNames;
    const list = map.get(lowerName) ?? [];
    list.push(row.id);
    map.set(lowerName, list);
  }

  for (const row of rows) {
    if (!row.selected) {
      result.set(row.id, { type: "none", matchedId: null, message: "" });
      continue;
    }

    const lowerName = row.name.toLowerCase();

    if (row.kind === "library") {
      // 1. ID match check
      const idMatch = existingLibById.get(row.id);
      if (idMatch) {
        if (!row.overwrite) {
          // Check name conflict: does a *different* existing lib have this name
          // (or does the ID-matched one have a different name but another existing
          // lib shares the new name)?
          const nameMatch = existingLibByName.get(lowerName);
          if (nameMatch && nameMatch.id !== row.id && !overwrittenIds.has(nameMatch.id)) {
            result.set(row.id, {
              type: "name-conflict",
              matchedId: nameMatch.id,
              message: `A library named "${nameMatch.name}" already exists. Rename or select overwrite.`,
            });
            continue;
          }
          // Check inter-import name duplicates
          const sameNameIds = selectedImportLibNames.get(lowerName) ?? [];
          if (sameNameIds.length > 1) {
            result.set(row.id, {
              type: "name-conflict",
              matchedId: null,
              message: "Another imported library has the same name.",
            });
            continue;
          }
          result.set(row.id, {
            type: "id-match",
            matchedId: idMatch.id,
            message: `A library with this ID already exists ("${idMatch.name}"). Enable overwrite to replace it, or deselect to skip it.`,
          });
          continue;
        }
        // Overwriting — no conflict
        result.set(row.id, { type: "none", matchedId: null, message: "" });
        continue;
      }

      // 2. No ID match — check name conflict against existing
      const nameMatch = existingLibByName.get(lowerName);
      if (nameMatch && !overwrittenIds.has(nameMatch.id)) {
        result.set(row.id, {
          type: "name-conflict",
          matchedId: nameMatch.id,
          message: `A library named "${nameMatch.name}" already exists. Rename to resolve.`,
        });
        continue;
      }

      // 3. Check inter-import name duplicates
      const sameNameIds = selectedImportLibNames.get(lowerName) ?? [];
      if (sameNameIds.length > 1) {
        result.set(row.id, {
          type: "name-conflict",
          matchedId: null,
          message: "Another imported library has the same name.",
        });
        continue;
      }

      result.set(row.id, { type: "none", matchedId: null, message: "" });
    } else {
      // Template
      const idMatch = existingTemplates.get(row.id);
      if (idMatch) {
        if (!row.overwrite) {
          const nameMatch = existingTmplByName.get(lowerName);
          if (nameMatch && nameMatch.id !== row.id && !overwrittenIds.has(nameMatch.id)) {
            result.set(row.id, {
              type: "name-conflict",
              matchedId: nameMatch.id,
              message: `A template named "${nameMatch.name}" already exists. Rename or select overwrite.`,
            });
            continue;
          }
          const sameNameIds = selectedImportTmplNames.get(lowerName) ?? [];
          if (sameNameIds.length > 1) {
            result.set(row.id, {
              type: "name-conflict",
              matchedId: null,
              message: "Another imported template has the same name.",
            });
            continue;
          }
          result.set(row.id, {
            type: "id-match",
            matchedId: idMatch.id,
            message: `A template with this ID already exists ("${idMatch.name}"). Enable overwrite to replace it, or deselect to skip it.`,
          });
          continue;
        }
        result.set(row.id, { type: "none", matchedId: null, message: "" });
        continue;
      }

      const nameMatch = existingTmplByName.get(lowerName);
      if (nameMatch && !overwrittenIds.has(nameMatch.id)) {
        result.set(row.id, {
          type: "name-conflict",
          matchedId: nameMatch.id,
          message: `A template named "${nameMatch.name}" already exists. Rename to resolve.`,
        });
        continue;
      }

      const sameNameIds = selectedImportTmplNames.get(lowerName) ?? [];
      if (sameNameIds.length > 1) {
        result.set(row.id, {
          type: "name-conflict",
          matchedId: null,
          message: "Another imported template has the same name.",
        });
        continue;
      }

      // Unassigned check: in library mode, a selected template whose parent library
      // is neither selected for import nor already exists on the server cannot be imported.
      // Mirrors Java CodeTemplateImportDialog unassignedConflict logic.
      if (mode === "library" && row.parentLibraryId) {
        const parentLibSelected = rows.some(
          (r) => r.kind === "library" && r.id === row.parentLibraryId && r.selected
        );
        const parentLibExists = existingLibById.has(row.parentLibraryId);
        if (!parentLibSelected && !parentLibExists) {
          const parentRow = rows.find((r) => r.kind === "library" && r.id === row.parentLibraryId);
          const parentName = parentRow?.name ?? row.parentLibraryId;
          result.set(row.id, {
            type: "unassigned",
            matchedId: null,
            message: `The parent library "${parentName}" does not currently exist, so it must be imported in order to import the selected code template.`,
          });
          continue;
        }
      }

      result.set(row.id, { type: "none", matchedId: null, message: "" });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when there's an ID match that enables the overwrite checkbox. */
export function hasIdMatch(
  row: ImportRow,
  existingLibraries: CodeTemplateLibrary[],
  existingTemplates: Map<string, CodeTemplate>
): boolean {
  if (row.kind === "library") {
    return existingLibraries.some((l) => l.id === row.id);
  }
  return existingTemplates.has(row.id);
}

/**
 * Returns true when any selected row has a conflict that blocks import.
 *
 * id-match (must overwrite or deselect), name-conflict (must rename or
 * overwrite), and unassigned (parent library missing) all block the Import
 * button — matching Java UI behavior.
 */
export function hasUnresolvedConflicts(conflicts: Map<string, ConflictInfo>): boolean {
  for (const [, info] of conflicts) {
    if (info.type === "id-match" || info.type === "name-conflict" || info.type === "unassigned")
      return true;
  }
  return false;
}

/** Returns true when any row has an "unassigned" (missing parent library) conflict. */
export function hasUnassignedConflicts(conflicts: Map<string, ConflictInfo>): boolean {
  for (const [, info] of conflicts) {
    if (info.type === "unassigned") return true;
  }
  return false;
}

/** Returns true when any row has a non-unassigned blocking conflict (id-match or name-conflict). */
export function hasNonUnassignedConflicts(conflicts: Map<string, ConflictInfo>): boolean {
  for (const [, info] of conflicts) {
    if (info.type === "id-match" || info.type === "name-conflict") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Resolve final import result
// ---------------------------------------------------------------------------

/**
 * Produce the final `{ libraries, templates }` payload from the reviewed rows.
 *
 * Called only when there are no unresolved conflicts (Import button is enabled).
 * - Items with `overwrite=true` keep their original ID (replaces existing).
 * - Items with no conflict keep their original ID.
 * - Library `codeTemplateIds` are filtered to only selected templates.
 */
export function resolveImportResult(
  rows: ImportRow[],
  parsedLibraries: CodeTemplateLibrary[],
  parsedTemplates: CodeTemplate[],
  existingLibraries: CodeTemplateLibrary[],
  existingTemplates: Map<string, CodeTemplate>,
  mode: "library" | "template",
  /** In template mode: the ID of the target library the templates will be added to. */
  targetLibraryId?: string
): { libraries: CodeTemplateLibrary[]; templates: CodeTemplate[] } {
  const existingLibById = new Map<string, CodeTemplateLibrary>();
  for (const lib of existingLibraries) {
    existingLibById.set(lib.id, lib);
  }

  const resultTemplates: CodeTemplate[] = [];
  const resultLibraries: CodeTemplateLibrary[] = [];

  const selectedTemplateIds = new Set(
    rows.filter((r) => r.selected && r.kind === "template").map((r) => r.id)
  );

  // --- Process templates ---
  const parsedTmplById = new Map<string, CodeTemplate>();
  for (const t of parsedTemplates) parsedTmplById.set(t.id, t);

  for (const row of rows) {
    if (!row.selected || row.kind !== "template") continue;
    const parsed = parsedTmplById.get(row.id);
    if (!parsed) continue;
    resultTemplates.push({ ...parsed, name: row.name });
  }

  // --- Process libraries ---
  if (mode === "library") {
    const parsedLibById = new Map<string, CodeTemplateLibrary>();
    for (const l of parsedLibraries) parsedLibById.set(l.id, l);

    for (const row of rows) {
      if (!row.selected || row.kind !== "library") continue;
      const parsed = parsedLibById.get(row.id);
      if (!parsed) continue;

      const lib: CodeTemplateLibrary = { ...parsed, name: row.name };

      if (existingLibById.has(row.id) && row.overwrite) {
        // Merge channel IDs from existing library (Java behavior)
        const existing = existingLibById.get(row.id)!;
        lib.enabledChannelIds = existing.enabledChannelIds;
        lib.disabledChannelIds = existing.disabledChannelIds;
      }

      // Only include template IDs that the user actually selected
      lib.codeTemplateIds = lib.codeTemplateIds.filter((tid) => selectedTemplateIds.has(tid));

      resultLibraries.push(lib);
    }
  } else if (mode === "template" && targetLibraryId) {
    // In template mode, we return a modified copy of the target library
    // with the newly imported template IDs appended
    const targetLib = existingLibraries.find((l) => l.id === targetLibraryId);
    if (targetLib) {
      const newTemplateIds = resultTemplates.map((t) => t.id);
      const existingIds = new Set(targetLib.codeTemplateIds);
      resultLibraries.push({
        ...targetLib,
        codeTemplateIds: [
          ...targetLib.codeTemplateIds,
          ...newTemplateIds.filter((id) => !existingIds.has(id)),
        ],
      });
    }
  }

  return { libraries: resultLibraries, templates: resultTemplates };
}
