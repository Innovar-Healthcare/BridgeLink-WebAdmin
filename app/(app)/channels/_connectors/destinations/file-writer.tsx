"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings2, FileText } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import { useTestConn } from "../shared/use-test-conn";
import { TestConnButton } from "../shared/test-conn-button";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  DEFAULT_FILE_WRITER_PROPS,
  parseFileWriterPropsFromXml,
  updateFileWriterPropsInXml,
  withVersion,
  resolveXmlVersion,
  type FileWriterProps,
} from "../../_lib/channel-xml";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, selectCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import {
  VariableOrNumberInput,
  isNumberOrVariable,
} from "@/components/ui/variable-or-number-input";
import { S3AdvancedDialog, type S3AdvancedSettings } from "../shared/s3-advanced-dialog";
import { SftpAdvancedDialog, type SftpAdvancedSettings } from "../shared/sftp-advanced-dialog";
import { FtpAdvancedDialog, type FtpAdvancedSettings } from "../shared/ftp-advanced-dialog";
import {
  SmbAdvancedDialog,
  type SmbAdvancedSettings,
  SMB_VERSIONS,
} from "../shared/smb-advanced-dialog";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "../shared/charset-options";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import type * as Monaco from "monaco-editor";
import { registerMirthDropHandler } from "../shared/monaco-mirth-drop";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["File Writer"]!;

const SCHEME_OPTIONS = [
  { label: "File", value: "file" },
  { label: "FTP", value: "ftp" },
  { label: "SFTP", value: "sftp" },
  { label: "SMB", value: "smb" },
  { label: "S3", value: "S3" },
  { label: "WebDAV", value: "webdav" },
];

type FileExistsMode = "append" | "overwrite" | "error";

function fileExistsModeFromProps(p: FileWriterProps): FileExistsMode {
  if (p.outputAppend) return "append";
  if (p.errorOnExists) return "error";
  return "overwrite";
}

function applyFileExistsMode(p: FileWriterProps, mode: FileExistsMode): Partial<FileWriterProps> {
  return {
    outputAppend: mode === "append",
    errorOnExists: mode === "error",
    // Mirror Java FileWriter.fileExistsAppendRadioActionPerformed: selecting Append
    // force-selects "Temp File No". The server checks isTemporary() before
    // isOutputAppend(), so a stale temporary=true would silently overwrite the
    // destination file instead of appending.
    ...(mode === "append" ? { temporary: false } : {}),
  };
}

/**
 * The scheme-specific advanced-settings fields, reset to their defaults. Mirrors Java
 * FileWriter.onSchemeChange, which discards the departed scheme's advancedProperties and
 * starts the new scheme from a fresh default. Fresh array instances so resets never share
 * mutable references. Sourced from DEFAULT_FILE_WRITER_PROPS to avoid duplicating defaults.
 */
function advancedDefaults(): Partial<FileWriterProps> {
  return {
    ftpInitialCommands: DEFAULT_FILE_WRITER_PROPS.ftpInitialCommands,
    sftpPasswordAuth: DEFAULT_FILE_WRITER_PROPS.sftpPasswordAuth,
    sftpKeyAuth: DEFAULT_FILE_WRITER_PROPS.sftpKeyAuth,
    sftpKeyFile: DEFAULT_FILE_WRITER_PROPS.sftpKeyFile,
    sftpPassPhrase: DEFAULT_FILE_WRITER_PROPS.sftpPassPhrase,
    sftpHostKeyChecking: DEFAULT_FILE_WRITER_PROPS.sftpHostKeyChecking,
    sftpKnownHostsFile: DEFAULT_FILE_WRITER_PROPS.sftpKnownHostsFile,
    sftpConfigurationSettings: [],
    smbMinVersion: DEFAULT_FILE_WRITER_PROPS.smbMinVersion,
    smbMaxVersion: DEFAULT_FILE_WRITER_PROPS.smbMaxVersion,
    s3UseDefaultCredentials: DEFAULT_FILE_WRITER_PROPS.s3UseDefaultCredentials,
    s3UseTemporaryCredentials: DEFAULT_FILE_WRITER_PROPS.s3UseTemporaryCredentials,
    s3Duration: DEFAULT_FILE_WRITER_PROPS.s3Duration,
    s3Region: DEFAULT_FILE_WRITER_PROPS.s3Region,
    s3CustomHeaders: [],
  };
}

