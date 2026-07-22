"use client";

/**
 * Git Settings Dialog — extracted from version-history-tab.tsx
 *
 * Mirrors Java's GitSettingsDialog.java (3.0.1).
 * Configures remote repository URL, branch, and per-auth-type credentials.
 * Includes server-side validation via POST /plugins/version-history/validateSetting.
 *
 * Backward compatibility:
 *   - On BridgeLink 26.3.1+ (plugin 3.0.1): renders auth-type switcher and the
 *     HTTPS panel with username/PAT/credentials-file-path; also offers the
 *     server-local SSH private key file path field.
 *   - On BridgeLink 26.3.0: renders only the legacy SSH-only form
 *     (Remote URL, Branch, SSH Private Key textarea + file upload).
 *
 * Capability is detected via `usePluginCapabilities()` (server version compare
 * with a one-time fallback probe).
 */

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

import { validateVersionHistorySettings } from "@/lib/api-client";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Button } from "@/components/ui/button";
import { SecretInput } from "@/components/ui/secret-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePluginCapabilities } from "@/plugins/version-history/use-plugin-capabilities";
import {
  AUTH_TYPE_HTTPS,
  AUTH_TYPE_SSH,
  type GitAuthType,
} from "@/plugins/version-history/api-version-history";

/** Property keys needed for the validation API call. */
const VALIDATE_KEYS = {
  REMOTE_URL: "versionHistory.remote.url",
  REMOTE_BRANCH: "versionHistory.remote.branch",
  REMOTE_SSH_KEY: "versionHistory.remote.ssh.key",
  REMOTE_SSH_KEY_PATH: "versionHistory.remote.ssh.keyPath",
  REMOTE_AUTH_TYPE: "versionHistory.remote.authType",
  REMOTE_HTTPS_USERNAME: "versionHistory.remote.https.username",
  REMOTE_HTTPS_PASSWORD: "versionHistory.remote.https.password",
  REMOTE_HTTPS_CREDENTIALS_PATH: "versionHistory.remote.https.credentialsPath",
} as const;

export interface GitSettingsDialogValues {
  remoteUrl: string;
  branchName: string;
  sshPrivateKey: string;
  sshPrivateKeyPath: string;
  authType: GitAuthType;
  httpsUsername: string;
  httpsPassword: string;
  httpsCredentialsPath: string;
}

export interface GitSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial values for the form fields. */
  initial: GitSettingsDialogValues;
  /** Called with the full settings shape when the user clicks Save. */
  onSave: (values: GitSettingsDialogValues) => void;
}

