"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  bulkUpdateCodeTemplates,
  getCodeTemplateLibraries,
  getCodeTemplates,
} from "@/lib/api-client";
import type { CodeTemplate, CodeTemplateLibrary, CodeTemplateLibrarySaveResult } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

/** The four authoritative-set fields for a code-template bulk save. */
export interface CodeTemplateSaveParams {
  libraries: CodeTemplateLibrary[];
  removedLibraryIds: string[];
  updatedCodeTemplates: CodeTemplate[];
  removedCodeTemplateIds: string[];
}

/**
 * Outcome of a code-template save attempt.
 * `"cancelled"` means the user declined the overwrite prompt (nothing was saved);
 * `"saved"` carries the server result so the caller can run its success/failure check.
 */
export type CodeTemplateSaveOutcome =
  | { status: "saved"; result: CodeTemplateLibrarySaveResult }
  | { status: "cancelled" };

/** A library/template another session changed since we loaded — would be overwritten. */
export interface CodeTemplateConflict {
  kind: "library" | "template";
  id: string;
  name: string;
  /** "modified": our save replaces their changes. "removed": their new library would be deleted. */
  change: "modified" | "removed";
  /** Server-side last-modified (ISO) of the newer version, when available. */
  lastModified?: string;
}

// Fallback wording, matching Java CodeTemplatePanel.attemptUpdate (CodeTemplatePanel.java:655).
export const CODE_TEMPLATE_CONFLICT_MESSAGE =
  "One or more code templates or libraries have been modified since you last refreshed. Do you want to overwrite the changes?";

/**
 * Identify which submitted items another session changed since we loaded, so the prompt
 * can name them. The server's `_bulkUpdate` conflict check is a pure revision comparison
 * but returns no detail on rejection (it just sets `overrideNeeded`), so we re-fetch the
 * current server state and diff revisions against what we submitted. Best-effort: any
 * failure resolves to an empty list and the prompt falls back to the generic message.
 */
async function collectConflicts(params: CodeTemplateSaveParams): Promise<CodeTemplateConflict[]> {
  try {
    const [serverLibs, serverTmpls] = await Promise.all([
      getCodeTemplateLibraries(),
      getCodeTemplates(),
    ]);
    const libById = new Map(serverLibs.map((l) => [l.id, l]));
    const tmplById = new Map(serverTmpls.map((t) => [t.id, t]));
    const submittedLibIds = new Set(params.libraries.map((l) => l.id));
    const removedLibIds = new Set(params.removedLibraryIds);
    const conflicts: CodeTemplateConflict[] = [];

    // A library whose server revision moved past ours: our save replaces their changes.
    // Compare against the same `?? 1` fallback the serializer puts on the wire.
    for (const lib of params.libraries) {
      const server = libById.get(lib.id);
      if (server && server.revision != null && server.revision !== (lib.revision ?? 1)) {
        conflicts.push({
          kind: "library",
          id: lib.id,
          name: lib.name,
          change: "modified",
          lastModified: server.lastModified,
        });
      }
    }
    // A server library we neither submit nor remove was created by another session since we
    // loaded; updateLibraries is an authoritative replace, so our save would delete it.
    for (const server of serverLibs) {
      if (!submittedLibIds.has(server.id) && !removedLibIds.has(server.id)) {
        conflicts.push({
          kind: "library",
          id: server.id,
          name: server.name,
          change: "removed",
          lastModified: server.lastModified,
        });
      }
    }
    // Only the templates we actually edited are part of the server's conflict check.
    for (const tmpl of params.updatedCodeTemplates) {
      const server = tmplById.get(tmpl.id);
      if (server && server.revision != null && server.revision !== (tmpl.revision ?? 1)) {
        conflicts.push({
          kind: "template",
          id: tmpl.id,
          name: tmpl.name,
          change: "modified",
          lastModified: server.lastModified,
        });
      }
    }
    return conflicts;
  } catch {
    return [];
  }
}

function ConflictDescription({ conflicts }: { conflicts: CodeTemplateConflict[] }) {
  if (conflicts.length === 0) return <>{CODE_TEMPLATE_CONFLICT_MESSAGE}</>;
  return (
    <div className="space-y-2">
      <p>
        Another session has changed the following since you last refreshed. Overwriting will discard
        those changes:
      </p>
      <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5">
        {conflicts.map((c) => (
          <li key={`${c.kind}:${c.id}`}>
            <span className="font-medium">{c.name}</span>{" "}
            <span className="text-muted-foreground">
              (
              {c.change === "removed"
                ? `${c.kind} created by another session — would be deleted`
                : `${c.kind} modified by another session`}
              {c.lastModified ? `, ${fmtDate(c.lastModified)}` : ""})
            </span>
          </li>
        ))}
      </ul>
      <p>Do you want to overwrite the changes?</p>
    </div>
  );
}

/**
 * Shared code-template save flow that mirrors Java `CodeTemplatePanel.attemptUpdate`:
 * attempt the bulk update with `override=false` first, and only if the server reports a
 * revision conflict (`overrideNeeded`) prompt the user before retrying with `override=true`.
 * The prompt names the specific items another session changed (best-effort; see collectConflicts).
 *
 * Usage: call `saveTemplates(...)` from a save handler and mount `conflictDialog` in the
 * component tree. `saveTemplates` resolves `{ status: "saved", result }` once the update is
 * applied, or `{ status: "cancelled" }` if the user declines the overwrite; it throws on
 * genuine API errors (callers keep their existing catch).
 */
export function useCodeTemplateSave() {
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflicts, setConflicts] = useState<CodeTemplateConflict[]>([]);
  // One save is assumed in flight at a time — the Save button is disabled while saving and the
  // guard path runs behind its own modal, so the two save flows can't share this resolver.
  const resolverRef = useRef<((overwrite: boolean) => void) | null>(null);

  const saveTemplates = useCallback(
    async (params: CodeTemplateSaveParams): Promise<CodeTemplateSaveOutcome> => {
      const result = await bulkUpdateCodeTemplates(params, false);
      if (!result.overrideNeeded) return { status: "saved", result };

      // Server reported a revision conflict. Name the affected items, then ask before forcing.
      setConflicts(await collectConflicts(params));
      const overwrite = await new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setConflictOpen(true);
      });
      setConflictOpen(false);
      setConflicts([]);
      resolverRef.current = null;
      if (!overwrite) return { status: "cancelled" };

      const forced = await bulkUpdateCodeTemplates(params, true);
      return { status: "saved", result: forced };
    },
    []
  );

  const conflictDialog = conflictOpen ? (
    <ConfirmDialog
      title="Overwrite Changes?"
      description={<ConflictDescription conflicts={conflicts} />}
      confirmLabel="Overwrite"
      confirmVariant="default"
      onConfirm={() => resolverRef.current?.(true)}
      onCancel={() => resolverRef.current?.(false)}
    />
  ) : null;

  return { saveTemplates, conflictDialog };
}
