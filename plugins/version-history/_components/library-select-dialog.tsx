"use client";

import { useState } from "react";
import { toast } from "sonner";

import { FormDialog } from "@/components/form-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bulkUpdateCodeTemplates,
  getCodeTemplateLibraries,
  parseCodeTemplateFromXml,
} from "@/lib/api/api-code-templates";
import type { CodeTemplateLibrary } from "@/lib/types";

import { getShortHash } from "../api-version-history";

export interface LibrarySelectTarget {
  templateId: string;
  xml: string;
  repoPath: string;
  commitHash: string;
  entityName: string;
}

interface LibrarySelectDialogProps {
  target: LibrarySelectTarget;
  libraries: CodeTemplateLibrary[];
  onSuccess: (opts: {
    hash: string;
    path: string;
    entityName: string;
    refreshedLibraries: CodeTemplateLibrary[];
  }) => void;
  onClose: () => void;
}

export function LibrarySelectDialog({
  target,
  libraries,
  onSuccess,
  onClose,
}: LibrarySelectDialogProps) {
  const [selectedLibraryId, setSelectedLibraryId] = useState(libraries[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!selectedLibraryId) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = parseCodeTemplateFromXml(target.xml);
      if (!parsed) throw new Error("Could not parse template XML");
      const updatedLibraries = libraries.map((lib) =>
        lib.id === selectedLibraryId
          ? { ...lib, codeTemplateIds: [...lib.codeTemplateIds, parsed.id] }
          : lib
      );
      // Force-overwrite: version-history restore, not the interactive panel save
      // (which prompts on revision conflict —.
      await bulkUpdateCodeTemplates(
        {
          libraries: updatedLibraries,
          removedLibraryIds: [],
          updatedCodeTemplates: [parsed],
          removedCodeTemplateIds: [],
        },
        true
      );
      toast.success(`Restored ${target.entityName} to revision ${getShortHash(target.commitHash)}`);
      const refreshedLibraries = await getCodeTemplateLibraries();
      onSuccess({
        hash: target.commitHash,
        path: target.repoPath,
        entityName: target.entityName,
        refreshedLibraries,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title="Select a library"
      description={
        <>
          <strong>{target.entityName}</strong> no longer exists in any library on this server.
          Choose which library to restore it into.
        </>
      }
      onSubmit={() => void handleSubmit()}
      submitLabel={saving ? "Restoring\u2026" : "Restore"}
      saving={saving}
      submitDisabled={!selectedLibraryId}
      error={error}
    >
      <div className="space-y-1.5">
        <Label className="text-xs">Library</Label>
        {libraries.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No libraries found on this server.
          </p>
        ) : (
          <Select value={selectedLibraryId} onValueChange={setSelectedLibraryId}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Select a library\u2026" />
            </SelectTrigger>
            <SelectContent>
              {libraries.map((lib) => (
                <SelectItem key={lib.id} value={lib.id} className="text-xs">
                  {lib.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </FormDialog>
  );
}