export function GitSettingsDialog({ open, onOpenChange, initial, onSave }: GitSettingsDialogProps) {
  const { viewDensity } = useCompactMode();
  const { hasHttpsAuth } = usePluginCapabilities(true);

  const [url, setUrl] = useState(initial.remoteUrl);
  const [branch, setBranch] = useState(initial.branchName);
  const [sshKey, setSshKey] = useState(initial.sshPrivateKey);
  const [sshKeyPath, setSshKeyPath] = useState(initial.sshPrivateKeyPath);
  const [authType, setAuthType] = useState<GitAuthType>(initial.authType || AUTH_TYPE_SSH);
  const [httpsUsername, setHttpsUsername] = useState(initial.httpsUsername);
  const [httpsPassword, setHttpsPassword] = useState(initial.httpsPassword);
  const [httpsCredentialsPath, setHttpsCredentialsPath] = useState(initial.httpsCredentialsPath);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [dialogError, setDialogError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local state from parent values when the dialog transitions to open.
  // Done during render (the React "adjusting state when a prop changes" idiom)
  // rather than in an effect, which avoids the cascading-render warning from
  // set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setUrl(initial.remoteUrl);
      setBranch(initial.branchName);
      setSshKey(initial.sshPrivateKey);
      setSshKeyPath(initial.sshPrivateKeyPath);
      setAuthType(initial.authType || AUTH_TYPE_SSH);
      setHttpsUsername(initial.httpsUsername);
      setHttpsPassword(initial.httpsPassword);
      setHttpsCredentialsPath(initial.httpsCredentialsPath);
      setValidateResult(null);
      setDialogError("");
    }
  }

  /**
   * Mirrors GitSettings.validate() on the server (3.0.1):
   *   URL + branch required;
   *   if SSH → sshPrivateKey || sshPrivateKeyPath
   *   if HTTPS → (httpsUsername && httpsPassword) || httpsCredentialsPath
   *
   * On legacy servers (no HTTPS support) the auth type is effectively SSH and
   * the SSH key path field isn't rendered, so the rule collapses to "SSH key
   * required" — identical to the prior dialog behavior.
   */
  function validateLocal(): string | null {
    if (!url.trim()) {
      return "Please provide a remote repository URL (e.g., git@github.com:user/repo.git or https://github.com/user/repo.git).";
    }
    if (!branch.trim()) {
      return "Please provide a branch name (e.g., main, develop, or feature/xyz).";
    }
    if (hasHttpsAuth && authType === AUTH_TYPE_HTTPS) {
      const inline = httpsUsername.trim() && httpsPassword.trim();
      const filePath = httpsCredentialsPath.trim();
      if (!inline && !filePath) {
        return "Please provide an HTTPS username and personal access token, or a credentials file path.";
      }
      return null;
    }
    // SSH (default, including legacy server)
    const inlineKey = sshKey.trim();
    const keyPath = hasHttpsAuth ? sshKeyPath.trim() : "";
    if (!inlineKey && !keyPath) {
      return hasHttpsAuth
        ? "Please provide an SSH private key (starts with '-----BEGIN') or an SSH private key file path."
        : "Please provide an SSH private key (starts with '-----BEGIN').";
    }
    return null;
  }

  function handleLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSshKey(reader.result.trim());
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-loaded
  }

  /**
   * Build the validate request body. On legacy servers we send only the three
   * keys the old plugin understands; on 26.3.1+ we add auth-type-specific
   * keys so the server can validate the configured auth path.
   */
  function buildValidatePayload(): Record<string, string> {
    const base: Record<string, string> = {
      [VALIDATE_KEYS.REMOTE_URL]: url.trim(),
      [VALIDATE_KEYS.REMOTE_BRANCH]: branch.trim(),
      [VALIDATE_KEYS.REMOTE_SSH_KEY]: sshKey.trim(),
    };
    if (!hasHttpsAuth) return base;
    base[VALIDATE_KEYS.REMOTE_AUTH_TYPE] = authType;
    base[VALIDATE_KEYS.REMOTE_SSH_KEY_PATH] = sshKeyPath.trim();
    base[VALIDATE_KEYS.REMOTE_HTTPS_USERNAME] = httpsUsername.trim();
    base[VALIDATE_KEYS.REMOTE_HTTPS_PASSWORD] = httpsPassword;
    base[VALIDATE_KEYS.REMOTE_HTTPS_CREDENTIALS_PATH] = httpsCredentialsPath.trim();
    return base;
  }

  async function handleValidate() {
    const err = validateLocal();
    if (err) {
      setDialogError(err);
      setValidateResult(null);
      return;
    }
    setValidating(true);
    setValidateResult(null);
    setDialogError("");
    try {
      const result = await validateVersionHistorySettings(buildValidatePayload());
      setValidateResult({ ok: true, msg: result });
    } catch (e) {
      setValidateResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Validation failed",
      });
    } finally {
      setValidating(false);
    }
  }

  function handleSave() {
    const err = validateLocal();
    if (err) {
      setDialogError(err);
      return;
    }
    onSave({
      remoteUrl: url.trim(),
      branchName: branch.trim(),
      sshPrivateKey: sshKey.trim(),
      sshPrivateKeyPath: sshKeyPath.trim(),
      authType: hasHttpsAuth ? authType : AUTH_TYPE_SSH,
      httpsUsername: httpsUsername.trim(),
      httpsPassword,
      httpsCredentialsPath: httpsCredentialsPath.trim(),
    });
  }

  const showHttps = hasHttpsAuth && authType === AUTH_TYPE_HTTPS;
  const showSsh = !hasHttpsAuth || authType === AUTH_TYPE_SSH;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Git Settings</DialogTitle>
          <DialogDescription>
            Configure the remote Git repository for version history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {dialogError && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-2 text-sm">
              {dialogError}
            </div>
          )}
          {validateResult && (
            <div
              className={
                validateResult.ok
                  ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700 rounded p-2 text-sm"
                  : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-2 text-sm"
              }
            >
              {validateResult.msg}
            </div>
          )}

          {/* Remote Repository URL */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Remote Repository URL
            </label>
            <HoverTooltip
              content={
                hasHttpsAuth
                  ? "Enter a Git remote URL. Use SSH (git@host:user/repo.git) or HTTPS (https://host/user/repo.git) to match the selected authentication type."
                  : "Enter an SSH URL for the remote Git repository (e.g., git@github.com:user/repo.git)."
              }
            >
              <Input
                density={viewDensity}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  hasHttpsAuth && authType === AUTH_TYPE_HTTPS
                    ? "https://github.com/user/repo.git"
                    : "git@github.com:user/repo.git"
                }
                className="mt-1 w-full"
              />
            </HoverTooltip>
          </div>

          {/* Branch Name */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Branch Name
            </label>
            <HoverTooltip content="Enter the branch name to use (e.g., main, develop, or feature/xyz).">
              <Input
                density={viewDensity}
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="mt-1 w-[200px]"
              />
            </HoverTooltip>
          </div>

          {/* Auth type switcher — 26.3.1+ only */}
          {hasHttpsAuth && (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Authentication Type
              </label>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="vhGitAuthType"
                    value={AUTH_TYPE_SSH}
                    checked={authType === AUTH_TYPE_SSH}
                    onChange={() => setAuthType(AUTH_TYPE_SSH)}
                  />
                  SSH
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="vhGitAuthType"
                    value={AUTH_TYPE_HTTPS}
                    checked={authType === AUTH_TYPE_HTTPS}
                    onChange={() => setAuthType(AUTH_TYPE_HTTPS)}
                  />
                  HTTPS (Personal Access Token)
                </label>
              </div>
            </div>
          )}

          {/* SSH panel */}
          {showSsh && (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  SSH Private Key
                </label>
                <HoverTooltip content="Paste your SSH private key, starting with '-----BEGIN' (e.g., '-----BEGIN OPENSSH PRIVATE KEY-----').">
                  <Textarea
                    density={viewDensity}
                    value={sshKey}
                    onChange={(e) => setSshKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    className="mt-1 h-[100px] font-mono resize-y"
                  />
                </HoverTooltip>
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm text-blue-600 hover:underline cursor-pointer"
                  >
                    Load from file
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleLoadFile}
                    className="hidden"
                    accept=".pem,.key,.pub,*"
                  />
                </div>
              </div>

              {/* SSH key file path — 26.3.1+ only (alternative to inline key) */}
              {hasHttpsAuth && (
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    SSH Private Key Path
                  </label>
                  <HoverTooltip content="Optional server-local file path to the SSH private key. Use this instead of pasting the key inline. If both are set, the inline key wins.">
                    <Input
                      density={viewDensity}
                      value={sshKeyPath}
                      onChange={(e) => setSshKeyPath(e.target.value)}
                      placeholder="/etc/bridgelink/id_ed25519"
                      className="mt-1 w-full font-mono"
                    />
                  </HoverTooltip>
                </div>
              )}
            </>
          )}

          {/* HTTPS panel — 26.3.1+ only */}
          {showHttps && (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Username
                </label>
                <HoverTooltip content="Git username for HTTPS authentication. For GitHub, this is your GitHub username; for many providers any non-empty value works alongside a PAT.">
                  <Input
                    density={viewDensity}
                    value={httpsUsername}
                    onChange={(e) => setHttpsUsername(e.target.value)}
                    placeholder="git-user"
                    autoComplete="off"
                    className="mt-1 w-[260px]"
                  />
                </HoverTooltip>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Personal Access Token
                </label>
                <HoverTooltip content="Personal access token (PAT) used as the HTTPS password. Generated in your Git provider's developer settings — give it the minimum scopes needed to push to the repo.">
                  <SecretInput
                    density={viewDensity}
                    revealable
                    value={httpsPassword}
                    onChange={(e) => setHttpsPassword(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    className="mt-1 w-full"
                  />
                </HoverTooltip>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  HTTPS Credentials Path
                </label>
                <HoverTooltip content="Optional server-local file path to a credentials file containing username and PAT. Use this instead of typing them inline. If both are set, the inline values win.">
                  <Input
                    density={viewDensity}
                    value={httpsCredentialsPath}
                    onChange={(e) => setHttpsCredentialsPath(e.target.value)}
                    placeholder="/etc/bridgelink/git-credentials"
                    className="mt-1 w-full font-mono"
                  />
                </HoverTooltip>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleValidate} disabled={validating}>
            {validating ? "Validating..." : "Validate"}
          </Button>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
