"use client";

/**
 * Server Settings tab — mirrors Java's SettingsPanelServer.java.
 *
 * Sections: General, Channel, Email, Notification.
 *
 * API: GET /server/settings  → load
 *      PUT /server/settings  → save
 *      POST /server/_testEmail → send test email
 *      GET /server/configuration → backup (XML download)
 *      PUT /server/configuration → restore (XML upload)
 */

import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bell, HelpCircle, Mail, Radio, Send, Settings, Upload } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { toast } from "sonner";

import {
  getServerSettings,
  setServerSettings,
  getUpdateSettings,
  setUpdateSettings,
  normalizeSmtpAuthForSave,
  sendTestEmail,
  getServerConfigurationXml,
  restoreServerConfiguration,
  clearAllStatistics,
} from "@/lib/api-client";
import { parseServerConfigurationDate } from "@/lib/api/parse-server-configuration";
import { clearCache } from "@/lib/cache-store";
import { dispatchSettingsSaved } from "@/lib/hooks/use-server-info";
import { ConfirmDialog, TypeToConfirmDialog } from "@/components/confirm-dialog";
import { SaveDiscardCancelDialog } from "@/components/save-discard-cancel-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ServerSettings, MetaDataColumn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { SecretInput } from "@/components/ui/secret-input";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection, FieldRow, RadioField } from "./settings-section";
import { SettingsTabScroll } from "./settings-tab-scroll";
import { ColorPickerButton } from "./color-picker-button";
import { tagColorToHex, hexToXStreamColor } from "@/components/tag-chip";

// Java's ServerSettings.DEFAULT_COLOR = new Color(0x9EB1C9)
const DEFAULT_BG_COLOR = "#9eb1c9";

const SECURE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "tls", label: "STARTTLS" },
  { value: "ssl", label: "SSL" },
];

const AUTH_TYPE_OPTIONS = [
  { value: "NONE", label: "None" },
  { value: "BASIC", label: "Basic" },
  { value: "OAUTH", label: "OAuth 2.0" },
];

/**
 * Per-field hover help, ported verbatim from Java's SettingsPanelServer.setToolTipText(...)
 * calls (with "Mirth"/"NextGen Healthcare" → "BridgeLink" per repo convention and the
 * source's typos corrected). Radio groups that have one Java tooltip per option are
 * collapsed into a single description on the WebUI's combined control. The OAuth Client
 * ID/Secret/Token URL/Scope fields keep their existing inline help icons left
 * them as-is).
 */
const TIP = {
  environmentName:
    "The name of this BridgeLink environment. There is one environment name per BridgeLink database.",
  serverName:
    "The server name which will appear in the Administrator title, taskbar/dock and desktop shortcut. This setting applies for all users on this server.",
  browserThemeColor:
    "The default Administrator background color this server should use. Users can override this with their own custom background color.",
  autoLogoutEnable: "Toggles automatically logging out the user due to inactivity.",
  autoLogoutInterval: "Interval in minutes to automatically logout the user due to inactivity.",
  clearGlobalMap: "Toggles clearing the global map when redeploying all channels.",
  queueBufferSize: "The default source/destination queue buffer size to use for new channels.",
  metaDataColumn: (col: string) =>
    `If checked, the ${col} metadata column will be added by default when a user creates a new channel. The user can choose to remove the column on the channel's Summary tab.`,
  smtpHost: "SMTP host used for global SMTP settings.",
  smtpPort: "SMTP port used for global SMTP settings.",
  smtpTimeout: "SMTP socket connection timeout in milliseconds used for global SMTP settings.",
  smtpFrom: 'Default "from" email address used for global SMTP settings.',
  secureConnection: "Toggles STARTTLS and SSL connections for global SMTP settings.",
  requireAuthentication:
    "Authentication type for global SMTP settings: None, Basic (username/password), or OAuth 2.0 Client Credentials.",
  smtpUsername: "Username for global SMTP settings.",
  smtpPassword: "Password for global SMTP settings.",
  loginNotification: "Toggles requiring a login notification and consent before logging in.",
} as const;

