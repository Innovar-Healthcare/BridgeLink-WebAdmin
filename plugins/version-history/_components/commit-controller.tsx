"use client";

/**
 * CommitController — shared commit-and-push gating used by every explicit
 * Version History commit surface (Global Scripts, Save Libraries, Code Template
 * History).
 *
 * Mirrors the channel post-save flow (the "channels.post-save" slot): it reads
 * the auto-commit settings when opened and either
 *   - auto-commit ON + prompt OFF → commits silently with the default message, or
 *   - otherwise                    → shows the shared CommitMessageDialog.
 *
 * Unlike the channel post-save flow, an explicit click with auto-commit OFF still
 * prompts (the action should always work) — the deliberate "better than the Java
 * UI" behavior agreed in the plan.
 *
 * The host only flips `open`; all gating lives here.
 */

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getVersionHistoryAutoCommitSettings, friendlyRepoError } from "../api-version-history";
import { CommitMessageDialog } from "./commit-message-dialog";

interface CommitControllerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Commit & Push — Global Scripts". */
  title: string;
  /** Optional description shown under the title. */
  description?: React.ReactNode;
  /** Performs the actual commit with the resolved message. */
  commit: (message: string) => Promise<void>;
  /** Success toast text. Default: "Committed and pushed successfully." */
  successMessage?: string;
  /** Called after a successful commit (silent or via dialog). */
  onCommitted?: () => void;
}

export function CommitController({
  open,
  onOpenChange,
  title,
  description,
  commit,
  successMessage = "Committed and pushed successfully.",
  onCommitted,
}: CommitControllerProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [defaultMessage, setDefaultMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest props, read by the stable callbacks below so neither the resolve
  // effect nor doCommit needs the mutable callbacks in its dependency list.
  // Updated inside an effect (never during render) per the react-hooks/refs rule.
  const propsRef = useRef({ commit, onCommitted, successMessage, onOpenChange });
  useEffect(() => {
    propsRef.current = { commit, onCommitted, successMessage, onOpenChange };
  });

  const reset = useCallback(() => {
    setShowPrompt(false);
    setError(null);
    setSaving(false);
  }, []);

  const doCommit = useCallback(async (message: string, viaDialog: boolean) => {
    const props = propsRef.current;
    setSaving(true);
    setError(null);
    try {
      await props.commit(message);
      toast.success(props.successMessage);
      props.onCommitted?.();
      setSaving(false);
      setShowPrompt(false);
      props.onOpenChange(false);
    } catch (e) {
      const msg = friendlyRepoError(e, "Failed to commit");
      setSaving(false);
      if (viaDialog) {
        // Keep the dialog open with an inline error so the user can retry.
        setError(msg);
      } else {
        // Silent path: nothing is on screen — surface via toast and close.
        toast.error(msg);
        setShowPrompt(false);
        props.onOpenChange(false);
      }
    }
  }, []);

  const resolve = useCallback(async () => {
    const settings = await getVersionHistoryAutoCommitSettings().catch(() => ({
      autoCommitEnabled: false,
      promptEnabled: false,
      defaultMessage: "",
    }));
    setError(null);
    setSaving(false);
    setDefaultMessage(settings.defaultMessage);
    if (settings.autoCommitEnabled && !settings.promptEnabled) {
      // Silent commit with the configured default message.
      void doCommit(settings.defaultMessage, false);
    } else {
      setShowPrompt(true);
    }
  }, [doCommit]);

  useEffect(() => {
    if (open) startTransition(() => void resolve());
  }, [open, resolve]);

  if (!open || !showPrompt) return null;

  return (
    <CommitMessageDialog
      open
      onOpenChange={(o) => {
        if (saving) return;
        if (!o) reset();
        onOpenChange(o);
      }}
      title={title}
      description={description}
      defaultMessage={defaultMessage}
      saving={saving}
      error={error}
      onSubmit={(message) => void doCommit(message, true)}
    />
  );
}
