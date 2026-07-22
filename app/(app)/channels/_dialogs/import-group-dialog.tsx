"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileCode2 } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import {
  bulkUpdateCodeTemplates,
  getCodeTemplateLibraries,
  getCodeTemplates,
  invalidateCodeTemplateCache,
  updateChannelFromXml,
} from "@/lib/api-client";
import { getChannelTags } from "@/lib/api/api-channels";
import { setChannelTags } from "@/lib/api/api-settings";
import { parseChannelTagsFromExportXml } from "@/lib/api/parse-channel-tags-xml";
import { mergeImportedChannelTags } from "@/lib/channel-tag-utils";
import { generateUUID } from "@/lib/utils";
import { loadAdminPrefs } from "@/components/settings/admin-tab";
import { ImportCodeTemplateDialog } from "@/app/(app)/code-templates/_dialogs/import-code-template-dialog";
import type { Channel, ChannelGroup, CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import { DEFAULT_GROUP_ID } from "../_lib/channel-columns";
import { useChannelGroupSave } from "../_lib/use-channel-group-save";
import { applyImportedChannelDependencies } from "../_lib/apply-imported-dependencies";
import {
  buildImportedGroupSet,
  classifyChannelImport,
  classifyGroupImport,
  consolidateChannelLibraries,
  extractGroupsFromXml,
  parseLibrariesFromChannelXml,
  patchXmlElement,
  updateLibraryChannelIds,
  type ExistingChannelInfo,
  type ExistingGroupInfo,
  type ImportChannelEntry,
  type ImportGroupEntry,
  type ParsedLibraryData,
} from "../_lib/channel-import-xml";

type Step =
  | "file-select"
  | "conflict"
  | "libraries-prompt"
  | "libraries-loading"
  | "libraries-review";

/** Per-conflict user choice: overwrite the existing item, or import as a new copy. */
interface Decision {
  decision: "overwrite" | "create-new";
  /** New name when decision is "create-new" (defaults to the original). */
  newName: string;
}

/** A fully-resolved channel ready to PUT: final id/name/revision + patched XML. */
interface ResolvedChannel {
  originalId: string;
  finalId: string;
  finalName: string;
  /** XML with id/name/revision patched, ready for updateChannelFromXml. */
  patchedXml: string;
  /** Original XML, used to read dependency ids (unaffected by the id/name patches). */
  originalXml: string;
  /** Embedded libraries, remapped from original id to final id. */
  libData: ParsedLibraryData | null;
}

/** A fully-resolved group ready for the bulk group update. */
interface ResolvedGroup {
  finalId: string;
  finalName: string;
  finalRevision: number;
  mode: "new" | "overwrite";
  channelFinalIds: string[];
}

interface ResolvedPlan {
  channels: ResolvedChannel[];
  groups: ResolvedGroup[];
  finalIdByOriginal: Map<string, string>;
}

/**
 * Import one or more channel groups from a BridgeLink group export.
 *
 * Unlike the old importer — which only wrote the group record and dropped the
 * channels — this creates every embedded channel on the server first, then writes
 * the COMPLETE group set (preserving existing groups), mirroring the Java client's
 * ChannelPanel.importGroup flow:
 *   - channel name unique, id unique  → import as-is
 *   - channel name unique, id collides → auto-assign a new id (no prompt)
 *   - channel/group name collides      → prompt Overwrite vs. Create New
 * Embedded code-template libraries are consolidated across channels and offered for
 * import; channel dependencies declared in exportData are merged into the global set.
 */
export function ImportGroupDialog({
  open,
  onClose,
  channels,
  existingGroups,
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  /** All current channels, for name/id conflict detection. */
  channels: Channel[];
  /** The server's real channel groups (excludes the synthesized Default Group). */
  existingGroups: ChannelGroup[];
  refresh: () => void | Promise<void>;
}) {
  const { saveGroups, conflictDialog } = useChannelGroupSave();
  const [step, setStep] = useState<Step>("file-select");
  const [file, setFile] = useState<File | null>(null);
  const [groups, setGroups] = useState<ImportGroupEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelDecisions, setChannelDecisions] = useState<Record<string, Decision>>({});
  const [groupDecisions, setGroupDecisions] = useState<Record<string, Decision>>({});

  // Library import state
  const [resolvedPlan, setResolvedPlan] = useState<ResolvedPlan | null>(null);
  const [consolidatedLibs, setConsolidatedLibs] = useState<ParsedLibraryData | null>(null);
  const [serverLibraries, setServerLibraries] = useState<CodeTemplateLibrary[]>([]);
  const [serverTemplates, setServerTemplates] = useState<Map<string, CodeTemplate>>(new Map());
  // True while handleLibrariesImported runs — prevents the ImportCodeTemplateDialog's
  // onClose (fired after onImported) from resetting the step mid-save.
  const libImportActiveRef = useRef(false);

  // Reset state when the dialog closes (render-time "adjust state on prop change"
  // idiom — avoids the react-hooks set-state-in-effect warning).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setStep("file-select");
      setFile(null);
      setGroups(null);
      setLoading(false);
      setError(null);
      setChannelDecisions({});
      setGroupDecisions({});
      setResolvedPlan(null);
      setConsolidatedLibs(null);
      setServerLibraries([]);
      setServerTemplates(new Map());
    }
  }

  useEffect(() => {
    if (!open) libImportActiveRef.current = false;
  }, [open]);

  // ── Existing-server lookups for conflict detection ──
  const existingChannelInfo = useMemo<ExistingChannelInfo>(
    () => ({
      byName: new Map(
        channels.map((c) => [c.name.toLowerCase(), { id: c.id, revision: c.revision }])
      ),
      ids: new Set(channels.map((c) => c.id)),
    }),
    [channels]
  );
  const existingGroupInfo = useMemo<ExistingGroupInfo>(
    () => ({
      byName: new Map(
        existingGroups.map((g) => [g.name.toLowerCase(), { id: g.id, revision: g.revision ?? 0 }])
      ),
      ids: new Set(existingGroups.map((g) => g.id)),
    }),
    [existingGroups]
  );

  // ── Conflicts derived from the parsed file ──
  const channelConflicts = useMemo<ImportChannelEntry[]>(() => {
    if (!groups) return [];
    const out: ImportChannelEntry[] = [];
    for (const g of groups) {
      for (const c of g.channels) {
        if (classifyChannelImport(c, existingChannelInfo) === "conflict") out.push(c);
      }
    }
    return out;
  }, [groups, existingChannelInfo]);

  const groupConflicts = useMemo<ImportGroupEntry[]>(() => {
    if (!groups) return [];
    return groups.filter((g) => classifyGroupImport(g, existingGroupInfo) === "conflict");
  }, [groups, existingGroupInfo]);

  // ── Validation of create-new names ──
  function channelNameError(c: ImportChannelEntry): string | null {
    const dec = channelDecisions[c.id];
    if (dec?.decision !== "create-new") return null;
    const t = dec.newName.trim();
    if (!t) return "Enter a name.";
    const lower = t.toLowerCase();
    if (existingChannelInfo.byName.has(lower)) return "A channel with that name already exists.";
    const dupes = channelConflicts.filter(
      (x) =>
        channelDecisions[x.id]?.decision === "create-new" &&
        channelDecisions[x.id]?.newName.trim().toLowerCase() === lower
    );
    if (dupes.length > 1) return "Duplicate name in this import.";
    return null;
  }

  function groupNameError(g: ImportGroupEntry): string | null {
    const dec = groupDecisions[g.id];
    if (dec?.decision !== "create-new") return null;
    const t = dec.newName.trim();
    if (!t) return "Enter a name.";
    if (existingGroupInfo.byName.has(t.toLowerCase()))
      return "A group with that name already exists.";
    return null;
  }

  const isValid =
    channelConflicts.every((c) => channelNameError(c) === null) &&
    groupConflicts.every((g) => groupNameError(g) === null);

  // ── Resolve every channel/group to its final identity (single source of truth
  //    shared by library remapping and the actual import). ──
  function buildPlan(
    parsed: ImportGroupEntry[],
    chDecisions: Record<string, Decision>,
    grDecisions: Record<string, Decision>
  ): ResolvedPlan {
    const finalIdByOriginal = new Map<string, string>();
    const resolvedChannels: ResolvedChannel[] = [];

    for (const g of parsed) {
      for (const c of g.channels) {
        const kind = classifyChannelImport(c, existingChannelInfo);
        let finalId = c.id;
        let finalName = c.name;
        let finalRevision = 0;

        if (kind === "new-id") {
          finalId = generateUUID();
        } else if (kind === "conflict") {
          const dec = chDecisions[c.id];
          if (dec?.decision === "create-new") {
            finalId = generateUUID();
            finalName = dec.newName.trim();
          } else {
            const existing = existingChannelInfo.byName.get(c.name.toLowerCase());
            if (existing) {
              finalId = existing.id;
              finalRevision = existing.revision;
            }
          }
        }

        let xml = patchXmlElement(c.xml, "id", finalId);
        // patchXmlElement escapes internally — pass the raw name #27).
        if (finalName !== c.name) xml = patchXmlElement(xml, "name", finalName);
        xml = patchXmlElement(xml, "revision", String(finalRevision));

        let libData = parseLibrariesFromChannelXml(c.xml);
        if (libData && finalId !== c.id) libData = updateLibraryChannelIds(libData, c.id, finalId);

        resolvedChannels.push({
          originalId: c.id,
          finalId,
          finalName,
          patchedXml: xml,
          originalXml: c.xml,
          libData,
        });
        finalIdByOriginal.set(c.id, finalId);
      }
    }

    const resolvedGroups: ResolvedGroup[] = parsed.map((g) => {
      const kind = classifyGroupImport(g, existingGroupInfo);
      let finalId = g.id;
      let finalName = g.name;
      let finalRevision = 0;
      let mode: "new" | "overwrite" = "new";

      if (kind === "new-id") {
        finalId = generateUUID();
      } else if (kind === "conflict") {
        const dec = grDecisions[g.id];
        if (dec?.decision === "create-new") {
          finalId = generateUUID();
          finalName = dec.newName.trim();
        } else {
          const existing = existingGroupInfo.byName.get(g.name.toLowerCase());
          if (existing) {
            finalId = existing.id;
            finalRevision = existing.revision;
            mode = "overwrite";
          }
        }
      }

      const channelFinalIds = g.channels
        .map((c) => finalIdByOriginal.get(c.id))
        .filter((id): id is string => Boolean(id));

      return { finalId, finalName, finalRevision, mode, channelFinalIds };
    });

    return { channels: resolvedChannels, groups: resolvedGroups, finalIdByOriginal };
  }

  // ── Step transitions ──
  async function handleFileSelected() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const text = await file.text();
      const parsed = extractGroupsFromXml(text); // throws "Invalid XML file"
      if (parsed.length === 0) {
        setError("No channel groups found in XML file.");
        setLoading(false);
        return;
      }
      const chConflicts = parsed.flatMap((g) =>
        g.channels.filter((c) => classifyChannelImport(c, existingChannelInfo) === "conflict")
      );
      const grConflicts = parsed.filter(
        (g) => classifyGroupImport(g, existingGroupInfo) === "conflict"
      );
      setGroups(parsed);
      if (chConflicts.length === 0 && grConflicts.length === 0) {
        // No conflicts — resolve and proceed straight away (common case, e.g. the repro file).
        await finalize(parsed, {}, {});
        return;
      }
      // Default each conflict to "overwrite" (the Java client's affirmative default),
      // pre-filling the create-new name with the original.
      const cd: Record<string, Decision> = {};
      for (const c of chConflicts) cd[c.id] = { decision: "overwrite", newName: c.name };
      const gd: Record<string, Decision> = {};
      for (const g of grConflicts) gd[g.id] = { decision: "overwrite", newName: g.name };
      setChannelDecisions(cd);
      setGroupDecisions(gd);
      setStep("conflict");
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file.");
      setLoading(false);
    }
  }

  /**
   * Resolve the plan, then branch on embedded code-template libraries: import them
   * (prompt / auto per Administrator preference) or skip straight to the import.
   */
  async function finalize(
    parsed: ImportGroupEntry[],
    chDecisions: Record<string, Decision>,
    grDecisions: Record<string, Decision>
  ) {
    const plan = buildPlan(parsed, chDecisions, grDecisions);
    setResolvedPlan(plan);

    const consolidated = consolidateChannelLibraries(
      plan.channels.map((c) => ({ finalId: c.finalId, libData: c.libData }))
    );
    if (consolidated.libraries.length === 0) {
      await executeImport(plan);
      return;
    }

    setConsolidatedLibs(consolidated);
    const pref = loadAdminPrefs().importChannelCodeTemplateLibraries;
    if (pref === "yes") {
      await openLibraryReview();
    } else if (pref === "no") {
      await executeImport(plan);
    } else {
      setStep("libraries-prompt");
      setLoading(false);
    }
  }

  /** Fetch current server code-template state and open the review dialog. */
  async function openLibraryReview() {
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

  /** Code-template review complete — save libraries, then continue with the import. */
  async function handleLibrariesImported(result: {
    libraries: CodeTemplateLibrary[];
    templates: CodeTemplate[];
  }) {
    if (!resolvedPlan) return;
    libImportActiveRef.current = true;
    setStep("libraries-loading");
    setError(null);
    try {
      const resultLibraries = Array.isArray(result.libraries)
        ? result.libraries
        : [result.libraries as CodeTemplateLibrary];

      // The review dialog may have replaced enabledChannelIds with the server's copy
      // during overwrite — re-assert the channel associations we consolidated.
      const consolidatedById = new Map((consolidatedLibs?.libraries ?? []).map((l) => [l.id, l]));
      const patchedLibraries = resultLibraries.map((lib) => {
        const ours = consolidatedById.get(lib.id);
        if (!ours) return lib;
        const enabled = new Set([
          ...(lib.enabledChannelIds ?? []),
          ...(ours.enabledChannelIds ?? []),
        ]);
        return { ...lib, enabledChannelIds: [...enabled] };
      });

      // Merge imported libraries with existing server state.
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

      await executeImport(resolvedPlan);
    } catch (e) {
      setError(
        "Failed to save code template libraries: " + (e instanceof Error ? e.message : String(e))
      );
      setStep("libraries-prompt");
    }
  }

  // ── Import execution (mirrors ChannelPanel: channels → dependencies → group set) ──
  async function executeImport(plan: ResolvedPlan) {
    setLoading(true);
    setError(null);
    try {
      // 1. Create/overwrite each channel.
      for (const c of plan.channels) {
        await updateChannelFromXml(c.finalId, c.patchedXml);
      }

      // 2. Merge any declared channel dependencies into the global set. Shared with
      //    the single-channel import path so the two cannot diverge again.
      await applyImportedChannelDependencies(
        plan.channels.map((c) => ({ xml: c.originalXml, finalId: c.finalId })),
        (id) => plan.finalIdByOriginal.get(id) ?? id
      );

      // 3. Fold each imported group into the complete group set (preserves existing
      //    groups; dedupes channel membership). Thread the result across groups.
      let groupSet: ChannelGroup[] = existingGroups;
      for (const g of plan.groups) {
        groupSet = buildImportedGroupSet(
          groupSet,
          {
            id: g.finalId,
            name: g.finalName,
            revision: g.finalRevision,
            channelIds: g.channelFinalIds,
          },
          g.mode,
          DEFAULT_GROUP_ID
        );
      }
      const result = await saveGroups(groupSet, []);
      if (result === "cancelled") {
        setLoading(false);
        return;
      }

      // 4. Recover tags carried in each channel's <exportData>, remapped to its final
      //    id, and persist the updated global set once; mirrors the Java
      //    import path which restores exportData.getChannelTags() per channel). Done
      //    last and best-effort: the channels/deps/groups are already saved, so a tag
      //    failure (e.g. missing TAGS_MANAGE) must not fail the import. Skips the
      //    getChannelTags fetch entirely when no imported channel carries tags.
      try {
        const carried = plan.channels
          .map((c) => ({ finalId: c.finalId, tags: parseChannelTagsFromExportXml(c.originalXml) }))
          .filter((e) => e.tags.length > 0);
        if (carried.length > 0) {
          let tagSet = await getChannelTags();
          for (const e of carried) tagSet = mergeImportedChannelTags(tagSet, e.tags, e.finalId);
          await setChannelTags(tagSet);
        }
      } catch {
        toast.warning("Group imported, but some channel tags could not be applied.");
      }

      await refresh();

      const groupLabel =
        plan.groups.length === 1 ? `"${plan.groups[0].finalName}"` : `${plan.groups.length} groups`;
      const channelCount = plan.channels.length;
      toast.success(
        `Imported ${groupLabel} with ${channelCount} channel${channelCount !== 1 ? "s" : ""}`
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  // ── Rendering ──
  if (step === "libraries-review" && consolidatedLibs) {
    return (
      <>
        {conflictDialog}
        <ImportCodeTemplateDialog
          open={open}
          mode="library"
          libraries={serverLibraries}
          templates={serverTemplates}
          onClose={() => {
            // The review dialog calls onClose() after onImported(); ignore it while the
            // async save is still running so we don't reset the step underneath it.
            if (!libImportActiveRef.current) setStep("libraries-prompt");
          }}
          onImported={handleLibrariesImported}
          initialData={consolidatedLibs}
        />
      </>
    );
  }

  if ((step === "libraries-prompt" || step === "libraries-loading") && consolidatedLibs) {
    return (
      <>
        {conflictDialog}
        <FormDialog
          open={open}
          onOpenChange={(v) => {
            if (!v && step !== "libraries-loading") onClose();
          }}
          title="Code Template Libraries"
          onSubmit={openLibraryReview}
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
              onClick={() => resolvedPlan && executeImport(resolvedPlan)}
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
                The imported channels include {consolidatedLibs.libraries.length} code template{" "}
                {consolidatedLibs.libraries.length === 1 ? "library" : "libraries"}. Would you like
                to import {consolidatedLibs.libraries.length === 1 ? "it" : "them"}?
              </p>
            </div>
            <ul className="ml-8 list-disc text-sm text-gray-600 dark:text-gray-400">
              {consolidatedLibs.libraries.map((lib) => (
                <li key={lib.id}>{lib.name}</li>
              ))}
            </ul>
          </div>
        </FormDialog>
      </>
    );
  }

  if (step === "conflict") {
    return (
      <>
        {conflictDialog}
        <FormDialog
          open={open}
          onOpenChange={(v) => {
            if (!v && !loading) onClose();
          }}
          title="Resolve Import Conflicts"
          onSubmit={() => groups && finalize(groups, channelDecisions, groupDecisions)}
          submitLabel="Import"
          submitDisabled={!isValid || loading}
          saving={loading}
          error={error}
          maxWidth="sm:max-w-lg"
        >
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <p className="text-gray-600 dark:text-gray-400">
                Some imported items already exist on this server. Choose how to resolve each
                conflict.
              </p>
            </div>

            {groupConflicts.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {groupConflicts.length === 1 ? "Group" : "Groups"}
                </h3>
                {groupConflicts.map((g) => (
                  <ConflictRow
                    key={g.id}
                    label={g.name}
                    itemLabel="group"
                    decision={groupDecisions[g.id]}
                    error={groupNameError(g)}
                    onChange={(patch) =>
                      setGroupDecisions((prev) => ({
                        ...prev,
                        [g.id]: { ...prev[g.id], ...patch },
                      }))
                    }
                    disabled={loading}
                  />
                ))}
              </section>
            )}

            {channelConflicts.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {channelConflicts.length === 1 ? "Channel" : "Channels"}
                </h3>
                {channelConflicts.map((c) => (
                  <ConflictRow
                    key={c.id}
                    label={c.name}
                    itemLabel="channel"
                    decision={channelDecisions[c.id]}
                    error={channelNameError(c)}
                    onChange={(patch) =>
                      setChannelDecisions((prev) => ({
                        ...prev,
                        [c.id]: { ...prev[c.id], ...patch },
                      }))
                    }
                    disabled={loading}
                  />
                ))}
              </section>
            )}
          </div>
        </FormDialog>
      </>
    );
  }

  // Default: file-select step
  return (
    <>
      {conflictDialog}
      <FormDialog
        open={open}
        onOpenChange={(v) => {
          if (!v && !loading) onClose();
        }}
        title="Import Groups"
        onSubmit={handleFileSelected}
        submitLabel="Import"
        submitDisabled={!file || loading}
        saving={loading}
        error={error}
        maxWidth="sm:max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Select a BridgeLink channel group XML file to import. The group and all of its channels
            will be imported.
          </p>
          <input
            type="file"
            accept=".xml"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-border file:text-sm file:bg-white dark:file:bg-gray-700 file:hover:bg-gray-50 dark:file:hover:bg-gray-600 cursor-pointer"
          />
          {file && (
            <p className="text-xs text-gray-500 dark:text-gray-400">Selected: {file.name}</p>
          )}
        </div>
      </FormDialog>
    </>
  );
}

/** One conflict row: the item name plus an Overwrite / Create-New choice. */
function ConflictRow({
  label,
  itemLabel,
  decision,
  error,
  onChange,
  disabled,
}: {
  label: string;
  itemLabel: "channel" | "group";
  decision?: Decision;
  error: string | null;
  onChange: (patch: Partial<Decision>) => void;
  disabled: boolean;
}) {
  const choice = decision?.decision ?? "overwrite";
  return (
    <div className="rounded border border-border p-2.5">
      <p className="mb-1.5">
        A {itemLabel} named <span className="font-medium">&quot;{label}&quot;</span> already exists.
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={choice === "overwrite"}
            onChange={() => onChange({ decision: "overwrite" })}
            disabled={disabled}
          />
          <span>Overwrite the existing {itemLabel}</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={choice === "create-new"}
            onChange={() => onChange({ decision: "create-new" })}
            disabled={disabled}
          />
          <span>Create new as:</span>
          <input
            type="text"
            value={decision?.newName ?? label}
            onChange={(e) => onChange({ decision: "create-new", newName: e.target.value })}
            disabled={disabled || choice !== "create-new"}
            className={`flex-1 rounded border px-2 py-1 text-sm focus:outline-none focus:ring-1 disabled:opacity-50 bg-white dark:bg-gray-700 dark:text-gray-200 ${
              error ? "border-red-400 focus:ring-red-400" : "border-input focus:ring-blue-400"
            }`}
          />
        </label>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
