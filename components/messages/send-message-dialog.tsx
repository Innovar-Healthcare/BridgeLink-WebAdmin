"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import type { OnMount } from "@monaco-editor/react";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import dynamic from "next/dynamic";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogMaximizeButton,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileText, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDialogDragResize } from "@/lib/hooks/use-dialog-drag-resize";
import { useMonacoOverflowHost } from "@/lib/hooks/use-monaco-overflow-host";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { HoverTooltip } from "@/components/hover-tooltip";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { formatContent } from "@/lib/format-content";
import { dataTypeToLanguage } from "@/lib/value-format";
import { registerHl7v2Language, hl7v2Theme } from "@/lib/monaco-hl7v2";
import { useTheme } from "@/lib/hooks/use-theme";
import type { ConnectorInfo } from "@/components/messages/advanced-filter-panel";

// ─── Column definitions ──────────────────────────────────────────────────────

type DestCol = "destination" | "included";

const DEST_COLS: ColDef<DestCol>[] = [
  {
    key: "destination",
    label: "Destination",
    defaultWidth: 360,
    minWidth: 100,
    defaultVisible: true,
  },
  { key: "included", label: "Included", defaultWidth: 80, minWidth: 60, defaultVisible: true },
];

type SrcMapCol = "variable" | "value";

const SRC_MAP_COLS: ColDef<SrcMapCol>[] = [
  { key: "variable", label: "Variable", defaultWidth: 200, minWidth: 80, defaultVisible: true },
  { key: "value", label: "Value", defaultWidth: 240, minWidth: 80, defaultVisible: true },
];

interface SrcMapRowEntry extends SourceMapRow {
  _index: number;
}

const Editor = dynamic(() => import("@/components/monaco-editor").then((m) => m.MonacoEditor), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-xs text-gray-400 dark:text-gray-500">
      Loading editor…
    </div>
  ),
});

interface SourceMapRow {
  key: string;
  value: string;
}

/** Pre-population data for "Resend Message" — extracted from the original message. */
export interface SendMessageInitialData {
  content: string;
  /**
   * Which destination connectors to pre-check. An array pre-checks exactly those metaDataIds;
   * `null` pre-checks ALL destinations — mirroring Java's `selectedMetaDataIds == null` (the
   * source/whole-message resend gesture and fresh Send). See ItemSelectionTableModel.java:44.
   */
  destinationMetaDataIds: number[] | null;
  sourceMap: Record<string, string>;
  /**
   * Inbound dataType of the connector being resent — the server-serialized
   * DataType ID (e.g. "HL7V2", "XML"), not the display name. Drives the editor's
   * syntax highlighting via dataTypeToLanguage, mirroring the Java EditMessageDialog.
   */
  dataType?: string;
}

interface SendMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelName: string;
  /** Destination connectors for the current channel. Only metaDataId > 0 are shown. */
  connectors: ConnectorInfo[];
  /**
   * Dispatches the message(s). Fire-and-forget: the dialog closes as soon as this
   * is called (mirroring the Java EditMessageDialog, which invokes processMessage()
   * then dispose()). The parent runs the blocking processMessage request in the
   * background and reports success/failure via a toast, so the dialog never spins
   * for the server-side processing duration.
   */
  onSend: (
    contents: string[],
    destinationMetaDataIds: number[] | null,
    sourceMap: Record<string, string>
  ) => void;
  /** When provided, pre-populates the dialog with data from an existing message (Resend flow). */
  initialData?: SendMessageInitialData;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function genKey(existing: string[]): string {
  const set = new Set(existing);
  let i = 1;
  while (set.has(`key${i}`)) i++;
  return `key${i}`;
}

