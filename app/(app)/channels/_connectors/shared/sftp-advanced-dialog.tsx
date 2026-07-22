"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { RadioGroup } from "./radio-group";
import { inputCls } from "./styles";
import { SecretInput } from "@/components/ui/secret-input";
import { NameValueTable } from "./name-value-table";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SftpAdvancedSettings {
  passwordAuth: boolean;
  keyAuth: boolean;
  keyFile: string;
  passPhrase: string;
  hostKeyChecking: string; // "yes" | "ask" | "no"
  knownHostsFile: string;
  configurationSettings: Array<{ name: string; value: string }>;
}

interface SftpAdvancedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SftpAdvancedSettings;
  onSave: (updated: SftpAdvancedSettings) => void;
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

// ─── Auth mode helper ─────────────────────────────────────────────────────────

type AuthMode = "password" | "publicKey" | "both";

function authModeFromBooleans(pw: boolean, key: boolean): AuthMode {
  if (pw && key) return "both";
  if (key) return "publicKey";
  return "password";
}

function authModeToBooleans(mode: AuthMode): { passwordAuth: boolean; keyAuth: boolean } {
  switch (mode) {
    case "password":
      return { passwordAuth: true, keyAuth: false };
    case "publicKey":
      return { passwordAuth: false, keyAuth: true };
    case "both":
      return { passwordAuth: true, keyAuth: true };
  }
}

// ─── SftpAdvancedDialog ───────────────────────────────────────────────────────

export function SftpAdvancedDialog({
  open,
  onOpenChange,
  settings,
  onSave,
}: SftpAdvancedDialogProps) {
  const { viewDensity } = useCompactMode();
  const [local, setLocal] = useState<SftpAdvancedSettings>(settings);
  const [errors, setErrors] = useState<{ keyFile?: string; knownHostsFile?: string }>({});

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocal(settings);
      setErrors({});
    }
  }, [open, settings]);

  function set<K extends keyof SftpAdvancedSettings>(key: K, val: SftpAdvancedSettings[K]) {
    setLocal((prev) => ({ ...prev, [key]: val }));
  }

  const authMode = authModeFromBooleans(local.passwordAuth, local.keyAuth);
  const keyEnabled = local.keyAuth;

  function handleAuthModeChange(mode: string) {
    const bools = authModeToBooleans(mode as AuthMode);
    setLocal((prev) => ({ ...prev, ...bools }));
  }

  function handleOk() {
    const newErrors: { keyFile?: string; knownHostsFile?: string } = {};

    if (local.keyAuth && !local.keyFile.trim()) {
      newErrors.keyFile = "Key File is required when key authentication is enabled.";
    }
    if (local.hostKeyChecking === "yes" && !local.knownHostsFile.trim()) {
      newErrors.knownHostsFile =
        "Known Hosts File is required when host key checking is set to Yes.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave(local);
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="SFTP Settings"
      description="Configure SFTP connection settings."
      onSubmit={handleOk}
      submitLabel="OK"
      maxWidth="sm:max-w-3xl"
    >
      <div className="border border-border rounded p-4 space-y-3 overflow-hidden">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1">
          SFTP Advanced Settings
        </p>

        {/* Authentication mode */}
        <Row label="Authentication:">
          <RadioGroup
            name="sftp-auth-mode"
            value={authMode}
            onChange={handleAuthModeChange}
            options={[
              { label: "Password", value: "password" },
              { label: "Public Key", value: "publicKey" },
              { label: "Both", value: "both" },
            ]}
            title="Select the authentication method for the SFTP connection."
          />
        </Row>

        {/* Key File */}
        <Row label="Key File:">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <HoverTooltip content="The absolute path to the private key file used for key-based authentication.">
              <input
                type="text"
                value={local.keyFile}
                onChange={(e) => set("keyFile", e.target.value)}
                disabled={!keyEnabled}
                className={`${inputCls(viewDensity)} w-full ${errors.keyFile ? "border-red-500" : ""} disabled:opacity-40`}
                placeholder="/path/to/private_key"
              />
            </HoverTooltip>
            {errors.keyFile && (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.keyFile}</span>
            )}
          </div>
        </Row>

        {/* Passphrase */}
        <Row label="Passphrase:">
          <HoverTooltip content="The passphrase for the private key file.">
            <SecretInput
              value={local.passPhrase}
              onChange={(e) => set("passPhrase", e.target.value)}
              disabled={!keyEnabled}
              density={viewDensity}
              className={`${inputCls(viewDensity)} w-52 disabled:opacity-40`}
            />
          </HoverTooltip>
        </Row>

        {/* Host Key Checking */}
        <Row label="Host Key Checking:">
          <RadioGroup
            name="sftp-host-checking"
            value={local.hostKeyChecking}
            onChange={(v) => set("hostKeyChecking", v)}
            options={[
              { label: "Yes", value: "yes" },
              { label: "Ask", value: "ask" },
              { label: "No", value: "no" },
            ]}
            title="Specifies whether the host's SSH key should be verified against the known_hosts file."
          />
        </Row>

        {/* Known Hosts File */}
        <Row label="Known Hosts File:">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <HoverTooltip content="The absolute path to the known_hosts file for SSH host key verification.">
              <input
                type="text"
                value={local.knownHostsFile}
                onChange={(e) => set("knownHostsFile", e.target.value)}
                className={`${inputCls(viewDensity)} w-full ${errors.knownHostsFile ? "border-red-500" : ""}`}
                placeholder="/path/to/known_hosts"
              />
            </HoverTooltip>
            {errors.knownHostsFile && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {errors.knownHostsFile}
              </span>
            )}
          </div>
        </Row>

        {/* Configuration Options (name/value table) */}
        <div className="flex items-start gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400 text-right w-[180px] shrink-0 pt-2">
            Configuration Options:
          </span>
          <div className="flex-1 min-w-0">
            <NameValueTable
              entries={local.configurationSettings}
              onChange={(entries) => set("configurationSettings", entries)}
              addLabel="New"
              namePlaceholder="Property name"
              valuePlaceholder="Property value"
            />
          </div>
        </div>
      </div>
    </FormDialog>
  );
}
