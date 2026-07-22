"use client";

/**
 * Version History Plugin Settings Tab
 *
 * Mirrors Java's VersionHistorySettingPanel.java + GitSettingsDialog.java (v3).
 *
 * Three sections:
 *   1. Enable — Yes/No toggle (always visible)
 *   2. Git — Configure button (opens dialog) + Sync Delete toggle (visible when enabled)
 *   3. Auto Commit — Enable, Prompt, Default Message (visible when enabled)
 *
 * API: GET/PUT /extensions/Version%20History%20Plugin/properties  → load/save
 *      POST /plugins/version-history/validateSetting              → validate git connection
 */

import { useCallback, useEffect, useState } from "react";
import { GitBranch, GitCommitHorizontal, Settings, ToggleLeft } from "lucide-react";

import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import { clearVersionHistoryEnabledCache } from "@/lib/version-history";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverTooltip } from "@/components/hover-tooltip";
import { SettingsSection, FieldRow, RadioField } from "../settings-section";
import { SettingsTabScroll } from "../settings-tab-scroll";
import { GitSettingsDialog } from "./git-settings-dialog";
import { AUTH_TYPE_SSH, type GitAuthType } from "@/plugins/version-history/api-version-history";

// ─── Property keys (from VersionHistoryProperties.java) ─────────────────────

const KEYS = {
  ENABLE: "versionHistory.enable",
  AUTO_COMMIT_ENABLE: "versionHistory.auto.commit.enable",
  AUTO_COMMIT_PROMPT: "versionHistory.auto.commit.prompt",
  AUTO_COMMIT_MSG: "versionHistory.auto.commit.message",
  SYNC_DELETE: "versionHistory.syncDelete",
  REMOTE_URL: "versionHistory.remote.url",
  REMOTE_BRANCH: "versionHistory.remote.branch",
  REMOTE_SSH_KEY: "versionHistory.remote.ssh.key",
  // Added in version-history 3.0.1 / BridgeLink 26.3.1. On 26.3.0 servers
  // these keys are simply absent from the properties record — `fromRecord`
  // falls back to defaults and `toRecord` writes them anyway. XStream on the
  // old server silently drops unknown keys, so this is safe to send.
  REMOTE_SSH_KEY_PATH: "versionHistory.remote.ssh.keyPath",
  REMOTE_AUTH_TYPE: "versionHistory.remote.authType",
  REMOTE_HTTPS_USERNAME: "versionHistory.remote.https.username",
  REMOTE_HTTPS_PASSWORD: "versionHistory.remote.https.password",
  REMOTE_HTTPS_CREDENTIALS_PATH: "versionHistory.remote.https.credentialsPath",
} as const;

const PLUGIN_NAME = "Version History Plugin";

// ─── Form interface ─────────────────────────────────────────────────────────

interface VersionHistoryForm {
  enable: boolean;
  autoCommitEnable: boolean;
  autoCommitPrompt: boolean;
  autoCommitMessage: string;
  syncDelete: boolean;
  remoteUrl: string;
  remoteBranch: string;
  remoteSshKey: string;
  remoteSshKeyPath: string;
  remoteAuthType: GitAuthType;
  remoteHttpsUsername: string;
  remoteHttpsPassword: string;
  remoteHttpsCredentialsPath: string;
}

// ─── Conversion helpers ─────────────────────────────────────────────────────

function fromRecord(record: Record<string, string>): VersionHistoryForm {
  const rawAuth = record[KEYS.REMOTE_AUTH_TYPE] ?? "";
  const authType: GitAuthType = rawAuth.toUpperCase() === "HTTPS" ? "HTTPS" : AUTH_TYPE_SSH;
  return {
    enable: record[KEYS.ENABLE] === "true",
    autoCommitEnable: record[KEYS.AUTO_COMMIT_ENABLE] === "true",
    autoCommitPrompt: record[KEYS.AUTO_COMMIT_PROMPT] === "true",
    autoCommitMessage: record[KEYS.AUTO_COMMIT_MSG] ?? "",
    syncDelete: record[KEYS.SYNC_DELETE] === "true",
    remoteUrl: record[KEYS.REMOTE_URL] ?? "",
    remoteBranch: record[KEYS.REMOTE_BRANCH] ?? "",
    remoteSshKey: record[KEYS.REMOTE_SSH_KEY] ?? "",
    remoteSshKeyPath: record[KEYS.REMOTE_SSH_KEY_PATH] ?? "",
    remoteAuthType: authType,
    remoteHttpsUsername: record[KEYS.REMOTE_HTTPS_USERNAME] ?? "",
    remoteHttpsPassword: record[KEYS.REMOTE_HTTPS_PASSWORD] ?? "",
    remoteHttpsCredentialsPath: record[KEYS.REMOTE_HTTPS_CREDENTIALS_PATH] ?? "",
  };
}

