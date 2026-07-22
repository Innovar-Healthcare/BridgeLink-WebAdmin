"use client";

/**
 * Code Templates page — mirrors Java's CodeTemplatePanel.java
 *
 * Business logic:
 *  - Load all libraries via GET /codeTemplateLibraries (template ID stubs only)
 *  - Load all templates via GET /codeTemplates (full data incl. code)
 *  - Load channel list via GET /channels/idsAndNames (for library channel association)
 *  - Display tree: libraries (expandable) containing their templates
 *  - Selecting a library → shows name + description editor
 *  - Selecting a template → shows Monaco JS editor + context checkboxes + type/library dropdowns
 *  - Context checkboxes: 15 ContextType values grouped into 4 sections
 *  - Save: POST /codeTemplateLibraries/_bulkUpdate (multipart/form-data, XStream XML)
 *    - Always sends full library list (server replaces all)
 *    - Only sends changed/new templates in updatedCodeTemplates
 *  - Generate JSDoc: parses function signature, builds/replaces leading /** block
 *  - Validate: synchronously re-validates the current code (mirrors Java doValidateCodeTemplate), then reports markers
 *  - Filter: text search across library and template names
 */

import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { PageHeader } from "@/components/page-header";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { validateRhinoSyntax } from "@/lib/monaco-rhino-validation";
import { validateCodeTemplatesForSave } from "@/lib/code-template-validation";
import type * as MonacoType from "monaco-editor";
import { toast } from "sonner";
import {
  getChannelIdsAndNames,
  getCodeTemplateLibraries,
  getCodeTemplates,
  invalidateCodeTemplateCache,
  exportTemplateToXml,
  exportLibraryToXml,
  exportAllLibrariesToXml,
} from "@/lib/api-client";
import { downloadFile } from "@/lib/download";
import type {
  CodeTemplate,
  CodeTemplateLibrary,
  CodeTemplateLibrarySaveResult,
  CodeTemplateType,
  ContextType,
} from "@/lib/types";
import { useNavigationGuard, NavigationSaveCancelled } from "@/lib/navigation-guard";
import { useExpandState } from "@/lib/hooks/use-expand-state";
import { useSplitResize } from "@/lib/hooks/use-split-resize";
import { cn } from "@/lib/utils";
import { loadAdminPrefs } from "@/components/settings/admin-tab";
import {
  findDuplicateSignatures,
  generateJsDoc,
  type SignatureConflict,
} from "@/lib/code-template-utils";
import { CodeTemplateTreeTable } from "./_components/code-template-tree-table";
import { CodeTemplatesActionPanel } from "./_components/code-templates-action-panel";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { LibraryDetailPanel } from "./_components/library-detail-panel";
import { TemplateDetailPanel, CONTEXT_GROUPS } from "./_components/template-detail-panel";
import { SignatureConflictBanner } from "./_components/signature-conflict-banner";
import { ConfirmDialog, TypeToConfirmDialog } from "@/components/confirm-dialog";
import { ImportCodeTemplateDialog } from "./_dialogs/import-code-template-dialog";
import { useCodeTemplateSave } from "./_lib/use-code-template-save";
import { getSlot, pluginSlots } from "@/lib/plugin-slots";
import { useSlotEnabled, slotSurfaceEnabled } from "@/lib/plugin-gating";
import { useRepoChanges, clearRepoChangesCache } from "@/lib/hooks/use-repo-changes";

// ─── Constants ────────────────────────────────────────────────────────────────

/** localStorage key for the tree split layout ("left" | "top"). */
const TREE_LAYOUT_KEY = "bl-code-templates-tree-layout";
/** localStorage key for the tree split ratio (percentage). */
const SPLIT_PCT_KEY = "bl-code-templates-split-pct";
/** Default split ratio for the tree panel (≈288px on a typical container). */
const DEFAULT_SPLIT_PCT = 28;

/** Read the persisted split ratio, clamped to a sane range; falls back to the default. */
function getStoredSplitPct(): number {
  if (typeof window === "undefined") return DEFAULT_SPLIT_PCT;
  const raw = localStorage.getItem(SPLIT_PCT_KEY);
  const pct = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(pct) ? Math.max(15, Math.min(70, pct)) : DEFAULT_SPLIT_PCT;
}

// Verbatim copy of Java's CodeTemplate.DEFAULT_CODE (new_function1, {String} tags).
const DEFAULT_CODE = `/**
\tModify the description here. Modify the function name and parameters as needed. One function per
\ttemplate is recommended; create a new code template for each new function.

\t@param {String} arg1 - arg1 description
\t@return {String} return description
*/
function new_function1(arg1) {
\t// TODO: Enter code here
}`;

/** Flat list of all ContextTypes, derived from CONTEXT_GROUPS. */
const ALL_CONTEXT_TYPES: ContextType[] = CONTEXT_GROUPS.flatMap((g) => g.items.map((i) => i.type));

// ─── Unique name helpers ──────────────────────────────────────────────────────

function uniqueLibraryName(libs: CodeTemplateLibrary[]): string {
  const names = new Set(libs.map((l) => l.name));
  let n = 1;
  while (names.has(`Library ${n}`)) n++;
  return `Library ${n}`;
}

