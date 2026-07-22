"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FileCode2 } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import {
  getCodeTemplateLibraries,
  getCodeTemplates,
  bulkUpdateCodeTemplates,
  invalidateCodeTemplateCache,
} from "@/lib/api-client";
import { setPendingChannelImport } from "@/lib/channel-import-store";
import { generateUUID } from "@/lib/utils";
import { ImportCodeTemplateDialog } from "@/app/(app)/code-templates/_dialogs/import-code-template-dialog";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import {
  type ParsedChannel,
  type ParsedLibraryData,
  parseImportXml,
  updateLibraryChannelIds,
  parseLibrariesFromChannelXml,
  patchXmlElement,
} from "@/app/(app)/channels/_lib/channel-import-xml";
import { applyImportedChannelDependencies } from "@/app/(app)/channels/_lib/apply-imported-dependencies";
import { loadAdminPrefs } from "@/components/settings/admin-tab";

type Step =
  | "file-select"
  | "conflict"
  | "rename"
  | "libraries-prompt"
  | "libraries-review"
  | "libraries-loading";

export function ImportChannelDialog({
  open,
  onClose,
  existingNames,
  existingChannels,
}: {
  open: boolean;
  onClose: () => void;
  /** Lowercase channel names for conflict detection. */
  existingNames: Set<string>;
  /** Lowercase channel name → { id, revision } for overwrite support. */
  existingChannels: Map<string, { id: string; revision: number }>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("file-select");
  const [file, setFile] = useState<File | null>(null);
  const [rawXml, setRawXml] = useState("");
  const [parsed, setParsed] = useState<ParsedChannel | null>(null);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Tracks whether handleLibrariesImported is running — prevents the
  // ImportCodeTemplateDialog's onClose (called after onImported) from
  // resetting the step while the async save is in progress.
  const libImportActiveRef = useRef(false);

  // Code template library import state
  const [parsedLibData, setParsedLibData] = useState<ParsedLibraryData | null>(null);
  const [serverLibraries, setServerLibraries] = useState<CodeTemplateLibrary[]>([]);
  const [serverTemplates, setServerTemplates] = useState<Map<string, CodeTemplate>>(new Map());

  // Reset state each time the dialog transitions to closed. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an effect,
  // which avoids the cascading-render warning from react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setStep("file-select");
      setFile(null);
      setRawXml("");
      setParsed(null);
      setNewName("");
      setError(null);
      setOverwrite(false);
      setParsedLibData(null);
      setServerLibraries([]);
      setServerTemplates(new Map());
    }
  }

  // Ref reset stays in an effect (not the render-time guard above) per react-hooks/refs.
  useEffect(() => {
    if (!open) libImportActiveRef.current = false;
  }, [open]);

  // Focus name input when entering rename step
  useEffect(() => {
    if (step === "rename") {
      setTimeout(() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      }, 50);
    }
  }, [step]);

  /** Parse XML after file is read and determine next step. */
  async function handleFileSelected() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const xml = await file.text();
      const result = parseImportXml(xml);
      if (!result) {
        setError("Invalid channel XML file. Could not parse channel id or name.");
        return;
      }
      setRawXml(xml);
      setParsed(result);
      // Parse code template libraries from the channel XML
      const libData = parseLibrariesFromChannelXml(xml);
      setParsedLibData(libData);
      // Check for name conflict
      if (existingNames.has(result.name.toLowerCase())) {
        setStep("conflict");
      } else {
        advanceAfterConflict(xml, result, false, libData);
      }
    } catch {
      setError("Failed to read file.");
    } finally {
      setLoading(false);
    }
  }

  /** After conflict resolution, check for libraries or execute. */
  function advanceAfterConflict(
    xml: string,
    channel: ParsedChannel,
    isOverwrite: boolean,
    libData?: ParsedLibraryData | null
  ) {
    setOverwrite(isOverwrite);
    let effectiveLibData = libData !== undefined ? libData : parsedLibData;
    if (!isOverwrite) {
      const existingIds = new Set(Array.from(existingChannels.values()).map((c) => c.id));
      if (existingIds.has(channel.id)) {
        const newId = generateUUID();
        xml = patchXmlElement(xml, "id", newId);
        setRawXml(xml);
        setParsed({ ...channel, id: newId });
        // Update library channel associations when channel ID changes
        if (effectiveLibData) {
          effectiveLibData = updateLibraryChannelIds(effectiveLibData, channel.originalId, newId);
          setParsedLibData(effectiveLibData);
        }
      }
    }
    if (effectiveLibData && effectiveLibData.libraries.length > 0) {
      const libPref = loadAdminPrefs().importChannelCodeTemplateLibraries;
      if (libPref === "yes") {
        handleImportLibrariesWithData(xml, channel, isOverwrite, effectiveLibData);
      } else if (libPref === "no") {
        void reviewImport(xml, channel, isOverwrite);
      } else {
        setStep("libraries-prompt");
      }
    } else {
      void reviewImport(xml, channel, isOverwrite);
    }
  }

  /** Handle the overwrite path from the conflict step. */
  function handleOverwrite() {
    if (!parsed || !rawXml) return;
    const existing = existingChannels.get(parsed.name.toLowerCase());
    if (!existing) return;
    let xml = patchXmlElement(rawXml, "id", existing.id);
    xml = patchXmlElement(xml, "revision", String(existing.revision));
    setRawXml(xml);
    const updated = { ...parsed, id: existing.id, revision: existing.revision };
    setParsed(updated);
    // Update library channel associations when channel ID changes
    if (parsedLibData && parsed.originalId !== existing.id) {
      const updatedLibData = updateLibraryChannelIds(parsedLibData, parsed.originalId, existing.id);
      setParsedLibData(updatedLibData);
      advanceAfterConflict(xml, updated, true, updatedLibData);
    } else {
      advanceAfterConflict(xml, updated, true);
    }
  }

  /** Handle the "Create New" path — go to rename step. */
  function handleCreateNew() {
    if (!parsed) return;
    setNewName(parsed.name);
    setStep("rename");
  }

  /** Handle rename submission. */
  function handleRenameSubmit() {
    if (!parsed || !rawXml) return;
    const trimmed = newName.trim();
    if (!trimmed || existingNames.has(trimmed.toLowerCase())) return;
    const newId = generateUUID();
    let xml = patchXmlElement(rawXml, "name", trimmed);
    xml = patchXmlElement(xml, "id", newId);
    xml = patchXmlElement(xml, "revision", "0");
    setRawXml(xml);
    const updated = { ...parsed, name: trimmed, id: newId, revision: 0 };
    setParsed(updated);
    // Update library channel associations when channel ID changes
    let effectiveLibData = parsedLibData;
    if (effectiveLibData) {
      effectiveLibData = updateLibraryChannelIds(effectiveLibData, parsed.originalId, newId);
      setParsedLibData(effectiveLibData);
    }
    if (effectiveLibData && effectiveLibData.libraries.length > 0) {
      const libPref = loadAdminPrefs().importChannelCodeTemplateLibraries;
      if (libPref === "yes") {
        handleImportLibrariesWithData(xml, updated, false, effectiveLibData);
      } else if (libPref === "no") {
        void reviewImport(xml, updated, false);
      } else {
        setStep("libraries-prompt");
      }
    } else {
      void reviewImport(xml, updated, false);
    }
  }

  /** User chose "Yes" to import libraries — fetch server state and open review dialog. */
  async function handleImportLibraries() {
    setStep("libraries-loading");
    setError(null);
    try {
      const [libs, tmplArr] = await Promise.all([getCodeTemplateLibraries(), getCodeTemplates()]);
      setServerLibraries(libs);
      setServerTemplates(new Map(tmplArr.map((t) => [t.id, t])));
      setStep("libraries-review");
    } catch (e) {
      setError(
        "Failed to fetch code template data: " + (e instanceof Error ? e.message : String(e))
      );
      setStep("libraries-prompt");
    }
  }

  /**
   * Auto-import path (pref = "yes"): fetch server state and jump straight to the
   * review dialog without showing the prompt step.
   */
  async function handleImportLibrariesWithData(
    xml: string,
    channel: ParsedChannel,
    isOverwrite: boolean,
    libData: ParsedLibraryData
  ) {
    setRawXml(xml);
    setParsed(channel);
    setOverwrite(isOverwrite);
    setParsedLibData(libData);
    setStep("libraries-loading");
    setError(null);
    try {
      const [libs, tmplArr] = await Promise.all([getCodeTemplateLibraries(), getCodeTemplates()]);
      setServerLibraries(libs);
      setServerTemplates(new Map(tmplArr.map((t) => [t.id, t])));
      setStep("libraries-review");
    } catch (e) {
      setError(
        "Failed to fetch code template data: " + (e instanceof Error ? e.message : String(e))
      );
      setStep("libraries-prompt");
    }
  }

  /** Code template import dialog completed — save libraries and continue with channel import. */
  async function handleLibrariesImported(result: {
    libraries: CodeTemplateLibrary[];
    templates: CodeTemplate[];
  }) {
    libImportActiveRef.current = true;
    setStep("libraries-loading");
    setError(null);
    try {
      const channelId = parsed!.id;

      // Ensure the importing channel's ID is in each result library's
      // enabledChannelIds so the library→channel association is preserved.
      // resolveImportResult may have replaced enabledChannelIds with the
      // server's copy during overwrite, losing the imported channel's ID.
      const resultLibraries = Array.isArray(result.libraries)
        ? result.libraries
        : [result.libraries as CodeTemplateLibrary];
      const patchedLibraries = resultLibraries.map((lib) => {
        const enabled = lib.enabledChannelIds ?? [];
        if (enabled.includes(channelId)) return lib;
        return { ...lib, enabledChannelIds: [...enabled, channelId] };
      });

      // Merge imported libraries with existing server state
      const mergedLibs = new Map<string, CodeTemplateLibrary>();
      for (const lib of serverLibraries) mergedLibs.set(lib.id, lib);
      for (const lib of patchedLibraries) mergedLibs.set(lib.id, lib);

      // Force-overwrite: additive import merge, not the interactive panel save
      // (the panel save prompts on revision conflict —.
      await bulkUpdateCodeTemplates(
        {
          libraries: Array.from(mergedLibs.values()),
          removedLibraryIds: [],
          updatedCodeTemplates: result.templates,
          removedCodeTemplateIds: [],
        },
        true
      );
      invalidateCodeTemplateCache();

      // Continue with channel import
      await reviewImport(rawXml, parsed!, overwrite);
    } catch (e) {
      setError(
        "Failed to save code template libraries: " + (e instanceof Error ? e.message : String(e))
      );
      setStep("libraries-prompt");
    }
  }

  /**
   * Queue the imported channel for review in the editor instead of saving it
   * immediately. The editor opens dirty; the user reviews and then
   * saves. New/renamed channels open the New Channel editor (Save → POST);
   * overwrites open the existing channel's editor (Save → PUT override).
   */
  async function reviewImport(xml: string, channel: ParsedChannel, isOverwrite: boolean) {
    // Persist the channel's dependency relationships now, mirroring the Java client's
    // ChannelPanel.importChannel (bridgelink-core ChannelPanel.java:1566-1592): Java writes
    // dependencies at import time, before and independent of the channel save. The WebUI
    // defers the channel save to the editor, and the server does NOT apply
    // exportData dependencies on save, so if we don't write them here they are lost.
    // The referenced channels already exist on the target under their original ids → identity remap.
    setLoading(true);
    try {
      await applyImportedChannelDependencies([{ xml, finalId: channel.id }]);
    } catch (e) {
      // Java alerts on failure but still opens the editor — mirror that (non-blocking).
      toast.error(
        "Unable to save channel dependencies: " + (e instanceof Error ? e.message : String(e))
      );
    } finally {
      setLoading(false);
    }

    if (isOverwrite) {
      setPendingChannelImport({ xml, mode: "overwrite", channelId: channel.id });
      router.push(`/channels/${encodeURIComponent(channel.id)}/edit`);
    } else {
      const finalXml = patchXmlElement(xml, "revision", "0");
      setPendingChannelImport({ xml: finalXml, mode: "new" });
      router.push("/channels/new");
    }
    onClose();
  }

  // ── Step-specific rendering ───────────────────────────────────────────

  const trimmedName = newName.trim();
  const isDuplicateName = trimmedName.length > 0 && existingNames.has(trimmedName.toLowerCase());

  if (step === "conflict" && parsed) {
    return (
      <FormDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
        title="Channel Already Exists"
        onSubmit={handleOverwrite}
        submitLabel="Overwrite"
        saving={loading}
        error={error}
        maxWidth="sm:max-w-md"
        footerLeft={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCreateNew}
            disabled={loading}
          >
            Create New
          </Button>
        }
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p>
              A channel named <span className="font-medium">&quot;{parsed.name}&quot;</span> already
              exists.
            </p>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              Choose <strong>Overwrite</strong> to replace the existing channel, or{" "}
              <strong>Create New</strong> to import with a different name.
            </p>
          </div>
        </div>
      </FormDialog>
    );
  }

  if (step === "rename" && parsed) {
    return (
      <FormDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
        title="Rename Imported Channel"
        onSubmit={handleRenameSubmit}
        submitLabel="Import"
        submitDisabled={!trimmedName || isDuplicateName}
        saving={loading}
        error={error}
        maxWidth="sm:max-w-sm"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Enter a new name for the imported channel.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Channel Name <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError(null);
              }}
              placeholder="Enter channel name"
              className={`border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 w-full bg-white dark:bg-gray-700 dark:text-gray-200 ${
                isDuplicateName
                  ? "border-red-400 focus:ring-red-400"
                  : "border-border focus:ring-blue-400"
              }`}
              disabled={loading}
            />
          </div>
          {isDuplicateName && (
            <p className="text-xs text-red-600 dark:text-red-400">
              A channel named &quot;{trimmedName}&quot; already exists.
            </p>
          )}
        </div>
      </FormDialog>
    );
  }

  if ((step === "libraries-prompt" || step === "libraries-loading") && parsed && parsedLibData) {
    return (
      <FormDialog
        open={open}
        onOpenChange={(v) => {
          if (!v && step !== "libraries-loading") onClose();
        }}
        title="Code Template Libraries"
        onSubmit={handleImportLibraries}
        submitLabel="Import Libraries"
        submitDisabled={step === "libraries-loading"}
        saving={step === "libraries-loading"}
        error={error}
        maxWidth="sm:max-w-md"
        footerLeft={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void reviewImport(rawXml, parsed, overwrite)}
            disabled={step === "libraries-loading"}
          >
            Skip
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <FileCode2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <p className="text-sm">
              Channel <span className="font-medium">&quot;{parsed.name}&quot;</span> has{" "}
              {parsedLibData.libraries.length} code template{" "}
              {parsedLibData.libraries.length === 1 ? "library" : "libraries"} included. Would you
              like to import them?
            </p>
          </div>
          <ul className="ml-8 list-disc text-sm text-gray-600 dark:text-gray-400">
            {parsedLibData.libraries.map((lib) => (
              <li key={lib.id}>{lib.name}</li>
            ))}
          </ul>
        </div>
      </FormDialog>
    );
  }

  if (step === "libraries-review" && parsedLibData) {
    return (
      <ImportCodeTemplateDialog
        open={open}
        mode="library"
        libraries={serverLibraries}
        templates={serverTemplates}
        onClose={() => {
          // ImportCodeTemplateDialog calls onClose() after onImported() in handleImport.
          // If library import is active (handleLibrariesImported is running), ignore
          // the close to avoid resetting the step during the async save.
          if (!libImportActiveRef.current) {
            setStep("libraries-prompt");
          }
        }}
        onImported={handleLibrariesImported}
        initialData={parsedLibData}
      />
    );
  }

  // Default: file-select step
  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Import Channel"
      onSubmit={handleFileSelected}
      submitLabel="Import"
      submitDisabled={!file}
      saving={loading}
      error={error}
      maxWidth="sm:max-w-sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Select a BridgeLink channel XML file to import.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xml"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-sm file:bg-white dark:file:bg-gray-700 file:hover:bg-gray-50 dark:file:hover:bg-gray-600 cursor-pointer"
        />
        {file && <p className="text-xs text-gray-500 dark:text-gray-400">Selected: {file.name}</p>}
      </div>
    </FormDialog>
  );
}