function toRecord(form: VersionHistoryForm): Record<string, string> {
  return {
    [KEYS.ENABLE]: String(form.enable),
    [KEYS.AUTO_COMMIT_ENABLE]: String(form.autoCommitEnable),
    [KEYS.AUTO_COMMIT_PROMPT]: String(form.autoCommitPrompt),
    [KEYS.AUTO_COMMIT_MSG]: form.autoCommitMessage,
    [KEYS.SYNC_DELETE]: String(form.syncDelete),
    [KEYS.REMOTE_URL]: form.remoteUrl,
    [KEYS.REMOTE_BRANCH]: form.remoteBranch,
    [KEYS.REMOTE_SSH_KEY]: form.remoteSshKey,
    [KEYS.REMOTE_SSH_KEY_PATH]: form.remoteSshKeyPath,
    [KEYS.REMOTE_AUTH_TYPE]: form.remoteAuthType,
    [KEYS.REMOTE_HTTPS_USERNAME]: form.remoteHttpsUsername,
    [KEYS.REMOTE_HTTPS_PASSWORD]: form.remoteHttpsPassword,
    [KEYS.REMOTE_HTTPS_CREDENTIALS_PATH]: form.remoteHttpsCredentialsPath,
  };
}

/**
 * Mirrors GitSettings.validate() on the server (3.0.1).
 *
 * On 26.3.0 servers `remoteAuthType` always stays SSH and the HTTPS branch is
 * unreachable, so this validator behaves identically to the legacy SSH-only
 * check there.
 */
function validate(form: VersionHistoryForm): string | null {
  if (!form.enable) return null;

  if (!form.remoteUrl.trim()) {
    return "Please provide a remote repository URL.";
  }
  if (!form.remoteBranch.trim()) {
    return "Please provide a branch name (e.g., main, develop, or feature/xyz).";
  }
  if (form.remoteAuthType === "HTTPS") {
    const inline = form.remoteHttpsUsername.trim() && form.remoteHttpsPassword.trim();
    const filePath = form.remoteHttpsCredentialsPath.trim();
    if (!inline && !filePath) {
      return "Please provide an HTTPS username and personal access token, or a credentials file path.";
    }
  } else {
    const inlineKey = form.remoteSshKey.trim();
    const keyPath = form.remoteSshKeyPath.trim();
    if (!inlineKey && !keyPath) {
      return "Please provide an SSH private key (starts with '-----BEGIN') or a key file path.";
    }
  }
  if (form.autoCommitEnable && !form.autoCommitMessage.trim()) {
    return "Please provide a default commit message when Auto Commit is enabled.";
  }
  return null;
}

// ─── Actions interface ──────────────────────────────────────────────────────

export interface VersionHistoryTabActions {
  save: () => void;
  refresh: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
}

interface VersionHistorySettingsTabProps {
  actionsRef?: React.MutableRefObject<VersionHistoryTabActions>;
  onActionsChanged?: () => void;
  onDirty?: (isDirty: boolean) => void;
  saveRef?: React.MutableRefObject<() => Promise<void>>;
}

// ─── Main settings tab ──────────────────────────────────────────────────────

