"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import {
  DEFAULT_LOOKUP_GROUPS,
  type DefaultLookupGroupPayload,
} from "../_data/default-lookup-groups";

interface ImportGroupDialogProps {
  /** Called when the dialog requests closing without importing. */
  onClose: () => void;
  /**
   * Called when the user confirms a selection. The payload is the
   * `{ group, values }` shape consumed by the page's existing import flow
   * (overwrite confirmation + 2-step chunked import).
   */
  onImport: (payload: DefaultLookupGroupPayload, groupName: string) => void;
}

type Source = "system" | "file";

/**
 * Import dialog for lookup groups, mirroring the Java Swing client's
 * `ImportLookupGroupDialog`. Offers two sources:
 *
 *  - **System** — one of the bundled default groups (Race, Ethnicity, etc.),
 *    sourced from {@link DEFAULT_LOOKUP_GROUPS}.
 *  - **File** — a JSON file matching the Export Group output shape.
 *
 * Both paths resolve to a `{ group, values }` payload handed back via
 * `onImport`; the parent then runs the shared overwrite-confirm + import flow.
 */
export function ImportGroupDialog({ onClose, onImport }: ImportGroupDialogProps) {
  const { viewDensity } = useCompactMode();
  const selectH = densityHeight(viewDensity);

  const [source, setSource] = useState<Source>("system");
  const [selectedName, setSelectedName] = useState<string>(DEFAULT_LOOKUP_GROUPS[0]?.name ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [filePayload, setFilePayload] = useState<DefaultLookupGroupPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setFilePayload(null);
    setFileName(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const payload = parsed as { group?: unknown; values?: unknown };
      if (!payload?.group || typeof payload.group !== "object") {
        setError("Invalid import file: JSON must contain a 'group' object.");
        return;
      }
      setFilePayload(payload as DefaultLookupGroupPayload);
      setFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSubmit() {
    setError(null);
    if (source === "system") {
      const entry = DEFAULT_LOOKUP_GROUPS.find((g) => g.name === selectedName);
      if (!entry) {
        setError("Please select a default lookup group.");
        return;
      }
      onImport(entry.payload, entry.payload.group.name);
      return;
    }
    if (!filePayload) {
      setError("Please choose a JSON file to import.");
      return;
    }
    const name =
      typeof filePayload.group?.name === "string" ? filePayload.group.name : "this group";
    onImport(filePayload, name);
  }

  const labelCls = "block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1";
  const submitDisabled = source === "file" && !filePayload;

  return (
    <FormDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Import Default Lookup Group"
      onSubmit={handleSubmit}
      submitLabel="Import"
      submitDisabled={submitDisabled}
      error={error}
    >
      <div className="space-y-4">
        {/* Source selection */}
        <fieldset className="space-y-2">
          <legend className={labelCls}>Import lookup group from:</legend>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="import-source"
                value="system"
                checked={source === "system"}
                onChange={() => {
                  setSource("system");
                  setError(null);
                }}
              />
              System
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="import-source"
                value="file"
                checked={source === "file"}
                onChange={() => {
                  setSource("file");
                  setError(null);
                }}
              />
              File
            </label>
          </div>
        </fieldset>

        {source === "system" ? (
          <div>
            <label className={labelCls}>Default lookup group</label>
            <select
              className={`w-full ${selectH} rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`}
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
            >
              {DEFAULT_LOOKUP_GROUPS.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className={labelCls}>JSON file</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-input bg-background hover:bg-muted transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Choose File…
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {fileName ?? "No file selected"}
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          If a group with the same name already exists, its values will be permanently replaced.
        </p>
      </div>
    </FormDialog>
  );
}
