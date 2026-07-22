"use client";

/**
 * UnsavedChangesDialog — renders automatically whenever the NavigationGuard
 * has a pending navigation destination and the registered guard reports dirty
 * state. Matches the Java UI "Would you like to save?" Yes / No / Cancel pattern.
 *
 * Owns the navigation-guard coupling (router.push, NavigationSaveCancelled);
 * the presentation is delegated to SaveDiscardCancelDialog.
 *
 * Must be rendered inside <NavigationGuardProvider>.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SaveDiscardCancelDialog } from "@/components/save-discard-cancel-dialog";
import { useNavigationGuard, NavigationSaveCancelled } from "@/lib/navigation-guard";

export function UnsavedChangesDialog() {
  const router = useRouter();
  const { pendingHref, clearPending, guard } = useNavigationGuard();

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Open only when there's a pending destination AND dirty state
  const open = pendingHref !== null && (guard?.isDirty() ?? false);

  async function handleYes() {
    if (!guard || !pendingHref) return;
    setSaveError(null);
    setSaving(true);
    try {
      await guard.save();
      // Save succeeded — navigate to the intended destination
      clearPending();
      router.push(pendingHref);
    } catch (err) {
      if (err instanceof NavigationSaveCancelled) {
        // The page aborted its own save (e.g. the user declined an overwrite-conflict
        // prompt). Close this dialog and stay put — no error, no navigation.
        clearPending();
        setSaving(false);
        return;
      }
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
      setSaving(false);
    }
  }

  function handleNo() {
    if (!pendingHref) return;
    const dest = pendingHref;
    clearPending();
    router.push(dest);
  }

  function handleCancel() {
    setSaveError(null);
    clearPending();
  }

  const label = guard?.label ?? "changes";

  return (
    <SaveDiscardCancelDialog
      open={open}
      description={`Would you like to save the ${label}?`}
      saving={saving}
      error={saveError}
      onSave={handleYes}
      onDiscard={handleNo}
      onCancel={handleCancel}
    />
  );
}
