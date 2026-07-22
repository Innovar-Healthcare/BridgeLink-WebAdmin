"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { selectCls } from "./styles";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SMB_VERSIONS = [
  { label: "SMB v1", value: "SMB1" },
  { label: "SMB v2.0.2", value: "SMB202" },
  { label: "SMB v2.1", value: "SMB210" },
  { label: "SMB v3.0", value: "SMB300" },
  { label: "SMB v3.0.2", value: "SMB302" },
  { label: "SMB v3.1.1", value: "SMB311" },
];

const VERSION_ORDER = SMB_VERSIONS.map((v) => v.value);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmbAdvancedSettings {
  smbMinVersion: string;
  smbMaxVersion: string;
}

interface SmbAdvancedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SmbAdvancedSettings;
  onSave: (updated: SmbAdvancedSettings) => void;
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-h-[32px]">
      <span className="text-sm text-gray-600 dark:text-gray-400 text-right w-[180px] shrink-0 leading-snug py-1">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── SmbAdvancedDialog ────────────────────────────────────────────────────────

export function SmbAdvancedDialog({
  open,
  onOpenChange,
  settings,
  onSave,
}: SmbAdvancedDialogProps) {
  const { viewDensity } = useCompactMode();
  const [local, setLocal] = useState<SmbAdvancedSettings>(settings);
  const [error, setError] = useState<string | null>(null);
  const [showSmbV1Confirm, setShowSmbV1Confirm] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocal(settings);

      setError(null);
    }
  }, [open, settings]);

  const hasSmbV1 = local.smbMinVersion === "SMB1" || local.smbMaxVersion === "SMB1";

  function doSave() {
    onSave(local);
    onOpenChange(false);
  }

  function handleOk() {
    const mi = VERSION_ORDER.indexOf(local.smbMinVersion);
    const mx = VERSION_ORDER.indexOf(local.smbMaxVersion);
    if (mi > mx) {
      setError("Minimum SMB version cannot be greater than maximum SMB version.");
      return;
    }

    if (hasSmbV1) {
      setShowSmbV1Confirm(true);
      return;
    }

    doSave();
  }

  return (
    <>
      {showSmbV1Confirm && (
        <ConfirmDialog
          title="Outdated SMB Version"
          description="SMB v1 is outdated and may pose a security risk. Do you wish to proceed?"
          confirmLabel="Yes"
          confirmVariant="default"
          onConfirm={() => {
            setShowSmbV1Confirm(false);
            doSave();
          }}
          onCancel={() => setShowSmbV1Confirm(false)}
        />
      )}
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="SMB Settings"
        description="Configure SMB connection settings."
        onSubmit={handleOk}
        submitLabel="OK"
        error={error}
        maxWidth="max-w-lg"
      >
        <div className="border border-border rounded p-4 space-y-3 overflow-hidden">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1">
            SMB Advanced Settings
          </p>

          <Row label="Minimum SMB Version:">
            <HoverTooltip content="The minimum SMB protocol version to use for the connection.">
              <select
                value={local.smbMinVersion}
                onChange={(e) => {
                  setLocal((prev) => ({ ...prev, smbMinVersion: e.target.value }));
                  setError(null);
                }}
                className={selectCls(viewDensity)}
              >
                {SMB_VERSIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </HoverTooltip>
          </Row>

          <Row label="Maximum SMB Version:">
            <HoverTooltip content="The maximum SMB protocol version to use for the connection.">
              <select
                value={local.smbMaxVersion}
                onChange={(e) => {
                  setLocal((prev) => ({ ...prev, smbMaxVersion: e.target.value }));
                  setError(null);
                }}
                className={selectCls(viewDensity)}
              >
                {SMB_VERSIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </HoverTooltip>
          </Row>

          {hasSmbV1 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
              SMB v1 is outdated and may pose a security risk.
            </p>
          )}
        </div>
      </FormDialog>
    </>
  );
}
