"use client";

/**
 * Manifest Preview page Slice 3; expanded — hidden route,
 * no sidebar entry.
 *
 * A local playground for authoring a `webadmin.json` manifest: paste JSON on
 * the left, see it rendered by the real production components on the right.
 * Registers nothing, calls no extension endpoints (`actionsDisabled` on every
 * rendered panel), executes nothing — safe by construction. Also serves as
 * the manual regression/dev playground for the manifest corpus, and proves
 * the Slice 2 JSON Schema is wired for Monaco autocomplete.
 *
 * Live-preview discipline: the last VALID manifest stays rendered while the
 * editor text is mid-edit and transiently invalid, so the preview never
 * flickers away between keystrokes and in-form state isn't lost. Syntax and
 * validation errors surface as a non-destructive banner over the last good
 * render.
 *
 * The right pane and its per-kind previews live in _components/preview-pane;
 * the split, seed data, and helpers are in _lib. This file owns the page
 * state (envelope / manifest text / Defaults XML map), the debounced
 * validation, and the left editor pane.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Monaco, OnMount } from "@monaco-editor/react";
import { revealPosition, type MonacoCodeEditor } from "@/lib/monaco-reveal";
import { toast } from "sonner";
import { Copy, Download, RotateCcw, WrapText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/hover-tooltip";
import { MonacoEditor } from "@/components/monaco-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { useTheme } from "@/lib/hooks/use-theme";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { buildPreview, type PreviewEnvelope } from "./_lib/preview-model";
import {
  DEFAULT_ENVELOPE,
  EDITOR_OPTIONS,
  SCHEMA_URI,
  SEED_MANIFEST_TEXT,
  SEED_PROPERTIES_XML,
  synthesizeDataTypeDefaultsXml,
} from "./_lib/seed-manifest";
import { MIN_SPLIT, MAX_SPLIT, useSplitPane } from "./_lib/use-split-pane";
import { locateJsonPath, parseValidationReason } from "./_lib/json-path-position";
import { prettyPrintXml } from "./_lib/pretty-xml";
import { suggestEnvelopePath } from "./_lib/suggest-path";
import { downloadWebadminZip } from "./_lib/download-webadmin-zip";
import { EnvelopeFields } from "./_components/envelope-fields";
import { PreviewPane, dataTypeXmlKey } from "./_components/preview-pane";
import { ExamplesMenu } from "./_components/examples-menu";
import { ReferencePane } from "./_components/reference-pane";
import type { PreviewExample } from "./_lib/examples-data";

const MANIFEST_EDITOR_PATH = "webadmin-preview.json";
const SCHEMA_FETCH_URL = "/schemas/webadmin-plugin.v3.schema.json";

/** One editable "Defaults XML" tab in the left pane. */
interface XmlEditor {
  /** Key into the properties-XML map (transportName for connectors, dt:<name> for data types). */
  key: string;
  tabLabel: string;
  seed: string;
}

