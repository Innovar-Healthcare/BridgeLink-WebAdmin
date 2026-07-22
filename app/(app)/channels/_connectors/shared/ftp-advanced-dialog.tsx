"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { inputCls } from "./styles";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FtpAdvancedSettings {
  initialCommands: string; // newline-separated FTP commands
}

interface FtpAdvancedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: FtpAdvancedSettings;
  onSave: (updated: FtpAdvancedSettings) => void;
}

// ─── FtpAdvancedDialog ────────────────────────────────────────────────────────

export function FtpAdvancedDialog({
  open,
  onOpenChange,
  settings,
  onSave,
}: FtpAdvancedDialogProps) {
  const { viewDensity } = useCompactMode();
  const [local, setLocal] = useState<FtpAdvancedSettings>(settings);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocal(settings);
    }
  }, [open, settings]);

  function handleOk() {
    onSave(local);
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="FTP Settings"
      description="Configure FTP connection settings."
      onSubmit={handleOk}
      submitLabel="OK"
      maxWidth="max-w-lg"
    >
      <div className="border border-border rounded p-4 space-y-3 overflow-hidden">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1">
          FTP Advanced Settings
        </p>

        <div className="flex items-start gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400 text-right w-[140px] shrink-0 pt-2">
            Initial Commands:
          </span>
          <HoverTooltip content="FTP commands to run on each connection initialization. Enter one command per line.">
            <Textarea
              density={viewDensity}
              enableTabKey
              value={local.initialCommands}
              onChange={(e) => setLocal({ initialCommands: e.target.value })}
              rows={4}
              placeholder="One command per line"
              className={`${inputCls(viewDensity)} h-auto flex-1 py-1.5 resize-y font-mono text-xs`}
            />
          </HoverTooltip>
        </div>
      </div>
    </FormDialog>
  );
}
