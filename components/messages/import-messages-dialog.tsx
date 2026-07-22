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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, Upload } from "lucide-react";
import { toast } from "sonner";
import { importMessagesFromPath, importMessage } from "@/lib/api-client";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { HoverTooltip } from "@/components/hover-tooltip";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

/** Field hover tooltips ported from Java MessageImportDialog. */
const TIP = {
  importFromServer: "Import messages from a file, folder or archive on the BridgeLink Server.",
  importFromLocal: "Import messages from a file, folder or archive on this computer.",
  filePath:
    "A file containing message(s) in XML format, or a folder/archive containing files with message(s) in XML format.",
  includeSubfolders:
    "If checked, sub-folders of the folder/archive shown above will be searched for messages to import.",
} as const;

/**
 * Matches a `<message>` or `<message …>` opening tag (but not siblings like `<messageId>`).
 * Mirrors the `<message>` scan Java's MessageImporter runs on each archive file; used to skip
 * non-message ZIP entries such as macOS AppleDouble forks and `.DS_Store`.
 */
const MESSAGE_OPEN_ELEMENT = /<message[\s>]/;

interface ImportMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  channelName: string;
  /** Called after a successful import to refresh the message list. */
  onImported: () => void;
}

/**
 * Import Messages dialog — mirrors Java's MessageImportDialog.
 *
 * Supports two import sources:
 *   - Server: sends a file path to the server (POST /_importFromPath)
 *   - My Computer: uploads XML files client-side and POSTs each message (POST /_import)
 */
