"use client";

import { useState, useRef } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronDown as ChevronDownSmall,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelBottom,
  PanelRight,
  CheckCircle,
  AlertCircle,
  X,
} from "lucide-react";
import type { Rule, Step, TransformerState } from "../../_lib/filter-transformer-xml";
import { ReferencePanel } from "./reference-panel";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import type { EditorContext } from "@/lib/plugin-registry";
import { useFilterTransformerState, pathsEqual } from "./use-filter-transformer-state";
import { useResizablePanels, COLLAPSED_LEFT_W, COLLAPSED_RIGHT_W } from "./use-resizable-panels";
import { ElementRow } from "./element-row";
import { DetailPaneContent, type DestInfo } from "./detail-pane-content";
import { BottomGeneratedScript } from "./bottom-generated-script";
import { IteratorWizardDialog } from "./iterator-wizard-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type { DestInfo };

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  mode: "filter" | "transformer" | "responseTransformer";
  isSource: boolean;
  /** Raw XML of <filter> or <transformer>. Must be a valid XML string. */
  xml: string;
  onChange: (xml: string) => void;
  onBack: () => void;
  /** Destination connectors for DestinationSetFilterStep. */
  destinationConnectors: DestInfo[];
  isDark: boolean;
  /** Display title shown in the header, e.g. "Source Filter". */
  title: string;
  /**
   * Filter mode only: the sibling <transformer> XML.
   * The filter has no inbound data type of its own — it shares <inboundDataType>
   * with the transformer. Passing this prop enables the reference panel to show
   * (and allow editing) the shared inbound data type / template.
   */
  transformerXml?: string;
  /** Filter mode only: called when the shared inbound data type or template changes. */
  onTransformerChange?: (newXml: string) => void;
  /** Channel ID — passed to reference panel to filter code templates by enabled libraries */
  channelId?: string;
  /** Channel name — forwarded to the AI overlay for context-aware code generation. */
  channelName?: string;
  /**
   * When true, automatically validates the selected element whenever the selection changes,
   * surfacing red-border highlighting without requiring a manual "Validate" click.
   * Set by the channel editor after a failed save to guide the user to fix errors.
   */
  autoValidate?: boolean;
  /**
   * When true (source mode only), the inbound data type selector in the reference panel
   * is locked. Set when the source connector requires a specific inbound type.
   */
  sourceInboundLocked?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FilterTransformerEditor({
  mode,
  isSource,
  xml,
  onChange,
  onBack,
  destinationConnectors,
  isDark,
  title,
  transformerXml,
  onTransformerChange,
  channelId,
  channelName,
  autoValidate,
  sourceInboundLocked,
}: Props) {
  const { viewDensity } = useCompactMode();
  const rowPy =
    viewDensity === "comfortable" ? "py-1.5" : viewDensity === "compact" ? "py-0.5" : "py-1";
  const barPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5";

  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  function openImportPicker() {
    setImportError(null);
    importFileRef.current?.click();
  }

  function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      try {
        handleImportFile(content);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Import failed.");
      }
    };
    reader.readAsText(file);
  }

  const {
    parsed,
    transformerState,
    selectedPath,
    setSelectedPath,
    addMenuOpen,
    setAddMenuOpen,
    bottomTab,
    setBottomTab,
    stepValidation,
    setStepValidation,
    allValidation,
    setAllValidation,
    elements,
    displayItems,
    selectedItem,
    generatedScript,
    availableVariables,
    availableTypes,
    childTypes,
    addIsForChild,
    typesToShow,
    canDelete,
    canMoveUp,
    canMoveDown,
    isInsideIterator,
    stepListDragOver,
    onStepListDragOver,
    onStepListDragLeave,
    onStepListDrop,
    handleAdd,
    handleDelete,
    handleMoveUp,
    handleMoveDown,
    handleElementChange,
    handleToggleEnabled,
    handleOperatorChange,
    handleTypeChange,
    handleValidateStep,
    handleValidateAll,
    handleTreeContextAction,
    handleCreateMessageBuilderFromTreesWithIterator,
    handleRefTypeChange,
    handleRefTemplateChange,
    dropInteraction,
    handleDropConfirmYes,
    handleDropConfirmNo,
    handleDropConfirmCancel,
    handleWizardComplete,
    handleWizardCancel,
    moveOutConfirm,
    handleMoveOutConfirmed,
    handleMoveOutCancelled,
    typeChangeConfirm,
    handleTypeChangeConfirmed,
    handleTypeChangeCancelled,
    deleteConfirm,
    handleDeleteConfirmed,
    handleDeleteCancelled,
    assignToIteratorOpen,
    assignInfo,
    handleAssignToIterator,
    handleAssignToIteratorComplete,
    handleAssignToIteratorCancel,
    handleRemoveFromIterator,
    importConfirm,
    handleImportFile,
    handleImportAppend,
    handleImportReplace,
    handleImportCancel,
    handleExport,
  } = useFilterTransformerState({
    mode,
    isSource,
    xml,
    onChange,
    transformerXml,
    onTransformerChange,
    autoValidate,
  });

  const {
    leftPanelWidth,
    leftCollapsed,
    setLeftCollapsed,
    onLeftPanelResizeMouseDown,
    refPanelWidth,
    rightCollapsed,
    setRightCollapsed,
    onRefPanelResizeMouseDown,
    ftLayout,
    setFtLayout,
    tbSplitPct,
    tbContainerRef,
    tbResizerMouseDown,
  } = useResizablePanels();

  // ── Template info for reference panel ───────────────────────────────────────

  const isTransformerLike = mode === "transformer" || mode === "responseTransformer";
  const refDataType = isTransformerLike
    ? (parsed as TransformerState).inboundDataType
    : transformerState?.inboundDataType;
  const refTemplate = isTransformerLike
    ? (parsed as TransformerState).inboundTemplate
    : (transformerState?.inboundTemplate ?? null);
  const refOutboundDataType = isTransformerLike
    ? (parsed as TransformerState).outboundDataType
    : undefined;
  const refOutboundTemplate = isTransformerLike
    ? (parsed as TransformerState).outboundTemplate
    : null;
  const refInboundPropsXml = isTransformerLike
    ? (parsed as TransformerState).inboundPropertiesXml
    : (transformerState?.inboundPropertiesXml ?? null);
  const refOutboundPropsXml = isTransformerLike
    ? (parsed as TransformerState).outboundPropertiesXml
    : null;

  // ── Editor context for AI overlay ───────────────────────────────────────────
  const editorContext: EditorContext = {
    location: "filter-transformer",
    mode,
    isSource,
    channelId,
    channelName,
    inboundDataType: refDataType,
    outboundDataType: refOutboundDataType,
    inboundTemplate: refTemplate ?? undefined,
    outboundTemplate: refOutboundTemplate ?? undefined,
  };

  // ── CSS helpers ─────────────────────────────────────────────────────────────

  const btnCls = (disabled = false) =>
    `inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border transition-colors ` +
    (disabled
      ? "border-border text-gray-300 dark:text-gray-600 cursor-not-allowed"
      : "border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer");

  const selectCls =
    "h-6 px-1 text-xs rounded border border-border " +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500";

  const bottomTabCls = (t: "step" | "generated") =>
    `px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ` +
    (bottomTab === t
      ? "border-blue-500 text-blue-600 dark:text-blue-400"
      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200");

  // ── Detail pane ─────────────────────────────────────────────────────────────

  const detailPaneJsx = (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Bottom panel tab bar (only when an element is selected) */}
      {selectedItem && (
        <div className="flex border-b border-border bg-gray-50 dark:bg-gray-800/50 shrink-0">
          <button className={bottomTabCls("step")} onClick={() => setBottomTab("step")}>
            {mode === "filter" ? "Rule" : "Step"}
          </button>
          <button className={bottomTabCls("generated")} onClick={() => setBottomTab("generated")}>
            Generated Script
          </button>
        </div>
      )}

      {/* Step tab: element name row + validation + editor */}
      {(!selectedItem || bottomTab === "step") && (
        <>
          {/* Row: element name (editable) + per-step validate */}
          {selectedItem && (
            <div
              className={`flex items-center gap-2 px-4 ${barPy} border-b border-border bg-gray-50 dark:bg-gray-800 shrink-0`}
            >
              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Name:</span>
              <input
                value={selectedItem.name}
                onChange={(e) =>
                  handleElementChange({ ...selectedItem, name: e.target.value } as Rule | Step)
                }
                className={
                  `flex-1 ${densityHeight(viewDensity)} px-2 text-xs rounded border border-border ` +
                  "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
                  "focus:outline-none focus:border-blue-500"
                }
              />
              <button
                onClick={handleValidateStep}
                className={
                  "shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors cursor-pointer " +
                  "border-border text-gray-700 dark:text-gray-300 " +
                  "hover:bg-gray-100 dark:hover:bg-gray-700"
                }
              >
                <CheckCircle className="w-3 h-3" />
                Validate
              </button>
            </div>
          )}

          {/* Per-step validation result */}
          {stepValidation && (
            <div
              className={
                "px-4 py-1.5 text-xs border-b shrink-0 flex items-center gap-2 " +
                (stepValidation.ok
                  ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800")
              }
            >
              {stepValidation.ok ? (
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="flex-1">{stepValidation.msg}</span>
              <button
                onClick={() => setStepValidation(null)}
                className="text-current opacity-60 hover:opacity-100 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto">
            <DetailPaneContent
              key={selectedPath?.join(".") ?? "none"}
              selectedItem={selectedItem}
              mode={mode}
              isDark={isDark}
              destinationConnectors={destinationConnectors}
              stepValidation={stepValidation}
              onChange={handleElementChange}
              isSource={isSource}
              channelId={channelId}
              context={editorContext}
              elements={elements}
              selectedPath={selectedPath}
            />
          </div>
        </>
      )}

      {/* Generated Script tab */}
      {selectedItem && bottomTab === "generated" && (
        <BottomGeneratedScript
          script={generatedScript}
          elementLabel={selectedItem.name || selectedItem.type}
          isDark={isDark}
        />
      )}
    </div>
  );

  // ── Element list shared header ───────────────────────────────────────────────

  const stepListHeader = (
    <div
      className={
        "flex items-center gap-1 px-2 py-1 border-b border-border " +
        "bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0"
      }
    >
      <span className="w-6 shrink-0" title="Enabled" />
      <span className="w-7 shrink-0 text-center">#</span>
      {mode === "filter" && <span className="w-[70px] shrink-0">Op</span>}
      <span className="flex-1 truncate">Name</span>
      <span className="w-[170px] shrink-0">Type</span>
    </div>
  );

  const emptyStepList = (
    <div className="p-4 text-xs text-gray-400 dark:text-gray-500 italic text-center">
      No {mode === "filter" ? "rules" : "steps"} defined.
      <br />
      Click &ldquo;{mode === "filter" ? "Add Rule" : "Add Step"}&rdquo; or drag a tree node here to
      add one.
    </div>
  );

  const stepListRows = displayItems.map((item) => (
    <ElementRow
      key={item.element.sequenceNumber}
      item={item}
      isSelected={pathsEqual(selectedPath, item.path)}
      mode={mode}
      rowPy={rowPy}
      selectCls={selectCls}
      childTypes={childTypes}
      availableTypes={availableTypes}
      onSelect={setSelectedPath}
      onToggleEnabled={handleToggleEnabled}
      onOperatorChange={handleOperatorChange}
      onTypeChange={handleTypeChange}
      onAdd={() => setAddMenuOpen(true)}
      onDelete={handleDelete}
      onAssignToIterator={handleAssignToIterator}
      onRemoveFromIterator={handleRemoveFromIterator}
      onImport={openImportPicker}
      onExport={() => handleExport(title)}
      onValidateAll={handleValidateAll}
      onValidateStep={handleValidateStep}
      onMoveUp={handleMoveUp}
      onMoveDown={handleMoveDown}
      canDelete={canDelete}
      canMoveUp={canMoveUp}
      canMoveDown={canMoveDown}
      isInsideIterator={isInsideIterator}
      hasElements={elements.length > 0}
    />
  ));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full bg-white dark:bg-gray-900">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div
          className={`flex items-center gap-3 px-4 ${viewDensity === "comfortable" ? "py-2.5" : barPy} border-b border-border bg-white dark:bg-gray-900 shrink-0`}
        >
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Channel
          </button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</span>
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
            {elements.length} {mode === "filter" ? "rule" : "step"}
            {elements.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────────────── */}
        <div
          className={`flex items-center gap-1.5 px-4 ${barPy} border-b border-border bg-gray-50 dark:bg-gray-800/50 shrink-0`}
        >
          {/* Add button with dropdown */}
          <div
            className="relative"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setAddMenuOpen(false);
              }
            }}
          >
            <button
              onClick={() => setAddMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:border-blue-700"
            >
              <Plus className="w-3 h-3" />
              {addIsForChild ? "Add Child" : mode === "filter" ? "Add Rule" : "Add Step"}
              <ChevronDownSmall className="w-2.5 h-2.5 opacity-70" />
            </button>

            {addMenuOpen && (
              <div className="absolute z-20 top-full left-0 mt-0.5 w-52 rounded border border-border bg-white dark:bg-gray-800 shadow-lg py-1">
                {typesToShow.map((type) => (
                  <button
                    key={type}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAdd(type);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleDelete} disabled={!canDelete} className={btnCls(!canDelete)}>
            <Trash2 className="w-3 h-3" />
            Delete
          </button>

          <button onClick={handleMoveUp} disabled={!canMoveUp} className={btnCls(!canMoveUp)}>
            <ChevronUp className="w-3 h-3" />
            Move Up
          </button>

          <button onClick={handleMoveDown} disabled={!canMoveDown} className={btnCls(!canMoveDown)}>
            <ChevronDown className="w-3 h-3" />
            Move Down
          </button>

          {/* Separator */}
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-600 mx-1 shrink-0" />

          <button
            onClick={handleValidateAll}
            disabled={elements.length === 0}
            className={btnCls(elements.length === 0)}
          >
            <CheckCircle className="w-3 h-3" />
            Validate{" "}
            {mode === "filter"
              ? "Filter"
              : mode === "responseTransformer"
                ? "Response Transformer"
                : "Transformer"}
          </button>

          {/* Separator */}
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-600 mx-1 shrink-0" />

          <button
            onClick={() =>
              setFtLayout((l) => (l === "side-by-side" ? "top-bottom" : "side-by-side"))
            }
            className={btnCls()}
            title={
              ftLayout === "side-by-side"
                ? "Switch to top/bottom layout"
                : "Switch to side-by-side layout"
            }
          >
            {ftLayout === "side-by-side" ? (
              <PanelBottom className="w-3 h-3" />
            ) : (
              <PanelRight className="w-3 h-3" />
            )}
            {ftLayout === "side-by-side" ? "Top/Bottom" : "Side-by-Side"}
          </button>
        </div>

        {/* ── Validate-all result banner ─────────────────────────────────────── */}
        {allValidation && (
          <div
            className={
              "px-4 py-2 text-xs border-b shrink-0 " +
              (allValidation.ok
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800")
            }
          >
            <div className="flex items-center gap-2">
              {allValidation.ok ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
              )}
              <span
                className={
                  allValidation.ok
                    ? "text-green-700 dark:text-green-300"
                    : "text-red-700 dark:text-red-300 font-medium"
                }
              >
                {allValidation.ok
                  ? allValidation.msgs[0]
                  : `${allValidation.msgs.length} error${allValidation.msgs.length !== 1 ? "s" : ""} found:`}
              </span>
              <button
                onClick={() => setAllValidation(null)}
                className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {!allValidation.ok && (
              <ul className="mt-1 space-y-0.5 pl-5 list-disc text-red-600 dark:text-red-400">
                {allValidation.msgs.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Main 3-pane area ───────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {ftLayout === "top-bottom" ? (
            /* ── Top/bottom layout: list on top, detail below ──────────────── */
            <div className="flex flex-col flex-1 overflow-hidden min-w-0" ref={tbContainerRef}>
              {/* Top: element list */}
              <div
                className="shrink-0 border-b border-border flex flex-col overflow-hidden"
                style={{ height: `${tbSplitPct}%` }}
              >
                {stepListHeader}
                <div
                  className={
                    "flex-1 overflow-auto transition-colors " +
                    (stepListDragOver
                      ? "bg-blue-50/50 dark:bg-blue-900/20 ring-2 ring-inset ring-blue-400/50 dark:ring-blue-500/50 ring-dashed"
                      : "")
                  }
                  onDragOver={onStepListDragOver}
                  onDragLeave={onStepListDragLeave}
                  onDrop={onStepListDrop}
                >
                  {displayItems.length === 0 ? emptyStepList : stepListRows}
                </div>
              </div>

              {/* Top/bottom resize handle */}
              <div
                onMouseDown={tbResizerMouseDown}
                className="h-1 shrink-0 cursor-row-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
                title="Drag to resize"
              />

              {/* Bottom: detail pane */}
              {detailPaneJsx}
            </div>
          ) : (
            /* ── Side-by-side layout: [list | detail] ──────────────────────── */
            <>
              {/* ── Left panel: element list (collapsible + resizable) ──────── */}
              {leftCollapsed ? (
                /* Collapsed left panel — narrow strip with step numbers */
                <div
                  className="shrink-0 border-r border-border flex flex-col items-center bg-gray-50 dark:bg-gray-800 overflow-hidden"
                  style={{ width: COLLAPSED_LEFT_W }}
                >
                  <button
                    onClick={() => setLeftCollapsed(false)}
                    className="w-full py-1.5 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0 border-b border-border"
                    title="Expand steps panel"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex-1 overflow-auto w-full">
                    {displayItems.map((item) => {
                      const isSelected = pathsEqual(selectedPath, item.path);
                      const seqNum = item.path[item.path.length - 1] + 1;
                      return (
                        <button
                          key={item.element.sequenceNumber}
                          onClick={() => setSelectedPath(item.path)}
                          className={
                            "w-full h-7 flex items-center justify-center text-[10px] font-mono transition-colors " +
                            (isSelected
                              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold"
                              : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700")
                          }
                          title={item.element.name || `Step ${seqNum}`}
                        >
                          {item.depth > 0 ? (
                            <span className="text-[8px] text-gray-300 dark:text-gray-600">
                              └{seqNum}
                            </span>
                          ) : (
                            seqNum
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Expanded left panel */
                <div
                  className="shrink-0 border-r border-border flex flex-col overflow-hidden"
                  style={{ width: leftPanelWidth }}
                >
                  {/* Table header with collapse button */}
                  <div
                    className={
                      "flex items-center gap-1 px-2 py-1 border-b border-border " +
                      "bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0"
                    }
                  >
                    <span className="w-6 shrink-0" title="Enabled" />
                    <span className="w-7 shrink-0 text-center">#</span>
                    {mode === "filter" && <span className="w-[70px] shrink-0">Op</span>}
                    <span className="flex-1 truncate">Name</span>
                    <span className="w-[170px] shrink-0">Type</span>
                    <button
                      onClick={() => setLeftCollapsed(true)}
                      className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title="Collapse steps panel"
                    >
                      <PanelLeftClose className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Rows — also a drop zone for tree nodes to auto-create steps */}
                  <div
                    className={
                      "flex-1 overflow-auto transition-colors " +
                      (stepListDragOver
                        ? "bg-blue-50/50 dark:bg-blue-900/20 ring-2 ring-inset ring-blue-400/50 dark:ring-blue-500/50 ring-dashed"
                        : "")
                    }
                    onDragOver={onStepListDragOver}
                    onDragLeave={onStepListDragLeave}
                    onDrop={onStepListDrop}
                  >
                    {displayItems.length === 0 ? emptyStepList : stepListRows}
                  </div>
                </div>
              )}

              {/* ── Left resize handle ────────────────────────────────────── */}
              {!leftCollapsed && (
                <div
                  onMouseDown={onLeftPanelResizeMouseDown}
                  onDoubleClick={() => setLeftCollapsed(true)}
                  className="w-1 shrink-0 cursor-col-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
                  title="Drag to resize · Double-click to collapse"
                />
              )}

              {/* ── Detail pane ───────────────────────────────────────────── */}
              {detailPaneJsx}
            </>
          )}

          {/* ── Right resize handle ─────────────────────────────────────────── */}
          {!rightCollapsed && (
            <div
              onMouseDown={onRefPanelResizeMouseDown}
              onDoubleClick={() => setRightCollapsed(true)}
              className="w-1 shrink-0 cursor-col-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
              title="Drag to resize · Double-click to collapse"
            />
          )}

          {/* ── Right panel: reference (collapsible + resizable) ────────────── */}
          {rightCollapsed ? (
            /* Collapsed right panel — thin strip with expand arrow */
            <div
              className="shrink-0 border-l border-border flex flex-col items-center bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              style={{ width: COLLAPSED_RIGHT_W }}
              onClick={() => setRightCollapsed(false)}
              title="Expand reference panel"
            >
              <ChevronLeft className="w-3.5 h-3.5 mt-2 text-gray-400 dark:text-gray-500" />
              <span
                className="text-[9px] text-gray-400 dark:text-gray-500 mt-3 tracking-widest"
                style={{ writingMode: "vertical-rl" }}
              >
                Reference
              </span>
            </div>
          ) : (
            /* Expanded right panel */
            <div
              className="shrink-0 overflow-hidden flex flex-col"
              style={{ width: refPanelWidth }}
            >
              <ReferencePanel
                inboundDataType={refDataType}
                inboundTemplate={refTemplate}
                inboundPropertiesXml={refInboundPropsXml}
                outboundDataType={refOutboundDataType}
                outboundTemplate={refOutboundTemplate}
                outboundPropertiesXml={refOutboundPropsXml}
                isTransformer={mode !== "filter"}
                isResponseTransformer={mode === "responseTransformer"}
                inboundTypeLocked={
                  (!isSource && mode !== "responseTransformer") ||
                  (isSource && !!sourceInboundLocked)
                }
                inboundTypeLockedTitle={
                  isSource && sourceInboundLocked
                    ? `This connector requires the inbound data type to be ${refDataType}`
                    : undefined
                }
                onTypeChange={handleRefTypeChange}
                onTemplateChange={handleRefTemplateChange}
                onCollapse={() => setRightCollapsed(true)}
                variables={availableVariables}
                channelId={channelId}
                isFilter={mode === "filter"}
                onCreateFromTree={handleTreeContextAction}
                onCreateMessageBuilder={handleCreateMessageBuilderFromTreesWithIterator}
                mode={mode}
                isSource={isSource}
                channelName={channelName}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Iterator confirmation dialog ─────────────────────────────────────── */}
      <Dialog
        open={dropInteraction?.stage === "confirm"}
        onOpenChange={(open) => {
          if (!open) handleDropConfirmCancel();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select An Option</DialogTitle>
            <DialogDescription>
              Would you like to create a new or choose an existing Iterator for this{" "}
              {dropInteraction?.kind === "messageBuilder"
                ? "Message Builder"
                : mode === "filter"
                  ? "filter rule"
                  : "transformer step"}
              ?
            </DialogDescription>
          </DialogHeader>
          <div className="py-1">
            <FormCheckbox
              label="Do not show this dialog again (may be re-enabled in the Administrator settings)"
              checked={dontShowAgain}
              onChange={setDontShowAgain}
              size="xs"
            />
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button
              variant="default"
              onClick={() => {
                handleDropConfirmYes(dontShowAgain);
                setDontShowAgain(false);
              }}
            >
              Yes
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                handleDropConfirmNo(dontShowAgain);
                setDontShowAgain(false);
              }}
            >
              No
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                handleDropConfirmCancel();
                setDontShowAgain(false);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Move-out-of-iterator confirmation ───────────────────────────────── */}
      {moveOutConfirm !== null && (
        <ConfirmDialog
          title="Move Out of Iterator"
          description={`This will move the ${mode === "filter" ? "rule" : "step"} out of its parent Iterator. Are you sure you wish to continue?`}
          onConfirm={handleMoveOutConfirmed}
          onCancel={handleMoveOutCancelled}
          confirmLabel="OK"
          confirmVariant="default"
        />
      )}

      {/* ── Type-change data-loss confirmation #62) ────────────────── */}
      {typeChangeConfirm !== null && (
        <ConfirmDialog
          title={`Change ${mode === "filter" ? "Rule" : "Step"} Type`}
          description={`Are you sure you would like to change this ${
            mode === "filter" ? "Filter Rule" : "Transformer Step"
          } and lose all of the current data?`}
          onConfirm={handleTypeChangeConfirmed}
          onCancel={handleTypeChangeCancelled}
          confirmLabel="OK"
          confirmVariant="destructive"
        />
      )}

      {/* ── Delete-iterator-with-children confirmation #63) ────────── */}
      {deleteConfirm !== null && (
        <ConfirmDialog
          title="Delete Iterator"
          description={`All child ${
            mode === "filter" ? "rules" : "steps"
          } will be removed along with the Iterator. Are you sure you wish to continue?`}
          onConfirm={handleDeleteConfirmed}
          onCancel={handleDeleteCancelled}
          confirmLabel="OK"
          confirmVariant="destructive"
        />
      )}

      {/* ── Iterator wizard dialog (DnD flow) ────────────────────────────────── */}
      {dropInteraction?.stage === "wizard" && (
        <IteratorWizardDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) handleWizardCancel();
          }}
          dragExpr={dropInteraction.dragExpr}
          outboundExpr={dropInteraction.outboundExpr}
          elements={elements}
          mode={mode}
          onComplete={handleWizardComplete}
        />
      )}

      {/* ── Iterator wizard dialog (Assign To Iterator context menu) ─────────── */}
      {assignToIteratorOpen && (
        <IteratorWizardDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) handleAssignToIteratorCancel();
          }}
          dragExpr={assignInfo.dragExpr}
          outboundExpr={assignInfo.outboundExpr || undefined}
          excludePath={assignInfo.excludePath}
          elements={elements}
          mode={mode}
          onComplete={handleAssignToIteratorComplete}
        />
      )}

      {/* ── Import: hidden file input ─────────────────────────────────────────── */}
      <input
        ref={importFileRef}
        type="file"
        accept=".xml"
        className="hidden"
        onChange={onImportFileChange}
      />

      {/* ── Import: append vs replace confirm ────────────────────────────────── */}
      {importConfirm !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) handleImportCancel();
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Import {mode === "filter" ? "Filter" : "Transformer"}</DialogTitle>
              <DialogDescription>
                This {mode === "filter" ? "filter" : "transformer"} already has {elements.length}{" "}
                {mode === "filter" ? "rule" : "step"}
                {elements.length !== 1 ? "s" : ""}. Would you like to append the imported{" "}
                {mode === "filter" ? "rules" : "steps"} to the existing ones, or replace them?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-row gap-2 sm:justify-end">
              <Button variant="default" onClick={handleImportAppend}>
                Append
              </Button>
              <Button variant="destructive" onClick={handleImportReplace}>
                Replace
              </Button>
              <Button variant="outline" onClick={handleImportCancel}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Import: parse error ───────────────────────────────────────────────── */}
      {importError !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setImportError(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Import Failed</DialogTitle>
              <DialogDescription>{importError}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="default" onClick={() => setImportError(null)}>
                OK
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