export default function ManifestPreviewPage() {
  const { viewDensity } = useCompactMode();
  const { isDark } = useTheme();
  // Bumped on Reset so PreviewPane remounts every preview and drops the local
  // form state each kind's preview keeps (the manifest/XML resets can't reach it).
  const [resetNonce, setResetNonce] = useState(0);
  // Envelope group is collapsed by default (the author cares about the manifest,
  // not the simulated engine identity); jumping to an envelope error expands it.
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  // Once the user hand-edits the path, stop auto-suggesting it. Persisted so a
  // manual path survives a restart (kept consistent with the envelope).
  const [pathEdited, setPathEdited] = useLocalStorageState(
    "bl-manifest-preview-path-edited",
    false
  );

  // Persisted to localStorage so a hand-authored manifest survives a browser
  // restart, not just same-session navigation; Reset restores the seed example.
  // (Migrates any value left in sessionStorage by the previous session-scoped
  // implementation on first mount.)
  const [envelope, setEnvelope] = useLocalStorageState<PreviewEnvelope>(
    "bl-manifest-preview-envelope",
    DEFAULT_ENVELOPE
  );
  const [manifestText, setManifestText] = useLocalStorageState(
    "bl-manifest-preview-text",
    SEED_MANIFEST_TEXT
  );
  const [propertiesXmlByTransport, setPropertiesXmlByTransport] = useLocalStorageState<
    Record<string, string>
  >("bl-manifest-preview-xml", {});

  // preview = live validation of the current text; lastGood = the most recent
  // VALID entry, kept mounted through transient invalid edits. Both are seeded
  // synchronously from the (possibly session-restored) initial values.
  const [preview, setPreview] = useState(() => buildPreview(envelope, manifestText));
  const [lastGood, setLastGood] = useState(() => {
    const p = buildPreview(envelope, manifestText);
    return p.kind === "ok" ? p.entry : null;
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      const p = buildPreview(envelope, manifestText);
      setPreview(p);
      if (p.kind === "ok") setLastGood(p.entry);
    }, 300);
    return () => clearTimeout(timer);
  }, [envelope, manifestText]);

  const attribution = lastGood?.name ?? envelope.name;

  // Auto-suggest the envelope path from the first action endpoint's
  // /extensions/<x>/ segment, until the author edits the path by hand. Suggestion
  // only — never auto-loads anything. Parsed best-effort so it works mid-edit.
  const pathSuggestion = useMemo(() => {
    try {
      return suggestEnvelopePath(JSON.parse(manifestText));
    } catch {
      return null;
    }
  }, [manifestText]);
  useEffect(() => {
    if (pathEdited || !pathSuggestion) return;
    // Debounced + async (setState in a timeout, not the effect body) so it never
    // fights the user's keystrokes and settles once path === suggestion.
    const timer = setTimeout(() => {
      setEnvelope((prev) =>
        prev.path === pathSuggestion ? prev : { ...prev, path: pathSuggestion }
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [pathSuggestion, pathEdited, setEnvelope]);

  // Left-pane Defaults XML tabs: one per connector panel and one per data type.
  const xmlEditors: XmlEditor[] = useMemo(() => {
    const m = lastGood?.manifest;
    if (!m) return [];
    return [
      ...(m.connectorPanels ?? []).map((panel) => ({
        key: panel.transportName,
        tabLabel: `Defaults XML — ${panel.transportName}`,
        seed: SEED_PROPERTIES_XML,
      })),
      ...(m.dataTypes ?? []).map((dataType) => ({
        key: dataTypeXmlKey(dataType.name),
        tabLabel: `Defaults XML — ${dataType.displayName ?? dataType.name} (data type)`,
        seed: synthesizeDataTypeDefaultsXml(dataType),
      })),
    ];
  }, [lastGood]);

  // Left tab is controlled; guard it so it never points at a Defaults-XML tab
  // whose contribution has disappeared (which would blank the editor area).
  const [activeLeftTab, setActiveLeftTab] = useState(MANIFEST_EDITOR_PATH);
  const leftTabValue =
    activeLeftTab === MANIFEST_EDITOR_PATH || xmlEditors.some((e) => e.key === activeLeftTab)
      ? activeLeftTab
      : MANIFEST_EDITOR_PATH;

  const setXml = useCallback(
    (key: string, xml: string) => {
      setPropertiesXmlByTransport((prev) => ({ ...prev, [key]: xml }));
    },
    [setPropertiesXmlByTransport]
  );

  const { containerRef, leftPct, startDrag, onDividerKeyDown } = useSplitPane();

  // ── JSON Schema wiring for Monaco autocomplete (scoped to this editor) ──
  const [schemaJson, setSchemaJson] = useState<object | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(SCHEMA_FETCH_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`schema fetch failed (${r.status})`);
        return r.json();
      })
      .then((json: unknown) => {
        if (!cancelled && json && typeof json === "object") setSchemaJson(json);
      })
      .catch(() => {
        // Autocomplete is a nicety — the page still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<MonacoCodeEditor | null>(null);
  // A jump requested while the Manifest editor isn't mounted (a Defaults XML tab
  // is active) is stashed here and drained by the editor's onMount after the tab
  // switch remounts it.
  const pendingJumpRef = useRef<{ lineNumber: number; column: number } | null>(null);
  const applySchema = useCallback((monaco: Monaco, schema: object) => {
    // fileMatch scopes the schema to THIS editor's model only. jsonDefaults is
    // monaco-global and setDiagnosticsOptions REPLACES the options with no
    // unmount restore — any future JSON-schema caller must merge, not clobber.
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemas: [{ uri: SCHEMA_URI, fileMatch: [MANIFEST_EDITOR_PATH], schema }],
    });
  }, []);
  useEffect(() => {
    if (monacoRef.current && schemaJson) applySchema(monacoRef.current, schemaJson);
  }, [schemaJson, applySchema]);

  const handleManifestEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    if (schemaJson) applySchema(monaco, schemaJson);
    if (pendingJumpRef.current) {
      revealPosition(editor, pendingJumpRef.current);
      pendingJumpRef.current = null;
    }
  };

  // A rejected manifest's reason is JSON-path-addressed; parse it so the banner
  // can offer a jump. Syntax errors and unparseable prefixes yield null (no jump).
  const jumpReason = useMemo(
    () => (preview.kind === "rejected" ? parseValidationReason(preview.reason) : null),
    [preview]
  );
  // Drop a stashed jump once there's no error to jump to, so it can never fire
  // on a later, unrelated tab switch (the manifest was fixed in the meantime).
  useEffect(() => {
    if (!jumpReason) pendingJumpRef.current = null;
  }, [jumpReason]);

  const handleJumpToError = useCallback(() => {
    if (!jumpReason) return;
    if (jumpReason.scope === "envelope") {
      // Envelope fields aren't in the editor text — expand the group and focus.
      setEnvelopeOpen(true);
      requestAnimationFrame(() =>
        document.getElementById(`preview-envelope-${jumpReason.field}`)?.focus()
      );
      return;
    }
    const loc = locateJsonPath(manifestText, jumpReason.segments);
    if (!loc) return;
    const pos = { lineNumber: loc.line, column: loc.column };
    // Radix unmounts the inactive Manifest editor; if a Defaults XML tab is
    // active, switch back and let onMount drain the pending jump.
    if (leftTabValue === MANIFEST_EDITOR_PATH && editorRef.current) {
      revealPosition(editorRef.current, pos);
    } else {
      pendingJumpRef.current = pos;
      setActiveLeftTab(MANIFEST_EDITOR_PATH);
    }
  }, [jumpReason, manifestText, leftTabValue]);

  const handleReset = useCallback(() => {
    setEnvelope(DEFAULT_ENVELOPE);
    setManifestText(SEED_MANIFEST_TEXT);
    setPropertiesXmlByTransport({});
    setResetNonce((n) => n + 1);
    setPathEdited(false);
    setEnvelopeOpen(false);
    pendingJumpRef.current = null;
    toast.success("Reset to the example manifest.");
  }, [setEnvelope, setManifestText, setPropertiesXmlByTransport, setPathEdited]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(manifestText).then(
      () => toast.success("Manifest copied to clipboard."),
      () => toast.error("Could not copy to clipboard.")
    );
  }, [manifestText]);

  const handleDownloadZip = useCallback(() => {
    // Re-validate the CURRENT text: the disabled gate reads the 300 ms-debounced
    // preview, so a just-typed invalid edit could still be clickable.
    if (buildPreview(envelope, manifestText).kind !== "ok") {
      toast.error("Fix validation errors before downloading.");
      return;
    }
    downloadWebadminZip(manifestText, envelope.path).then(
      () => toast.success("Downloaded webadmin/webadmin.json."),
      () => toast.error("Could not build the download.")
    );
  }, [manifestText, envelope]);

  const handleLoadExample = useCallback(
    (ex: PreviewExample) => {
      setEnvelope(ex.envelope);
      setManifestText(ex.manifestText);
      setPropertiesXmlByTransport({});
      setResetNonce((n) => n + 1);
      setPathEdited(false);
      pendingJumpRef.current = null;
      toast.success(`Loaded "${ex.label}".`);
    },
    [setEnvelope, setManifestText, setPropertiesXmlByTransport, setPathEdited]
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Manifest Preview"
        subtitle="Paste a webadmin.json manifest to see it rendered by the real WebAdmin components — nothing is registered, no extension endpoints are called."
        actions={
          <div className="flex items-center gap-2">
            <ExamplesMenu onLoad={handleLoadExample} />
            <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" /> Copy manifest
            </Button>
            <HoverTooltip content={preview.kind === "ok" ? "" : "Fix validation errors first"}>
              {/* Span wrapper: a disabled button has pointer-events:none, so the
                  tooltip trigger must sit on an element that still receives hover. */}
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={preview.kind !== "ok"}
                  onClick={handleDownloadZip}
                >
                  <Download className="size-3.5" /> Download webadmin/
                </Button>
              </span>
            </HoverTooltip>
            <Button type="button" variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="size-3.5" /> Reset to example
            </Button>
          </div>
        }
      />
      <div ref={containerRef} className={`flex flex-1 min-h-0 ${pagePadding(viewDensity)}`}>
        {/* ── Editor pane ── */}
        <div
          style={{ width: `${leftPct}%` }}
          className="flex flex-col min-h-0 border border-border rounded-lg overflow-hidden bg-card"
        >
          <EnvelopeFields
            envelope={envelope}
            onChange={setEnvelope}
            open={envelopeOpen}
            onOpenChange={setEnvelopeOpen}
            onPathUserEdit={() => setPathEdited(true)}
            pathSuggested={
              !pathEdited && pathSuggestion !== null && envelope.path === pathSuggestion
            }
          />
          <Tabs
            value={leftTabValue}
            onValueChange={setActiveLeftTab}
            className="flex flex-col flex-1 min-h-0"
          >
            <TabsList className="shrink-0 overflow-x-auto flex-nowrap">
              <TabsTrigger value={MANIFEST_EDITOR_PATH}>Manifest</TabsTrigger>
              {xmlEditors.map((ed) => (
                <TabsTrigger key={ed.key} value={ed.key}>
                  {ed.tabLabel}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={MANIFEST_EDITOR_PATH} className="min-h-0">
              <MonacoEditor
                language="json"
                path={MANIFEST_EDITOR_PATH}
                value={manifestText}
                onChange={(value) => setManifestText(value ?? "")}
                onMount={handleManifestEditorMount}
                options={EDITOR_OPTIONS}
              />
            </TabsContent>
            {xmlEditors.map((ed) => (
              <TabsContent key={ed.key} value={ed.key} className="flex min-h-0 flex-col">
                <div className="flex shrink-0 justify-end border-b border-border px-2 py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setXml(ed.key, prettyPrintXml(propertiesXmlByTransport[ed.key] ?? ed.seed))
                    }
                  >
                    <WrapText className="size-3.5" /> Format
                  </Button>
                </div>
                <div className="min-h-0 flex-1">
                  <MonacoEditor
                    language="xml"
                    path={`webadmin-preview-defaults-${ed.key}.xml`}
                    value={propertiesXmlByTransport[ed.key] ?? ed.seed}
                    onChange={(value) => setXml(ed.key, value ?? "")}
                    options={EDITOR_OPTIONS}
                  />
                </div>
              </TabsContent>
            ))}
          </Tabs>
          <p className="shrink-0 border-t border-border px-2.5 py-1 text-xs text-muted-foreground">
            Schema-aware editor — press{" "}
            <kbd className="rounded border border-border bg-muted px-1">Ctrl</kbd>+
            <kbd className="rounded border border-border bg-muted px-1">Space</kbd> for completions;
            problems underline inline. Add a <code className="font-mono">$schema</code> line for
            editor autocomplete.
          </p>
        </div>

        {/* ── Drag handle ── */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor and preview panes"
          aria-valuenow={Math.round(leftPct)}
          aria-valuemin={MIN_SPLIT}
          aria-valuemax={MAX_SPLIT}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={onDividerKeyDown}
          className="group mx-1 flex w-2 shrink-0 cursor-col-resize items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <div className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-blue-400 group-focus-visible:bg-blue-400" />
        </div>

        {/* ── Preview pane ── */}
        <div className="flex flex-1 min-w-0 flex-col min-h-0 border border-border rounded-lg overflow-hidden bg-card">
          <PreviewPane
            preview={preview}
            lastGood={lastGood}
            attribution={attribution}
            xmlByKey={propertiesXmlByTransport}
            onXmlChange={setXml}
            isDark={isDark}
            resetNonce={resetNonce}
            onJumpToError={jumpReason ? handleJumpToError : undefined}
          />
          <ReferencePane schema={schemaJson} open={referenceOpen} onOpenChange={setReferenceOpen} />
        </div>
      </div>
    </div>
  );
}
