"use client";

import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, AlertCircle, Download } from "lucide-react";
import { toast } from "sonner";
import {
  exportMessagesServer,
  auditExportMessages,
  auditExportMessagesSuccess,
  searchMessages,
  getMessageXml,
  getMessageAttachmentsXml,
} from "@/lib/api-client";
import type { MessageFilter } from "@/lib/api-client";
import type { MessageWriterOptions, Message } from "@/lib/types";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { embedAttachmentsXml, buildMessagesZip } from "@/components/messages/export-xml-utils";
import { DialogFieldRow as Row } from "@/components/messages/dialog-field-row";

// ─── Content type options ────────────────────────────────────────────────────

interface ExportFormat {
  label: string;
  contentType: string | null;
  destinationContent: boolean;
}

const EXPORT_FORMATS: ExportFormat[] = [
  { label: "XML serialized message", contentType: null, destinationContent: false },
  // Source content types
  { label: "Source - Raw", contentType: "RAW", destinationContent: false },
  { label: "Source - Processed Raw", contentType: "PROCESSED_RAW", destinationContent: false },
  { label: "Source - Transformed", contentType: "TRANSFORMED", destinationContent: false },
  { label: "Source - Encoded", contentType: "ENCODED", destinationContent: false },
  { label: "Source - Response", contentType: "RESPONSE", destinationContent: false },
  // Destination content types
  { label: "Destination - Raw", contentType: "RAW", destinationContent: true },
  { label: "Destination - Transformed", contentType: "TRANSFORMED", destinationContent: true },
  { label: "Destination - Encoded", contentType: "ENCODED", destinationContent: true },
  { label: "Destination - Sent", contentType: "SENT", destinationContent: true },
  { label: "Destination - Response", contentType: "RESPONSE", destinationContent: true },
  {
    label: "Destination - Processed Response",
    contentType: "PROCESSED_RESPONSE",
    destinationContent: true,
  },
];

// Compression options
type CompressionOption = "none" | "zip" | "tar.gz" | "tar.bz2";

function getArchiveParams(compression: CompressionOption): {
  archiveFormat: string | null;
  compressFormat: string | null;
} {
  switch (compression) {
    case "zip":
      return { archiveFormat: "zip", compressFormat: null };
    case "tar.gz":
      return { archiveFormat: "tar", compressFormat: "gz" };
    case "tar.bz2":
      return { archiveFormat: "tar", compressFormat: "bzip2" };
    default:
      return { archiveFormat: null, compressFormat: null };
  }
}

function getArchiveExtension(compression: CompressionOption): string {
  switch (compression) {
    case "zip":
      return ".zip";
    case "tar.gz":
      return ".tar.gz";
    case "tar.bz2":
      return ".tar.bz2";
    default:
      return "";
  }
}

// File pattern variables (right sidebar)
const FILE_PATTERN_VARIABLES = [
  { label: "Message ID", variable: "${message.messageId}" },
  { label: "Server ID", variable: "${message.serverId}" },
  { label: "Channel ID", variable: "${message.channelId}" },
  { label: "Original File Name", variable: "${originalFilename}" },
  { label: "Formatted Message Date", variable: "${formattedDate}" },
  { label: "Formatted Current Date", variable: "${currentDate}" },
  { label: "Timestamp", variable: "${timestamp}" },
  { label: "Unique ID", variable: "${uid}" },
  { label: "Count", variable: "${count}" },
];

const DEFAULT_FILE_PATTERN = "${message.channelId}_message_${message.messageId}.xml";

// ─── Component ───────────────────────────────────────────────────────────────

interface ExportResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  channelName: string;
  /** Filter PINNED at search time (null before the first search); mirrors Java getMessageFilter(). */
  messageFilter: MessageFilter | null;
  pageSize: number;
  /** Whether there are messages in the current search results. */
  hasMessages: boolean;
  /** True if no search has been performed yet. */
  isFirstLoad: boolean;
}

