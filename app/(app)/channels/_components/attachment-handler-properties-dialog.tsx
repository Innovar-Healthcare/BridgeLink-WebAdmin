"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { MONACO_DIALOG_CENTER_STYLE } from "@/lib/hooks/use-monaco-overflow-host";
import type { AttachmentHandlerState, AttachmentCommitResult } from "../_lib/channel-xml";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RegexBody } from "./attachment-handler/regex-body";
import { JavaScriptBody } from "./attachment-handler/javascript-body";
import { CustomBody } from "./attachment-handler/custom-body";

// ─── Shared input style (passed to body components) ───────────────────────────

export function useInputCls() {
  const { viewDensity } = useCompactMode();
  return `${densityHeight(viewDensity)} px-3 text-sm rounded border border-border
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  placeholder:text-gray-400 dark:placeholder:text-gray-500
  focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30`;
}

// ─── AttachmentHandlerPropertiesDialog ────────────────────────────────────────

interface AttachmentHandlerPropertiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachmentHandler: AttachmentHandlerState;
  onSave: (updated: AttachmentHandlerState) => void;
  channelId?: string;
}

export function AttachmentHandlerPropertiesDialog({
  open,
  onOpenChange,
  attachmentHandler,
  onSave,
  channelId,
}: AttachmentHandlerPropertiesDialogProps) {
  const inputCls = useInputCls();

  // Working copy — reset when dialog opens
  const [local, setLocal] = useState<AttachmentHandlerState>(attachmentHandler);
  const [footerError, setFooterError] = useState<string | null>(null);

  // Soft-block warning awaiting a "Save anyway?" confirm (Custom/JavaScript bodies).
  const [pendingWarning, setPendingWarning] = useState<{
    warning: string;
    value: AttachmentHandlerState;
  } | null>(null);

  // footerLeft slot — JS body renders its Validate button here
  const [footerLeft, setFooterLeft] = useState<React.ReactNode>(null);

  // Ref passed to JS body so it can register a commit function (avoids prop drilling)
  const commitRef = useRef<() => AttachmentCommitResult>(() => local);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocal(attachmentHandler);
      setFooterError(null);
      setFooterLeft(null);
      setPendingWarning(null);
    }
  }, [open, attachmentHandler]);

  function commitAndClose(value: AttachmentHandlerState) {
    onSave(value);
    onOpenChange(false);
  }

  function handleSave() {
    const result = commitRef.current();
    if ("error" in result) {
      setFooterError(result.error);
      return;
    }
    if ("warning" in result) {
      // Soft block — prompt "Save anyway?" rather than refusing #45).
      setFooterError(null);
      setPendingWarning(result);
      return;
    }
    commitAndClose(result);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  // ── Dialog size / title / description ─────────────────────────────────────

  const dialogSizeCls =
    local.type === "JavaScript"
      ? "w-[95vw] sm:max-w-[1800px] h-[90vh]"
      : local.type === "Regex"
        ? "w-[95vw] sm:max-w-[1400px] h-[85vh]"
        : local.type === "Custom"
          ? "max-w-3xl h-[70vh]"
          : "max-w-md";

  const dialogTitle =
    local.type === "JavaScript"
      ? "JavaScript Attachment Handler"
      : local.type === "Regex"
        ? "Regex Attachment Handler"
        : local.type === "Custom"
          ? "Custom Attachment Handler"
          : "Entire Message Properties";

  const dialogDescription =
    local.type === "JavaScript"
      ? "Script runs for each inbound message to extract attachments. Return a list of attachment objects."
      : local.type === "Regex"
        ? "Define one or more regex patterns to extract attachments from the message."
        : local.type === "Custom"
          ? "Configure the fully-qualified Java class and properties for the custom attachment handler."
          : "Configure the MIME type for the extracted attachment.";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={`flex flex-col gap-0 p-0 overflow-hidden ${dialogSizeCls}`}
          // The JavaScript body hosts a Monaco editor whose autocomplete popup uses
          // position:fixed. Radix centers DialogContent with a CSS `translate`, which
          // makes it the containing block for fixed descendants and offsets the popup
          // from the cursor. Center this dialog transform-free (sized by dialogSizeCls)
          // so the popup anchors to the viewport, shared const per.
          // Only for JavaScript — the other types (e.g. Entire Message) have no definite
          // height, so margin:auto centering would stretch them full-viewport.
          style={local.type === "JavaScript" ? MONACO_DIALOG_CENTER_STYLE : undefined}
        >
          {/* ── Header ────────────────────────────────────────────────── */}
          <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          {/* ── Body — adapts by type ──────────────────────────────────── */}

          {local.type === "Entire Message" && (
            <div className="px-6 py-5 space-y-3 flex-1">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  MIME Type
                </label>
                <input
                  type="text"
                  value={local.identityMimeType}
                  onChange={(e) => setLocal({ ...local, identityMimeType: e.target.value })}
                  placeholder="text/plain"
                  className={`${inputCls} w-full`}
                />
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Source map variables may be used (e.g. {"${mimeType}"})
                </p>
              </div>
            </div>
          )}

          {local.type === "Regex" && (
            <RegexBody local={local} setLocal={setLocal} commitRef={commitRef} />
          )}

          {local.type === "JavaScript" && (
            <JavaScriptBody
              local={local}
              setLocal={setLocal}
              commitRef={commitRef}
              setFooterLeft={setFooterLeft}
              channelId={channelId}
            />
          )}

          {local.type === "Custom" && (
            <CustomBody local={local} setLocal={setLocal} commitRef={commitRef} />
          )}

          {/* ── Footer ────────────────────────────────────────────────── */}
          <DialogFooter className="px-6 py-3 shrink-0 border-t border-border">
            <div className="flex w-full items-center gap-3">
              {/* Left slot — Validate JS button rendered by JS body */}
              <div className="flex items-center gap-2 flex-1 min-w-0">{footerLeft}</div>

              {/* Error message */}
              {footerError && (
                <span className="text-sm text-red-600 dark:text-red-400 truncate shrink min-w-0">
                  {footerError}
                </span>
              )}

              {/* Cancel + Save */}
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <button
                  onClick={handleCancel}
                  className="px-4 py-1.5 text-sm rounded border border-border
                  text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                  hover:border-border transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 text-sm rounded border border-blue-500 bg-blue-500 text-white
                  hover:bg-blue-600 hover:border-blue-600 transition-colors font-medium"
                >
                  Save
                </button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingWarning && (
        <ConfirmDialog
          title="Save anyway?"
          description={pendingWarning.warning}
          confirmLabel="Save Anyway"
          confirmVariant="default"
          onConfirm={() => {
            const { value } = pendingWarning;
            setPendingWarning(null);
            commitAndClose(value);
          }}
          onCancel={() => setPendingWarning(null)}
        />
      )}
    </>
  );
}