function uniqueTemplateName(templates: Map<string, CodeTemplate>): string {
  const names = new Set(Array.from(templates.values()).map((t) => t.name));
  let n = 1;
  while (names.has(`Template ${n}`)) n++;
  return `Template ${n}`;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CodeTemplatesPage() {
  return (
    <Suspense>
      <CodeTemplatesPageInner />
    </Suspense>
  );
}

function CodeTemplatesPageInner() {
  const searchParams = useSearchParams();
  const initialTemplateIdRef = useRef(searchParams.get("templateId"));
  const ImportFromRepoDialog = pluginSlots["code-templates.import-repo-dialog"];
  const SaveLibrariesDialog = pluginSlots["code-templates.save-libraries-dialog"];
  const TemplateHistoryDialog = pluginSlots["code-templates.history-dialog"];
  const LibraryHistoryDialog = pluginSlots["code-templates.library.history-dialog"];
  const saveLibrariesToRepo = getSlot("code-templates.save-libraries");
  // Per-slot server-enablement gating; each slot is Version-History-owned.
  const importRepoEnabled = useSlotEnabled("code-templates.import-repo-dialog");
  const saveLibrariesDialogEnabled = useSlotEnabled("code-templates.save-libraries-dialog");
  const saveLibrariesEnabled = useSlotEnabled("code-templates.save-libraries");
  const templateHistoryEnabled = useSlotEnabled("code-templates.history-dialog");
  const libraryHistoryEnabled = useSlotEnabled("code-templates.library.history-dialog");

  // Data
  const [libraries, setLibraries] = useState<CodeTemplateLibrary[]>([]);
  const [templates, setTemplates] = useState<Map<string, CodeTemplate>>(new Map());
  const [channels, setChannels] = useState<Map<string, string>>(new Map());

  // Snapshots for save diff
  const originalLibraries = useRef<CodeTemplateLibrary[]>([]);
  const originalTemplates = useRef<Map<string, CodeTemplate>>(new Map());

  // UI state
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [
    expandedLibraryIds,
    toggleExpand,
    setAllExpanded,
    collapseAllExpanded,
    hasSavedExpandState,
  ] = useExpandState("bl-code-templates-expand");
  const [filterText, setFilterText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);
  // Bumped whenever the open template's code is replaced from a NON-typing source
  // (reload, Generate JSDoc, import). Feeds the editor's `key` so it remounts with a
  // fresh seed — the uncontrolled editor reads its content only on mount. Typing must
  // never bump this, or the cursor would jump to the end.
  const [codeReloadKey, setCodeReloadKey] = useState(0);
  const [treeVisible, setTreeVisible] = useState(true);
  const [treeLayout, setTreeLayout] = useState<"left" | "top">("left");
  const [findUsageOpen, setFindUsageOpen] = useState(false);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pendingDeleteLibrary, setPendingDeleteLibrary] = useState<{
    id: string;
    name: string;
    templateCount: number;
  } | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState(false);
  const [importMode, setImportMode] = useState<"template" | "library" | null>(null);
  const [importFromRepoOpen, setImportFromRepoOpen] = useState(false);
  const [saveLibrariesOpen, setSaveLibrariesOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<
    { kind: "template"; id: string } | { kind: "library"; id: string } | null
  >(null);
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const { isViewOnly } = usePermissions();
  const codeTemplatesViewOnly = isViewOnly("Code Templates");
  const { templateIds: repoChangedTemplateIds } = useRepoChanges();
  const { saveTemplates, conflictDialog } = useCodeTemplateSave();

  useEffect(() => {
    startTransition(() => {
      if (localStorage.getItem("bl-code-templates-tree-visible") === "false") setTreeVisible(false);
      if (localStorage.getItem(TREE_LAYOUT_KEY) === "top") setTreeLayout("top");
    });
  }, []);

  // Draggable split between the tree panel and the detail panel. Orientation follows the layout:
  // left/right → horizontal (width %), top/bottom → vertical (height %).
  const { splitPct, containerRef, onResizerMouseDown } = useSplitResize({
    orientation: treeLayout === "top" ? "vertical" : "horizontal",
    defaultPct: getStoredSplitPct(),
    minPct: 15,
    maxPct: 70,
  });

  // Persist the layout choice and the split ratio (the hook itself doesn't persist).
  useEffect(() => {
    localStorage.setItem(TREE_LAYOUT_KEY, treeLayout);
  }, [treeLayout]);
  useEffect(() => {
    localStorage.setItem(SPLIT_PCT_KEY, String(Math.round(splitPct)));
  }, [splitPct]);

  // Monaco editor + Monaco API refs for validation
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoType | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedLibrary = selectedLibraryId
    ? (libraries.find((l) => l.id === selectedLibraryId) ?? null)
    : null;
  const selectedTemplate = selectedTemplateId ? (templates.get(selectedTemplateId) ?? null) : null;

  // Duplicate signature detection
  const signatureConflictMap = useMemo(() => {
    const conflicts = findDuplicateSignatures(templates, libraries);
    const map = new Map<string, SignatureConflict>();
    for (const c of conflicts) {
      for (const t of c.templates) {
        map.set(t.templateId, c);
      }
    }
    return map;
  }, [templates, libraries]);

  const getSignatureConflict = useCallback(
    (templateId: string): SignatureConflict | null => signatureConflictMap.get(templateId) ?? null,
    [signatureConflictMap]
  );

  function isLibraryNew(id: string): boolean {
    return !originalLibraries.current.some((l) => l.id === id);
  }

  function isLibraryModified(id: string): boolean {
    const orig = originalLibraries.current.find((l) => l.id === id);
    if (!orig) return false;
    const curr = libraries.find((l) => l.id === id);
    if (!curr) return false;
    return (
      curr.name !== orig.name ||
      (curr.description ?? "") !== (orig.description ?? "") ||
      (curr.includeNewChannels ?? false) !== (orig.includeNewChannels ?? false) ||
      JSON.stringify([...(curr.enabledChannelIds ?? [])].sort()) !==
        JSON.stringify([...(orig.enabledChannelIds ?? [])].sort()) ||
      JSON.stringify([...(curr.disabledChannelIds ?? [])].sort()) !==
        JSON.stringify([...(orig.disabledChannelIds ?? [])].sort()) ||
      JSON.stringify([...curr.codeTemplateIds].sort()) !==
        JSON.stringify([...orig.codeTemplateIds].sort())
    );
  }

  function isTemplateNew(id: string): boolean {
    return !originalTemplates.current.has(id);
  }

  function isTemplateModified(id: string): boolean {
    const orig = originalTemplates.current.get(id);
    if (!orig) return false;
    const curr = templates.get(id);
    if (!curr) return false;
    return (
      curr.name !== orig.name ||
      curr.code !== orig.code ||
      curr.type !== orig.type ||
      JSON.stringify(curr.contextTypes) !== JSON.stringify(orig.contextTypes)
    );
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (preserveSelection = false) => {
    setLoading(true);
    setError(null);
    try {
      const [libs, tmpls, chans] = await Promise.all([
        getCodeTemplateLibraries(),
        getCodeTemplates(),
        getChannelIdsAndNames(),
      ]);

      const tmplMap = new Map(tmpls.map((t) => [t.id, t]));
      setLibraries(libs);
      setTemplates(tmplMap);
      setChannels(chans);

      originalLibraries.current = libs.map((l) => ({
        ...l,
        codeTemplateIds: [...l.codeTemplateIds],
      }));
      originalTemplates.current = new Map(
        tmpls.map((t) => [t.id, { ...t, contextTypes: [...t.contextTypes] }])
      );

      if (!preserveSelection && !hasSavedExpandState && !loadAdminPrefs().defaultGroupsCollapsed) {
        setAllExpanded(libs.map((l) => l.id));
      }
      if (!preserveSelection) {
        const urlTmplId = initialTemplateIdRef.current;
        if (urlTmplId && tmplMap.has(urlTmplId)) {
          setSelectedTemplateId(urlTmplId);
          setSelectedLibraryId(null);
        } else {
          setSelectedLibraryId(libs.length > 0 ? libs[0].id : null);
          setSelectedTemplateId(null);
        }
      }
      setDirty(false);
      // Code was replaced from the server (refresh, save-reload, version-history
      // revert) — remount the editor so it reseeds from the freshly loaded code.
      setCodeReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasSavedExpandState/setAllExpanded intentionally omitted; load runs once on mount
  }, []);

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  // ── Navigation guard ───────────────────────────────────────────────────────

  const { registerGuard, unregisterGuard } = useNavigationGuard();
  const dirtyRef = useRef(dirty);
  const saveForGuardRef = useRef<() => Promise<void>>(async () => {});
  // Synced in a deps-less effect (read only from the navigation-guard callback).
  useEffect(() => {
    dirtyRef.current = dirty;
  });

  useEffect(() => {
    registerGuard(
      () => dirtyRef.current,
      () => saveForGuardRef.current(),
      "code templates"
    );
    return () => unregisterGuard();
  }, [registerGuard, unregisterGuard]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Mutators ───────────────────────────────────────────────────────────────

  function markDirty() {
    setDirty(true);
    setValidateMsg(null);
  }

  function updateLibrary(id: string, patch: Partial<CodeTemplateLibrary>) {
    setLibraries((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    markDirty();
  }

  function updateTemplate(id: string, patch: Partial<CodeTemplate>) {
    setTemplates((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (existing) next.set(id, { ...existing, ...patch });
      return next;
    });
    markDirty();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleAddLibrary() {
    const id = uuidv4();
    const name = uniqueLibraryName(libraries);
    const newLib: CodeTemplateLibrary = {
      id,
      name,
      revision: 1,
      description: "",
      includeNewChannels: false,
      enabledChannelIds: [],
      disabledChannelIds: [],
      codeTemplateIds: [],
    };
    setLibraries((prev) => [...prev, newLib]);
    setAllExpanded([...expandedLibraryIds, id]);
    setSelectedLibraryId(id);
    setSelectedTemplateId(null);
    markDirty();
  }

  function handleAddTemplate() {
    const targetLibId = selectedLibraryId ?? libraries[0]?.id;
    if (!targetLibId) {
      setError("Create a library first before adding a code template.");
      return;
    }
    const id = uuidv4();
    const name = uniqueTemplateName(templates);
    const newTemplate: CodeTemplate = {
      id,
      name,
      revision: 1,
      contextTypes: [
        "SOURCE_RECEIVER",
        "SOURCE_FILTER_TRANSFORMER",
        "DESTINATION_FILTER_TRANSFORMER",
        "DESTINATION_DISPATCHER",
        "DESTINATION_RESPONSE_TRANSFORMER",
      ],
      type: "FUNCTION" as CodeTemplateType,
      code: DEFAULT_CODE,
    };
    setTemplates((prev) => new Map([...prev, [id, newTemplate]]));
    setLibraries((prev) =>
      prev.map((l) =>
        l.id === targetLibId ? { ...l, codeTemplateIds: [...l.codeTemplateIds, id] } : l
      )
    );
    setAllExpanded([...expandedLibraryIds, targetLibId]);
    setSelectedLibraryId(null);
    setSelectedTemplateId(id);
    markDirty();
  }

  function handleDelete() {
    if (selectedTemplateId && selectedTemplate) {
      setPendingDeleteTemplate({ id: selectedTemplateId, name: selectedTemplate.name });
    } else if (selectedLibraryId && selectedLibrary) {
      setPendingDeleteLibrary({
        id: selectedLibraryId,
        name: selectedLibrary.name,
        templateCount: selectedLibrary.codeTemplateIds.length,
      });
    }
  }

  function executeDeleteTemplate(tid: string) {
    setLibraries((prev) =>
      prev.map((l) => ({ ...l, codeTemplateIds: l.codeTemplateIds.filter((id) => id !== tid) }))
    );
    setTemplates((prev) => {
      const next = new Map(prev);
      next.delete(tid);
      return next;
    });
    setSelectedTemplateId(null);
    markDirty();
  }

  function executeDeleteLibrary(lid: string) {
    const lib = libraries.find((l) => l.id === lid);
    if (!lib) return;
    setTemplates((prev) => {
      const next = new Map(prev);
      lib.codeTemplateIds.forEach((tid) => next.delete(tid));
      return next;
    });
    setLibraries((prev) => prev.filter((l) => l.id !== lid));
    setSelectedLibraryId(null);
    setSelectedTemplateId(null);
    markDirty();
  }

  function addTemplateToLibrary(libraryId: string) {
    const id = uuidv4();
    const name = uniqueTemplateName(templates);
    const newTemplate: CodeTemplate = {
      id,
      name,
      revision: 1,
      contextTypes: [
        "SOURCE_RECEIVER",
        "SOURCE_FILTER_TRANSFORMER",
        "DESTINATION_FILTER_TRANSFORMER",
        "DESTINATION_DISPATCHER",
        "DESTINATION_RESPONSE_TRANSFORMER",
      ],
      type: "FUNCTION" as CodeTemplateType,
      code: DEFAULT_CODE,
    };
    setTemplates((prev) => new Map([...prev, [id, newTemplate]]));
    setLibraries((prev) =>
      prev.map((l) =>
        l.id === libraryId ? { ...l, codeTemplateIds: [...l.codeTemplateIds, id] } : l
      )
    );
    setAllExpanded([...expandedLibraryIds, libraryId]);
    setSelectedLibraryId(null);
    setSelectedTemplateId(id);
    markDirty();
  }

  function deleteLibraryById(libraryId: string) {
    const lib = libraries.find((l) => l.id === libraryId);
    if (!lib) return;
    setPendingDeleteLibrary({
      id: libraryId,
      name: lib.name,
      templateCount: lib.codeTemplateIds.length,
    });
  }

  function deleteTemplateById(templateId: string) {
    const tmpl = templates.get(templateId);
    if (!tmpl) return;
    setPendingDeleteTemplate({ id: templateId, name: tmpl.name });
  }

  function openFindUsage(templateId: string) {
    setSelectedTemplateId(templateId);
    setSelectedLibraryId(null);
    setFindUsageOpen(true);
  }

  // ── Export handlers ─────────────────────────────────────────────────────────

  function handleExportTemplate(templateId: string) {
    const tmpl = templates.get(templateId);
    if (!tmpl) return;
    const xml = exportTemplateToXml(tmpl);
    downloadFile(xml, `${tmpl.name}.xml`, { mimeType: "application/xml" });
  }

  function handleExportLibrary(libraryId: string) {
    const lib = libraries.find((l) => l.id === libraryId);
    if (!lib) return;
    const libTemplates = lib.codeTemplateIds
      .map((tid) => templates.get(tid))
      .filter((t): t is CodeTemplate => t !== undefined);
    const xml = exportLibraryToXml(lib, libTemplates);
    downloadFile(xml, `${lib.name}.xml`, { mimeType: "application/xml" });
  }

  function handleExportAllLibraries() {
    const data = libraries.map((lib) => ({
      library: lib,
      templates: lib.codeTemplateIds
        .map((tid) => templates.get(tid))
        .filter((t): t is CodeTemplate => t !== undefined),
    }));
    const xml = exportAllLibrariesToXml(data);
    downloadFile(xml, "CodeTemplateLibraries.xml", { mimeType: "application/xml" });
  }

  // ── Import handler ───────────────────────────────────────────────────────

  function handleImported(result: { libraries: CodeTemplateLibrary[]; templates: CodeTemplate[] }) {
    // Merge templates by ID (overwrite existing, add new)
    setTemplates((prev) => {
      const next = new Map(prev);
      for (const t of result.templates) {
        next.set(t.id, t);
      }
      return next;
    });

    // Merge libraries by ID (overwrite existing, add new)
    if (result.libraries.length > 0) {
      setLibraries((prev) => {
        const libMap = new Map(prev.map((l) => [l.id, l]));
        for (const lib of result.libraries) {
          libMap.set(lib.id, lib);
        }
        return Array.from(libMap.values());
      });
    }

    markDirty();
    // An import can overwrite the currently open template's code — remount the
    // editor so the imported code appears instead of the stale mounted content.
    setCodeReloadKey((k) => k + 1);

    const tCount = result.templates.length;
    const lCount = result.libraries.length;
    const msg =
      lCount > 0
        ? `Imported ${tCount} template(s) in ${lCount} library/libraries`
        : `Imported ${tCount} template(s)`;
    toast.success(msg);
  }

  function handleValidate() {
    if (!editorRef.current) {
      setValidateMsg("No editor open. Select a code template to validate.");
      return;
    }
    const model = editorRef.current.getModel();
    if (!model) return;

    const monaco = monacoRef.current;
    if (!monaco) {
      setValidateMsg("Editor not ready. Please wait a moment and try again.");
      return;
    }

    // Force a synchronous re-validate of the current code before reading markers —
    // mirrors Java's doValidateCodeTemplate(), which validates at click time. Without
    // this we'd read markers left stale by the editor's 600ms debounce #31).
    validateRhinoSyntax(monaco, model);

    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    const errors = markers.filter((m) => m.severity === monaco.MarkerSeverity.Error);
    if (errors.length === 0) {
      setValidateMsg("✓ No JavaScript errors found.");
    } else {
      setValidateMsg(
        `${errors.length} error(s) found:\n` +
          errors.map((e) => `  Line ${e.startLineNumber}: ${e.message}`).join("\n")
      );
    }
  }

  function handleGenerateJsDoc() {
    if (!selectedTemplateId || !selectedTemplate) return;
    const newCode = generateJsDoc(selectedTemplate.code);
    updateTemplate(selectedTemplateId, { code: newCode });
    // Code replaced programmatically (not via the editor) — remount so it appears.
    setCodeReloadKey((k) => k + 1);
  }

  function handleFormat() {
    editorRef.current?.trigger("keyboard", "editor.action.formatDocument", {});
  }

  function checkSaveResult(result: CodeTemplateLibrarySaveResult): string | null {
    if (result.overrideNeeded) {
      // Reached only when a forced override=true still comes back overrideNeeded —
      // mirrors Java CodeTemplatePanel.attemptUpdate's alertError branch.
      return "Unable to save code templates or libraries.";
    }
    if (result.librariesSuccess === false) {
      return "Failed to save code template libraries.";
    }
    let numFailed = 0;
    let firstCause: string | undefined;
    for (const r of Object.values(result.codeTemplateResults ?? {})) {
      if (!r.success) {
        numFailed++;
        if (!firstCause && r.cause?.detailMessage) firstCause = r.cause.detailMessage;
      }
    }
    if (numFailed > 0) {
      const detail = firstCause ? ` First cause: ${firstCause}` : "";
      return `${numFailed} code template(s) failed to be updated or removed.${detail}`;
    }
    return null;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setValidateMsg(null);
    try {
      const origTmpls = originalTemplates.current;
      const origLibIds = new Set(originalLibraries.current.map((l) => l.id));
      const currentLibIds = new Set(libraries.map((l) => l.id));
      const removedLibraryIds = [...origLibIds].filter((id) => !currentLibIds.has(id));

      const origTmplIds = new Set(origTmpls.keys());
      const currentTmplIds = new Set(templates.keys());
      const removedCodeTemplateIds = [...origTmplIds].filter((id) => !currentTmplIds.has(id));

      const updatedCodeTemplates = Array.from(templates.values()).filter((t) => {
        const orig = origTmpls.get(t.id);
        if (!orig) return true;
        return (
          t.name !== orig.name ||
          t.code !== orig.code ||
          t.type !== orig.type ||
          JSON.stringify(t.contextTypes) !== JSON.stringify(orig.contextTypes)
        );
      });

      // Client-side syntax check across every changed template before persisting — mirrors
      // Java's validateAll() gate, but names every offender #4). Blocks the save.
      const jsError = validateCodeTemplatesForSave(updatedCodeTemplates, libraries);
      if (jsError) {
        setError(jsError);
        return;
      }

      const outcome = await saveTemplates({
        libraries,
        removedLibraryIds,
        updatedCodeTemplates,
        removedCodeTemplateIds,
      });
      // User declined the overwrite prompt — leave edits in place so they can retry.
      if (outcome.status === "cancelled") return;

      const saveError = checkSaveResult(outcome.result);
      if (saveError) {
        setError(saveError);
      } else {
        // Fire the post-save repo write only when the owning plugin is enabled
        //; the async gate is load-accurate under a cold cache.
        void slotSurfaceEnabled("code-templates.post-save")
          .then((on) => (on ? getSlot("code-templates.post-save")?.(libraries) : undefined))
          .catch(() => {});
        invalidateCodeTemplateCache();
        clearRepoChangesCache();
        await load(true);
        toast.success("Code templates saved");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveForGuard() {
    const origTmpls = originalTemplates.current;
    const origLibIds = new Set(originalLibraries.current.map((l) => l.id));
    const currentLibIds = new Set(libraries.map((l) => l.id));
    const removedLibraryIds = [...origLibIds].filter((id) => !currentLibIds.has(id));

    const origTmplIds = new Set(origTmpls.keys());
    const currentTmplIds = new Set(templates.keys());
    const removedCodeTemplateIds = [...origTmplIds].filter((id) => !currentTmplIds.has(id));

    const updatedCodeTemplates = Array.from(templates.values()).filter((t) => {
      const orig = origTmpls.get(t.id);
      if (!orig) return true;
      return (
        t.name !== orig.name ||
        t.code !== orig.code ||
        t.type !== orig.type ||
        JSON.stringify(t.contextTypes) !== JSON.stringify(orig.contextTypes)
      );
    });

    // Same blocking syntax gate as handleSave — throw so the navigation guard surfaces the
    // named offenders and aborts the save-on-exit #4).
    const jsError = validateCodeTemplatesForSave(updatedCodeTemplates, libraries);
    if (jsError) throw new Error(jsError);

    // Save-on-exit (navigation guard): route through the same conflict-aware flow as
    // the Save button so a concurrent edit warns here too. If the user declines the
    // overwrite prompt, abort the navigation (NavigationSaveCancelled) rather than
    // saving or surfacing a spurious error.
    const outcome = await saveTemplates({
      libraries,
      removedLibraryIds,
      updatedCodeTemplates,
      removedCodeTemplateIds,
    });
    if (outcome.status === "cancelled") throw new NavigationSaveCancelled();

    const saveError = checkSaveResult(outcome.result);
    if (saveError) throw new Error(saveError);

    invalidateCodeTemplateCache();
    clearRepoChangesCache();
    await load(true);
  }
  // Synced in a deps-less effect (read only from the navigation-guard callback).
  useEffect(() => {
    saveForGuardRef.current = handleSaveForGuard;
  });

  function handleRefresh() {
    if (dirty) {
      setPendingDiscard(true);
      return;
    }
    load();
  }

  function handleMoveTemplateToLibrary(templateId: string, newLibId: string) {
    setLibraries((prev) =>
      prev.map((l) => {
        if (l.id === newLibId && !l.codeTemplateIds.includes(templateId)) {
          return { ...l, codeTemplateIds: [...l.codeTemplateIds, templateId] };
        }
        if (l.id !== newLibId && l.codeTemplateIds.includes(templateId)) {
          return { ...l, codeTemplateIds: l.codeTemplateIds.filter((id) => id !== templateId) };
        }
        return l;
      })
    );
    markDirty();
  }

  // ── Context type helpers ───────────────────────────────────────────────────

  function toggleContextType(contextType: ContextType) {
    if (!selectedTemplateId || !selectedTemplate) return;
    const current = selectedTemplate.contextTypes;
    const next = current.includes(contextType)
      ? current.filter((ct) => ct !== contextType)
      : [...current, contextType];
    updateTemplate(selectedTemplateId, { contextTypes: next });
  }

  function selectAllContextTypes() {
    if (!selectedTemplateId) return;
    updateTemplate(selectedTemplateId, { contextTypes: [...ALL_CONTEXT_TYPES] });
  }

  function deselectAllContextTypes() {
    if (!selectedTemplateId) return;
    updateTemplate(selectedTemplateId, { contextTypes: [] });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const canDelete = selectedLibraryId !== null || selectedTemplateId !== null;

  /** Resolve the library ID for the currently selected item (library or template's parent). */
  const activeLibraryId =
    selectedLibraryId ??
    (selectedTemplateId
      ? (libraries.find((l) => l.codeTemplateIds.includes(selectedTemplateId))?.id ?? null)
      : null);

  const actionPanelProps = {
    position: toolbarPos,
    loading,
    dirty,
    saving,
    canDelete,
    selectedTemplateId,
    selectedLibraryId: activeLibraryId,
    hasLibraries: libraries.length > 0,
    viewOnly: codeTemplatesViewOnly,
    onRefresh: handleRefresh,
    onAddTemplate: handleAddTemplate,
    onAddLibrary: handleAddLibrary,
    onDelete: handleDelete,
    onValidate: handleValidate,
    onSave: handleSave,
    onFindUsage: () => {
      if (selectedTemplateId) setFindUsageOpen(true);
    },
    onExportTemplate: () => {
      if (selectedTemplateId) handleExportTemplate(selectedTemplateId);
    },
    onExportLibrary: () => {
      if (activeLibraryId) handleExportLibrary(activeLibraryId);
    },
    onExportAllLibraries: handleExportAllLibraries,
    onImportTemplate: () => setImportMode("template"),
    onImportLibrary: () => setImportMode("library"),
    onImportFromRepo:
      ImportFromRepoDialog && importRepoEnabled ? () => setImportFromRepoOpen(true) : undefined,
    onViewHistory:
      ((TemplateHistoryDialog && templateHistoryEnabled) ||
        (LibraryHistoryDialog && libraryHistoryEnabled)) &&
      (selectedTemplateId || activeLibraryId)
        ? () => {
            if (selectedTemplateId) setHistoryTarget({ kind: "template", id: selectedTemplateId });
            else if (activeLibraryId) setHistoryTarget({ kind: "library", id: activeLibraryId });
          }
        : undefined,
    onSaveLibraries:
      libraries.length > 0 &&
      ((SaveLibrariesDialog && saveLibrariesDialogEnabled) ||
        (saveLibrariesToRepo && saveLibrariesEnabled))
        ? () => {
            // Prefer the commit-message dialog when the plugin provides
            // one AND its gate passes; otherwise fall back to the legacy silent
            // save-to-repo handler (both are VH-owned today, but the gates are
            // per-slot so a future split-ownership fill stays correct).
            if (SaveLibrariesDialog && saveLibrariesDialogEnabled) {
              setSaveLibrariesOpen(true);
              return;
            }
            void saveLibrariesToRepo!(libraries)
              .then(() => {
                clearRepoChangesCache();
                toast.success("Libraries saved to version history");
              })
              .catch((e: unknown) =>
                toast.error(e instanceof Error ? e.message : "Failed to save libraries")
              );
          }
        : undefined,
  };

  const isHorizontal = toolbarPos === "top" || toolbarPos === "bottom";

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Code Templates" />

      {/* Error and validate messages */}
      <ApiErrorAlert error={error} className="mx-4 mt-2" />
      {validateMsg && (
        <div className="mx-4 mt-2 px-3 py-2 text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded whitespace-pre shrink-0">
          {validateMsg}
        </div>
      )}

      {/* Toolbar + main content */}
      <div className={`flex flex-1 min-h-0 ${isHorizontal ? "flex-col" : "flex-row"}`}>
        {(toolbarPos === "left" || toolbarPos === "top") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <CodeTemplatesActionPanel {...actionPanelProps} />
          </DockableToolbar>
        )}

        <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
          {/* Main split: tree + detail. Orientation toggles between left/right and top/bottom. */}
          <div
            ref={containerRef}
            className={`flex-1 flex overflow-hidden min-h-0 ${treeLayout === "top" ? "flex-col" : "flex-row"}`}
          >
            {/* Tree: library / template list (left or top depending on layout) */}
            <CodeTemplateTreeTable
              layout={treeLayout}
              splitPct={splitPct}
              onToggleLayout={() => setTreeLayout((l) => (l === "left" ? "top" : "left"))}
              libraries={libraries}
              templates={templates}
              filterText={filterText}
              onFilterChange={setFilterText}
              loading={loading}
              selectedLibraryId={selectedLibraryId}
              selectedTemplateId={selectedTemplateId}
              onSelectLibrary={(id) => {
                setSelectedLibraryId(id);
                setSelectedTemplateId(null);
              }}
              onSelectTemplate={(id) => {
                setSelectedTemplateId(id);
                setSelectedLibraryId(null);
              }}
              expandedLibraryIds={expandedLibraryIds}
              onToggleExpand={toggleExpand}
              onExpandAll={setAllExpanded}
              onCollapseAll={collapseAllExpanded}
              treeVisible={treeVisible}
              onHideTree={() => {
                setTreeVisible(false);
                localStorage.setItem("bl-code-templates-tree-visible", "false");
              }}
              onShowTree={() => {
                setTreeVisible(true);
                localStorage.setItem("bl-code-templates-tree-visible", "true");
              }}
              isLibraryNew={isLibraryNew}
              isLibraryModified={isLibraryModified}
              isTemplateNew={isTemplateNew}
              isTemplateModified={isTemplateModified}
              onAddLibrary={handleAddLibrary}
              onAddTemplateToLibrary={addTemplateToLibrary}
              onDeleteLibrary={deleteLibraryById}
              onDeleteTemplate={deleteTemplateById}
              onFindUsage={openFindUsage}
              onExportTemplate={handleExportTemplate}
              onExportLibrary={handleExportLibrary}
              onExportAllLibraries={handleExportAllLibraries}
              getSignatureConflict={getSignatureConflict}
              repoChangedTemplateIds={repoChangedTemplateIds}
              onViewHistoryLibrary={
                LibraryHistoryDialog && libraryHistoryEnabled
                  ? (id) => setHistoryTarget({ kind: "library", id })
                  : undefined
              }
              onViewHistoryTemplate={
                TemplateHistoryDialog && templateHistoryEnabled
                  ? (id) => setHistoryTarget({ kind: "template", id })
                  : undefined
              }
            />

            {/* Draggable resizer between tree and detail (only while the tree is visible) */}
            {treeVisible && (
              <div
                onMouseDown={onResizerMouseDown}
                className={cn(
                  "shrink-0 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors",
                  treeLayout === "top"
                    ? "h-1 w-full cursor-row-resize"
                    : "w-1 h-full cursor-col-resize"
                )}
              />
            )}

            {/* Detail panel (right in left/right layout, bottom in top/bottom layout) */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
              {selectedTemplate && signatureConflictMap.has(selectedTemplate.id) && (
                <SignatureConflictBanner
                  templateId={selectedTemplate.id}
                  conflict={signatureConflictMap.get(selectedTemplate.id)!}
                  libraries={libraries}
                />
              )}
              {selectedTemplate ? (
                <TemplateDetailPanel
                  template={selectedTemplate}
                  codeReloadKey={codeReloadKey}
                  libraries={libraries}
                  channels={channels}
                  templates={templates}
                  findUsageOpen={findUsageOpen}
                  onOpenFindUsage={() => setFindUsageOpen(true)}
                  onFindUsageClose={() => setFindUsageOpen(false)}
                  onSelectTemplate={(tid) => {
                    setSelectedTemplateId(tid);
                    setSelectedLibraryId(null);
                    setFindUsageOpen(false);
                  }}
                  onUpdateTemplate={(patch) => updateTemplate(selectedTemplate.id, patch)}
                  onMoveToLibrary={(libId) =>
                    handleMoveTemplateToLibrary(selectedTemplate.id, libId)
                  }
                  onGenerateJsDoc={handleGenerateJsDoc}
                  onFormat={handleFormat}
                  onToggleContext={toggleContextType}
                  onSelectAllContexts={selectAllContextTypes}
                  onDeselectAllContexts={deselectAllContextTypes}
                  onEditorMount={(editor) => {
                    editorRef.current = editor;
                  }}
                  onMonacoMount={(m) => {
                    monacoRef.current = m;
                  }}
                />
              ) : selectedLibrary ? (
                <LibraryDetailPanel
                  library={selectedLibrary}
                  channels={channels}
                  onUpdate={(patch) => updateLibrary(selectedLibrary.id, patch)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
                  Select a library or code template from the tree.
                </div>
              )}
            </div>
          </div>
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <CodeTemplatesActionPanel {...actionPanelProps} />
          </DockableToolbar>
        )}
      </div>

      {pendingDeleteTemplate && (
        <ConfirmDialog
          title="Delete Code Template"
          description={`Delete code template "${pendingDeleteTemplate.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            const { id } = pendingDeleteTemplate;
            setPendingDeleteTemplate(null);
            executeDeleteTemplate(id);
          }}
          onCancel={() => setPendingDeleteTemplate(null)}
        />
      )}

      {pendingDeleteLibrary && (
        <TypeToConfirmDialog
          title="Delete Library"
          description={`Delete library "${pendingDeleteLibrary.name}" and all ${pendingDeleteLibrary.templateCount} template(s) in it? Type DELETE to confirm.`}
          confirmWord="DELETE"
          confirmLabel="Delete"
          onConfirm={() => {
            const { id } = pendingDeleteLibrary;
            setPendingDeleteLibrary(null);
            executeDeleteLibrary(id);
          }}
          onCancel={() => setPendingDeleteLibrary(null)}
        />
      )}

      {pendingDiscard && (
        <ConfirmDialog
          title="Discard Changes"
          description="Discard unsaved changes and reload?"
          confirmLabel="Discard"
          onConfirm={() => {
            setPendingDiscard(false);
            load();
          }}
          onCancel={() => setPendingDiscard(false)}
        />
      )}

      <ImportCodeTemplateDialog
        open={importMode !== null}
        mode={importMode ?? "template"}
        libraries={libraries}
        templates={templates}
        onClose={() => setImportMode(null)}
        onImported={handleImported}
      />
      {ImportFromRepoDialog && (
        <ImportFromRepoDialog open={importFromRepoOpen} onOpenChange={setImportFromRepoOpen} />
      )}
      {SaveLibrariesDialog && (
        <SaveLibrariesDialog
          open={saveLibrariesOpen}
          onOpenChange={setSaveLibrariesOpen}
          libraries={libraries}
          onCommitted={() => clearRepoChangesCache()}
        />
      )}

      {/* Version history dialogs — controlled by historyTarget state */}
      {(() => {
        const TemplateDialog = TemplateHistoryDialog;
        const tmpl =
          historyTarget?.kind === "template" ? templates.get(historyTarget.id) : undefined;
        return TemplateDialog && historyTarget?.kind === "template" && tmpl ? (
          <TemplateDialog
            open
            onOpenChange={(v) => {
              if (!v) setHistoryTarget(null);
            }}
            templateId={tmpl.id}
            templateName={tmpl.name}
            currentTemplate={tmpl}
            onReverted={() => {
              invalidateCodeTemplateCache();
              clearRepoChangesCache();
              void load(true);
            }}
          />
        ) : null;
      })()}
      {(() => {
        const LibraryDialog = LibraryHistoryDialog;
        const lib =
          historyTarget?.kind === "library"
            ? libraries.find((l) => l.id === historyTarget.id)
            : undefined;
        return LibraryDialog && historyTarget?.kind === "library" && lib ? (
          <LibraryDialog
            open
            onOpenChange={(v) => {
              if (!v) setHistoryTarget(null);
            }}
            libraryId={lib.id}
            libraryName={lib.name}
            currentLibrary={lib}
          />
        ) : null;
      })()}

      {conflictDialog}
    </div>
  );
}
