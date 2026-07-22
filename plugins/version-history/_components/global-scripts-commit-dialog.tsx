"use client";

/**
 * GlobalScriptsCommitDialog — controlled "Commit & Push" for the Global Scripts page.
 *
 * Mirrors Java's GlobalScriptOperations.commitAndPush(): commits all four global
 * scripts as a single commit and pushes. The shared CommitController handles the
 * auto-commit-settings gating (silent vs. dialog).
 */

import { getSession } from "@/lib/auth";
import { clearRepoChangesCache } from "@/lib/hooks/repo-changes-cache";
import type { GlobalScriptKey } from "@/lib/api-client";

import { commitAndPushGlobalScripts } from "../api-version-history";
import { CommitController } from "./commit-controller";

interface GlobalScriptsCommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentScripts?: Record<GlobalScriptKey, string> | null;
  onCommitted?: () => void;
}

export function GlobalScriptsCommitDialog({
  open,
  onOpenChange,
  currentScripts,
  onCommitted,
}: GlobalScriptsCommitDialogProps) {
  return (
    <CommitController
      open={open}
      onOpenChange={onOpenChange}
      title="Commit &amp; Push — Global Scripts"
      description="Commit the current global scripts and push them to the remote repository."
      successMessage="Global scripts committed and pushed successfully."
      commit={async (message) => {
        if (!currentScripts) throw new Error("No global scripts loaded to commit.");
        const userId = getSession()?.userId ?? 1;
        await commitAndPushGlobalScripts(currentScripts, message, userId);
        clearRepoChangesCache();
      }}
      onCommitted={onCommitted}
    />
  );
}
