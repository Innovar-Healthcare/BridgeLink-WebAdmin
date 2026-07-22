"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, GitBranch } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { CodeTemplateEditor } from "@/components/code-template-editor";
import type * as MonacoType from "monaco-editor";
import { cn } from "@/lib/utils";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import type { CodeTemplate, CodeTemplateLibrary, CodeTemplateType, ContextType } from "@/lib/types";
import { FindUsageDialog } from "./find-usage-dialog";
import { DependencyPanel } from "./dependency-panel";
import { extractFunctionName } from "../_lib/find-usage";
import { FormCheckbox } from "@/components/ui/form-checkbox";

// ─── Constants (only used in this panel) ─────────────────────────────────────

export const CODE_TEMPLATE_TYPES: { value: CodeTemplateType; label: string }[] = [
  { value: "FUNCTION", label: "Function" },
  { value: "DRAG_AND_DROP_CODE", label: "Drag-and-Drop Code Block" },
  { value: "COMPILED_CODE", label: "Compiled Code Block" },
];

/** All 15 ContextTypes grouped for the checkbox panel — mirrors Java layout exactly. */
export const CONTEXT_GROUPS: Array<{
  label: string;
  items: Array<{ type: ContextType; label: string }>;
}> = [
  {
    label: "Global Scripts",
    items: [
      { type: "GLOBAL_DEPLOY", label: "Deploy Script" },
      { type: "GLOBAL_UNDEPLOY", label: "Undeploy Script" },
      { type: "GLOBAL_PREPROCESSOR", label: "Preprocessor Script" },
      { type: "GLOBAL_POSTPROCESSOR", label: "Postprocessor Script" },
    ],
  },
  {
    label: "Channel Scripts",
    items: [
      { type: "CHANNEL_DEPLOY", label: "Deploy Script" },
      { type: "CHANNEL_UNDEPLOY", label: "Undeploy Script" },
      { type: "CHANNEL_PREPROCESSOR", label: "Preprocessor Script" },
      { type: "CHANNEL_POSTPROCESSOR", label: "Postprocessor Script" },
      { type: "CHANNEL_ATTACHMENT", label: "Attachment Script" },
      { type: "CHANNEL_BATCH", label: "Batch Script" },
    ],
  },
  {
    label: "Source Connector",
    items: [
      { type: "SOURCE_RECEIVER", label: "Receiver Script(s)" },
      { type: "SOURCE_FILTER_TRANSFORMER", label: "Filter / Transformer Script" },
    ],
  },
  {
    label: "Destination Connector",
    items: [
      { type: "DESTINATION_FILTER_TRANSFORMER", label: "Filter / Transformer Script" },
      { type: "DESTINATION_DISPATCHER", label: "Dispatcher Script" },
      { type: "DESTINATION_RESPONSE_TRANSFORMER", label: "Response Transformer Script" },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface TemplateDetailPanelProps {
  template: CodeTemplate;
  /** Bumped by the page when the open template's code is replaced from a non-typing
   *  source; combined with the template id into the editor's `key` to force a remount. */
  codeReloadKey: number;
  libraries: CodeTemplateLibrary[];
  channels: Map<string, string>;
  templates: Map<string, CodeTemplate>;
  findUsageOpen: boolean;
  onOpenFindUsage: () => void;
  onFindUsageClose: () => void;
  onSelectTemplate: (templateId: string) => void;
  onUpdateTemplate: (patch: Partial<CodeTemplate>) => void;
  onMoveToLibrary: (libId: string) => void;
  onGenerateJsDoc: () => void;
  onFormat: () => void;
  onToggleContext: (ct: ContextType) => void;
  onSelectAllContexts: () => void;
  onDeselectAllContexts: () => void;
  onEditorMount: (editor: MonacoType.editor.IStandaloneCodeEditor) => void;
  onMonacoMount: (monaco: typeof MonacoType) => void;
}

export function TemplateDetailPanel({
  template,
  codeReloadKey,
  libraries,
  channels,
  templates,
  findUsageOpen,
  onOpenFindUsage,
  onFindUsageClose,
  onSelectTemplate,
  onUpdateTemplate,
  onMoveToLibrary,
  onGenerateJsDoc,
  onFormat,
  onToggleContext,
  onSelectAllContexts,
  onDeselectAllContexts,
  onEditorMount,
  onMonacoMount,
}: TemplateDetailPanelProps) {
  const { viewDensity } = useCompactMode();

  // Find which library owns this template
  const ownerLib = libraries.find((l) => l.codeTemplateIds.includes(template.id));

  const [contextVisible, setContextVisible] = useState(
    () =>
      typeof window === "undefined" ||
      localStorage.getItem("bl-code-templates-context-visible") !== "false"
  );
  const [depsVisible, setDepsVisible] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("bl-code-templates-deps-visible") === "true"
  );

  const fnName = extractFunctionName(template.code);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header row: name, library picker, type picker */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-white dark:bg-gray-900 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <label className="text-sm text-gray-500 dark:text-gray-400 shrink-0">Name:</label>
          <input
            type="text"
            value={template.name}
            onChange={(e) => onUpdateTemplate({ name: e.target.value })}
            className={`border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-400 ${densityHeight(viewDensity)}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400 shrink-0">Library:</label>
          <select
            value={ownerLib?.id ?? ""}
            onChange={(e) => onMoveToLibrary(e.target.value)}
            className={`border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 ${densityHeight(viewDensity)}`}
          >
            {libraries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-400 shrink-0">Type:</label>
          <select
            value={template.type}
            onChange={(e) => onUpdateTemplate({ type: e.target.value as CodeTemplateType })}
            className={`border border-border dark:bg-gray-700 dark:text-gray-200 rounded px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 ${densityHeight(viewDensity)}`}
          >
            {CODE_TEMPLATE_TYPES.map((ct) => (
              <option key={ct.value} value={ct.value}>
                {ct.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Editor + Context side-by-side */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Monaco editor */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 min-h-0">
            <CodeTemplateEditor
              key={`${template.id}:${codeReloadKey}`}
              defaultValue={template.code}
              onChange={(val) => onUpdateTemplate({ code: val })}
              height="100%"
              onEditorMount={onEditorMount}
              onMonacoMount={onMonacoMount}
              aiContext={{
                location: "code-template",
                templateName: template.name,
                templateType: template.type,
                contextTypes: template.contextTypes,
              }}
            />
          </div>
          {/* Action buttons below editor */}
          <div className="px-3 py-1.5 border-t border-border bg-white dark:bg-gray-900 shrink-0 flex justify-between gap-2">
            <div className="flex gap-2">
              <button
                onClick={onOpenFindUsage}
                disabled={!fnName}
                title={
                  fnName
                    ? `Search channels for references to ${fnName}()`
                    : "No function declaration found — add a function to enable Find Usage"
                }
                className="px-3 py-1 text-sm bg-white dark:bg-gray-800 dark:text-gray-300 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Find Usage
              </button>
              <button
                onClick={() => {
                  const next = !depsVisible;
                  setDepsVisible(next);
                  localStorage.setItem("bl-code-templates-deps-visible", String(next));
                }}
                title={depsVisible ? "Hide dependency panel" : "Show dependency panel"}
                className={cn(
                  "flex items-center gap-1 px-3 py-1 text-sm border rounded",
                  depsVisible
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700"
                    : "bg-white dark:bg-gray-800 dark:text-gray-300 border-border hover:bg-gray-50 dark:hover:bg-gray-700"
                )}
              >
                <GitBranch className="w-3.5 h-3.5" />
                Dependencies
              </button>
            </div>
            <div className="flex gap-2">
              <HoverTooltip content="Auto-format the JavaScript code using the built-in formatter.">
                <button
                  onClick={onFormat}
                  className="px-3 py-1 text-sm bg-white dark:bg-gray-800 dark:text-gray-300 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Format Code
                </button>
              </HoverTooltip>
              <HoverTooltip content="Generates/updates a JSDoc at the beginning of your code, with parameter/return annotations as needed.">
                <button
                  onClick={onGenerateJsDoc}
                  className="px-3 py-1 text-sm bg-white dark:bg-gray-800 dark:text-gray-300 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  {template.code.trimStart().startsWith("/**") ? "Update JSDoc" : "Generate JSDoc"}
                </button>
              </HoverTooltip>
            </div>
          </div>

          {/* Dependency panel (below action buttons) */}
          {depsVisible && (
            <DependencyPanel
              template={template}
              templates={templates}
              libraries={libraries}
              channels={channels}
              onSelectTemplate={onSelectTemplate}
            />
          )}
        </div>

        {/* Context checkboxes (right side) */}
        <div
          className={cn(
            "shrink-0 border-l border-border bg-white dark:bg-gray-900 flex flex-col",
            contextVisible ? "w-56 overflow-y-auto" : "w-8"
          )}
        >
          {contextVisible ? (
            <>
              <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1">
                  <HoverTooltip content="Hide context panel">
                    <button
                      onClick={() => {
                        setContextVisible(false);
                        localStorage.setItem("bl-code-templates-context-visible", "false");
                      }}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </HoverTooltip>
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                    Context
                  </span>
                </div>
                <div className="flex gap-2 text-xs text-blue-600 dark:text-blue-400">
                  <button onClick={onSelectAllContexts} className="hover:underline">
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button onClick={onDeselectAllContexts} className="hover:underline">
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
                {CONTEXT_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 px-1">
                      {group.label}
                    </div>
                    {group.items.map(({ type, label }) => (
                      <FormCheckbox
                        key={type}
                        label={label}
                        checked={template.contextTypes.includes(type)}
                        onChange={() => onToggleContext(type)}
                        size="xs"
                        className="px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center pt-2">
              <HoverTooltip content="Show context panel">
                <button
                  onClick={() => {
                    setContextVisible(true);
                    localStorage.setItem("bl-code-templates-context-visible", "true");
                  }}
                  className="p-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </HoverTooltip>
            </div>
          )}
        </div>
      </div>

      <FindUsageDialog
        template={template}
        libraries={libraries}
        channels={channels}
        templates={templates}
        open={findUsageOpen}
        onClose={onFindUsageClose}
        onSelectTemplate={onSelectTemplate}
      />
    </div>
  );
}