// ─── Advanced Options summary (mirrors SchemeProperties.getSummaryText()) ─────

function getAdvancedSummaryText(p: FileWriterProps): string {
  if (p.scheme === "ftp") return `Initial Commands: ${p.ftpInitialCommands}`;
  if (p.scheme === "sftp") {
    const auth =
      p.sftpPasswordAuth && p.sftpKeyAuth
        ? "Password and Public Key"
        : p.sftpKeyAuth
          ? "Public Key"
          : "Password";
    const checking =
      p.sftpHostKeyChecking === "yes" ? "On" : p.sftpHostKeyChecking === "no" ? "Off" : "Ask";
    return `${auth} Authentication / Hostname Checking ${checking}`;
  }
  if (p.scheme === "S3") {
    const credPart = p.s3UseDefaultCredentials
      ? "Default Credential Provider Chain"
      : "Explicit Credentials";
    const tempPart = p.s3UseTemporaryCredentials ? " with STS temporary access" : "";
    return `Using region ${p.s3Region}, ${credPart}${tempPart}`;
  }
  if (p.scheme === "smb") {
    const lookup = Object.fromEntries(SMB_VERSIONS.map((v) => [v.value, v.label]));
    const min = lookup[p.smbMinVersion] ?? p.smbMinVersion;
    const max = lookup[p.smbMaxVersion] ?? p.smbMaxVersion;
    return `Using ${min} - ${max}`;
  }
  return "";
}

// ─── Bottom section ───────────────────────────────────────────────────────────