export function SendMessageDialog({
  open,
  onOpenChange,
  channelName,
  connectors,
  onSend,
  initialData,
}: SendMessageDialogProps) {
  const { isDark } = useTheme();
  const destColConfig = useColumnConfig(DEST_COLS, "bl-send-msg-dest-cols-v1");
  const destSortState = useSortable<DestCol>("destination", "asc");
  const srcMapColConfig = useColumnConfig(SRC_MAP_COLS, "bl-send-msg-srcmap-cols-v1");
  const srcMapSortState = useSortable<SrcMapCol>("variable", "asc");
  const { contentProps, handleProps, maximize } = useDialogDragResize({
    open,
    defaultWidth: 720,
    defaultHeight: 660,
    minHeight: 400,
  });
  // Host Monaco's overflow widgets (incl. the right-click context menu's shadow
  // root) inside this modal dialog — on the default document.body host, Radix's
  // modal scope pointer-events:none's the menu and yanks focus off the editor, so
  // Copy/Cut/Paste from the menu closed the dialog and broke typing.
  const { overflowHost, hostRef } = useMonacoOverflowHost();

  // Message content — array supports multiple files
  const [contents, setContents] = useState<string[]>([""]);
  const [isMultiple, setIsMultiple] = useState(false);

  // Editor options
  const [wordWrap, setWordWrap] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("bl-send-message-wordwrap") !== "false";
  });

  // Destinations — map of metaDataId -> included (default: all included)
  const [destIncluded, setDestIncluded] = useState<Record<number, boolean>>({});

  // Source map variables
  const [sourceMapRows, setSourceMapRows] = useState<SourceMapRow[]>([]);
  const [selectedSourceRow, setSelectedSourceRow] = useState<number | null>(null);

  // Surfaces local file-read failures (the send itself is fire-and-forget and
  // reports its outcome via a toast from the parent handler).
  const [error, setError] = useState("");

  const textFileRef = useRef<HTMLInputElement>(null);
  const binaryFileRef = useRef<HTMLInputElement>(null);

  // Reset (or pre-populate) state each time the dialog transitions to open. Done
  // during render (the React "adjusting state when a prop changes" idiom) rather
  // than in an effect, which avoids the cascading-render warning from
  // react-hooks/set-state-in-effect. Like the original effect, this only re-runs
  // on the open transition, so it reads the current initialData/connectors props.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      if (initialData) {
        setContents([initialData.content]);
        setIsMultiple(false);
        // Pre-select destinations, mirroring Java's ItemSelectionTableModel: a null
        // destinationMetaDataIds pre-checks ALL destinations (source/whole-message resend and
        // fresh Send); an array pre-checks exactly those ids and excludes the rest.
        const destIds = initialData.destinationMetaDataIds;
        const destSet = destIds === null ? null : new Set(destIds);
        const included: Record<number, boolean> = {};
        connectors
          .filter((c) => c.metaDataId > 0)
          .forEach((c) => {
            included[c.metaDataId] = destSet === null || destSet.has(c.metaDataId);
          });
        setDestIncluded(included);
        setSourceMapRows(
          Object.entries(initialData.sourceMap).map(([key, value]) => ({ key, value }))
        );
      } else {
        setContents([""]);
        setIsMultiple(false);
        setDestIncluded({});
        setSourceMapRows([]);
      }
      setSelectedSourceRow(null);
      setError("");
    }
  }

  // Only show destination connectors (metaDataId > 0 = destinations; 0 = source)
  const destConnectors = connectors.filter((c) => c.metaDataId > 0);

  const sortedDestConnectors = destSortState.sorted(destConnectors, (c) => {
    switch (destSortState.sort.key) {
      case "destination":
        return c.metaDataId;
      case "included":
        return isIncluded(c.metaDataId) ? 1 : 0;
      default:
        return undefined;
    }
  });

  function isIncluded(metaDataId: number): boolean {
    return destIncluded[metaDataId] !== false;
  }

  function toggleDest(metaDataId: number) {
    setDestIncluded((prev) => ({ ...prev, [metaDataId]: !isIncluded(metaDataId) }));
  }

  function handleTextFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            reader.readAsText(file);
          })
      )
    )
      .then((texts) => {
        setContents(texts);
        setIsMultiple(texts.length > 1);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to read file"));

    e.target.value = "";
  }

  function handleBinaryFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(arrayBufferToBase64(reader.result as ArrayBuffer));
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            reader.readAsArrayBuffer(file);
          })
      )
    )
      .then((b64s) => {
        setContents(b64s);
        setIsMultiple(b64s.length > 1);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to read file"));

    e.target.value = "";
  }

  // Focus the editor as soon as it mounts so Radix Dialog's FocusScope doesn't
  // steal focus away from Monaco before the user starts typing. (The context
  // menu's working Paste comes from the MonacoEditor wrapper —/1333.)
  const handleEditorMount = useCallback<OnMount>((editor) => {
    editor.focus();
  }, []);

  function handleWordWrapChange(checked: boolean) {
    setWordWrap(checked);
    localStorage.setItem("bl-send-message-wordwrap", String(checked));
  }

  function handleFormat() {
    if (isMultiple) return;
    const formatted = formatContent(contents[0] ?? "", true);
    setContents([formatted]);
  }

  function addSourceMapRow() {
    const existingKeys = sourceMapRows.map((r) => r.key);
    const newKey = genKey(existingKeys);
    setSourceMapRows((prev) => [...prev, { key: newKey, value: "" }]);
    setSelectedSourceRow(sourceMapRows.length);
  }

  function deleteSourceMapRow() {
    if (selectedSourceRow === null) return;
    const nextRows = sourceMapRows.filter((_, i) => i !== selectedSourceRow);
    setSourceMapRows(nextRows);
    setSelectedSourceRow(
      nextRows.length === 0 ? null : Math.min(selectedSourceRow, nextRows.length - 1)
    );
  }

  function updateSourceMapRow(idx: number, field: "key" | "value", val: string) {
    setSourceMapRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }

  function handleSend() {
    const singleContent = contents[0] ?? "";
    if (!isMultiple && !singleContent.trim()) return;

    // Determine destination IDs — null means send to all
    const allDestIds = destConnectors.map((c) => c.metaDataId);
    const selectedIds = allDestIds.filter((id) => isIncluded(id));
    const destIds =
      selectedIds.length === allDestIds.length || allDestIds.length === 0 ? null : selectedIds;

    // Build source map (skip blank keys)
    const sourceMap: Record<string, string> = {};
    for (const row of sourceMapRows) {
      if (row.key.trim()) sourceMap[row.key.trim()] = row.value;
    }

    // Fire-and-forget, mirroring the Java EditMessageDialog (processMessage() then
    // dispose()): dispatch and close immediately. The parent handler runs the
    // blocking processMessage request in the background and toasts the outcome.
    onSend(contents, destIds, sourceMap);
    onOpenChange(false);
  }

  const singleContent = contents[0] ?? "";
  const canSend = isMultiple ? true : singleContent.trim().length > 0;

  // Syntax highlighting for the resend editor follows the original connector's
  // inbound dataType (mirrors Java EditMessageDialog's TokenMarker install).
  // No dataType (fresh send) or an unmapped type falls back to plaintext.
  const editorLanguage = useMemo(
    () => dataTypeToLanguage(initialData?.dataType),
    [initialData?.dataType]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...contentProps}
        className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <DialogHeader {...handleProps}>
          <DialogTitle>Send Message</DialogTitle>
          <DialogDescription>
            Process a new message through <strong>{channelName}</strong>.
          </DialogDescription>
        </DialogHeader>
        {maximize.available ? (
          <DialogMaximizeButton maximized={maximize.isMaximized} onToggle={maximize.toggle} />
        ) : null}

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Message Content */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Message Content
            </Label>
            <ResizableEditorBox
              className={cn(
                "rounded-md border border-border overflow-hidden",
                isMultiple && "bg-gray-50 dark:bg-gray-900"
              )}
              height={200}
            >
              {isMultiple ? (
                <div className="flex items-center justify-center h-full text-xs text-gray-400 dark:text-gray-500 italic">
                  Multiple Messages Selected ({contents.length} files)
                </div>
              ) : (
                // Radix Dialog wraps content in a FocusScope that intercepts keydown
                // events at the document level. Stopping propagation here keeps those
                // events inside Monaco where they belong.
                <div className="h-full" onKeyDown={(e) => e.stopPropagation()}>
                  <Editor
                    height="100%"
                    language={editorLanguage}
                    theme={
                      editorLanguage === "hl7v2" ? hl7v2Theme(isDark) : isDark ? "vs-dark" : "vs"
                    }
                    beforeMount={registerHl7v2Language}
                    value={singleContent}
                    onChange={(v) => setContents([v ?? ""])}
                    onMount={handleEditorMount}
                    options={{
                      ...MONACO_BASE_OPTIONS,
                      // In-dialog widgets host so the right-click context menu and
                      // popups like the find widget aren't suppressed by Radix's
                      // modal scope (see useMonacoOverflowHost /. The
                      // menu's working Paste comes from the MonacoEditor wrapper.
                      ...(overflowHost && { overflowWidgetsDomNode: overflowHost }),
                      fontSize: 12,
                      lineNumbers: "off",
                      wordWrap: wordWrap ? "on" : "off",
                      renderLineHighlight: "none",
                      overviewRulerLanes: 0,
                      hideCursorInOverviewRuler: true,
                      overviewRulerBorder: false,
                      quickSuggestions: false,
                      suggestOnTriggerCharacters: false,
                      parameterHints: { enabled: false },
                      wordBasedSuggestions: "off",
                    }}
                  />
                  {/* Keeps the widgets host inside both the dialog subtree (so
                      Radix's modal scope doesn't suppress it) and this keydown
                      wrapper (so menu keystrokes don't leak to the FocusScope). */}
                  <div ref={hostRef} />
                </div>
              )}
            </ResizableEditorBox>
            <div className="flex items-center gap-2">
              <input
                ref={textFileRef}
                type="file"
                multiple
                className="hidden"
                data-testid="send-message-text-file"
                onChange={handleTextFile}
              />
              <input
                ref={binaryFileRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleBinaryFile}
              />
              <HoverTooltip content="Open a text file into the editor above.">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => textFileRef.current?.click()}
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  Open Text File...
                </Button>
              </HoverTooltip>
              <HoverTooltip content="Open a binary file into the editor above. The file will be encoded and displayed as Base64.">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => binaryFileRef.current?.click()}
                >
                  <File className="w-3.5 h-3.5 mr-1.5" />
                  Open Binary File...
                </Button>
              </HoverTooltip>
              <div className="ml-auto flex items-center gap-3">
                <FormCheckbox
                  label="Wrap"
                  checked={wordWrap}
                  onChange={handleWordWrapChange}
                  size="xs"
                />
                <button
                  type="button"
                  onClick={handleFormat}
                  disabled={isMultiple || !singleContent.trim()}
                  className="px-2 py-1 text-xs rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Format
                </button>
              </div>
            </div>
          </div>

          {/* Destinations Table */}
          {destConnectors.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Send to the following destination(s):
              </Label>
              <DataTable<ConnectorInfo, DestCol>
                variant="sortable"
                cols={DEST_COLS}
                rows={sortedDestConnectors}
                colConfig={destColConfig}
                sortState={destSortState}
                rowKey={(c) => c.metaDataId}
                onRowClick={(c) => toggleDest(c.metaDataId)}
                cellAlign={{ included: "center" }}
                empty="No destinations."
                renderCell={(conn, col) => {
                  if (col === "destination") return conn.name;
                  return (
                    <input
                      type="checkbox"
                      checked={isIncluded(conn.metaDataId)}
                      onChange={() => toggleDest(conn.metaDataId)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-border text-blue-600 cursor-pointer"
                    />
                  );
                }}
              />
            </div>
          )}

          {/* Source Map Variables */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Include the following source map variables:
            </Label>
            <div className="flex gap-2">
              <div className="flex-1 min-h-[80px]">
                <DataTable<SrcMapRowEntry, SrcMapCol>
                  variant="sortable"
                  cols={SRC_MAP_COLS}
                  rows={srcMapSortState.sorted(
                    sourceMapRows.map((r, i) => ({ ...r, _index: i })),
                    (r) => {
                      switch (srcMapSortState.sort.key) {
                        case "variable":
                          return r.key;
                        case "value":
                          return r.value;
                        default:
                          return undefined;
                      }
                    }
                  )}
                  colConfig={srcMapColConfig}
                  sortState={srcMapSortState}
                  rowKey={(r) => r._index}
                  selectedRowId={selectedSourceRow}
                  onRowClick={(r) => setSelectedSourceRow(r._index)}
                  empty="No variables"
                  renderCell={(row, col) => {
                    if (col === "variable") {
                      return (
                        <input
                          type="text"
                          value={row.key}
                          onChange={(e) => updateSourceMapRow(row._index, "key", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full px-2 py-1 text-xs bg-transparent border-0 outline-none focus:bg-white dark:focus:bg-gray-700 rounded text-gray-800 dark:text-gray-200"
                        />
                      );
                    }
                    return (
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) => updateSourceMapRow(row._index, "value", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full px-2 py-1 text-xs bg-transparent border-0 outline-none focus:bg-white dark:focus:bg-gray-700 rounded text-gray-800 dark:text-gray-200"
                      />
                    );
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 w-16"
                  onClick={addSourceMapRow}
                >
                  New
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 w-16"
                  onClick={deleteSourceMapRow}
                  disabled={selectedSourceRow === null}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter className="pt-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <HoverTooltip content="Process the message displayed in the editor above.">
            <Button size="sm" onClick={handleSend} disabled={!canSend}>
              Process Message
            </Button>
          </HoverTooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
