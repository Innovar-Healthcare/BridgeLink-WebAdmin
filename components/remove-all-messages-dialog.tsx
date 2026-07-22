"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { removeAllMessagesForChannels } from "@/lib/api-client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";

interface RemoveAllMessagesChannel {
  channelId: string;
  channelName: string;
  channelState: string;
}

interface RemoveAllMessagesDialogProps {
  /** Channels to remove messages for. A single-channel removal passes a one-element array,
   *  mirroring the Java client's bulk removeAllMessages(Set<String>, ...) path. */
  channels: RemoveAllMessagesChannel[];
  onClose: () => void;
  onDone: () => void;
}

export function RemoveAllMessagesDialog({
  channels,
  onClose,
  onDone,
}: RemoveAllMessagesDialogProps) {
  // Restart checkbox is enabled if ANY selected channel is not STOPPED — mirrors Java's
  // restartCheckboxEnabled (Frame.java:3937-3945). When every channel is stopped it is disabled.
  const anyRunning = channels.some((c) => c.channelState !== "STOPPED");
  const targetLabel =
    channels.length === 1 ? channels[0].channelName : `${channels.length} channels`;
  const [restartRunning, setRestartRunning] = useState(false);
  const [clearStats, setClearStats] = useState(true);
  const [step, setStep] = useState<"confirm" | "type">("confirm");
  const [confirmText, setConfirmText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setSaving(true);
    setError(null);
    try {
      await removeAllMessagesForChannels(
        channels.map((c) => c.channelId),
        {
          restartRunningChannels: restartRunning,
          clearStatistics: clearStats,
        }
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(v) => {
        if (!v && !saving) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[520px] flex flex-col p-0 gap-0"
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Remove All Messages
          </DialogTitle>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === "confirm" ? (
          <>
            <div className="px-4 py-4 flex flex-col gap-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Are you sure you want to remove all messages (including QUEUED) for{" "}
                <span className="font-medium">{targetLabel}</span>
                {anyRunning ? " (one or more currently not stopped)" : ""}?
              </p>
              <FormCheckbox
                label={
                  <span className={anyRunning ? "" : "text-gray-400 dark:text-gray-500"}>
                    Include selected channels that are not stopped (channels will be temporarily
                    stopped while messages are being removed)
                  </span>
                }
                checked={restartRunning}
                onChange={setRestartRunning}
                disabled={!anyRunning}
                className="items-start"
              />
              <FormCheckbox
                label="Clear statistics for affected channel(s)"
                checked={clearStats}
                onChange={setClearStats}
              />
            </div>
            <div className="flex justify-center gap-3 px-4 py-3 border-t border-border">
              <button
                type="button"
                onClick={() => setStep("type")}
                className="px-6 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
              >
                No
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-4 flex flex-col gap-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                This will remove <strong>all</strong> messages for{" "}
                <span className="font-medium">{targetLabel}</span>. Type{" "}
                <span className="font-mono font-semibold">REMOVEALL</span> and click OK to continue.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmText === "REMOVEALL") handleRemove();
                }}
                placeholder="Type REMOVEALL to confirm"
                autoFocus
                className="w-full px-3 py-1.5 text-sm border border-border rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <div className="flex justify-center gap-3 px-4 py-3 border-t border-border">
              <button
                type="button"
                onClick={handleRemove}
                disabled={confirmText !== "REMOVEALL" || saving}
                className="px-6 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                {saving ? "Removing\u2026" : "OK"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("confirm");
                  setConfirmText("");
                  setError(null);
                }}
                disabled={saving}
                className="px-6 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
