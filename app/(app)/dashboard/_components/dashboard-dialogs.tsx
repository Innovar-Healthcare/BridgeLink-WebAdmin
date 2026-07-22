"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearStatistics } from "@/lib/api-client";
import { getCache } from "@/lib/cache-store";
import { FormDialog } from "@/components/form-dialog";
import { InfoDialog } from "@/components/info-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";

// Re-export from shared component so existing Dashboard imports continue to work
export { RemoveAllMessagesDialog } from "@/components/remove-all-messages-dialog";

// ─── Clear Statistics Dialog ──────────────────────────────────────────────────
// Mirrors Java UI "Clear Statistics" dialog: checkboxes for Received/Filtered/Sent/Errored
// + Invert Selection button. channelName is shown in the subtitle.

interface ClearStatsDialogProps {
  channelId: string;
  /** When provided, clears stats for all channel IDs (group-level clear) */
  channelIds?: string[];
  channelName: string;
  /** If provided, clears stats for a single connector only; null = whole channel */
  metaDataId?: number | null;
  onClose: () => void;
  onDone: () => void;
}

export function ClearStatisticsDialog({
  channelId,
  channelIds,
  channelName,
  metaDataId,
  onClose,
  onDone,
}: ClearStatsDialogProps) {
  const [received, setReceived] = useState(false);
  const [filtered, setFiltered] = useState(false);
  const [sent, setSent] = useState(false);
  const [errored, setErrored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function invertSelection() {
    setReceived((v) => !v);
    setFiltered((v) => !v);
    setSent((v) => !v);
    setErrored((v) => !v);
  }

  async function handleOk() {
    if (!received && !filtered && !sent && !errored) return;
    setSaving(true);
    setError(null);
    try {
      const ids = channelIds ?? [channelId];
      const channelConnectorMap: Record<string, (number | null)[]> = {};
      if (metaDataId != null) {
        // Clearing a single connector
        for (const id of ids) channelConnectorMap[id] = [metaDataId];
      } else {
        // Clearing whole channel — build list like Java client: [null, 0, 1, ...]
        // null = channel-level stats, 0 = source, 1+ = destinations
        const { dashboardStatuses } = getCache();
        for (const id of ids) {
          const status = dashboardStatuses.find((s) => s.channelId === id);
          const mids: (number | null)[] = [null];
          if (status?.childStatuses) {
            for (const child of status.childStatuses) {
              if (child.metaDataId != null) mids.push(child.metaDataId);
            }
          }
          channelConnectorMap[id] = mids;
        }
      }
      await clearStatistics(channelConnectorMap, {
        received,
        filtered,
        sent,
        error: errored,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const noneSelected = !received && !filtered && !sent && !errored;
  const subtitle =
    metaDataId != null
      ? `${channelName} — connector ${metaDataId === 0 ? "Source" : `Dest ${metaDataId}`}`
      : channelName;

  return (
    <FormDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Clear Statistics"
      description={subtitle}
      onSubmit={handleOk}
      submitLabel="OK"
      saving={saving}
      error={error}
      submitDisabled={noneSelected}
      maxWidth="sm:max-w-xs"
      footerLeft={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={invertSelection}
          disabled={saving}
        >
          Invert Selection
        </Button>
      }
    >
      <div className="space-y-2">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Please select the statistics that you would like to reset:
        </p>
        <div className="flex flex-col gap-2">
          {(
            [
              ["Received", received, setReceived],
              ["Filtered", filtered, setFiltered],
              ["Sent", sent, setSent],
              ["Errored", errored, setErrored],
            ] as [string, boolean, (v: boolean) => void][]
          ).map(([label, checked, setter]) => (
            <FormCheckbox
              key={label}
              label={label}
              checked={checked}
              onChange={setter}
              disabled={saving}
            />
          ))}
        </div>
      </div>
    </FormDialog>
  );
}

// ─── Queue Disabled Warning Dialog ────────────────────────────────────────────

interface QueueDisabledWarningDialogProps {
  onClose: () => void;
}

export function QueueDisabledWarningDialog({ onClose }: QueueDisabledWarningDialogProps) {
  return (
    <InfoDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Warning"
      maxWidth="sm:max-w-[480px]"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-8 h-8 text-yellow-500 shrink-0 mt-0.5" />
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          One or more destination connectors were not stopped because queueing was not enabled.
          Queueing must be enabled for a destination connector to be stopped individually.
        </p>
      </div>
    </InfoDialog>
  );
}