function FileWriterBottomSection({
  propertiesXml,
  onChange,
  channelId,
  channelName,
  invalidFields,
  isDark,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const serverCharsets = useCharsetEncodings();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion());
  const [local, setLocal] = useState<FileWriterProps>(() => parseFileWriterPropsFromXml(propsXml));
  const [pendingScheme, setPendingScheme] = useState<string | null>(null);
  const [s3DialogOpen, setS3DialogOpen] = useState(false);
  const [sftpDialogOpen, setSftpDialogOpen] = useState(false);
  const [ftpDialogOpen, setFtpDialogOpen] = useState(false);
  const [smbDialogOpen, setSmbDialogOpen] = useState(false);
  const {
    testing: tcTesting,
    result: tcResult,
    test: tcTest,
  } = useTestConn("file", "_testWrite", propsXml, channelId, channelName);

  // The template field is always Velocity (never JS), so preferJsRef is always false.
  const preferJsRef = useRef(false);
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const handleMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      dropCleanupRef.current?.();
      dropCleanupRef.current = registerMirthDropHandler(editor, monaco, preferJsRef);
    },
    []
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(
      parseFileWriterPropsFromXml(propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion()))
    );
  }, [propertiesXml]);

  function commit(updated: FileWriterProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateFileWriterPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof FileWriterProps>(key: K, val: FileWriterProps[K]) {
    commit({ ...local, [key]: val });
  }

  /**
   * Mirror Java FileWriter.isAdvancedDefault(): true when the CURRENT scheme's advanced
   * settings differ from a freshly-constructed default. Only FTP/SFTP/S3/SMB have advanced
   * settings; FILE/WebDAV never do, so they never trigger the scheme-change confirm.
   */
  function hasNonDefaultAdvancedSettings(): boolean {
    const d = DEFAULT_FILE_WRITER_PROPS;
    switch (local.scheme) {
      case "ftp":
        return local.ftpInitialCommands !== d.ftpInitialCommands;
      case "sftp":
        return (
          local.sftpPasswordAuth !== d.sftpPasswordAuth ||
          local.sftpKeyAuth !== d.sftpKeyAuth ||
          local.sftpKeyFile !== d.sftpKeyFile ||
          local.sftpPassPhrase !== d.sftpPassPhrase ||
          local.sftpHostKeyChecking !== d.sftpHostKeyChecking ||
          local.sftpKnownHostsFile !== d.sftpKnownHostsFile ||
          local.sftpConfigurationSettings.length > 0
        );
      case "S3":
        return (
          local.s3UseDefaultCredentials !== d.s3UseDefaultCredentials ||
          local.s3UseTemporaryCredentials !== d.s3UseTemporaryCredentials ||
          local.s3Duration !== d.s3Duration ||
          local.s3Region !== d.s3Region ||
          local.s3CustomHeaders.length > 0
        );
      case "smb":
        return local.smbMinVersion !== d.smbMinVersion || local.smbMaxVersion !== d.smbMaxVersion;
      default:
        return false;
    }
  }

  /**
   * Mirror Java FileWriter.schemeComboBoxActionPerformed: confirm before discarding
   * non-default advanced settings on a scheme change. Otherwise apply immediately.
   */
  function handleSchemeChange(newScheme: string) {
    if (newScheme !== local.scheme && hasNonDefaultAdvancedSettings()) {
      setPendingScheme(newScheme);
    } else {
      applySchemeChange(newScheme);
    }
  }

  /** Mirror Java FileWriter.java onSchemeChange() — reset scheme-dependent props */
  function applySchemeChange(newScheme: string) {
    const updates: Partial<FileWriterProps> = { scheme: newScheme };

    // Java onSchemeChange discards the departed scheme's advancedProperties and starts the
    // new scheme fresh, so the scheme-change confirm's "lose all current properties" holds
    // in-session too (not just at save). Only on a real change — a no-op re-select keeps them.
    if (newScheme !== local.scheme) Object.assign(updates, advancedDefaults());

    switch (newScheme) {
      case "file":
        // Java onSchemeChange(false, true, true, FILE): anonymous with "anonymous" credentials.
        updates.anonymous = true;
        updates.username = "anonymous";
        updates.password = "anonymous";
        break;
      case "ftp":
        // FTP: only enables the passive/validateConnection radios (mirrors Java
        // FileWriter.onSchemeChange, which leaves the existing values untouched).
        // Do NOT force passive/validateConnection here — that silently reverted user changes.
        break;
      case "sftp":
        // SFTP: forces anonymous=false
        updates.anonymous = false;
        break;
      case "S3":
        // S3: forces anonymous=true; clears username/password (uses AWS credentials); no append.
        // Java onSchemeChange also force-selects "Temp File No" for S3 (S3 can't do the
        // temp-write-then-rename pattern), so clear temporary unconditionally.
        updates.anonymous = true;
        updates.username = "";
        updates.password = "";
        updates.temporary = false;
        if (local.outputAppend) {
          updates.outputAppend = false;
          updates.errorOnExists = false;
        }
        break;
      case "smb":
        // SMB: forces anonymous=false
        updates.anonymous = false;
        break;
      case "webdav":
        // WebDAV: forces passive=false, validateConnection=false; no append
        updates.passive = false;
        updates.validateConnection = false;
        if (local.outputAppend) {
          updates.outputAppend = false;
          updates.errorOnExists = false;
        }
        break;
    }

    commit({ ...local, ...updates });
  }

  /**
   * Mirror Java FileWriter.anonymousYes/NoActionPerformed — fill or clear the
   * credentials when the Anonymous toggle changes so stale creds aren't persisted.
   * S3 clears username/password in both directions (it uses AWS credentials);
   * other schemes set "anonymous" on Yes and leave the fields editable on No.
   */
  function handleAnonymousChange(yes: boolean) {
    const updates: Partial<FileWriterProps> = { anonymous: yes };
    if (local.scheme === "S3") {
      updates.username = "";
      updates.password = "";
    } else if (yes) {
      updates.username = "anonymous";
      updates.password = "anonymous";
    }
    commit({ ...local, ...updates });
  }

  function s3PropsFromLocal(): S3AdvancedSettings {
    return {
      anonymous: local.anonymous,
      username: local.username,
      password: local.password,
      useDefaultCredentials: local.s3UseDefaultCredentials,
      useTemporaryCredentials: local.s3UseTemporaryCredentials,
      duration: String(local.s3Duration),
      region: local.s3Region,
      customHeaders: local.s3CustomHeaders,
    };
  }

  function handleS3Save(updated: S3AdvancedSettings) {
    const dur = parseInt(updated.duration, 10);
    commit({
      ...local,
      s3UseDefaultCredentials: updated.useDefaultCredentials,
      s3UseTemporaryCredentials: updated.useTemporaryCredentials,
      s3Duration: isNaN(dur) ? local.s3Duration : dur,
      s3Region: updated.region,
      s3CustomHeaders: updated.customHeaders,
    });
  }

  function sftpSettingsFromLocal(): SftpAdvancedSettings {
    return {
      passwordAuth: local.sftpPasswordAuth,
      keyAuth: local.sftpKeyAuth,
      keyFile: local.sftpKeyFile,
      passPhrase: local.sftpPassPhrase,
      hostKeyChecking: local.sftpHostKeyChecking,
      knownHostsFile: local.sftpKnownHostsFile,
      configurationSettings: local.sftpConfigurationSettings,
    };
  }

  function handleSftpSave(updated: SftpAdvancedSettings) {
    commit({
      ...local,
      sftpPasswordAuth: updated.passwordAuth,
      sftpKeyAuth: updated.keyAuth,
      sftpKeyFile: updated.keyFile,
      sftpPassPhrase: updated.passPhrase,
      sftpHostKeyChecking: updated.hostKeyChecking,
      sftpKnownHostsFile: updated.knownHostsFile,
      sftpConfigurationSettings: updated.configurationSettings,
    });
  }

  function ftpSettingsFromLocal(): FtpAdvancedSettings {
    return { initialCommands: local.ftpInitialCommands };
  }

  function handleFtpSave(updated: FtpAdvancedSettings) {
    commit({ ...local, ftpInitialCommands: updated.initialCommands });
  }

  function smbSettingsFromLocal(): SmbAdvancedSettings {
    return { smbMinVersion: local.smbMinVersion, smbMaxVersion: local.smbMaxVersion };
  }

  function handleSmbSave(updated: SmbAdvancedSettings) {
    commit({
      ...local,
      smbMinVersion: updated.smbMinVersion,
      smbMaxVersion: updated.smbMaxVersion,
    });
  }

  const isFile = local.scheme === "file";
  const isS3 = local.scheme === "S3";
  const isFtp = local.scheme === "ftp";
  const isSftp = local.scheme === "sftp";
  const isSmb = local.scheme === "smb";
  const isWebDav = local.scheme === "webdav";
  const isNetwork = !isFile;
  // Java enables Timeout for FTP/SFTP/S3/SMB and disables it for WebDAV (and FILE).
  const hasTimeout = isFtp || isSftp || isSmb || isS3;
  const hasPassive = isFtp;
  // Java enables Secure Mode for WebDAV only; the FTP "secure" flag is never read at runtime.
  const hasSecure = isWebDav;
  const hasValidate = isFtp;
  const hasAnon = isFtp || isS3 || isWebDav;
  const canAppend = !isS3 && !isWebDav;
  const canTempFile = !isS3;
  // Java onSchemeChange never disables the Keep Connection Open radios for any scheme,
  // and FileDispatcher honors the flag for every scheme (FILE included, via pool
  // release vs destroy). So show it for all schemes.
  const hasKeepOpen = true;

  const fileExistsMode = fileExistsModeFromProps(local);

  return (
    <SettingsSection
      title="File Writer Settings"
      icon={FileText}
      defaultExpanded={true}
      storageKey="bl-file-writer-main"
    >
      {/* Scheme + inline Test Write */}
      <FieldRow label="Method:">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HoverTooltip content="The basic method used to write files with - file (local filesystem), FTP, SFTP, SMB, or WebDAV">
              <select
                value={local.scheme}
                onChange={(e) => handleSchemeChange(e.target.value)}
                className={selectCls(viewDensity)}
              >
                {SCHEME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </HoverTooltip>
            {(isS3 || isFtp || isSftp || isSmb) && (
              <HoverTooltip
                content={`${isS3 ? "S3" : isFtp ? "FTP" : isSftp ? "SFTP" : "SMB"} Advanced Settings`}
              >
                <button
                  onClick={() => {
                    if (isS3) setS3DialogOpen(true);
                    else if (isFtp) setFtpDialogOpen(true);
                    else if (isSftp) setSftpDialogOpen(true);
                    else if (isSmb) setSmbDialogOpen(true);
                  }}
                  className="shrink-0 p-1.5 rounded border border-border
                    text-gray-700 dark:text-gray-300
                    hover:bg-gray-50 dark:hover:bg-gray-700
                    hover:border-border transition-colors"
                >
                  <Settings2 size={14} />
                </button>
              </HoverTooltip>
            )}
            <TestConnButton
              label="Test Write"
              testing={tcTesting}
              result={tcResult}
              onTest={tcTest}
            />
          </div>
        </div>
      </FieldRow>

      {/* Advanced Options summary — FTP/SFTP/S3/SMB only (mirrors SchemeProperties.getSummaryText()) */}
      {(isFtp || isSftp || isS3 || isSmb) && (
        <FieldRow label="Advanced Options:">
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {getAdvancedSummaryText(local)}
          </span>
        </FieldRow>
      )}

      {/* Directory (FILE), S3 Bucket, WebDAV URL, or Host (network) */}
      {isFile ? (
        <FieldRow label="Directory:">
          <div className="flex-1 min-w-0">
            <HoverTooltip content="The directory (folder) to write the files to.">
              <input
                type="text"
                value={local.host}
                onChange={(e) => set("host", e.target.value)}
                className={`${inputCls(viewDensity)} w-full ${invalid.has("host") ? inputErrorCls : ""}`}
              />
            </HoverTooltip>
            {invalid.has("host") && <p className={fieldErrorMsgCls}>Directory is required.</p>}
          </div>
        </FieldRow>
      ) : isWebDav ? (
        <FieldRow label={local.secure ? "https://" : "http://"}>
          <div className="flex-1 min-w-0 flex items-center gap-0">
            <HoverTooltip content="The name or IP address of the host (computer) on which the files can be written.">
              <input
                type="text"
                value={(() => {
                  const idx = local.host.indexOf("/");
                  return idx !== -1 ? local.host.substring(0, idx) : local.host;
                })()}
                onChange={(e) => {
                  const idx = local.host.indexOf("/");
                  const pathPart = idx !== -1 ? local.host.substring(idx + 1) : "";
                  set("host", e.target.value + "/" + pathPart);
                }}
                className={`${inputCls(viewDensity)} w-[200px] ${invalid.has("host") ? inputErrorCls : ""}`}
              />
            </HoverTooltip>
            <span className="px-1.5 text-sm text-gray-500 dark:text-gray-400 shrink-0">/</span>
            <HoverTooltip content="The directory (folder) to write the files to.">
              <input
                type="text"
                value={(() => {
                  const idx = local.host.indexOf("/");
                  return idx !== -1 ? local.host.substring(idx + 1) : "";
                })()}
                onChange={(e) => {
                  const idx = local.host.indexOf("/");
                  const hostPart = idx !== -1 ? local.host.substring(0, idx) : local.host;
                  set("host", hostPart + "/" + e.target.value);
                }}
                className={`${inputCls(viewDensity)} w-[200px]`}
              />
            </HoverTooltip>
          </div>
          {invalid.has("host") && <p className={fieldErrorMsgCls}>URL is required.</p>}
        </FieldRow>
      ) : (
        <FieldRow label={isS3 ? "S3 Bucket:" : "Host:"}>
          <div className="flex-1 min-w-0">
            <HoverTooltip content="The name or IP address of the host on which the files can be written.">
              <input
                type="text"
                value={local.host}
                onChange={(e) => set("host", e.target.value)}
                className={`${inputCls(viewDensity)} w-full ${invalid.has("host") ? inputErrorCls : ""}`}
              />
            </HoverTooltip>
            {invalid.has("host") && <p className={fieldErrorMsgCls}>Directory is required.</p>}
          </div>
        </FieldRow>
      )}

      {/* File Name */}
      <FieldRow label="File Name:">
        <div className="flex-1 min-w-0">
          <HoverTooltip content="The file name to give to the generated file.">
            <input
              type="text"
              value={local.outputPattern}
              onChange={(e) => set("outputPattern", e.target.value)}
              className={`${inputCls(viewDensity)} w-full ${invalid.has("outputPattern") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          {invalid.has("outputPattern") && (
            <p className={fieldErrorMsgCls}>File Name is required.</p>
          )}
        </div>
      </FieldRow>

      {/* Anonymous (network schemes except SFTP/SMB) */}
      {hasAnon && (
        <FieldRow label="Anonymous:">
          <RadioGroup
            name="file-anonymous"
            value={local.anonymous ? "yes" : "no"}
            onChange={(v) => handleAnonymousChange(v === "yes")}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Connect to the file system anonymously instead of using a username and password."
          />
        </FieldRow>
      )}

      {/* Username / Password (network schemes) */}
      {isNetwork && (
        <>
          <FieldRow label={isS3 ? "Access Key ID:" : "Username:"}>
            <HoverTooltip
              content={
                isS3
                  ? "The access key ID used to authenticate to AWS S3. This is optional when using the default credential provider chain."
                  : "The user name used to gain access to the server."
              }
            >
              <input
                type="text"
                value={local.username}
                onChange={(e) => set("username", e.target.value)}
                disabled={local.anonymous}
                className={`${inputCls(viewDensity)} w-56 disabled:opacity-40`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label={isS3 ? "Secret Access Key:" : "Password:"}>
            <HoverTooltip
              content={
                isS3
                  ? "The secret access key used to authenticate to AWS S3. This is optional when using the default credential provider chain."
                  : "The password used to gain access to the server."
              }
            >
              <SecretInput
                value={local.password}
                onChange={(e) => set("password", e.target.value)}
                disabled={local.anonymous}
                className={`${inputCls(viewDensity)} w-56 disabled:opacity-40`}
              />
            </HoverTooltip>
          </FieldRow>
        </>
      )}

      {/* Timeout */}
      {hasTimeout && (
        <FieldRow label="Timeout (ms):">
          <HoverTooltip content="The socket timeout (in ms) for connecting to the server.">
            <VariableOrNumberInput
              min={0}
              value={local.timeout}
              onChange={(timeout) => set("timeout", timeout)}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>
      )}

      {/* Keep Connection Open */}
      {hasKeepOpen && (
        <>
          <FieldRow label="Keep Connection Open:">
            <RadioGroup
              name="file-keep-open"
              value={local.keepConnectionOpen ? "yes" : "no"}
              onChange={(v) => set("keepConnectionOpen", v === "yes")}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Select Yes to keep the connection to the file system open after writing to it."
            />
          </FieldRow>
          {local.keepConnectionOpen && (
            <FieldRow label="Max Idle Time (ms):">
              <HoverTooltip content="Sets the max idle timeout in milliseconds before closing a connection. Zero = infinite.">
                <VariableOrNumberInput
                  min={0}
                  value={local.maxIdleTime}
                  onChange={(maxIdleTime) => set("maxIdleTime", maxIdleTime)}
                  className={`${inputCls(viewDensity)} w-28`}
                />
              </HoverTooltip>
            </FieldRow>
          )}
        </>
      )}

      {/* Secure Mode (WebDAV only — Java reads `secure` only in the WebDAV branch) */}
      {hasSecure && (
        <FieldRow label="Secure Mode:">
          <RadioGroup
            name="file-secure"
            value={local.secure ? "yes" : "no"}
            onChange={(v) => set("secure", v === "yes")}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to connect via HTTPS; No to connect via HTTP."
          />
        </FieldRow>
      )}

      {/* Passive Mode (FTP only) */}
      {hasPassive && (
        <FieldRow label="Passive Mode:">
          <RadioGroup
            name="file-passive"
            value={local.passive ? "yes" : "no"}
            onChange={(v) => set("passive", v === "yes")}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to connect in passive mode (sometimes allows a connection through a firewall)."
          />
        </FieldRow>
      )}

      {/* Validate Connection (FTP only) */}
      {hasValidate && (
        <FieldRow label="Validate Connection:">
          <RadioGroup
            name="file-validate"
            value={local.validateConnection ? "yes" : "no"}
            onChange={(v) => set("validateConnection", v === "yes")}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to test the connection to the server before each operation."
          />
        </FieldRow>
      )}

      {/* File Exists */}
      <FieldRow label="File Exists:">
        <RadioGroup
          name="file-exists"
          value={fileExistsMode}
          onChange={(v) => commit({ ...local, ...applyFileExistsMode(local, v as FileExistsMode) })}
          options={[
            ...(canAppend ? [{ label: "Append", value: "append" }] : []),
            { label: "Overwrite", value: "overwrite" },
            { label: "Error", value: "error" },
          ]}
          title="Append: append to existing file. Overwrite: replace existing file. Error: fail if file exists."
        />
      </FieldRow>

      {/* Create Temp File */}
      {canTempFile && (
        <FieldRow label="Create Temp File:">
          <RadioGroup
            name="file-temp"
            value={local.temporary ? "yes" : "no"}
            onChange={(v) => set("temporary", v === "yes")}
            disabled={local.outputAppend}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="If Yes, write to a temp file first then rename. Not available when appending."
          />
        </FieldRow>
      )}

      {/* File Type */}
      <FieldRow label="File Type:">
        <RadioGroup
          name="file-type"
          value={local.binary ? "binary" : "text"}
          onChange={(v) =>
            // Java fileTypeBinaryActionPerformed resets the encoding combobox to index 0
            // (DEFAULT_ENCODING) when Binary is selected.
            commit(
              v === "binary"
                ? { ...local, binary: true, charsetEncoding: "DEFAULT_ENCODING" }
                : { ...local, binary: false }
            )
          }
          options={[
            { label: "Binary", value: "binary" },
            { label: "Text", value: "text" },
          ]}
          title="Binary: Base64 decode before writing. Text: write using the specified character encoding."
        />
      </FieldRow>

      {/* Encoding (Text only) */}
      {!local.binary && (
        <FieldRow label="Encoding:">
          <HoverTooltip content="The character set encoding to use when writing the file.">
            <select
              value={local.charsetEncoding}
              onChange={(e) => set("charsetEncoding", e.target.value)}
              className={selectCls(viewDensity)}
            >
              {buildCharsetOptions(serverCharsets, local.charsetEncoding).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </FieldRow>
      )}

      {/* Template */}
      <FullWidthField label="Template:">
        <HoverTooltip content="The file content to be written.">
          <ResizableEditorBox
            className={`rounded overflow-hidden border ${invalid.has("template") ? "border-red-500" : "border-border"}`}
            height={220}
          >
            <MonacoEditor
              language="plaintext"
              value={local.template}
              onChange={(v) => set("template", v ?? "")}
              onMount={handleMount}
              theme={isDark ? "vs-dark" : "vs"}
              height="100%"
              options={{
                ...MONACO_BASE_OPTIONS,
                lineNumbers: "off",
                // Disable suggestion machinery — word-based completions intercept Enter
                // (acceptSuggestionOnEnter) causing newlines to be rejected.
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                acceptSuggestionOnEnter: "off",
                tabCompletion: "off",
                wordBasedSuggestions: "off",
                parameterHints: { enabled: false },
              }}
            />
          </ResizableEditorBox>
        </HoverTooltip>
        {invalid.has("template") && <p className={fieldErrorMsgCls}>Template is required.</p>}
      </FullWidthField>

      <S3AdvancedDialog
        open={s3DialogOpen}
        onOpenChange={setS3DialogOpen}
        settings={s3PropsFromLocal()}
        onSave={handleS3Save}
      />
      <SftpAdvancedDialog
        open={sftpDialogOpen}
        onOpenChange={setSftpDialogOpen}
        settings={sftpSettingsFromLocal()}
        onSave={handleSftpSave}
      />
      <FtpAdvancedDialog
        open={ftpDialogOpen}
        onOpenChange={setFtpDialogOpen}
        settings={ftpSettingsFromLocal()}
        onSave={handleFtpSave}
      />
      <SmbAdvancedDialog
        open={smbDialogOpen}
        onOpenChange={setSmbDialogOpen}
        settings={smbSettingsFromLocal()}
        onSave={handleSmbSave}
      />
      {pendingScheme && (
        <ConfirmDialog
          title="Change Scheme"
          description="Are you sure you would like to change the scheme mode and lose all of the current properties?"
          confirmLabel="Change"
          confirmVariant="default"
          onConfirm={() => {
            applySchemeChange(pendingScheme);
            setPendingScheme(null);
          }}
          onCancel={() => setPendingScheme(null)}
        />
      )}
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const FileWriterConnector: DestinationConnectorDefinition = {
  canValidateResponse: false,
  BottomSection: FileWriterBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];

    if (!txt("host")) errors.push({ field: "host", message: "Directory is required." });
    if (!txt("outputPattern"))
      errors.push({ field: "outputPattern", message: "File Name is required." });
    if (!txt("template")) errors.push({ field: "template", message: "Template is required." });

    const scheme = txt("scheme").toLowerCase();
    const isS3 = scheme === "s3";
    const isNetworkScheme = ["ftp", "sftp", "smb", "s3", "webdav"].includes(scheme);

    // Java FileWriter.setDirHostPath: for non-file schemes the Host field is "host/path";
    // the part before the first "/" (the host) must be non-empty. Only fire when the
    // field is non-empty but the host part is missing (e.g. "/path") — an entirely empty
    // host is already reported above.
    if (isNetworkScheme) {
      const hostVal = txt("host");
      const idx = hostVal.indexOf("/");
      const hostPart = idx === -1 ? hostVal : hostVal.substring(0, idx);
      if (hostVal && !hostPart) errors.push({ field: "host", message: "Host is required." });
    }

    // Java FileWriter.checkProperties: credentials required when
    // !anonymous && (scheme != S3 || !useDefaultCredentialProviderChain). This applies to
    // every non-FILE scheme (FILE is always anonymous), WebDAV included.
    const anonymous = txt("anonymous") === "true";
    const useS3DefaultCreds = isS3 && txt("useDefaultCredentialProviderChain") === "true";
    const credsRequired = scheme !== "file" && scheme !== "" && !anonymous && !useS3DefaultCreds;

    if (credsRequired && !txt("username"))
      errors.push({ field: "username", message: "Username is required." });

    // Java skips the password check for SFTP unless password authentication is enabled.
    const sftpKeyOnly = scheme === "sftp" && txt("passwordAuth") !== "true";
    if (credsRequired && !sftpKeyOnly && !txt("password"))
      errors.push({ field: "password", message: "Password is required." });

    if (scheme === "ftp" || scheme === "sftp" || scheme === "smb") {
      const timeout = txt("timeout");
      if (!timeout || !isNumberOrVariable(timeout))
        errors.push({ field: "timeout", message: "Timeout is required." });
    }

    if (txt("keepConnectionOpen") === "true") {
      const maxIdleTime = txt("maxIdleTime");
      if (!maxIdleTime || !isNumberOrVariable(maxIdleTime))
        errors.push({ field: "maxIdleTime", message: "Max Idle Time is required." });
    }

    return errors;
  },
};
