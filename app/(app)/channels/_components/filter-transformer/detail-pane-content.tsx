"use client";

import type {
  Rule,
  Step,
  RuleBuilderRule,
  JavaScriptRule,
  ExternalScriptRule,
  IteratorRule,
} from "../../_lib/filter-transformer-xml";
import type { ContextType } from "@/lib/types";
import type { EditorContext } from "@/lib/plugin-registry";
import { resolveStep } from "../../_lib/filter-transformer-steps";
import type { TransformerStepBase } from "../../_lib/filter-transformer-steps";
import { RuleBuilderPanel } from "./rule-builder-panel";
import { JavaScriptPanel } from "./javascript-panel";
import { ExternalScriptPanel } from "./external-script-panel";
import { IteratorRulePanel } from "./iterator-rule-panel";

export interface DestInfo {
  metaDataId: number;
  name: string;
}

interface Props {
  selectedItem: Rule | Step | null;
  mode: "filter" | "transformer" | "responseTransformer";
  isDark: boolean;
  destinationConnectors: DestInfo[];
  stepValidation: { ok: boolean; msg: string } | null;
  onChange: (newEl: Rule | Step) => void;
  isSource?: boolean;
  channelId?: string;
  /** Full editor context forwarded to JavaScriptPanel for the AI overlay. */
  context?: EditorContext;
  /** Full element tree — forwarded to panels that apply iterator index substitution on tree-node drops. */
  elements?: (Rule | Step)[];
  /** Path of the selected element — forwarded alongside `elements` for iterator ancestry detection. */
  selectedPath?: number[] | null;
}

export function DetailPaneContent({
  selectedItem,
  mode,
  isDark,
  destinationConnectors,
  stepValidation,
  onChange,
  isSource,
  channelId,
  context,
  elements,
  selectedPath,
}: Props) {
  // Derive the BridgeLink ContextType for code template filtering based on the editor mode.
  const contextType: ContextType | undefined =
    mode === "responseTransformer"
      ? "DESTINATION_RESPONSE_TRANSFORMER"
      : isSource
        ? "SOURCE_FILTER_TRANSFORMER"
        : "DESTINATION_FILTER_TRANSFORMER";

  if (!selectedItem) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500 italic">
        Select a {mode === "filter" ? "rule" : "step"} to view its properties
      </div>
    );
  }

  const el = selectedItem;
  const showErrors = stepValidation?.ok === false;

  // Opaque, unrecognized element: no editor panel exists for it. Show
  // a read-only notice plus the preserved raw XML so the user understands why it
  // cannot be edited and can see what will be kept verbatim on save.
  if (el.type === "unknown") {
    return (
      <div className="flex flex-col h-full p-3 gap-2 text-xs">
        <div className="text-gray-600 dark:text-gray-300">
          This {mode === "filter" ? "rule" : "step"} is not supported by this web client (it comes
          from a plugin or server version not available here). It is shown read-only and preserved
          unchanged when you save.
        </div>
        <textarea
          readOnly
          value={el.rawXml}
          className="flex-1 min-h-0 w-full font-mono text-[11px] rounded border border-input bg-muted p-2 resize-none"
        />
      </div>
    );
  }

  // ─── Filter rules ─ hardcoded dispatch (rules are out of scope for the
  // transformer-step registry). ──────────────────────────────────────────────
  if (mode === "filter") {
    if (el.type === "Rule Builder") {
      return (
        <RuleBuilderPanel
          rule={el as RuleBuilderRule}
          onChange={onChange}
          showErrors={showErrors}
          elements={elements}
          selectedPath={selectedPath}
        />
      );
    }
    if (el.type === "JavaScript") {
      return (
        <JavaScriptPanel
          element={el as JavaScriptRule}
          onChange={onChange}
          isDark={isDark}
          showErrors={showErrors}
          contextType={contextType}
          channelId={channelId}
          context={context}
        />
      );
    }
    if (el.type === "External Script") {
      return (
        <ExternalScriptPanel
          element={el as ExternalScriptRule}
          onChange={onChange}
          showErrors={showErrors}
        />
      );
    }
    if (el.type === "Iterator") {
      return (
        <IteratorRulePanel rule={el as IteratorRule} onChange={onChange} showErrors={showErrors} />
      );
    }
    return null;
  }

  // ─── Transformer steps ─ look up the registered EditorPanel ─────────────
  const def = resolveStep(el.type);
  if (!def) return null;
  const EditorPanel = def.EditorPanel;
  const step = el as unknown as TransformerStepBase;
  return (
    <EditorPanel
      step={step}
      onChange={(next) => onChange(next as Step)}
      isDark={isDark}
      destinations={destinationConnectors}
      showErrors={showErrors}
      contextType={contextType}
      channelId={channelId}
      context={context}
      elements={elements}
      selectedPath={selectedPath}
    />
  );
}