export function ImportMessagesDialog({
  open,
  onOpenChange,
  channelId,
  channelName,
  onImported,
}: ImportMessagesDialogProps) {
  const { viewDensity } = useCompactMode();
  const [importFrom, setImportFrom] = useState<"server" | "local">("server");
  const [filePath, setFilePath] = useState("");
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset form state each time the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an effect,
  // which avoids the cascading-render warning from react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setImportFrom("server");
      setFilePath("");
      setIncludeSubfolders(true);
      setLoading(false);
      setError("");
      setSelectedFiles([]);
    }
  }

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    setSelectedFiles(fileList);
    // Show file names in the path field
    if (fileList.length === 1) {
      setFilePath(fileList[0].name);
    } else {
      setFilePath(`${fileList.length} files selected`);
    }
    setError("");
  }, []);

  /**
   * Extract individual top-level <message>…</message> blocks from XML content.
   *
   * A file may hold one message, or several concatenated top-level message documents.
   * Splitting is done by tracking <message> nesting depth and slicing only at depth-0
   * boundaries — a message's own content can contain literal <message> elements (e.g. a
   * <response> persisted in responseMapContent), and a naive non-greedy regex would break
   * the document at the first nested </message>, producing invalid fragments that the
   * server rejects with a 500.
   */
  function extractMessageXml(content: string): string[] {
    const messages: string[] = [];
    // Tokenize opening (<message …> / <message …/>) and closing (</message>) tags. The \b
    // after "message" keeps us from matching sibling tags like <messageId>.
    const tagRe = /<message\b[^>]*?(\/?)>|<\/message\s*>/gi;
    let depth = 0;
    let start = -1;
    let match: RegExpExecArray | null;
    while ((match = tagRe.exec(content)) !== null) {
      const isClose = match[0].startsWith("</");
      if (isClose) {
        if (depth > 0 && --depth === 0 && start >= 0) {
          messages.push(content.slice(start, tagRe.lastIndex).trim());
          start = -1;
        }
        continue;
      }
      if (match[1] === "/") {
        // Self-closing <message/> — a complete (empty) message only at the top level.
        if (depth === 0) messages.push(match[0]);
        continue;
      }
      if (depth === 0) start = match.index;
      depth++;
    }
    // A payload with no top-level <message> block contributes nothing. This mirrors Java's
    // MessageImporter, which scans every file and only imports those containing <message> — so a
    // mistakenly-selected non-message file yields "No messages were found to import" rather than
    // being POSTed verbatim and rejected by the server with a 500.
    return messages;
  }

  /**
   * Read a selected file into one or more text payloads.
   *
   * Plain XML/text files yield a single payload. ZIP archives are unzipped in-browser (fflate,
   * loaded on demand to match the export dialogs) and each non-directory entry becomes a payload —
   * mirroring Java's MessageImporter archive support. Each payload is then split into individual
   * <message> blocks by the caller.
   *
   * ZIP entries are filtered to those whose content contains the `<message>` open element, exactly
   * as Java's MessageImporter.importVfsFile scans each file before importing it. This skips archive
   * cruft that carries no messages — most notably the `__MACOSX/._*` AppleDouble resource forks and
   * `.DS_Store` files that macOS's native "Compress" adds. An extension filter alone would not catch
   * these (the AppleDouble files are named `._foo.xml`, so they still end in `.xml`); the content
   * scan is both more faithful to Java and more robust.
   */
  async function readFileContents(file: File): Promise<string[]> {
    const isZip =
      file.name.toLowerCase().endsWith(".zip") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

    if (!isZip) return [await file.text()];

    const { unzip, strFromU8 } = await import("fflate");
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Decompress off the main thread (fflate spins up a Web Worker, allowed by the
    // CSP's worker-src 'self' blob:) so large archives don't freeze the UI.
    const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      unzip(bytes, (err, unzipped) => (err ? reject(err) : resolve(unzipped)));
    });
    // Skip directory entries (names ending in "/"); decode each remaining entry as UTF-8 text and
    // keep only those that actually contain a <message> element (mirrors Java's per-file scan, and
    // discards macOS __MACOSX/._* AppleDouble forks and .DS_Store without mis-importing them).
    return Object.entries(entries)
      .filter(([name]) => !name.endsWith("/"))
      .map(([, content]) => strFromU8(content))
      .filter((text) => MESSAGE_OPEN_ELEMENT.test(text));
  }

  async function handleImport() {
    setError("");

    // Validate
    if (importFrom === "server" && !filePath.trim()) {
      setError("Please enter a file path.");
      return;
    }
    if (importFrom === "local" && selectedFiles.length === 0) {
      setError("Please select one or more files.");
      return;
    }

    setLoading(true);
    try {
      if (importFrom === "server") {
        // Server-side import
        const result = await importMessagesFromPath(channelId, filePath.trim(), includeSubfolders);
        if (result.successCount === 0 && result.totalCount === 0) {
          toast.info("No messages were found to import.");
        } else {
          toast.success(
            `${result.successCount} out of ${result.totalCount} message(s) have been successfully imported from ${filePath.trim()}.`
          );
        }
      } else {
        // Client-side import — read files (unzip archives), extract messages, POST each.
        let totalCount = 0;
        let successCount = 0;
        const failures: string[] = [];

        for (const file of selectedFiles) {
          let payloads: string[];
          try {
            payloads = await readFileContents(file);
          } catch (err) {
            failures.push(`${file.name}: ${err instanceof Error ? err.message : "could not read"}`);
            continue;
          }

          for (const payload of payloads) {
            const messageBlocks = extractMessageXml(payload);
            totalCount += messageBlocks.length;

            for (const msgXml of messageBlocks) {
              try {
                await importMessage(channelId, msgXml);
                successCount++;
              } catch (err) {
                // Don't stop the batch — record the reason so it isn't silently swallowed.
                failures.push(err instanceof Error ? err.message : "import failed");
              }
            }
          }
        }

        if (successCount > 0) {
          toast.success(
            `${successCount} out of ${totalCount} message(s) have been successfully imported.`
          );
        }
        if (failures.length > 0) {
          // Surface per-message failures instead of swallowing them; keep the dialog open.
          setError(`${failures.length} message(s) failed to import. First error: ${failures[0]}`);
        } else if (totalCount === 0) {
          toast.info("No messages were found to import.");
        }

        onImported();
        // Only auto-close when everything succeeded, so failures stay visible.
        if (failures.length === 0) onOpenChange(false);
        return;
      }

      onImported();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Messages</DialogTitle>
          <DialogDescription>Import messages into channel: {channelName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Import From */}
          <div className="flex items-center gap-4">
            <Label className="w-28 text-right text-sm font-medium shrink-0">Import From:</Label>
            <div className="flex items-center gap-4">
              <HoverTooltip content={TIP.importFromServer}>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="importFrom"
                    checked={importFrom === "server"}
                    onChange={() => {
                      setImportFrom("server");
                      setFilePath("");
                      setSelectedFiles([]);
                      setError("");
                    }}
                    className="accent-blue-600"
                  />
                  Server
                </label>
              </HoverTooltip>
              <HoverTooltip content={TIP.importFromLocal}>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="importFrom"
                    checked={importFrom === "local"}
                    onChange={() => {
                      setImportFrom("local");
                      setFilePath("");
                      setSelectedFiles([]);
                      setError("");
                    }}
                    className="accent-blue-600"
                  />
                  My Computer
                </label>
              </HoverTooltip>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBrowse}
                disabled={importFrom === "server"}
              >
                <Upload className="w-3.5 h-3.5 mr-1" />
                Browse…
              </Button>
              {/* Hidden file input for My Computer mode */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xml,.zip"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </div>

          {/* File/Folder/Archive path */}
          <div className="flex items-center gap-4">
            <Label className="w-28 text-right text-sm font-medium shrink-0">
              {importFrom === "server" ? "File/Folder/Archive:" : "File/Folder/Archive:"}
            </Label>
            <HoverTooltip content={TIP.filePath}>
              <Input
                value={filePath}
                onChange={(e) => {
                  setFilePath(e.target.value);
                  setError("");
                }}
                placeholder={
                  importFrom === "server"
                    ? "Enter path on the server…"
                    : "Select files using Browse…"
                }
                readOnly={importFrom === "local"}
                density={viewDensity}
                className={`flex-1 text-sm ${!filePath.trim() && error ? "border-red-500" : ""}`}
              />
            </HoverTooltip>
          </div>

          {/* Include Sub-folders — only the server importer walks folders/archives recursively;
              the local path imports the selected files directly, so the toggle would be inert. */}
          {importFrom === "server" && (
            <div className="flex items-center gap-4">
              <div className="w-28 shrink-0" />
              <FormCheckbox
                label="Include Sub-folders"
                checked={includeSubfolders}
                onChange={setIncludeSubfolders}
                tooltip={TIP.includeSubfolders}
              />
            </div>
          )}

          {/* Note */}
          <div className="flex items-center gap-4">
            <div className="w-28 shrink-0" />
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              Note: RECEIVED, QUEUED, or PENDING messages will be set to ERROR upon import.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