export function ExportResultsDialog({
  open,
  onOpenChange,
  channelId,
  channelName,
  messageFilter,
  pageSize,
  hasMessages,
  isFirstLoad,
}: ExportResultsDialogProps) {
  const { viewDensity } = useCompactMode();
  const sectionSpacing =
    viewDensity === "comfortable"
      ? "space-y-4"
      : viewDensity === "compact"
        ? "space-y-2"
        : "space-y-3";
  const rowGap =
    viewDensity === "comfortable" ? "gap-4" : viewDensity === "compact" ? "gap-2" : "gap-3";

  // Content/format
  const [formatIndex, setFormatIndex] = useState(0);
  const [encrypt, setEncrypt] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(false);

  // Compression
  const [compression, setCompression] = useState<CompressionOption>("none");

  // Password (ZIP only)
  const [passwordProtect, setPasswordProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [encryptionType, setEncryptionType] = useState("AES128");

  // Export destination
  const [exportTo, setExportTo] = useState<"server" | "local">("server");

  // File options
  const [rootPath, setRootPath] = useState("");
  const [filePattern, setFilePattern] = useState(DEFAULT_FILE_PATTERN);

  // My Computer: File System Access API directory handle
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Persistent informational notice (e.g. "no messages to export"), shown inline in the dialog
  // to match Java's modal alertInformation rather than a transient toast.
  const [info, setInfo] = useState("");

  const filePatternRef = useRef<HTMLTextAreaElement>(null);

  const selectedFormat = EXPORT_FORMATS[formatIndex];
  const isXmlFormat = selectedFormat.contentType === null;
  const isZip = compression === "zip";
  // Local export supports only plain zip — fflate can't produce tar or encrypted archives.
  const isLocal = exportTo === "local";

  // Reset form state each time the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an effect,
  // which avoids the cascading-render warning from react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFormatIndex(0);
      setEncrypt(false);
      setIncludeAttachments(false);
      setCompression("none");
      setPasswordProtect(false);
      setPassword("");
      setEncryptionType("AES128");
      setExportTo("server");
      setRootPath("");
      setFilePattern(DEFAULT_FILE_PATTERN);
      setLoading(false);
      setError("");
      setInfo("");
      dirHandleRef.current = null;
    }
  }

  // Keep dependent toggles consistent with the selected format/compression.
  // These derived resets run during render (the "adjusting state when a prop
  // changes" idiom) instead of in an effect, which avoids the cascading-render
  // warning from react-hooks/set-state-in-effect.
  // When content type changes away from XML, disable "Include Attachments".
  if (!isXmlFormat && includeAttachments) {
    setIncludeAttachments(false);
  }
  // When compression changes away from ZIP, disable password protection.
  if (!isZip && (passwordProtect || password !== "")) {
    setPasswordProtect(false);
    setPassword("");
  }
  // Local ("My Computer") export can only produce a plain zip (fflate can't make tar or
  // encrypted/AES archives), so fall back to "none" for tar formats and force password off.
  if (exportTo === "local" && (compression === "tar.gz" || compression === "tar.bz2")) {
    setCompression("none");
  }
  if (exportTo === "local" && (passwordProtect || password !== "")) {
    setPasswordProtect(false);
    setPassword("");
  }

  const insertVariable = useCallback(
    (variable: string) => {
      const textarea = filePatternRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = filePattern.slice(0, start) + variable + filePattern.slice(end);
        setFilePattern(newValue);
        // Restore cursor position after the inserted variable
        requestAnimationFrame(() => {
          textarea.focus();
          const pos = start + variable.length;
          textarea.setSelectionRange(pos, pos);
        });
      } else {
        setFilePattern((prev) => prev + variable);
      }
    },
    [filePattern]
  );

  async function handleBrowseLocal() {
    // Use the File System Access API (Chrome/Edge) to let the user pick a local directory
    if ("showDirectoryPicker" in window) {
      try {
        const handle = await (
          window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
        ).showDirectoryPicker();
        dirHandleRef.current = handle;
        setRootPath(handle.name);
        setError("");
      } catch {
        // User cancelled the picker — do nothing
      }
    } else {
      setError(
        "Your browser does not support directory selection. Files will be downloaded to your default download folder."
      );
    }
  }

  function validate(): string | null {
    if (exportTo === "server" && !rootPath.trim()) return "Root Path is required.";
    if (!filePattern.trim()) return "File Pattern is required.";
    if (passwordProtect && !password)
      return "Password is required when password protection is enabled.";
    return null;
  }

  /**
   * Build a downloadable file from a single connector content type for "My Computer" export.
   *
   * Only handles per-content-type formats (RAW/TRANSFORMED/…). The "XML serialized message" format
   * (contentType === null) is produced by fetching the server's XStream `<message>` XML directly
   * (see `buildSerializedMessageXml`) and never routes through here.
   */
  function getMessageContent(msg: Message, format: ExportFormat): string {
    if (format.contentType === null) return "";

    const connectorMessages = msg.connectorMessages ?? {};
    const keys = Object.keys(connectorMessages).sort((a, b) => Number(a) - Number(b));

    // Find the content type in the connector messages
    const contentTypeKey = format.contentType
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const key of keys) {
      const cm = connectorMessages[key];
      const isSource = Number(key) === 0;
      if (format.destinationContent && isSource) continue;
      if (!format.destinationContent && !isSource) continue;

      const content = (cm as unknown as Record<string, unknown>)[contentTypeKey];
      if (content && typeof content === "object" && "content" in content) {
        return (content as { content: string }).content;
      }
    }
    return "";
  }

  /**
   * Fetch a single message as a re-importable XStream `<message>` XML document, embedding the
   * attachment list when requested. Mirrors Java's local XML-serialized export.
   */
  async function buildSerializedMessageXml(
    messageId: number,
    withAttachments: boolean
  ): Promise<string> {
    const messageXml = await getMessageXml(channelId, messageId);
    if (!withAttachments) return messageXml;
    const attachmentsXml = await getMessageAttachmentsXml(channelId, messageId);
    return embedAttachmentsXml(messageXml, attachmentsXml);
  }

  function substituteFilePattern(pattern: string, msg: Message, index: number): string {
    return pattern
      .replace(/\$\{message\.messageId\}/g, String(msg.messageId))
      .replace(/\$\{message\.serverId\}/g, msg.serverId ?? "")
      .replace(/\$\{message\.channelId\}/g, msg.channelId)
      .replace(/\$\{originalFilename\}/g, "")
      .replace(
        /\$\{formattedDate\}/g,
        new Date(msg.receivedDate).toISOString().replace(/[:.]/g, "-")
      )
      .replace(/\$\{currentDate\}/g, new Date().toISOString().replace(/[:.]/g, "-"))
      .replace(/\$\{timestamp\}/g, String(Date.now()))
      .replace(/\$\{uid\}/g, crypto.randomUUID())
      .replace(/\$\{count\}/g, String(index + 1));
  }

  function triggerDownload(content: string | Uint8Array, filename: string) {
    const blob = new Blob([content as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    setError("");
    setInfo("");

    // Check for messages — shown inline (persistent), matching Java's modal alertInformation.
    if (isFirstLoad) {
      setInfo("There are no messages to export. Please perform a search before exporting.");
      return;
    }
    if (!hasMessages) {
      setInfo("There are no messages to export.");
      return;
    }
    // isFirstLoad (no explicit user search yet) already refuses above; this narrows messageFilter
    // for exportMessagesServer/searchMessages below and covers the no-channel-selected case.
    if (!messageFilter) {
      setInfo("There are no messages to export. Please perform a search before exporting.");
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const { archiveFormat, compressFormat } = getArchiveParams(compression);
      const writerOptions: MessageWriterOptions = {
        contentType: selectedFormat.contentType,
        destinationContent: selectedFormat.destinationContent,
        encrypt,
        includeAttachments: isXmlFormat ? includeAttachments : false,
        rootFolder: rootPath.trim(),
        filePattern: filePattern.trim(),
        archiveFormat,
        compressFormat,
        passwordEnabled: passwordProtect,
        password: passwordProtect ? password : undefined,
        encryptionType: passwordProtect ? encryptionType : undefined,
      };

      if (exportTo === "server") {
        // Server-side export
        await auditExportMessages({});

        const exportCount = await exportMessagesServer(
          channelId,
          messageFilter,
          pageSize,
          writerOptions
        );

        if (exportCount > 0) {
          // Audit success with detailed attributes
          const archiveExt = getArchiveExtension(compression);
          await auditExportMessagesSuccess({
            rootPath: rootPath.trim(),
            filePattern: filePattern.trim(),
            exportCount: String(exportCount),
            contentType: selectedFormat.contentType ?? "",
            encrypted: String(encrypt),
            includeAttachments: String(isXmlFormat ? includeAttachments : false),
            compressionFormat: archiveExt ? archiveExt.slice(1) : "",
            passwordProtected: String(passwordProtect),
          });

          toast.success(
            `${exportCount} message(s) have been successfully exported to: ${rootPath.trim()}`
          );
        } else {
          setInfo("There are no messages to export.");
          return;
        }
      } else {
        // My Computer export — fetch messages and download.
        // Audit the export the same way the Server branch does: the Java MessageExportDialog
        // emits auditExportMessages/auditExportMessagesSuccess for BOTH local and server
        // destinations (the calls sit outside its isExportLocal() branch), so a local pull must
        // leave the same "Export all messages" / "Successfully exported messages" server events.
        // Omitting them here was a parity regression that let a PHI-bearing export to the user's
        // own machine go unrecorded.
        await auditExportMessages({});

        let allMessages: Message[] = [];
        let offset = 0;
        const limit = pageSize;

        // Fetch all matching messages page by page
        for (;;) {
          const page = await searchMessages(channelId, messageFilter, {
            offset,
            limit,
            includeContent: true,
          });
          if (page.length === 0) break;
          allMessages = allMessages.concat(page);
          offset += page.length;
          if (page.length < limit) break;
        }

        if (allMessages.length === 0) {
          setInfo("There are no messages to export.");
          return;
        }

        // Generate per-message content. XML-serialized format: fetch the server's XStream <message>
        // XML (re-importable), embedding attachments when requested. Other formats extract a single
        // content type from the already-fetched search results.
        const dirHandle = dirHandleRef.current;
        const generated: { filename: string; content: string }[] = [];
        for (let i = 0; i < allMessages.length; i++) {
          const content = isXmlFormat
            ? await buildSerializedMessageXml(allMessages[i].messageId, includeAttachments)
            : getMessageContent(allMessages[i], selectedFormat);
          if (!content) continue;
          generated.push({
            filename: substituteFilePattern(filePattern, allMessages[i], i),
            content,
          });
        }

        // If no matched message carries the selected content type (e.g. exporting a Response format
        // on a channel that never produced one), there is nothing to write. Bail before writing an
        // empty zip / firing a misleading success toast, mirroring Java's exportCount == 0 path. This
        // also keeps the success-audit guard below trivially consistent.
        if (generated.length === 0) {
          setInfo("There are no messages to export.");
          return;
        }

        async function writeLocalFile(name: string, data: string | Uint8Array) {
          if (dirHandle) {
            // Write directly to the user-selected directory via the File System Access API.
            // Bytes are wrapped in a Blob (a valid write chunk) to sidestep the ArrayBuffer vs
            // ArrayBufferLike mismatch on Uint8Array.
            const fileHandle = await dirHandle.getFileHandle(name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(typeof data === "string" ? data : new Blob([data as BlobPart]));
            await writable.close();
          } else {
            triggerDownload(data, name);
          }
        }

        if (compression === "zip") {
          // Bundle every message into a single .zip (mirrors the server-side archive export, which
          // the local path previously ignored). tar.gz/tar.bz2 and password protection are disabled
          // for local export, so zip is the only archive form reachable here.
          const zipBytes = await buildMessagesZip(
            Object.fromEntries(generated.map((g) => [g.filename, g.content]))
          );
          await writeLocalFile(`${channelId}_messages.zip`, zipBytes);
        } else {
          for (const g of generated) {
            await writeLocalFile(g.filename, g.content);
          }
        }

        // Audit success with the same attribute schema as the Server branch. exportCount is the
        // number of message files actually written (empty-content messages were skipped and the
        // all-empty case already returned above), i.e. the records that left the system. rootPath is
        // the chosen local folder name when the user picked one via Browse, otherwise empty (default
        // download folder).
        const archiveExt = getArchiveExtension(compression);
        await auditExportMessagesSuccess({
          rootPath: rootPath.trim(),
          filePattern: filePattern.trim(),
          exportCount: String(generated.length),
          contentType: selectedFormat.contentType ?? "",
          encrypted: String(encrypt),
          includeAttachments: String(isXmlFormat ? includeAttachments : false),
          compressionFormat: archiveExt ? archiveExt.slice(1) : "",
          passwordProtected: String(passwordProtect),
        });

        toast.success(`${generated.length} message(s) have been exported.`);
      }

      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export Results</DialogTitle>
          <DialogDescription>Export messages from channel: {channelName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 min-w-0">
          {/* Left panel — main form */}
          <div className={`flex-1 min-w-0 ${sectionSpacing} py-2`}>
            {/* Content type */}
            <Row label="Content:" gap={rowGap}>
              <Select value={String(formatIndex)} onValueChange={(v) => setFormatIndex(Number(v))}>
                <SelectTrigger density={viewDensity} className="grow basis-48 min-w-0 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">XML serialized message</SelectItem>
                  <SelectGroup>
                    <SelectLabel>Source</SelectLabel>
                    {EXPORT_FORMATS.slice(1, 6).map((f, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Destination</SelectLabel>
                    {EXPORT_FORMATS.slice(6).map((f, i) => (
                      <SelectItem key={i + 6} value={String(i + 6)}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormCheckbox label="Encrypt" checked={encrypt} onChange={setEncrypt} />
              <FormCheckbox
                label="Include Attachments"
                checked={includeAttachments}
                onChange={setIncludeAttachments}
                disabled={!isXmlFormat}
              />
            </Row>

            {/* Compression */}
            <Row label="Compression:" gap={rowGap}>
              <Select
                value={compression}
                onValueChange={(v) => setCompression(v as CompressionOption)}
              >
                <SelectTrigger density={viewDensity} className="w-36 min-w-0 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">none</SelectItem>
                  <SelectItem value="zip">zip</SelectItem>
                  {/* tar.gz/tar.bz2 require server-side archiving; not available for local export. */}
                  {!isLocal && <SelectItem value="tar.gz">tar.gz</SelectItem>}
                  {!isLocal && <SelectItem value="tar.bz2">tar.bz2</SelectItem>}
                </SelectContent>
              </Select>
            </Row>

            {/* Password Protect (ZIP only) */}
            <Row label="Password Protect:" gap={rowGap}>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="passwordProtect"
                  checked={passwordProtect}
                  onChange={() => setPasswordProtect(true)}
                  disabled={!isZip || isLocal}
                  className="accent-blue-600"
                />
                Yes
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="passwordProtect"
                  checked={!passwordProtect}
                  onChange={() => setPasswordProtect(false)}
                  disabled={!isZip || isLocal}
                  className="accent-blue-600"
                />
                No
              </label>
              <Select
                value={encryptionType}
                onValueChange={setEncryptionType}
                disabled={!passwordProtect}
              >
                <SelectTrigger density={viewDensity} className="w-28 min-w-0 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STANDARD">Standard</SelectItem>
                  <SelectItem value="AES128">AES-128</SelectItem>
                  <SelectItem value="AES256">AES-256</SelectItem>
                </SelectContent>
              </Select>
            </Row>

            {/* Password field */}
            <Row label="Password:" gap={rowGap}>
              <SecretInput
                density={viewDensity}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!passwordProtect}
                className={`w-48 min-w-0 text-sm ${passwordProtect && !password && error ? "border-red-500" : ""}`}
                placeholder={passwordProtect ? "Enter password…" : ""}
              />
            </Row>

            {/* Export To */}
            <Row label="Export To:" gap={rowGap}>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="exportTo"
                  checked={exportTo === "server"}
                  onChange={() => {
                    setExportTo("server");
                    setError("");
                  }}
                  className="accent-blue-600"
                />
                Server
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="exportTo"
                  checked={exportTo === "local"}
                  onChange={() => {
                    setExportTo("local");
                    setError("");
                  }}
                  className="accent-blue-600"
                />
                My Computer
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={exportTo === "server"}
                onClick={handleBrowseLocal}
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Browse…
              </Button>
            </Row>

            {/* Root Path */}
            <Row label="Root Path:" gap={rowGap}>
              <div className="flex items-center gap-1 grow basis-48 min-w-0">
                {exportTo === "server" ? (
                  <Input
                    density={viewDensity}
                    value={rootPath}
                    onChange={(e) => {
                      setRootPath(e.target.value);
                      setError("");
                    }}
                    placeholder="Enter path on the server…"
                    className={`flex-1 min-w-0 text-sm ${!rootPath.trim() && error ? "border-red-500" : ""}`}
                  />
                ) : (
                  <Input
                    density={viewDensity}
                    value={rootPath}
                    readOnly
                    placeholder="Use Browse to select a folder…"
                    className="flex-1 min-w-0 text-sm bg-gray-50 dark:bg-gray-800/50"
                  />
                )}
                {compression !== "none" && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    {getArchiveExtension(compression)}
                  </span>
                )}
              </div>
            </Row>

            {/* File Pattern */}
            <Row label="File Pattern:" gap={rowGap} align="start">
              <Textarea
                ref={filePatternRef}
                density={viewDensity}
                value={filePattern}
                onChange={(e) => {
                  setFilePattern(e.target.value);
                  setError("");
                }}
                rows={2}
                className={`grow basis-48 min-w-0 ${!filePattern.trim() && error ? "border-red-500" : ""}`}
              />
            </Row>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Informational notice (e.g. no messages to export) */}
            {info && (
              <div className="flex items-start gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {info}
              </div>
            )}
          </div>

          {/* Right sidebar — variable reference. Below `lg` it collapses under the form
              as a wrapping chip row: the fixed 12rem column plus the 8rem labels leaves
              the form nothing to live in on a narrow dialog. */}
          <div className="w-full lg:w-48 lg:shrink-0 border-t lg:border-t-0 lg:border-l border-border pt-3 pb-2 lg:pt-2 lg:pl-4">
            <div className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
              {FILE_PATTERN_VARIABLES.map((v) => (
                <button
                  key={v.variable}
                  type="button"
                  onClick={() => insertVariable(v.variable)}
                  className="lg:block w-auto lg:w-full text-left text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-2 py-1 rounded transition-colors"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