// Canonical metadata columns — mirrors Java's DefaultMetaData.java exactly.
// mappingName must match so that Java's MetaDataColumn.equals() (which compares name+type+mappingName)
// recognises these as the known default columns.
const META_SOURCE: MetaDataColumn = {
  name: "SOURCE",
  type: "STRING",
  mappingName: "message_source",
};
const META_TYPE: MetaDataColumn = { name: "TYPE", type: "STRING", mappingName: "message_type" };
const META_VERSION: MetaDataColumn = {
  name: "VERSION",
  type: "STRING",
  mappingName: "mirth_version",
};

const CANONICAL_MAPPING: Record<string, string> = {
  SOURCE: "message_source",
  TYPE: "message_type",
  VERSION: "mirth_version",
};

/**
 * Mirrors Java's list.contains(DefaultMetaData.X_COLUMN) which uses MetaDataColumn.equals().
 * equals() compares name + type + mappingName — so a VERSION entry without mappingName does NOT
 * match DefaultMetaData.VERSION_COLUMN (mappingName="mirth_version") and is treated as unchecked.
 * We replicate this by requiring the mappingName to match the canonical value when present.
 */
function hasMetaCol(cols: MetaDataColumn[] | undefined, name: string): boolean {
  const canonicalMapping = CANONICAL_MAPPING[name];
  return (cols ?? []).some((c) => {
    if (c.name !== name) return false;
    // If a canonical mappingName exists, require it to match (mirrors Java equals()).
    // A column entry without mappingName (or with a different one) is NOT considered a match.
    if (canonicalMapping !== undefined) {
      return c.mappingName === canonicalMapping;
    }
    return true;
  });
}

export function toggleMetaCol(
  cols: MetaDataColumn[],
  name: string,
  checked: boolean
): MetaDataColumn[] {
  const col = { SOURCE: META_SOURCE, TYPE: META_TYPE, VERSION: META_VERSION }[name];
  if (!col) return cols;
  // When checking: add the canonical column if not already present (by full equality: name+mappingName).
  if (checked && !hasMetaCol(cols, name)) return [...cols, col];
  // When unchecking: remove ONLY the canonical column (name + canonical mappingName), mirroring
  // Java's list.remove(DefaultMetaData.X_COLUMN) which uses MetaDataColumn.equals() (name+type+
  // mappingName). A same-name custom column with a different mappingName must survive L4).
  if (!checked) {
    const canonicalMapping = CANONICAL_MAPPING[name];
    return cols.filter((c) => !(c.name === name && c.mappingName === canonicalMapping));
  }
  return cols;
}

/**
 * Email address validation for the Default From Address and test-email recipient.
 * Mirrors Java's use of javax.mail.internet.InternetAddress, which accepts a dotless host such
 * as "user@localhost" — so we only require a local part and a host, not a dotted domain
 * L2). The stricter dotted-domain regex previously rejected valid local addresses.
 */
export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}

/** Max digits Java's MirthFieldConstraints allow in the queue-buffer field. */
const QUEUE_BUFFER_MAX = 99999999; // 8 digits

/**
 * Validate the Server settings before save. Mirrors SettingsPanelServer.doSave() plus Java's
 * per-field MirthFieldConstraints (digits-only, bounded length) which the WebUI number inputs
 * can't fully enforce on paste/programmatic edits L1). Returns an error message or null.
 */
export function validateServerSettings(settings: ServerSettings | null): string | null {
  if (!settings) return "No settings loaded";
  if (settings.administratorAutoLogoutIntervalEnabled) {
    const interval = settings.administratorAutoLogoutIntervalField;
    if (interval == null || !Number.isInteger(interval) || interval <= 0 || interval >= 61) {
      return "Please enter an auto logout interval time that is between 1 and 60.";
    }
  }
  const qbs = settings.queueBufferSize;
  if (qbs == null || !Number.isInteger(qbs) || qbs <= 0 || qbs > QUEUE_BUFFER_MAX) {
    return "Please enter a valid queue buffer size.";
  }
  if (settings.smtpFrom && settings.smtpFrom.trim()) {
    if (!isValidEmailAddress(settings.smtpFrom)) {
      return "The Default From Address is invalid.";
    }
  }
  return null;
}

