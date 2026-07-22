// Re-export the generic dialog components so existing imports in the messages
// module continue to work without change.
export { ConfirmDialog } from "@/components/confirm-dialog";

import { TypeToConfirmDialog } from "@/components/confirm-dialog";

// ─── Remove Results Confirmation Dialog ──────────────────────────────────────

export function RemoveResultsConfirmDialog({
  channelName,
  onConfirm,
  onCancel,
}: {
  channelName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <TypeToConfirmDialog
      title="Remove Results"
      description={
        <>
          This will remove all messages that match the current search criteria for{" "}
          <span className="font-medium">{channelName}</span>. Type{" "}
          <span className="font-mono font-semibold">REMOVEALL</span> and click OK to continue.
        </>
      }
      confirmWord="REMOVEALL"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
