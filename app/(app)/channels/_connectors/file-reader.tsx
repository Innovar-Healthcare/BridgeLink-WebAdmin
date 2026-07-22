"use client";

import { useState } from "react";
import { Settings2, FileText, CheckCircle2, AlertTriangle, Filter, FileCode } from "lucide-react";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { PollingSection } from "./shared/polling-section";
import { validatePolling } from "./shared/validate-utils";
import { RadioGroup } from "./shared/radio-group";
import { inputCls, selectCls, inputErrorCls, fieldErrorMsgCls } from "./shared/styles";
import { useTestConn } from "./shared/use-test-conn";
import { TestConnButton } from "./shared/test-conn-button";
import { SecretInput } from "@/components/ui/secret-input";
import {
  VariableOrNumberInput,
  isNumberOrVariable,
} from "@/components/ui/variable-or-number-input";
import { VariableInsertInput } from "./shared/variable-insert-input";
import {
  DEFAULT_FILE_READER_PROPERTIES_XML,
  parseFileReaderPropsFromXml,
  updateFileReaderPropsInXml,
  type FileReaderProps,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import { S3AdvancedDialog, type S3AdvancedSettings } from "./shared/s3-advanced-dialog";
import { SftpAdvancedDialog, type SftpAdvancedSettings } from "./shared/sftp-advanced-dialog";
import { FtpAdvancedDialog, type FtpAdvancedSettings } from "./shared/ftp-advanced-dialog";
import {
  SmbAdvancedDialog,
  type SmbAdvancedSettings,
  SMB_VERSIONS,
} from "./shared/smb-advanced-dialog";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "./shared/charset-options";
import { ConfirmDialog } from "@/components/confirm-dialog";

// ─── Constants ────────────────────────────────────────────────────────────────

// Variables available for insertion in move/rename path fields — matches
// the static MirthVariableList defined in FileReader.java
const FILE_READER_VARIABLES = [
  "channelName",
  "channelId",
  "DATE",
  "COUNT",
  "UUID",
  "SYSTIME",
  "originalFilename",
] as const;

// FileScheme.toString() display values — these are what XStream writes to XML
const SCHEMES = [
  { label: "File", value: "file" },
  { label: "FTP", value: "ftp" },
  { label: "SFTP", value: "sftp" },
  { label: "Amazon S3", value: "S3" },
  { label: "SMB", value: "smb" },
  { label: "WebDAV", value: "webdav" },
];

// FileAction enum names — used verbatim in XML
const AFTER_ACTIONS = [
  { label: "None", value: "NONE" },
  { label: "Move", value: "MOVE" },
  { label: "Delete", value: "DELETE" },
];

const ERROR_READING_ACTIONS = [
  { label: "None", value: "NONE" },
  { label: "Move", value: "MOVE" },
  { label: "Delete", value: "DELETE" },
];

const ERROR_RESPONSE_ACTIONS = [
  { label: "After Processing Action", value: "AFTER_PROCESSING" },
  { label: "Move", value: "MOVE" },
  { label: "Delete", value: "DELETE" },
];

const SORT_OPTIONS = [
  { label: "Date", value: "date" },
  { label: "Name", value: "name" },
  { label: "Size", value: "size" },
];

// ─── Advanced Options summary (mirrors SchemeProperties.getSummaryText()) ─────

function getAdvancedSummaryText(p: FileReaderProps): string {
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

// ─── Top section: Polling Settings ────────────────────────────────────────────

function FileReaderTopSection({ propertiesXml, onChange, isDark }: ConnectorSectionProps) {
  return (
    <PollingSection
      propertiesXml={propertiesXml}
      onChange={onChange}
      isDark={isDark}
      defaultPropertiesXml={DEFAULT_FILE_READER_PROPERTIES_XML}
    />
  );
}

// ─── Bottom section: File Reader Settings ─────────────────────────────────────

function FileReaderBottomSection({
  propertiesXml,
  onChange,
  invalidFields,
  channelId,
  channelName,
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const serverCharsets = useCharsetEncodings();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_FILE_READER_PROPERTIES_XML, resolveXmlVersion());
  const props = parseFileReaderPropsFromXml(propertiesXml);
  const {
    testing: tcTesting,
    result: tcResult,
    test: tcTest,
  } = useTestConn("file", "_testRead", propsXml, channelId, channelName);
  const [s3DialogOpen, setS3DialogOpen] = useState(false);
  const [sftpDialogOpen, setSftpDialogOpen] = useState(false);
  const [ftpDialogOpen, setFtpDialogOpen] = useState(false);
  const [smbDialogOpen, setSmbDialogOpen] = useState(false);
  const [pendingScheme, setPendingScheme] = useState<string | null>(null);
  const [showRecursionWarn, setShowRecursionWarn] = useState(false);

  function update(patch: Partial<FileReaderProps>) {
    onChange({ propertiesXml: updateFileReaderPropsInXml(propsXml, { ...props, ...patch }) });
  }

  // Mirror Java FileReader.isAdvancedDefault(): the current scheme's advanced settings differ
  // from a freshly-constructed default (Objects.equals against fresh SchemeProperties). The
  // reader must compare every field the Java default constructor sets — including SFTP's
  // passwordAuth/hostKeyChecking and S3's duration/region — otherwise the scheme-change confirm
  // is skipped for settings Java would have prompted on.
  function hasNonDefaultAdvancedSettings(): boolean {
    const s = props.scheme;
    if (s === "ftp") return props.ftpInitialCommands !== "";
    if (s === "sftp")
      return (
        !props.sftpPasswordAuth ||
        props.sftpKeyAuth ||
        props.sftpKeyFile !== "" ||
        props.sftpPassPhrase !== "" ||
        props.sftpHostKeyChecking !== "ask" ||
        props.sftpKnownHostsFile !== "" ||
        props.sftpConfigurationSettings.length > 0
      );
    if (s === "S3")
      return (
        !props.s3UseDefaultCredentials ||
        props.s3UseTemporaryCredentials ||
        props.s3Duration !== "7200" ||
        props.s3Region !== "us-east-1" ||
        props.s3CustomHeaders.length > 0
      );
    if (s === "smb") return props.smbMinVersion !== "SMB202" || props.smbMaxVersion !== "SMB311";
    return false;
  }

  // Mirror Java FileReader.onSchemeChange + anonymous action handlers: each scheme forces the
  // anonymous/credential state Swing produces. Anonymous is enabled only for FTP/S3/WebDAV;
  // SFTP/SMB are always non-anonymous and FILE is always anonymous with "anonymous" credentials.
  function applySchemeChange(newScheme: string) {
    const patch: Partial<FileReaderProps> = { scheme: newScheme };
    if (newScheme === "file") {
      // onSchemeChange(false, true, FILE): anonymous + "anonymous"/"anonymous" credentials
      patch.anonymous = true;
      patch.username = "anonymous";
      patch.password = "anonymous";
    } else if (newScheme === "S3") {
      // onSchemeChange(true, true, S3): anonymous, credentials cleared (AWS creds)
      patch.username = "";
      patch.password = "";
      patch.anonymous = true;
    } else if (newScheme === "sftp" || newScheme === "smb") {
      // onSchemeChange(true, false, …): SFTP/SMB anonymous radios are hard-disabled
      patch.anonymous = false;
    } else if (newScheme === "webdav") {
      // onSchemeChange forces Passive Mode = No for WebDAV
      patch.passive = false;
    }
    update(patch);
  }

  function handleSchemeChange(newScheme: string) {
    if (newScheme !== props.scheme && hasNonDefaultAdvancedSettings()) {
      setPendingScheme(newScheme);
    } else {
      applySchemeChange(newScheme);
    }
  }

  function s3SettingsFromProps(): S3AdvancedSettings {
    return {
      anonymous: props.anonymous,
      username: props.username,
      password: props.password,
      useDefaultCredentials: props.s3UseDefaultCredentials,
      useTemporaryCredentials: props.s3UseTemporaryCredentials,
      duration: props.s3Duration,
      region: props.s3Region,
      customHeaders: props.s3CustomHeaders,
    };
  }

  function handleS3Save(updated: S3AdvancedSettings) {
    // S3SchemeProperties.duration is a Java int — a non-integer string (e.g. "900.5") throws
    // in XStream on the server and 500s the save. Normalize to a whole-second integer the same
    // way the File Writer does; keep the current value only when the input isn't parseable.
    const dur = parseInt(updated.duration, 10);
    const s3Duration = isNaN(dur) ? props.s3Duration : String(dur);
    update({
      anonymous: updated.anonymous,
      username: updated.username,
      password: updated.password,
      s3UseDefaultCredentials: updated.useDefaultCredentials,
      s3UseTemporaryCredentials: updated.useTemporaryCredentials,
      s3Duration,
      s3Region: updated.region,
      s3CustomHeaders: updated.customHeaders,
    });
  }

  function sftpSettingsFromProps(): SftpAdvancedSettings {
    return {
      passwordAuth: props.sftpPasswordAuth,
      keyAuth: props.sftpKeyAuth,
      keyFile: props.sftpKeyFile,
      passPhrase: props.sftpPassPhrase,
      hostKeyChecking: props.sftpHostKeyChecking,
      knownHostsFile: props.sftpKnownHostsFile,
      configurationSettings: props.sftpConfigurationSettings,
    };
  }

  function handleSftpSave(updated: SftpAdvancedSettings) {
    update({
      sftpPasswordAuth: updated.passwordAuth,
      sftpKeyAuth: updated.keyAuth,
      sftpKeyFile: updated.keyFile,
      sftpPassPhrase: updated.passPhrase,
      sftpHostKeyChecking: updated.hostKeyChecking,
      sftpKnownHostsFile: updated.knownHostsFile,
      sftpConfigurationSettings: updated.configurationSettings,
    });
  }

  function ftpSettingsFromProps(): FtpAdvancedSettings {
    return { initialCommands: props.ftpInitialCommands };
  }

  function handleFtpSave(updated: FtpAdvancedSettings) {
    update({ ftpInitialCommands: updated.initialCommands });
  }

  function smbSettingsFromProps(): SmbAdvancedSettings {
    return { smbMinVersion: props.smbMinVersion, smbMaxVersion: props.smbMaxVersion };
  }

  function handleSmbSave(updated: SmbAdvancedSettings) {
    update({ smbMinVersion: updated.smbMinVersion, smbMaxVersion: updated.smbMaxVersion });
  }

  const isFile = props.scheme === "file";
  const isFtp = props.scheme === "ftp";
  const isSftp = props.scheme === "sftp";
  const isS3 = props.scheme === "S3";
  const isSmb = props.scheme === "smb";
  const isWebdav = props.scheme === "webdav";

  // S3 uses its own credential model; SFTP/FTP/SMB/WebDAV use generic auth.
  // Java enables the Anonymous radios only for FTP/S3/WebDAV; SFTP and SMB are hard-disabled
  // and forced non-anonymous (Swing can never produce SFTP/SMB with anonymous=true), so the
  // toggle must not be offered for them.
  const showGenericAuth = isFtp || isSftp || isSmb || isWebdav;
  const showAnonymousToggle = isFtp || isWebdav;
  // Java enables Timeout for FTP/SFTP/S3/SMB and disables it for WebDAV (and FILE).
  const showTimeout = isFtp || isSftp || isSmb || isS3;
  // Java enables Secure Mode for WebDAV only; the FTP "secure" flag is never read at runtime.
  const showSecure = isWebdav; // HTTPS toggle (WebDAV)
  const showPassive = isFtp;
  const showValidateConn = isFtp;

  // Move-to fields are only relevant when the action is MOVE
  const showMoveFields = props.afterProcessingAction === "MOVE";
  const showErrorMoveFields =
    props.errorReadingAction === "MOVE" || props.errorResponseAction === "MOVE";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {pendingScheme && (
        <ConfirmDialog
          title="Change Scheme"
          description="Are you sure you want to change the scheme? All advanced settings for the current scheme will be lost."
          confirmLabel="Change"
          confirmVariant="default"
          onConfirm={() => {
            applySchemeChange(pendingScheme);
            setPendingScheme(null);
          }}
          onCancel={() => setPendingScheme(null)}
        />
      )}

      {showRecursionWarn && (
        <ConfirmDialog
          title="Directory Recursion"
          description="Including all subdirectories recursively is not recommended, especially if you are moving or deleting files. Are you sure you want to enable directory recursion?"
          confirmLabel="Yes"
          confirmVariant="default"
          onConfirm={() => {
            update({ directoryRecursion: true });
            setShowRecursionWarn(false);
          }}
          onCancel={() => setShowRecursionWarn(false)}
        />
      )}

      {/* ── Connection & file location ─────────────────────────────────────── */}

      <SettingsSection title="File Reader Settings" icon={FileText}>
        <FieldRow label="Method:">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HoverTooltip content="The basic method used to access files to be read - file (local filesystem), FTP, SFTP, S3, SMB, or WebDAV">
                <select
                  value={props.scheme}
                  onChange={(e) => handleSchemeChange(e.target.value)}
                  className={selectCls(viewDensity)}
                >
                  {SCHEMES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
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
                label="Test Read"
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
              {getAdvancedSummaryText(props)}
            </span>
          </FieldRow>
        )}

        {/* Directory (FILE), S3 Bucket+Prefix, or Host/Path (remote) */}
        {isS3 ? (
          <>
            <FieldRow label="S3 Bucket:">
              <div className="flex items-center gap-1">
                <HoverTooltip content="The name of the S3 bucket to read from.">
                  <input
                    type="text"
                    value={props.host.split("/")[0] ?? ""}
                    onChange={(e) => {
                      const prefix = props.host.split("/").slice(1).join("/");
                      update({ host: e.target.value + (prefix ? "/" + prefix : "") });
                    }}
                    className={`${inputCls(viewDensity)} w-48`}
                    placeholder="bucket-name"
                  />
                </HoverTooltip>
                <span className="text-gray-500 dark:text-gray-400">/</span>
                <HoverTooltip content="The key prefix (folder path) within the S3 bucket.">
                  <input
                    type="text"
                    value={props.host.split("/").slice(1).join("/")}
                    onChange={(e) => {
                      const bucket = props.host.split("/")[0] ?? "";
                      update({ host: bucket + "/" + e.target.value });
                    }}
                    className={`${inputCls(viewDensity)} w-48`}
                    placeholder="prefix/path"
                  />
                </HoverTooltip>
              </div>
            </FieldRow>
            {/* AWS keys are ignored at runtime when anonymous (S3Connection returns an
                AnonymousCredentialsProvider) or when the default credential chain is on —
                match Java, which disables/clears the fields in both cases. */}
            {!props.anonymous && !props.s3UseDefaultCredentials && (
              <>
                <FieldRow label="AWS Access Key ID:">
                  <HoverTooltip content="The AWS access key ID used to authenticate with S3.">
                    <input
                      type="text"
                      value={props.username}
                      onChange={(e) => update({ username: e.target.value })}
                      className={`${inputCls(viewDensity)} w-52`}
                      autoComplete="off"
                    />
                  </HoverTooltip>
                </FieldRow>
                <FieldRow label="AWS Secret Access Key:">
                  <HoverTooltip content="The AWS secret access key used to authenticate with S3.">
                    <SecretInput
                      value={props.password}
                      onChange={(e) => update({ password: e.target.value })}
                      density={viewDensity}
                      className={`${inputCls(viewDensity)} w-52`}
                    />
                  </HoverTooltip>
                </FieldRow>
              </>
            )}
          </>
        ) : (
          <FieldRow label={isFile ? "Directory:" : "Host:"}>
            <div>
              <HoverTooltip
                content={
                  isFile
                    ? "The directory (folder) in which the files to be read can be found."
                    : "The name or IP address of the host (computer) on which the files to be read can be found, followed by the directory path."
                }
              >
                <input
                  type="text"
                  value={props.host}
                  onChange={(e) => update({ host: e.target.value })}
                  className={`${inputCls(viewDensity)} w-96 ${invalid.has("host") ? inputErrorCls : ""}`}
                  placeholder={isFile ? "/path/to/directory" : "hostname/path"}
                />
              </HoverTooltip>
              {invalid.has("host") && <p className={fieldErrorMsgCls}>Directory is required.</p>}
            </div>
          </FieldRow>
        )}

        <FieldRow label="Filename Filter:">
          <div>
            <HoverTooltip content="The pattern which names of files must match in order to be read. Files with names that do not match the pattern will be ignored.">
              <input
                type="text"
                value={props.fileFilter}
                onChange={(e) => update({ fileFilter: e.target.value })}
                className={`${inputCls(viewDensity)} w-64 ${invalid.has("fileFilter") ? inputErrorCls : ""}`}
                placeholder="* or regex pattern"
              />
            </HoverTooltip>
            {invalid.has("fileFilter") && (
              <p className={fieldErrorMsgCls}>File Name Filter is required.</p>
            )}
          </div>
        </FieldRow>

        <FieldRow label="Regular Expression:">
          <RadioGroup
            name="regex"
            value={props.regex ? "yes" : "no"}
            onChange={(v) => update({ regex: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="If Regex is checked, the pattern is treated as a regular expression. If Regex is not checked, it is treated as a pattern that supports wildcards and a comma separated list."
          />
        </FieldRow>

        <FieldRow label="Include Subdirectories:">
          <RadioGroup
            name="directoryRecursion"
            value={props.directoryRecursion ? "yes" : "no"}
            onChange={(v) => {
              if (v === "yes") {
                setShowRecursionWarn(true);
              } else {
                update({ directoryRecursion: false });
              }
            }}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to traverse directories recursively and search for files in each one. Select No to only search for files in the selected directory/location, ignoring subdirectories."
          />
        </FieldRow>

        <FieldRow label="Ignore Dot Files:">
          <RadioGroup
            name="ignoreDot"
            value={props.ignoreDot ? "yes" : "no"}
            onChange={(v) => update({ ignoreDot: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to ignore all files starting with a period. Select No to process files starting with a period."
          />
        </FieldRow>

        {/* ── Generic auth (FTP, SMB, WEBDAV) ─────────────────────────────── */}

        {showGenericAuth && (
          <>
            {showAnonymousToggle && (
              <FieldRow label="Anonymous:">
                <RadioGroup
                  name="anonymous"
                  value={props.anonymous ? "yes" : "no"}
                  onChange={(v) => update({ anonymous: v === "yes" })}
                  options={[
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                  ]}
                  title="Select Yes to connect to the file anonymously instead of using a username and password. Select No to connect using a username and password."
                />
              </FieldRow>
            )}
            {!props.anonymous && (
              <>
                <FieldRow label="Username:">
                  <HoverTooltip content="The user name used to gain access to the server.">
                    <input
                      type="text"
                      value={props.username}
                      onChange={(e) => update({ username: e.target.value })}
                      className={`${inputCls(viewDensity)} w-52`}
                    />
                  </HoverTooltip>
                </FieldRow>
                <FieldRow label="Password:">
                  <HoverTooltip content="The password used to gain access to the server.">
                    <SecretInput
                      value={props.password}
                      onChange={(e) => update({ password: e.target.value })}
                      density={viewDensity}
                      className={`${inputCls(viewDensity)} w-52`}
                    />
                  </HoverTooltip>
                </FieldRow>
              </>
            )}
          </>
        )}

        {/* ── Connection settings ──────────────────────────────────────────── */}

        {showTimeout && (
          <FieldRow label="Timeout (ms):">
            <HoverTooltip content="The socket timeout (in ms) for connecting to the server.">
              <VariableOrNumberInput
                min={0}
                value={props.timeout}
                onChange={(timeout) => update({ timeout })}
                className={`${inputCls(viewDensity)} w-28`}
              />
            </HoverTooltip>
          </FieldRow>
        )}

        {showSecure && (
          <FieldRow label={isFtp ? "Secure (FTPS):" : "Secure (HTTPS):"}>
            <RadioGroup
              name="secure"
              value={props.secure ? "yes" : "no"}
              onChange={(v) => update({ secure: v === "yes" })}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Select Yes to connect to the server via HTTPS. Select No to connect via HTTP."
            />
          </FieldRow>
        )}

        {showPassive && (
          <FieldRow label="Passive Mode:">
            <RadioGroup
              name="passive"
              value={props.passive ? "yes" : "no"}
              onChange={(v) => update({ passive: v === "yes" })}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title='Select Yes to connect to the server in "passive mode". Passive mode sometimes allows a connection through a firewall that normal mode does not.'
            />
          </FieldRow>
        )}

        {showValidateConn && (
          <FieldRow label="Validate Connection:">
            <RadioGroup
              name="validateConnection"
              value={props.validateConnection ? "yes" : "no"}
              onChange={(v) => update({ validateConnection: v === "yes" })}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Select Yes to test the connection to the server before each operation. Select No to skip testing the connection to the server before each operation."
            />
          </FieldRow>
        )}
      </SettingsSection>

      {/* Advanced settings dialogs */}
      <S3AdvancedDialog
        open={s3DialogOpen}
        onOpenChange={setS3DialogOpen}
        settings={s3SettingsFromProps()}
        onSave={handleS3Save}
        showAnonymousField
      />
      <SftpAdvancedDialog
        open={sftpDialogOpen}
        onOpenChange={setSftpDialogOpen}
        settings={sftpSettingsFromProps()}
        onSave={handleSftpSave}
      />
      <FtpAdvancedDialog
        open={ftpDialogOpen}
        onOpenChange={setFtpDialogOpen}
        settings={ftpSettingsFromProps()}
        onSave={handleFtpSave}
      />
      <SmbAdvancedDialog
        open={smbDialogOpen}
        onOpenChange={setSmbDialogOpen}
        settings={smbSettingsFromProps()}
        onSave={handleSmbSave}
      />

      {/* ── After processing ──────────────────────────────────────────────── */}

      <SettingsSection
        title="After Processing"
        icon={CheckCircle2}
        defaultExpanded={true}
        storageKey="bl-file-reader-after"
        summary={
          <SummaryChip
            value={
              props.afterProcessingAction === "NONE" ? "No action" : props.afterProcessingAction
            }
          />
        }
      >
        <FieldRow label="Action:">
          <HoverTooltip content="Select Move to move and/or rename the file after successful processing. Select Delete to delete the file after successful processing.">
            <select
              value={props.afterProcessingAction}
              onChange={(e) => update({ afterProcessingAction: e.target.value })}
              className={selectCls(viewDensity)}
            >
              {AFTER_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </FieldRow>

        {showMoveFields && (
          <>
            <FieldRow label="Move-to Directory:">
              <HoverTooltip content="If successfully processed files should be moved to a different directory (folder), enter that directory here. If this field is left empty, successfully processed files will not be moved to a different directory.">
                <VariableInsertInput
                  value={props.moveToDirectory}
                  onChange={(v) => update({ moveToDirectory: v })}
                  variables={FILE_READER_VARIABLES}
                  className="w-80"
                  placeholder="/path/to/processed"
                />
              </HoverTooltip>
            </FieldRow>
            <FieldRow label="Move-to Filename:">
              <HoverTooltip content="If successfully processed files should be renamed, enter the new name here. If this field is left empty, successfully processed files will not be renamed.">
                <VariableInsertInput
                  value={props.moveToFileName}
                  onChange={(v) => update({ moveToFileName: v })}
                  variables={FILE_READER_VARIABLES}
                  className="w-80"
                  placeholder="(blank = keep original name)"
                />
              </HoverTooltip>
            </FieldRow>
          </>
        )}
      </SettingsSection>

      {/* ── Error handling ────────────────────────────────────────────────── */}

      <SettingsSection
        title="Error Handling"
        icon={AlertTriangle}
        defaultExpanded={true}
        storageKey="bl-file-reader-error"
        summary={
          <SummaryChip
            value={props.errorReadingAction === "NONE" ? "Continue" : props.errorReadingAction}
          />
        }
      >
        <FieldRow label="Error Reading Action:">
          <HoverTooltip content="Select Move to move and/or rename files that have failed to be read in. Select Delete to delete files that have failed to be read in.">
            <select
              value={props.errorReadingAction}
              onChange={(e) => update({ errorReadingAction: e.target.value })}
              className={selectCls(viewDensity)}
            >
              {ERROR_READING_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Error in Response Action:">
          <HoverTooltip content="Select Move to move and/or rename the file if an ERROR response is returned. Select Delete to delete the file if an ERROR response is returned. If After Processing Action is selected, the After Processing Action will apply. This action is only available if Process Batch Files is disabled.">
            <select
              value={props.errorResponseAction}
              onChange={(e) => update({ errorResponseAction: e.target.value })}
              className={selectCls(viewDensity)}
            >
              {ERROR_RESPONSE_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </FieldRow>

        {showErrorMoveFields && (
          <>
            <FieldRow label="Error Move-to Directory:">
              <HoverTooltip content="If files which cause processing errors should be moved to a different directory (folder), enter that directory here. If this field is left empty, files which cause processing errors will not be moved to a different directory.">
                <VariableInsertInput
                  value={props.errorMoveToDirectory}
                  onChange={(v) => update({ errorMoveToDirectory: v })}
                  variables={FILE_READER_VARIABLES}
                  className="w-80"
                  placeholder="/path/to/errors"
                />
              </HoverTooltip>
            </FieldRow>
            <FieldRow label="Error Move-to Filename:">
              <HoverTooltip content="If files which cause processing errors should be renamed, enter the new name here. If this field is left empty, files which cause processing errors will not be renamed.">
                <VariableInsertInput
                  value={props.errorMoveToFileName}
                  onChange={(v) => update({ errorMoveToFileName: v })}
                  variables={FILE_READER_VARIABLES}
                  className="w-80"
                  placeholder="(blank = keep original name)"
                />
              </HoverTooltip>
            </FieldRow>
          </>
        )}
      </SettingsSection>

      {/* ── File filtering ────────────────────────────────────────────────── */}

      <SettingsSection
        title="File Filtering"
        icon={Filter}
        defaultExpanded={false}
        storageKey="bl-file-reader-filter"
        summary={
          <SummaryChip value={props.checkFileAge ? `Age: ${props.fileAge}ms` : "No filter"} />
        }
      >
        <FieldRow label="Check File Age:">
          <RadioGroup
            name="checkFileAge"
            value={props.checkFileAge ? "yes" : "no"}
            onChange={(v) => update({ checkFileAge: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to skip files that are created within the specified age below. Select No to process files regardless of age."
          />
        </FieldRow>

        {props.checkFileAge && (
          <FieldRow label="Minimum File Age (ms):">
            <HoverTooltip content="If Check File Age Yes is selected, only the files created that are older than the specified value in milliseconds will be processed.">
              <VariableOrNumberInput
                min={0}
                value={props.fileAge}
                onChange={(fileAge) => update({ fileAge })}
                className={`${inputCls(viewDensity)} w-28`}
              />
            </HoverTooltip>
          </FieldRow>
        )}

        <FieldRow label="Minimum File Size (bytes):">
          <HoverTooltip content="The minimum size (in bytes) of files to be accepted.">
            <VariableOrNumberInput
              min={0}
              value={props.fileSizeMinimum}
              onChange={(fileSizeMinimum) => update({ fileSizeMinimum })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Ignore Maximum File Size:">
          <RadioGroup
            name="ignoreFileSizeMaximum"
            value={props.ignoreFileSizeMaximum ? "yes" : "no"}
            onChange={(v) => update({ ignoreFileSizeMaximum: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="If checked, only the minimum file size will be checked against incoming files."
          />
        </FieldRow>

        {!props.ignoreFileSizeMaximum && (
          <FieldRow label="Maximum File Size (bytes):">
            <HoverTooltip content="The maximum size (in bytes) of files to be accepted. This option has no effect if Ignore Maximum is checked.">
              <VariableOrNumberInput
                min={0}
                value={props.fileSizeMaximum}
                onChange={(fileSizeMaximum) => update({ fileSizeMaximum })}
                className={`${inputCls(viewDensity)} w-28`}
              />
            </HoverTooltip>
          </FieldRow>
        )}

        <FieldRow label="Sort Files By:">
          <HoverTooltip content="Selects the order in which files should be processed, if there are multiple files available to be processed. Files can be processed by Date (oldest last modification date first), Size (smallest first) or name (a before z, etc.).">
            <select
              value={props.sortBy}
              onChange={(e) => update({ sortBy: e.target.value })}
              className={selectCls(viewDensity)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </FieldRow>
      </SettingsSection>

      {/* ── File type & encoding ──────────────────────────────────────────── */}

      <SettingsSection
        title="Encoding"
        icon={FileCode}
        defaultExpanded={false}
        storageKey="bl-file-reader-encoding"
        summary={
          <SummaryChip value={props.binary ? "Binary" : props.charsetEncoding || "Default"} />
        }
      >
        <FieldRow label="File Type:">
          <RadioGroup
            name="binary"
            value={props.binary ? "binary" : "text"}
            onChange={(v) =>
              // Java fileTypeBinaryActionPerformed resets the encoding combobox to index 0
              // (DEFAULT_ENCODING) when Binary is selected.
              update(
                v === "binary"
                  ? { binary: true, charsetEncoding: "DEFAULT_ENCODING" }
                  : { binary: false }
              )
            }
            options={[
              { label: "Text", value: "text" },
              { label: "Binary", value: "binary" },
            ]}
            title="Select Binary if files contain binary data; the contents will be Base64 encoded before processing. Select Text if files contain text data; the contents will be encoded using the specified character set encoding."
          />
        </FieldRow>

        {!props.binary && (
          <FieldRow label="Encoding:">
            <HoverTooltip content="If File Type Text is selected, select the character set encoding (ASCII, UTF-8, etc.) to be used in reading the contents of each file.">
              <select
                value={props.charsetEncoding}
                onChange={(e) => update({ charsetEncoding: e.target.value })}
                className={selectCls(viewDensity)}
              >
                {buildCharsetOptions(serverCharsets, props.charsetEncoding).map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </HoverTooltip>
          </FieldRow>
        )}
      </SettingsSection>
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const FileReaderConnector: ConnectorDefinition = {
  TopSection: FileReaderTopSection,
  BottomSection: FileReaderBottomSection,
  defaultPropertiesXml: DEFAULT_FILE_READER_PROPERTIES_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("./shared/validate-utils").ValidationError[] = [];

    if (!txt("host")) errors.push({ field: "host", message: "Directory is required." });
    if (!txt("fileFilter"))
      errors.push({ field: "fileFilter", message: "File Name Filter is required." });

    const scheme = txt("scheme").toLowerCase();
    const isS3 = scheme === "s3";
    const needsAuth = scheme === "ftp" || scheme === "sftp" || scheme === "smb" || isS3;
    // Java forces anonymous=false for SFTP/SMB (the radios are hard-disabled), so a persisted
    // anonymous=true for those schemes must not exempt them from the credential check.
    const forcedNonAnonymous = scheme === "sftp" || scheme === "smb";
    const anonymous = forcedNonAnonymous ? false : txt("anonymous") === "true";

    // Java FileReader.checkProperties: credentials are checked when
    // !anonymous && (scheme != S3 || !useDefaultCredentialProviderChain).
    const useS3DefaultCreds = isS3 && txt("useDefaultCredentialProviderChain") === "true";
    const credsRequired = needsAuth && !anonymous && !useS3DefaultCreds;

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

    if (txt("checkFileAge") === "true") {
      const fileAge = txt("fileAge");
      if (!fileAge || !isNumberOrVariable(fileAge))
        errors.push({ field: "fileAge", message: "File Age must be a valid number." });
    }

    // Java FileReader.checkProperties rejects an empty Minimum File Size.
    const minStr = txt("fileSizeMinimum");
    if (!minStr || !isNumberOrVariable(minStr))
      errors.push({
        field: "fileSizeMinimum",
        message: "File Size Minimum must be a valid number.",
      });

    if (txt("ignoreFileSizeMaximum") === "false") {
      const maxStr = txt("fileSizeMaximum");
      if (!maxStr || !isNumberOrVariable(maxStr)) {
        errors.push({
          field: "fileSizeMaximum",
          message: "File Size Maximum must be a valid number.",
        });
      } else if (/^\d+$/.test(minStr) && /^\d+$/.test(maxStr) && Number(maxStr) < Number(minStr)) {
        // Bound check only applies when both are plain numbers — variable expressions
        // can't be compared at save time.
        errors.push({
          field: "fileSizeMaximum",
          message: "File Size Maximum must be greater than or equal to the minimum.",
        });
      }
    }

    errors.push(...validatePolling(propertiesXml));
    return errors;
  },
};