export function VersionHistorySettingsTab({
  actionsRef,
  onActionsChanged,
  onDirty,
  saveRef,
}: VersionHistorySettingsTabProps) {
  const { props, loading, saving, error, dirty, set, load, save, saveOrThrow } =
    usePluginSettings<VersionHistoryForm>({
      pluginName: PLUGIN_NAME,
      fromRecord,
      toRecord,
      validate,
      preserveExtraKeys: true,
    });

  const [gitDialogOpen, setGitDialogOpen] = useState(false);

  // Invalidate the version-history "enabled" cache after a successful save so
  // the change to the "Enable" toggle is reflected immediately across all gated
  // surfaces (nav item, channel-editor tab, toolbars) without a re-login.
  const saveAndInvalidate = useCallback(async () => {
    const ok = await save();
    if (ok) clearVersionHistoryEnabledCache();
  }, [save]);

  // Pure (throwing, no-toast) variant for the host's unsaved-changes guard,
  // preserving the same cache invalidation on success.
  const saveOrThrowAndInvalidate = useCallback(async () => {
    await saveOrThrow();
    clearVersionHistoryEnabledCache();
  }, [saveOrThrow]);

  // ── Expose actions to parent ──
  if (actionsRef) {
    // eslint-disable-next-line react-hooks/refs -- actionsRef is parent-owned; writing .current during render exposes current handlers to parent toolbar
    actionsRef.current = {
      save: saveAndInvalidate,
      refresh: load,
      dirty,
      saving,
      loading,
    };
  }

  // Pure save for the Settings host's unsaved-changes guard / tab-switch prompt.
  if (saveRef) {
    // eslint-disable-next-line react-hooks/refs -- saveRef is parent-owned; writing .current during render exposes the current save handler to the host guard
    saveRef.current = saveOrThrowAndInvalidate;
  }

  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, onActionsChanged]);

  // Report dirty state up so plugin tabs join the host's unsaved-changes guard.
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // ── Error state (no data loaded) ──
  if (!props) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
          {error || "Failed to load Version History settings."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <SettingsTabScroll contentClassName="p-6 space-y-5">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}

        {/* ── Section 1: Enable ── */}
        <SettingsSection labelWidth="w-[340px]" title="Enable" icon={ToggleLeft}>
          <RadioField
            label="Enable:"
            name="vhEnable"
            value={String(props.enable)}
            onChange={(v) => set("enable", v === "true")}
            tooltip="Enable version history tracking of channels, code templates, and other configuration in a Git repository."
          />
        </SettingsSection>

        {/* ── Section 2: Git (visible only when enabled) ── */}
        {props.enable && (
          <SettingsSection labelWidth="w-[340px]" title="Git" icon={GitBranch}>
            <FieldRow label="Settings:">
              <HoverTooltip content="Configure the Git remote repository URL, branch, and authentication used to store version history.">
                <Button variant="outline" size="sm" onClick={() => setGitDialogOpen(true)}>
                  <Settings className="w-3.5 h-3.5 mr-1.5" />
                  Configure
                </Button>
              </HoverTooltip>
              {props.remoteUrl && (
                <span
                  className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[300px]"
                  title={props.remoteUrl}
                >
                  {props.remoteUrl}
                </span>
              )}
            </FieldRow>
            <RadioField
              label="Sync Delete:"
              name="vhSyncDelete"
              value={String(props.syncDelete)}
              onChange={(v) => set("syncDelete", v === "true")}
              tooltip="When enabled, deleting a channel or code template also removes its file from the Git repository on the next commit."
            />
          </SettingsSection>
        )}

        {/* ── Section 3: Auto Commit (visible only when enabled) ── */}
        {props.enable && (
          <SettingsSection labelWidth="w-[340px]" title="Auto Commit" icon={GitCommitHorizontal}>
            <RadioField
              label="Enable:"
              name="vhAutoCommit"
              value={String(props.autoCommitEnable)}
              onChange={(v) => set("autoCommitEnable", v === "true")}
              tooltip="Automatically commit configuration changes to Git when they are saved."
            />
            <RadioField
              label="Prompt:"
              name="vhPrompt"
              value={String(props.autoCommitPrompt)}
              onChange={(v) => set("autoCommitPrompt", v === "true")}
              disabled={!props.autoCommitEnable}
              tooltip="When enabled, prompt for a commit message on each commit instead of using the default message below."
            />
            <FieldRow
              label="Default Message:"
              tooltip="The default commit message used when Auto Commit is enabled and prompting is off."
            >
              <textarea
                value={props.autoCommitMessage}
                onChange={(e) => set("autoCommitMessage", e.target.value)}
                disabled={!props.autoCommitEnable}
                placeholder="Enter default commit message..."
                className="border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 py-1.5 text-sm w-[300px] h-[100px] resize-y focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400 dark:disabled:text-gray-500"
              />
            </FieldRow>
          </SettingsSection>
        )}
      </SettingsTabScroll>

      {/* ── Git Settings Dialog ── */}
      <GitSettingsDialog
        open={gitDialogOpen}
        onOpenChange={setGitDialogOpen}
        initial={{
          remoteUrl: props.remoteUrl,
          branchName: props.remoteBranch,
          sshPrivateKey: props.remoteSshKey,
          sshPrivateKeyPath: props.remoteSshKeyPath,
          authType: props.remoteAuthType,
          httpsUsername: props.remoteHttpsUsername,
          httpsPassword: props.remoteHttpsPassword,
          httpsCredentialsPath: props.remoteHttpsCredentialsPath,
        }}
        onSave={(v) => {
          set("remoteUrl", v.remoteUrl);
          set("remoteBranch", v.branchName);
          set("remoteSshKey", v.sshPrivateKey);
          set("remoteSshKeyPath", v.sshPrivateKeyPath);
          set("remoteAuthType", v.authType);
          set("remoteHttpsUsername", v.httpsUsername);
          set("remoteHttpsPassword", v.httpsPassword);
          set("remoteHttpsCredentialsPath", v.httpsCredentialsPath);
          setGitDialogOpen(false);
        }}
      />
    </div>
  );
}