export interface ServerTabActions {
  save: () => void;
  refresh: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  backup: () => void;
  restore: () => void;
  backingUp: boolean;
  restoring: boolean;
  clearStats: () => void;
  clearingStats: boolean;
}

interface ServerTabProps {
  onDirty?: (isDirty: boolean) => void;
  saveRef?: { current: () => Promise<void> };
  actionsRef?: React.MutableRefObject<ServerTabActions>;
  onActionsChanged?: () => void;
}

export function ServerTab({ onDirty, saveRef, actionsRef, onActionsChanged }: ServerTabProps) {
  const { viewDensity } = useCompactMode();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Test email dialog
  const [showTestEmail, setShowTestEmail] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailSending, setTestEmailSending] = useState(false);

  // Backup / Restore
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreDeploy, setRestoreDeploy] = useState(true);
  const [restoreOverwriteConfigMap, setRestoreOverwriteConfigMap] = useState(false);
  const [restoreXml, setRestoreXml] = useState<string | null>(null);
  const [restoreDate, setRestoreDate] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] = useState(false);
  const [pendingRestore, setPendingRestore] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  // Clear All Statistics (Settings → Server task in the Java client)
  const [showClearStats, setShowClearStats] = useState(false);
  const [clearingStats, setClearingStats] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Mirror Java doRefresh():116 — fetch server + update settings together. The fork hides the
      // stats radios so getUpdateSettings has no UI consumer; awaiting it keeps the refresh call
      // sequence at parity and lets any failure surface through this try/catch as Java's does.
      const [s] = await Promise.all([getServerSettings(), getUpdateSettings()]);

      // Heal a server corrupted by the old WebUI: smtpSecure is a Java String, but the pre-fix
      // WebUI saved it as 0/1/2, so the parser surfaces a digits-only value as a number. Map it
      // back to "none"/"tls"/"ssl"; the next save re-persists the correct string F2).
      const smtpSecureMap: Record<number, "none" | "tls" | "ssl"> = {
        0: "none",
        1: "tls",
        2: "ssl",
      };
      if (typeof s.smtpSecure === "number") {
        s.smtpSecure = smtpSecureMap[s.smtpSecure] ?? "none";
      }

      // smtpTimeout: server returns integer (ms) → stringify for <input>
      if (typeof s.smtpTimeout === "number") {
        s.smtpTimeout = String(s.smtpTimeout);
      }

      // Upgrade legacy smtpAuth boolean → smtpAuthType (absent on older servers)
      if (!s.smtpAuthType) {
        s.smtpAuthType = s.smtpAuth ? "BASIC" : "NONE";
      }

      setSettings(s);
      setOriginal(JSON.stringify(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  const dirty = settings !== null && JSON.stringify(settings) !== original;

  // Notify parent of dirty state changes
  const onDirtyRef = useRef(onDirty);
  useLayoutEffect(() => {
    onDirtyRef.current = onDirty;
  });
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);

  // Update a single field
  const set = <K extends keyof ServerSettings>(key: K, val: ServerSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: val } : prev));
  };

  // ── Validation (mirrors Java SettingsPanelServer.doSave()) ──
  const validate = (): string | null => validateServerSettings(settings);

  // Pure save — throws on error; no UI state changes. Used by the navigation guard.
  async function doSave() {
    if (!settings) return;
    const err = validate();
    if (err) throw new Error(err);
    await setServerSettings(settings);
    // Force update stats off on every save, mirroring Java doSave():232 (which PUTs a fresh
    // UpdateSettings{statsEnabled=false}). Heals a server migrated from Mirth with stats.enabled=1;
    // the fork exposes no UI for it finding 12).
    await setUpdateSettings({ statsEnabled: false });
    // Flush the SMTP credential fields that don't apply to the saved auth type
    // out of local state too — setServerSettings only blanks them in the PUT
    // body. Without this, switching auth type back would resurface the stale
    // secrets that were just cleared server-side SMTP regression).
    const flushed = { ...settings, ...normalizeSmtpAuthForSave(settings) };
    setSettings(flushed);
    setOriginal(JSON.stringify(flushed));
    dispatchSettingsSaved();
  }

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await doSave();
      toast.success("Settings saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  // ── Test Email ──
  const validateTestEmail = (): string | null => {
    if (!settings) return "No settings loaded";
    if (!settings.smtpHost?.trim()) return "SMTP Host is required for test email.";
    if (!String(settings.smtpPort ?? "").trim()) return "SMTP Port is required for test email.";
    if (!String(settings.smtpTimeout ?? "").trim())
      return "Send Timeout is required for test email.";
    if (!settings.smtpFrom?.trim()) return "Default From Address is required for test email.";
    const authType = settings.smtpAuthType ?? "NONE";
    if (authType === "BASIC") {
      if (!settings.smtpUsername?.trim())
        return "SMTP Username is required when Basic authentication is enabled.";
      if (!settings.smtpPassword?.trim())
        return "SMTP Password is required when Basic authentication is enabled.";
    }
    if (authType === "OAUTH") {
      if (!settings.smtpUsername?.trim())
        return "SMTP Username is required when OAuth authentication is enabled.";
      if (!settings.smtpOAuthClientId?.trim())
        return "Client ID is required when OAuth authentication is enabled.";
      if (!settings.smtpOAuthClientSecret?.trim())
        return "Client Secret is required when OAuth authentication is enabled.";
      if (!settings.smtpOAuthTokenEndpointUrl?.trim())
        return "Token URL is required when OAuth authentication is enabled.";
    }
    if (!testEmailTo.trim() || !isValidEmailAddress(testEmailTo)) {
      return "Please enter a valid recipient email address.";
    }
    return null;
  };

  const handleTestEmail = async () => {
    const err = validateTestEmail();
    if (err) {
      toast.error(err);
      return;
    }
    if (!settings) return;
    setTestEmailSending(true);
    try {
      const authType = settings.smtpAuthType ?? "NONE";
      const resp = await sendTestEmail({
        port: settings.smtpPort ?? "",
        encryption: String(settings.smtpSecure ?? "none"),
        host: settings.smtpHost ?? "",
        timeout: String(settings.smtpTimeout ?? "5000"),
        authentication: String(authType !== "NONE"),
        authType: authType,
        username: settings.smtpUsername ?? "",
        password: settings.smtpPassword ?? "",
        oAuthClientId: settings.smtpOAuthClientId ?? "",
        oAuthClientSecret: settings.smtpOAuthClientSecret ?? "",
        oAuthTokenEndpointUrl: settings.smtpOAuthTokenEndpointUrl ?? "",
        oAuthScope: settings.smtpOAuthScope ?? "",
        toAddress: testEmailTo.trim(),
        fromAddress: settings.smtpFrom ?? "",
      });
      toast.success(resp?.message ?? "Test email sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send test email");
    } finally {
      setTestEmailSending(false);
    }
  };

  // ── Backup ──
  const handleBackup = () => {
    if (dirty) {
      setPendingBackup(true);
      return;
    }
    void executeBackup();
  };

  const executeBackup = async () => {
    setBackingUp(true);
    try {
      const xml = await getServerConfigurationXml();
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${date} BridgeLink Backup.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create backup");
    } finally {
      setBackingUp(false);
    }
  };

  // ── Restore ──
  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const xml = reader.result as string;
      setRestoreXml(xml);
      // Surface the backup's embedded date in the confirm prompt, mirroring Java's
      // "Import configuration from <date>?" (SettingsPanelServer.java:599-613).
      setRestoreDate(parseServerConfigurationDate(xml));
      setRestoreDeploy(true);
      setRestoreOverwriteConfigMap(false);
      setShowRestore(true);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = "";
  };

  const triggerRestoreFileSelect = () => {
    if (dirty) {
      setPendingRestore(true);
      return;
    }
    restoreFileInputRef.current?.click();
  };

  const executeSaveAndRestore = () => {
    doSave()
      .then(() => {
        toast.success("Settings saved");
        restoreFileInputRef.current?.click();
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Failed to save settings");
      });
  };

  const handleRestore = async () => {
    if (!restoreXml) return;
    setRestoring(true);
    try {
      await restoreServerConfiguration(restoreXml, restoreDeploy, restoreOverwriteConfigMap);
      clearCache();
      setShowRestore(false);
      setRestoreXml(null);
      toast.success("Server configuration restored. The server is processing the import.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore configuration");
    } finally {
      setRestoring(false);
    }
  };

  // ── Clear All Statistics ──
  const triggerClearStats = () => setShowClearStats(true);

  const executeClearStats = async () => {
    setClearingStats(true);
    try {
      await clearAllStatistics();
      toast.success("All current and lifetime statistics have been cleared for all channels.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear statistics");
    } finally {
      setClearingStats(false);
      setShowClearStats(false);
    }
  };

  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, backingUp, restoring, clearingStats, onActionsChanged]);

  // Expose the imperative save/actions handles to the parent. Written in a deps-less
  // effect (not during render) to satisfy react-hooks/refs. Declared after the handlers
  // it references; the parent's re-render from onActionsChanged is deferred until the
  // full effect flush completes, so it always observes fresh handles.
  useEffect(() => {
    if (saveRef) saveRef.current = doSave;
    if (actionsRef) {
      actionsRef.current = {
        save: handleSave,
        refresh: load,
        dirty,
        saving,
        loading,
        backup: handleBackup,
        restore: triggerRestoreFileSelect,
        backingUp,
        restoring,
        clearStats: triggerClearStats,
        clearingStats,
      };
    }
  });

  // ── Color handling ──
  // tagColorToHex / parseTagColor already handles both {r,g,b} and {red,green,blue} formats.
  const bgColorHex = settings?.defaultAdministratorBackgroundColor
    ? tagColorToHex(
        settings.defaultAdministratorBackgroundColor as Parameters<typeof tagColorToHex>[0]
      )
    : DEFAULT_BG_COLOR;

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
          {error || "Failed to load server settings."}
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

        {/* ── General ── */}
        <SettingsSection labelWidth="w-[340px]" title="General" icon={Settings}>
          <FieldRow label="Environment Name:" tooltip={TIP.environmentName}>
            <Input
              density={viewDensity}
              value={settings.environmentName ?? ""}
              onChange={(e) => set("environmentName", e.target.value)}
              className="w-64"
            />
          </FieldRow>
          <FieldRow label="Server Name:" tooltip={TIP.serverName}>
            <Input
              density={viewDensity}
              value={settings.serverName ?? ""}
              onChange={(e) => set("serverName", e.target.value)}
              className="w-64"
            />
          </FieldRow>
          <FieldRow label="Browser Theme Color:" tooltip={TIP.browserThemeColor}>
            <ColorPickerButton
              value={bgColorHex}
              onChange={(hex) => set("defaultAdministratorBackgroundColor", hexToXStreamColor(hex))}
            />
          </FieldRow>
          <RadioField
            label="Enable Auto Logout:"
            name="autoLogout"
            value={String(settings.administratorAutoLogoutIntervalEnabled ?? false)}
            onChange={(v) => set("administratorAutoLogoutIntervalEnabled", v === "true")}
            tooltip={TIP.autoLogoutEnable}
          />
          <FieldRow label="Auto Logout Interval (minutes):" tooltip={TIP.autoLogoutInterval}>
            <Input
              density={viewDensity}
              type="number"
              min={1}
              max={60}
              value={settings.administratorAutoLogoutIntervalField ?? ""}
              onChange={(e) => {
                // Digits only, max 2 chars — mirrors Java's MirthFieldConstraints; blocks the
                // decimals/oversized values that XStream's Integer parse rejects as a raw 500
                // L1).
                const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
                set("administratorAutoLogoutIntervalField", digits ? Number(digits) : undefined);
              }}
              disabled={!settings.administratorAutoLogoutIntervalEnabled}
              className="w-20"
            />
          </FieldRow>
        </SettingsSection>

        {/* ── Channel ── */}
        <SettingsSection labelWidth="w-[340px]" title="Channel" icon={Radio}>
          <RadioField
            label="Clear global map on redeploy:"
            name="clearGlobalMap"
            value={String(settings.clearGlobalMap ?? true)}
            onChange={(v) => set("clearGlobalMap", v === "true")}
            tooltip={TIP.clearGlobalMap}
          />
          <FieldRow label="Default Queue Buffer Size:" tooltip={TIP.queueBufferSize}>
            <Input
              density={viewDensity}
              type="number"
              min={1}
              value={settings.queueBufferSize ?? ""}
              onChange={(e) => {
                // Digits only, max 8 chars — mirrors Java's MirthFieldConstraints; blocks the
                // decimals/oversized values that XStream's Integer parse rejects as a raw 500
                // L1).
                const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                set("queueBufferSize", digits ? Number(digits) : undefined);
              }}
              className="w-32"
            />
          </FieldRow>
          <FieldRow label="Default Metadata Columns:">
            <div className="flex items-center gap-4">
              {(["SOURCE", "TYPE", "VERSION"] as const).map((name) => {
                const title = name.charAt(0) + name.slice(1).toLowerCase();
                return (
                  // Each column has its own Java tooltip — hover the individual checkbox.
                  <HoverTooltip key={name} content={TIP.metaDataColumn(title)}>
                    <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasMetaCol(settings.defaultMetaDataColumns, name)}
                        onChange={(e) =>
                          set(
                            "defaultMetaDataColumns",
                            toggleMetaCol(
                              settings.defaultMetaDataColumns ?? [],
                              name,
                              e.target.checked
                            )
                          )
                        }
                        className="accent-blue-600"
                      />
                      {title}
                    </label>
                  </HoverTooltip>
                );
              })}
            </div>
          </FieldRow>
        </SettingsSection>

        {/* ── Email ── */}
        <SettingsSection labelWidth="w-[340px]" title="Email" icon={Mail}>
          {/* SMTP Host's row also holds the Send Test Email button (own tooltip), so the
              host help is attached to the input directly rather than the whole row. */}
          <FieldRow label="SMTP Host:">
            <HoverTooltip content={TIP.smtpHost}>
              <Input
                density={viewDensity}
                value={settings.smtpHost ?? ""}
                onChange={(e) => set("smtpHost", e.target.value)}
                className="w-64"
              />
            </HoverTooltip>
            <HoverTooltip content="Send a test email using the current SMTP settings">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTestEmailTo(settings.smtpFrom ?? "");
                  setShowTestEmail(true);
                }}
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Send Test Email
              </Button>
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="SMTP Port:" tooltip={TIP.smtpPort}>
            <Input
              density={viewDensity}
              value={settings.smtpPort ?? ""}
              onChange={(e) => set("smtpPort", e.target.value)}
              className="w-20"
            />
          </FieldRow>
          <FieldRow label="Send Timeout (ms):" tooltip={TIP.smtpTimeout}>
            <Input
              density={viewDensity}
              // No phantom default: show the server's value (incl. empty), never a fabricated
              // "5000" the server doesn't hold L3). A cleared field saves "" (Java parity).
              value={
                settings.smtpTimeout != null && settings.smtpTimeout !== ""
                  ? String(settings.smtpTimeout)
                  : ""
              }
              onChange={(e) => set("smtpTimeout", e.target.value)}
              className="w-24"
            />
          </FieldRow>
          <FieldRow label="Default From Address:" tooltip={TIP.smtpFrom}>
            <Input
              density={viewDensity}
              value={settings.smtpFrom ?? ""}
              onChange={(e) => set("smtpFrom", e.target.value)}
              className="w-64"
            />
          </FieldRow>
          <RadioField
            label="Secure Connection:"
            name="smtpSecure"
            value={String(settings.smtpSecure ?? "none")}
            onChange={(v) => set("smtpSecure", v as "none" | "tls" | "ssl")}
            options={SECURE_OPTIONS}
            tooltip={TIP.secureConnection}
          />
          <RadioField
            label="Require Authentication:"
            name="smtpAuthType"
            value={settings.smtpAuthType ?? "NONE"}
            onChange={(v) => set("smtpAuthType", v as "NONE" | "BASIC" | "OAUTH")}
            options={AUTH_TYPE_OPTIONS}
            tooltip={TIP.requireAuthentication}
          />
          {(settings.smtpAuthType === "BASIC" || settings.smtpAuthType === "OAUTH") && (
            <FieldRow label="Username:" tooltip={TIP.smtpUsername}>
              <Input
                density={viewDensity}
                value={settings.smtpUsername ?? ""}
                onChange={(e) => set("smtpUsername", e.target.value)}
                className="w-48"
              />
            </FieldRow>
          )}
          {settings.smtpAuthType === "BASIC" && (
            <FieldRow label="Password:">
              <SecretInput
                density={viewDensity}
                value={settings.smtpPassword ?? ""}
                onChange={(e) => set("smtpPassword", e.target.value)}
                className="w-48"
                tooltip={TIP.smtpPassword}
              />
            </FieldRow>
          )}
          {settings.smtpAuthType === "OAUTH" && (
            <>
              <FieldRow label="Client ID:">
                <Input
                  density={viewDensity}
                  value={settings.smtpOAuthClientId ?? ""}
                  onChange={(e) => set("smtpOAuthClientId", e.target.value)}
                  className="w-64"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-4 h-4 text-gray-400 cursor-help shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      OAuth 2.0 application (client) ID for global SMTP settings.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </FieldRow>
              <FieldRow label="Client Secret:">
                <SecretInput
                  density={viewDensity}
                  value={settings.smtpOAuthClientSecret ?? ""}
                  onChange={(e) => set("smtpOAuthClientSecret", e.target.value)}
                  className="w-64"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-4 h-4 text-gray-400 cursor-help shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      OAuth 2.0 client secret for global SMTP settings.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </FieldRow>
              <FieldRow label="Token URL:">
                <Input
                  density={viewDensity}
                  value={settings.smtpOAuthTokenEndpointUrl ?? ""}
                  onChange={(e) => set("smtpOAuthTokenEndpointUrl", e.target.value)}
                  className="w-80"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-4 h-4 text-gray-400 cursor-help shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      OAuth 2.0 token endpoint URL for global SMTP settings.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </FieldRow>
              <FieldRow label="Scope:">
                <Input
                  density={viewDensity}
                  value={settings.smtpOAuthScope ?? ""}
                  onChange={(e) => set("smtpOAuthScope", e.target.value)}
                  className="w-80"
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-4 h-4 text-gray-400 cursor-help shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      OAuth 2.0 scope for global SMTP settings (e.g.
                      https://outlook.office365.com/.default).
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </FieldRow>
            </>
          )}
        </SettingsSection>

        {/* ── Notification ── */}
        <SettingsSection labelWidth="w-[340px]" title="Notification" icon={Bell}>
          <RadioField
            label="Require Login Notification and Consent:"
            name="loginNotification"
            value={String(settings.loginNotificationEnabled ?? false)}
            onChange={(v) => set("loginNotificationEnabled", v === "true")}
            tooltip={TIP.loginNotification}
          />
          <FieldRow label="Login Notification:">
            <Textarea
              density={viewDensity}
              enableTabKey
              value={settings.loginNotificationMessage ?? ""}
              onChange={(e) => set("loginNotificationMessage", e.target.value)}
              disabled={!settings.loginNotificationEnabled}
              rows={6}
              className="w-full max-w-lg resize-y disabled:opacity-50 disabled:bg-gray-50 dark:disabled:bg-gray-800"
            />
          </FieldRow>
        </SettingsSection>
      </SettingsTabScroll>

      {/* ── Test Email Dialog ── */}
      <Dialog open={showTestEmail} onOpenChange={setShowTestEmail}>
        <DialogContent className="w-[520px] sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              Send a test email using the currently configured SMTP settings.
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-1">
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
              Recipient address
            </label>
            <Input
              density={viewDensity}
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              placeholder="recipient@example.com"
              onKeyDown={(e) => e.key === "Enter" && handleTestEmail()}
              autoFocus
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">
              Uses the SMTP settings currently configured above.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestEmail(false)}>
              Cancel
            </Button>
            <Button onClick={handleTestEmail} disabled={testEmailSending}>
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {testEmailSending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Restore Confirmation Dialog ── */}
      <Dialog open={showRestore} onOpenChange={setShowRestore}>
        <DialogContent className="w-[520px] sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>Restore Configuration</DialogTitle>
            <DialogDescription>
              {restoreDate
                ? `Import configuration from ${restoreDate}?`
                : "Restore a previously exported configuration backup. This will overwrite all current channels, alerts, and server properties."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded p-3">
              This will overwrite all current channels, alerts, server properties, and plugin
              properties.
            </p>
            <FormCheckbox
              label="Deploy all channels after import"
              checked={restoreDeploy}
              onChange={setRestoreDeploy}
            />
            <FormCheckbox
              label="Overwrite Configuration Map"
              checked={restoreOverwriteConfigMap}
              onChange={setRestoreOverwriteConfigMap}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestore(false)} disabled={restoring}>
              Cancel
            </Button>
            <Button onClick={handleRestore} disabled={restoring}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {restoring ? "Restoring..." : "Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden file input for restore */}
      <input
        type="file"
        accept=".xml"
        className="hidden"
        ref={restoreFileInputRef}
        onChange={handleRestoreFileSelect}
      />

      {/*
        Save-before-backup prompt — a true 3-way Yes/No/Cancel, mirroring
        SettingsPanelServer.doBackup() (Java:534-545):
          Save & Backup        → save first, then back up (abort if the save fails)
          Backup without Saving → back up the currently-persisted settings
          Cancel / dismiss      → abort entirely (no backup)
      */}
      <SaveDiscardCancelDialog
        open={pendingBackup}
        title="Save Before Backup"
        description="Would you like to save the settings before creating the backup?"
        saveLabel="Save & Backup"
        discardLabel="Backup without Saving"
        onSave={async () => {
          setPendingBackup(false);
          try {
            await doSave();
            toast.success("Settings saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to save settings");
            return;
          }
          void executeBackup();
        }}
        onDiscard={() => {
          setPendingBackup(false);
          void executeBackup();
        }}
        onCancel={() => setPendingBackup(false)}
      />

      {pendingRestore && (
        <ConfirmDialog
          title="Save Before Restore"
          description="Your new settings will first be saved. Continue?"
          confirmLabel="Save & Continue"
          confirmVariant="default"
          onConfirm={() => {
            setPendingRestore(false);
            executeSaveAndRestore();
          }}
          onCancel={() => setPendingRestore(false)}
        />
      )}

      {showClearStats && (
        <TypeToConfirmDialog
          title="Clear All Statistics"
          confirmWord="CLEAR"
          confirmLabel="OK"
          description={
            <>
              This will reset all channel statistics (including lifetime statistics) for all
              channels (including undeployed channels).
              <br />
              <br />
              Type <strong>CLEAR</strong> and click OK to continue.
            </>
          }
          onConfirm={() => void executeClearStats()}
          onCancel={() => setShowClearStats(false)}
        />
      )}
    </div>
  );
}
