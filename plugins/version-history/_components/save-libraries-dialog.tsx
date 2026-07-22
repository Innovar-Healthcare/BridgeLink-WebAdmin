"use client";

/**
 * SaveLibrariesDialog — controlled "Save Libs" commit for the Code Templates page.
 *
 * Mirrors Java's CodeTemplateOperations.saveLibraries(): writes the library
 * structure to the repo, commits, and pushes. The shared CommitController handles
 * the auto-commit-settings gating (silent vs. dialog). Fixes, where the
 * "Save Libs" button committed silently with a default message and never prompted.
 */

import { getSession } from "@/lib/auth";
import { clearRepoChangesCache } from "@/lib/hooks/repo-changes-cache";
import type { CodeTemplateLibrary } from "@/lib/types";

import { saveLibraries } from "../api-version-history";
import { CommitController } from "./commit-controller";

interface SaveLibrariesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: CodeTemplateLibrary[];
  onCommitted?: () => void;
}

export function SaveLibrariesDialog({
  open,
  onOpenChange,
  libraries,
  onCommitted,
}: SaveLibrariesDialogProps) {
  return (
    <CommitController
      open={open}
      onOpenChange={onOpenChange}
      title="Save Libraries to Repo"
      description="Commit the code template library structure and push it to the remote repository."
      successMessage="Libraries committed and pushed successfully."
      commit={async (message) => {
        const userId = getSession()?.userId ?? 1;
        await saveLibraries(libraries, message, userId);
        clearRepoChangesCache();
      }}
      onCommitted={onCommitted}
    />
  );
}
