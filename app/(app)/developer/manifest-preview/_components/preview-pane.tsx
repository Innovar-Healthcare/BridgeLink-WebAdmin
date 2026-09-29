"use client";

/**
 * Right-pane orchestrator for the Manifest Preview page (extracted from
 * page.tsx and extended to all six contribution kinds,. Builds one
 * tab per declared contribution from the last-good manifest, renders the
 * matching preview component, and surfaces the non-destructive validation
 * banner over them.
 *
 * XML-backed kinds (connector panels, data types) read their properties XML
 * from the page-owned `xmlByKey` map so the left-pane "Defaults XML" editors
 * and the preview stay two-way bound; connector panels also write back through
 * `onXmlChange`. Data types only read their author-supplied defaults here (the
 * per-side working copies live inside DataTypePreview).
 */

import { useMemo } from "react";
import { Monitor, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { ViewDensityOverrideContext, type ViewDensity } from "@/lib/hooks/use-compact-mode";
import type {
  ConnectorPanelContribution,
  ConnectorSectionContribution,
  DataTypeContribution,
  SettingsPanelContribution,
  TransformerStepContribution,
  TransmissionModeContribution,
  ValidatedManifestEntry,
} from "@/lib/runtime-plugins/manifest-types";
import type { PreviewResult } from "../_lib/preview-model";
import { SEED_PROPERTIES_XML, synthesizeDataTypeDefaultsXml } from "../_lib/seed-manifest";
import { ManifestRejectionCard } from "./manifest-rejection-card";
import { ConnectorPanelPreview } from "./connector-panel-preview";
import { SettingsPanelPreview } from "./settings-panel-preview";
import { TransmissionModePreview } from "./transmission-mode-preview";
import { DataTypePreview } from "./data-type-preview";
import { ConnectorSectionPreview } from "./connector-section-preview";
import { TransformerStepPreview } from "./transformer-step-preview";

// Preview-scoped cycles; null = follow the global/app setting ("auto").
const DENSITY_CYCLE: (ViewDensity | null)[] = [null, "comfortable", "default", "compact"];
const DARK_CYCLE: (boolean | null)[] = [null, true, false]; // auto → dark → light
const densityLabel = (d: ViewDensity | null) => d ?? "auto";
const darkLabel = (d: boolean | null) => (d === null ? "auto" : d ? "dark" : "light");
const isViewDensity = (v: unknown): v is ViewDensity =>
  v === "comfortable" || v === "default" || v === "compact";

/** Data-type Defaults XML shares the connector XML map under a `dt:` prefix
 * (":" is illegal in a manifest name, so it can never collide with a transport). */
export const dataTypeXmlKey = (name: string) => `dt:${name}`;

/** A right-pane tab: the value is namespaced so identifiers can never collide across kinds. */
type PreviewTab =
  | { value: string; label: string; kind: "connector"; panel: ConnectorPanelContribution }
  | { value: string; label: string; kind: "settings"; panel: SettingsPanelContribution }
  | { value: string; label: string; kind: "transmissionMode"; mode: TransmissionModeContribution }
  | { value: string; label: string; kind: "dataType"; dataType: DataTypeContribution }
  | {
      value: string;
      label: string;
      kind: "connectorSection";
      section: ConnectorSectionContribution;
    }
  | { value: string; label: string; kind: "transformerStep"; step: TransformerStepContribution };

function buildPreviewTabs(entry: ValidatedManifestEntry | null): PreviewTab[] {
  const m = entry?.manifest;
  if (!m) return [];
  return [
    ...(m.connectorPanels ?? []).map(
      (panel): PreviewTab => ({
        value: `c:${panel.transportName}`,
        label: panel.transportName,
        kind: "connector",
        panel,
      })
    ),
    ...(m.settingsPanels ?? []).map(
      (panel): PreviewTab => ({
        value: `s:${panel.tabKey}`,
        label: panel.tabLabel,
        kind: "settings",
        panel,
      })
    ),
    ...(m.transmissionModes ?? []).map(
      (mode): PreviewTab => ({
        value: `m:${mode.name}`,
        label: mode.displayName,
        kind: "transmissionMode",
        mode,
      })
    ),
    ...(m.dataTypes ?? []).map(
      (dataType): PreviewTab => ({
        value: `d:${dataType.name}`,
        label: dataType.displayName ?? dataType.name,
        kind: "dataType",
        dataType,
      })
    ),
    ...(m.connectorSections ?? []).map(
      (section): PreviewTab => ({
        // (mode, propertiesClass) is the unique pair — the same class on both
        // modes is the validator-blessed SSL mirror pattern, so mode must be in
        // the key or the two tabs would collide.
        value: `x:${section.mode}:${section.propertiesClass}`,
        label: section.name,
        kind: "connectorSection",
        section,
      })
    ),
    ...(m.transformerSteps ?? []).map(
      (step): PreviewTab => ({
        value: `t:${step.name}`,
        label: step.name,
        kind: "transformerStep",
        step,
      })
    ),
  ];
}

export function PreviewPane({
  preview,
  lastGood,
  attribution,
  xmlByKey,
  onXmlChange,
  isDark,
  resetNonce = 0,
  onJumpToError,
}: {
  preview: PreviewResult;
  lastGood: ValidatedManifestEntry | null;
  attribution: string;
  xmlByKey: Record<string, string>;
  onXmlChange: (key: string, xml: string) => void;
  isDark?: boolean;
  /** Bumped by the page's Reset action to force every preview to remount and
   *  drop its local form state (each kind's edits live inside its own component). */
  resetNonce?: number;
  /** When set (a locatable validation error), the banner shows "Jump to error". */
  onJumpToError?: () => void;
}) {
  const previewTabs = useMemo(() => buildPreviewTabs(lastGood), [lastGood]);
  // Remounting the uncontrolled Tabs via `key` when the tab SET changes resets
  // it to the first tab; an unrelated re-validation (same tabs) leaves the
  // user's active tab untouched. The resetNonce suffix additionally remounts
  // every preview on an explicit Reset, clearing their local form state.
  const previewTabsKey = `${previewTabs.map((t) => t.value).join("|")}#${resetNonce}`;

  // Pane-scoped theme/density overrides (null = follow the global/app setting).
  // Both cycle through null → … so the author can always return to "auto".
  const [darkOverride, setDarkOverride] = useLocalStorageState<boolean | null>(
    "bl-manifest-preview-dark",
    null
  );
  const [densityRaw, setDensityOverride] = useLocalStorageState<ViewDensity | null>(
    "bl-manifest-preview-density",
    null
  );
  // Guard a hand-edited / legacy stored value against the ViewDensity type.
  const densityOverride = isViewDensity(densityRaw) ? densityRaw : null;
  const effectiveDark = darkOverride ?? isDark ?? false;
  const cycleDark = () =>
    setDarkOverride(DARK_CYCLE[(DARK_CYCLE.indexOf(darkOverride) + 1) % DARK_CYCLE.length]);
  const cycleDensity = () =>
    setDensityOverride(
      DENSITY_CYCLE[(DENSITY_CYCLE.indexOf(densityOverride) + 1) % DENSITY_CYCLE.length]
    );

  const DarkIcon = darkOverride === null ? Monitor : darkOverride ? Moon : Sun;
  const toolbar = (
    <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1">
      <button
        type="button"
        onClick={cycleDark}
        aria-label={`Preview theme: ${darkLabel(darkOverride)} (click to cycle)`}
        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
      >
        <DarkIcon className="size-3.5" /> {darkLabel(darkOverride)}
      </button>
      <button
        type="button"
        onClick={cycleDensity}
        aria-label={`Preview density: ${densityLabel(densityOverride)} (click to cycle)`}
        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
      >
        <SlidersHorizontal className="size-3.5" /> {densityLabel(densityOverride)}
      </button>
    </div>
  );

  const errorBanner = preview.kind !== "ok" && (
    <ManifestRejectionCard
      compact={previewTabs.length > 0}
      severity={preview.kind === "syntax-error" ? "error" : "warning"}
      title={
        preview.kind === "syntax-error"
          ? "Manifest is not valid JSON"
          : "Manifest failed validation"
      }
      detail={preview.kind === "syntax-error" ? preview.message : preview.reason}
      note={previewTabs.length > 0 ? "Showing the last valid manifest below." : undefined}
      onJump={onJumpToError}
    />
  );

  // The dark override is scoped by a nested `.dark` wrapper (Tailwind v4
  // `@custom-variant dark (&:is(.dark *))`). Known limitations, acceptable for a
  // dev playground: (1) Radix dialogs (dialog-presentation sections, the script
  // editor) portal to document.body and escape this CSS scope; (2) Monaco's
  // theme is page-global, so opening a script editor from a dark-overridden pane
  // in a light app briefly themes every editor on the page. (3) The persisted
  // override is per-key, not synced across tabs — last writer wins on restart.
  const content =
    previewTabs.length === 0 ? (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {preview.kind !== "ok" ? (
          errorBanner
        ) : (
          <p className="text-sm text-muted-foreground">
            Valid manifest, but it declares no previewable contributions.
          </p>
        )}
      </div>
    ) : (
      <>
        {preview.kind !== "ok" && (
          <div className="shrink-0 border-b border-border p-2">{errorBanner}</div>
        )}
        <Tabs
          key={previewTabsKey}
          defaultValue={previewTabs[0].value}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="shrink-0 overflow-x-auto flex-nowrap">
            {previewTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {previewTabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="min-h-0 overflow-auto p-3">
              {tab.kind === "connector" && (
                <ConnectorPanelPreview
                  panel={tab.panel}
                  attribution={attribution}
                  propertiesXml={xmlByKey[tab.panel.transportName] ?? SEED_PROPERTIES_XML}
                  onPropertiesXmlChange={(xml) => onXmlChange(tab.panel.transportName, xml)}
                />
              )}
              {tab.kind === "settings" && (
                <SettingsPanelPreview panel={tab.panel} attribution={attribution} />
              )}
              {tab.kind === "transmissionMode" && (
                <TransmissionModePreview mode={tab.mode} attribution={attribution} />
              )}
              {tab.kind === "dataType" && (
                <DataTypePreview
                  dataType={tab.dataType}
                  attribution={attribution}
                  defaultsXml={
                    xmlByKey[dataTypeXmlKey(tab.dataType.name)] ??
                    synthesizeDataTypeDefaultsXml(tab.dataType)
                  }
                  isDark={effectiveDark}
                />
              )}
              {tab.kind === "connectorSection" && (
                <ConnectorSectionPreview section={tab.section} attribution={attribution} />
              )}
              {tab.kind === "transformerStep" && (
                <TransformerStepPreview
                  step={tab.step}
                  attribution={attribution}
                  isDark={effectiveDark}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </>
    );

  return (
    <ViewDensityOverrideContext.Provider value={densityOverride ?? undefined}>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          effectiveDark && "dark bg-background text-foreground"
        )}
      >
        {toolbar}
        {content}
      </div>
    </ViewDensityOverrideContext.Provider>
  );
}
