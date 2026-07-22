"use client";

import { useState, useRef, useMemo } from "react";
import type {
  FilterState,
  TransformerState,
  Rule,
  Step,
  Operator,
  IteratorRule,
  IteratorStep,
  MapperStep,
  MessageBuilderStep,
  RuleBuilderRule,
  DisplayItem,
  UnknownElement,
} from "../../_lib/filter-transformer-xml";
import {
  parseFilterFromXml,
  parseTransformerFromXml,
  serializeFilterToXml,
  serializeTransformerToXml,
  assignSequenceNumbers,
  normalizeOperators,
  flattenElements,
  getElementAtPath,
  updateElementAtPath,
  deleteElementAtPath,
  insertElementAtPath,
  insertElementAtIndex,
  moveElementUp,
  moveElementDown,
  moveElementOutUp,
  moveElementOutDown,
  defaultRule,
  defaultStep,
  generateRuleBuilderName,
  generateIteratorRuleName,
  generateIteratorStepName,
  SOURCE_RULE_TYPES,
  DESTINATION_RULE_TYPES,
  SOURCE_STEP_TYPES,
  DESTINATION_STEP_TYPES,
  emptyFilterXml,
} from "../../_lib/filter-transformer-xml";
import { resolveXmlVersion, withVersion } from "../../_lib/channel-xml";
import { filterEnabledStepTypes } from "../../_lib/filter-transformer-steps";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";
import { generateScript } from "../../_lib/generated-script";
import { extractVariablesFromElements } from "../../_lib/variable-extraction";
import { validateElement } from "../../_lib/filter-transformer-validation";
import {
  getExpressionParts,
  applyIteratorVariables,
  replaceIteratorVariables,
  stripToStringSuffix,
  removeNumberLiterals,
  findIteratorEntries,
  getValidIndexVariable,
  getAncestorIndexVariables,
  getDescendantIndexVariables,
} from "../../_lib/iterator-utils";
import {
  getIteratorInfo,
  applyIteratorVarsToSubtree,
  removeIteratorVarsFromSubtree,
} from "../../_lib/iterator-field-rewrite";
import { loadAdminPrefs, saveAdminPref } from "@/components/settings/admin-tab";
import {
  TREE_NODE_MIME,
  type TreeNodeDragData,
  type TreeContextAction,
} from "./message-tree-viewer";
import { varNameFromTree } from "./var-name";
import { toast } from "sonner";

// ─── Iterator dialog types ─────────────────────────────────────────────────────

/**
 * State machine for the DnD → confirm → wizard flow.
 *
 * `kind` distinguishes the resulting element:
 * - `"mapper"`        — single-field drop into the transformer/filter step list.
 * - `"messageBuilder"` — inbound → outbound tree drop. `outboundExpr` carries the
 *                        outbound target (`tmp[...]`); `dragExpr` is the inbound mapping
 *                        (`msg[...]`). Both fields receive iterator substitutions.
 */
export type DropInteraction =
  | {
      stage: "confirm";
      source: "inbound" | "outbound";
      dragExpr: string;
      nodeLabel: string;
      ancestorLabels: string[];
      kind: "mapper" | "messageBuilder";
      outboundExpr?: string;
    }
  | {
      stage: "wizard";
      source: "inbound" | "outbound";
      dragExpr: string;
      nodeLabel: string;
      ancestorLabels: string[];
      kind: "mapper" | "messageBuilder";
      outboundExpr?: string;
    }
  | null;

/** Result produced by the Iterator Wizard dialog. */
export type WizardResult =
  | {
      action: "createNew";
      target: string;
      indexVariable: string;
      prefixSubstitutions: string[];
    }
  | { action: "useExisting"; iteratorPath: number[] };

/** State for the import confirm dialog (append vs replace). */
export type ImportConfirm = { elements: (Rule | Step)[] } | null;

// ─── Constants ────────────────────────────────────────────────────────────────

// Data type names are case-sensitive on the server ("RAW", not "Raw"); a
// lowercase value yields "This channel is invalid. Verify all required
// extensions are loaded correctly." on save. The root tag here is
// only used as a parse fallback — serializeTransformerToXml emits the correct
// element via its rootTag argument regardless of this string's tag.
// {{VERSION}} is substituted with the resolved server/channel version at each use
// (see withVersion / resolveXmlVersion) so the empty transformer is never stamped
// with a stale hardcoded release.
const EMPTY_TRANSFORMER_XML = `<transformer version="{{VERSION}}"><elements/><inboundDataType>RAW</inboundDataType><outboundDataType>RAW</outboundDataType></transformer>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function pathsEqual(a: number[] | null, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function cloneElement(el: Rule | Step): Rule | Step {
  if (el.type === "Iterator") {
    return { ...el, children: (el as IteratorRule | IteratorStep).children.map(cloneElement) } as
      | Rule
      | Step;
  }
  return { ...el };
}

function cloneElements(els: (Rule | Step)[]): (Rule | Step)[] {
  return els.map(cloneElement);
}

/**
 * Deterministic JSON with recursively sorted object keys, so two elements built
 * with different field orders compare equal. Used by the type-change pristine
 * check #62).
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * @internal Exported for unit testing only.
 * Adjusts `pathToAdjust` to account for the removal of the element at `deletedPath`.
 * If both paths share the same parent and the deleted index is less than the adjusted index
 * at that level, the adjusted index is decremented by 1.
 */
export function adjustPathAfterDelete(pathToAdjust: number[], deletedPath: number[]): number[] {
  const result = [...pathToAdjust];
  const deletedParent = deletedPath.slice(0, -1);
  // Only adjust if pathToAdjust is at least as deep as the deleted element's level
  if (pathToAdjust.length <= deletedParent.length) return result;
  // Check they share the same parent
  const sameParent = deletedParent.every((v, i) => pathToAdjust[i] === v);
  if (!sameParent) return result;
  const deletedIdx = deletedPath[deletedPath.length - 1];
  const adjustLevel = deletedParent.length;
  if (deletedIdx < result[adjustLevel]) {
    result[adjustLevel] -= 1;
  }
  return result;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface Params {
  mode: "filter" | "transformer" | "responseTransformer";
  isSource: boolean;
  xml: string;
  onChange: (xml: string) => void;
  transformerXml?: string;
  onTransformerChange?: (newXml: string) => void;
  autoValidate?: boolean;
}

export function useFilterTransformerState({
  mode,
  isSource,
  xml,
  onChange,
  transformerXml,
  onTransformerChange,
  autoValidate,
}: Params) {
  const baseXmlRef = useRef(
    xml.trim() ||
      (mode === "filter"
        ? emptyFilterXml(resolveXmlVersion())
        : withVersion(EMPTY_TRANSFORMER_XML, resolveXmlVersion()))
  );

  // Root element this editor writes back. A destination connector's response
  // transformer must serialize as <responseTransformer>, not <transformer>, or
  // it overwrites the connector's request transformer slot and corrupts the
  // channel. Filter mode never serializes the response transformer.
  const txRootTag: "transformer" | "responseTransformer" =
    mode === "responseTransformer" ? "responseTransformer" : "transformer";

  // Filter mode only: parsed transformer XML prop so we can show/edit the shared inbound data type.
  const transformerState = useMemo<TransformerState | null>(() => {
    if (mode !== "filter" || !transformerXml) return null;
    try {
      return parseTransformerFromXml(transformerXml);
    } catch {
      return null;
    }
  }, [mode, transformerXml]);

  // Always-current ref for transformer XML (used inside handlers to avoid stale closures)
  const transformerXmlRef = useRef(transformerXml ?? "");
  transformerXmlRef.current = transformerXml ?? "";

  const [parsed, setParsed] = useState<FilterState | TransformerState>(() => {
    try {
      return mode === "filter"
        ? parseFilterFromXml(baseXmlRef.current)
        : parseTransformerFromXml(baseXmlRef.current);
    } catch {
      return mode === "filter"
        ? parseFilterFromXml(emptyFilterXml(resolveXmlVersion()))
        : parseTransformerFromXml(withVersion(EMPTY_TRANSFORMER_XML, resolveXmlVersion()));
    }
  });

  const [selectedPath, setSelectedPath] = useState<number[] | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<"step" | "generated">("step");
  const [stepValidation, setStepValidation] = useState<{ ok: boolean; msg: string } | null>(null);
  const [allValidation, setAllValidation] = useState<{ ok: boolean; msgs: string[] } | null>(null);
  const [stepListDragOver, setStepListDragOver] = useState(false);
  const [dropInteraction, setDropInteraction] = useState<DropInteraction>(null);
  const [moveOutConfirm, setMoveOutConfirm] = useState<"up" | "down" | null>(null);
  // Pending "lose all data?" confirm for a type change on a non-pristine element
  // #62); pending "remove iterator children?" confirm for a delete
  // #63). Both mirror the moveOutConfirm defer-until-confirmed pattern.
  const [typeChangeConfirm, setTypeChangeConfirm] = useState<{
    path: number[];
    newType: Rule["type"] | Step["type"];
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number[] | null>(null);
  const [assignToIteratorOpen, setAssignToIteratorOpen] = useState(false);
  // Iterator-info derived from the element when the "Assign To Iterator" dialog
  // opens: the element's own expression is fed to the wizard as the drag
  // expression, and its own path is excluded from the candidate-iterator list.
  const [assignInfo, setAssignInfo] = useState<{
    dragExpr: string;
    outboundExpr: string;
    excludePath: number[];
  }>({ dragExpr: "", outboundExpr: "", excludePath: [] });
  const [importConfirm, setImportConfirm] = useState<ImportConfirm>(null);

  // Clear per-step validation whenever the selection changes (adjust state during render).
  const [prevSelectedPath, setPrevSelectedPath] = useState(selectedPath);
  if (selectedPath !== prevSelectedPath) {
    setPrevSelectedPath(selectedPath);
    setStepValidation(null);
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const elements: (Rule | Step)[] = useMemo(() => (parsed as FilterState).elements ?? [], [parsed]);

  const displayItems: DisplayItem[] = useMemo(() => flattenElements(elements), [elements]);

  const selectedFlatIndex = useMemo(() => {
    if (!selectedPath) return undefined;
    const idx = displayItems.findIndex((item) => pathsEqual(item.path, selectedPath));
    return idx >= 0 ? idx : undefined;
  }, [selectedPath, displayItems]);

  const availableVariables = useMemo(
    () => extractVariablesFromElements(elements, true, selectedFlatIndex),
    [elements, selectedFlatIndex]
  );

  const selectedItem = selectedPath ? getElementAtPath(elements, selectedPath) : null;

  const generatedScript = useMemo(
    () => (selectedItem ? generateScript(selectedItem) : ""),
    [selectedItem]
  );

  // When auto-validate is toggled on, validate the current selection (adjust state during render).
  const [prevAutoValidate, setPrevAutoValidate] = useState(autoValidate);
  if (autoValidate !== prevAutoValidate) {
    setPrevAutoValidate(autoValidate);
    if (autoValidate && selectedItem) {
      const err = validateElement(selectedItem);
      setStepValidation(err ? { ok: false, msg: err } : { ok: true, msg: "Step is valid." });
    }
  }

  const surfaceEnabled = usePluginSurfaceEnabled();
  // Add-menu types, filtered by server-enablement gating: a plugin
  // step type is offered only when its server extension is enabled. Rule types
  // and built-in steps carry no pluginName, so they always show. Existing steps
  // of a gated type still parse, render, and round-trip (lookup stays ungated) —
  // only the ability to add a new one is gated. childTypes/typesToShow derive
  // from this, so this single filter covers every add surface.
  const availableTypes: (Rule["type"] | Step["type"])[] = filterEnabledStepTypes(
    mode === "filter"
      ? isSource
        ? SOURCE_RULE_TYPES
        : DESTINATION_RULE_TYPES
      : isSource
        ? SOURCE_STEP_TYPES
        : DESTINATION_STEP_TYPES,
    surfaceEnabled
  );

  // Children of an Iterator may be any type available in this context — including
  // nested Iterators (first-class in Java) and, in a source transformer, the
  // Destination Set Filter step (whose plugin implements the iterator hooks so it
  // can live under an Iterator). The source/destination restriction is already
  // encoded in availableTypes: DSF is absent from destination via its `contexts`
  // field, and Iterator is now present in both. Mirrors Java FilterPane /
  // TransformerPane, which offer the full plugin map for child elements.
  const childTypes: (Rule["type"] | Step["type"])[] = availableTypes;

  // Where a new element added via the "Add" button will land (mirrors Java
  // BaseEditorPane.doAddElement:428-436): if the selected element is an Iterator,
  // add inside it; otherwise add as a sibling of the selection — which, for an
  // iterator child, means inside that same iterator #61). No selection
  // (or a top-level element selected) → top level.
  const addParentPath = useMemo(() => {
    if (!selectedPath) return [] as number[];
    return selectedItem?.type === "Iterator" ? selectedPath : selectedPath.slice(0, -1);
  }, [selectedPath, selectedItem]);
  const addIsForChild = addParentPath.length > 0;
  const typesToShow = addIsForChild ? childTypes : availableTypes;

  const canDelete = selectedPath !== null;
  const isInsideIterator = selectedPath !== null && selectedPath.length > 1;
  const canMoveUp =
    selectedPath !== null &&
    // Normal sibling move up
    (selectedPath[selectedPath.length - 1] > 0 ||
      // Cross-boundary: move first child out of iterator (up = above iterator)
      selectedPath.length > 1);
  const canMoveDown = (() => {
    if (!selectedPath) return false;
    if (selectedPath.length === 1) return selectedPath[0] < elements.length - 1;
    const parent = getElementAtPath(elements, selectedPath.slice(0, -1)) as
      | IteratorRule
      | IteratorStep;
    const lastIdx = (parent?.children.length ?? 0) - 1;
    const currentIdx = selectedPath[selectedPath.length - 1];
    // Normal sibling move down, OR cross-boundary: move last child out of iterator
    return currentIdx < lastIdx || selectedPath.length > 1;
  })();

  // ── Mutation helpers ────────────────────────────────────────────────────────

  function applyElements(newEls: (Rule | Step)[]) {
    setAllValidation(null);
    if (mode === "filter") {
      // Renormalize operators after every structural mutation, mirroring Java's
      // FilterPane.updateOperations at its updateTable chokepoint.
      // Safe here because every caller passes a fresh cloneElements(...).
      normalizeOperators(newEls as Rule[]);
      const next: FilterState = { ...(parsed as FilterState), elements: newEls as Rule[] };
      setParsed(next);
      onChange(serializeFilterToXml(baseXmlRef.current, next));
    } else {
      const next: TransformerState = {
        ...(parsed as TransformerState),
        elements: newEls as Step[],
      };
      setParsed(next);
      onChange(serializeTransformerToXml(baseXmlRef.current, next, txRootTag));
    }
  }

  function handleAdd(type: Rule["type"] | Step["type"]) {
    setAddMenuOpen(false);
    const parentPath = addParentPath;
    const isFirstChild =
      parentPath.length === 0
        ? elements.length === 0
        : ((getElementAtPath(elements, parentPath) as IteratorRule | IteratorStep)?.children
            .length ?? 0) === 0;
    const operator: Operator = isFirstChild ? "NONE" : "AND";
    const newEl =
      mode === "filter"
        ? defaultRule(type as Rule["type"], operator)
        : defaultStep(type as Step["type"]);
    const raw = insertElementAtPath(elements, parentPath, newEl);
    const cloned = cloneElements(raw);
    assignSequenceNumbers(cloned);
    let newPath: number[];
    if (parentPath.length === 0) {
      newPath = [cloned.length - 1];
    } else {
      const iterAfter = getElementAtPath(cloned, parentPath) as IteratorRule | IteratorStep;
      newPath = [...parentPath, iterAfter.children.length - 1];
    }
    applyElements(cloned);
    setSelectedPath(newPath);
  }

  function performDelete(path: number[]) {
    const raw = deleteElementAtPath(elements, path);
    const cloned = cloneElements(raw);
    assignSequenceNumbers(cloned);
    setSelectedPath(null);
    applyElements(cloned);
  }

  function handleDelete() {
    if (!selectedPath) return;
    const el = getElementAtPath(elements, selectedPath);
    // Deleting an Iterator that has children discards those children — confirm
    // first (mirrors Java BaseEditorPane.doDeleteElement:527-531). #63.
    if (
      el?.type === "Iterator" &&
      ((el as IteratorRule | IteratorStep).children?.length ?? 0) > 0
    ) {
      setDeleteConfirm(selectedPath);
      return;
    }
    performDelete(selectedPath);
  }

  function handleDeleteConfirmed() {
    if (deleteConfirm) performDelete(deleteConfirm);
    setDeleteConfirm(null);
  }

  function handleDeleteCancelled() {
    setDeleteConfirm(null);
  }

  function handleMoveUp() {
    if (!selectedPath || !canMoveUp) return;
    const lastIdx = selectedPath[selectedPath.length - 1];

    if (selectedPath.length > 1 && lastIdx === 0) {
      // Cross-boundary: first child of iterator — prompt to move out above iterator
      setMoveOutConfirm("up");
      return;
    }

    const raw = moveElementUp(elements, selectedPath);
    const cloned = cloneElements(raw);
    assignSequenceNumbers(cloned);
    const newPath = [...selectedPath.slice(0, -1), lastIdx - 1];
    setSelectedPath(newPath);
    applyElements(cloned);
  }

  function handleMoveDown() {
    if (!selectedPath || !canMoveDown) return;
    const lastIdx = selectedPath[selectedPath.length - 1];

    if (selectedPath.length > 1) {
      const parent = getElementAtPath(elements, selectedPath.slice(0, -1)) as
        | IteratorRule
        | IteratorStep;
      if (lastIdx >= (parent?.children.length ?? 0) - 1) {
        // Cross-boundary: last child of iterator — prompt to move out below iterator
        setMoveOutConfirm("down");
        return;
      }
    }

    const raw = moveElementDown(elements, selectedPath);
    const cloned = cloneElements(raw);
    assignSequenceNumbers(cloned);
    const newPath = [...selectedPath.slice(0, -1), lastIdx + 1];
    setSelectedPath(newPath);
    applyElements(cloned);
  }

  function handleMoveOutConfirmed() {
    if (!selectedPath || !moveOutConfirm) return;
    const direction = moveOutConfirm;
    setMoveOutConfirm(null);

    const iterPath = selectedPath.slice(0, -1);
    const iterIdx = iterPath[iterPath.length - 1];
    const parentPath = iterPath.slice(0, -1);

    // Strip the moved subtree's iterator variables against its OLD parent chain
    // before detaching (mirrors Java's removeIteratorVariables(node) before
    // removeNodeFromParent).
    const beforeMove = cloneElements(elements);
    removeIteratorVarsFromSubtree(beforeMove, selectedPath);

    let raw: (Rule | Step)[];
    let newPath: number[];

    if (direction === "up") {
      raw = moveElementOutUp(beforeMove, selectedPath);
      // Element is now at the iterator's position in its parent level
      newPath = [...parentPath, iterIdx];
    } else {
      raw = moveElementOutDown(beforeMove, selectedPath);
      // Element is now right after the iterator in its parent level
      newPath = [...parentPath, iterIdx + 1];
    }

    // Re-apply iterator variables against the NEW parent chain after reattaching
    // (mirrors Java's replaceIteratorVariables(node) after insertNode).
    const cloned = cloneElements(raw);
    applyIteratorVarsToSubtree(cloned, newPath);
    assignSequenceNumbers(cloned);
    applyElements(cloned);
    setSelectedPath(newPath);
  }

  function handleMoveOutCancelled() {
    setMoveOutConfirm(null);
  }

  // ── Assign To Iterator ──────────────────────────────────────────────────────

  function handleAssignToIterator() {
    if (!selectedPath) return;
    const el = getElementAtPath(elements, selectedPath);
    if (!el) return;

    // Derive the element's iteration target/outbound, stripped of its CURRENT
    // ancestor iterator variables and of all number literals. Mirrors Java
    // doAssignToIterator: removeIteratorVariables(node) → getIteratorInfo →
    // removeNumberLiterals.
    const stripped = cloneElements(elements);
    removeIteratorVarsFromSubtree(stripped, selectedPath);
    const strippedEl = getElementAtPath(stripped, selectedPath);
    const info = strippedEl ? getIteratorInfo(strippedEl) : { target: "", outbound: "" };
    const dragExpr = removeNumberLiterals(info.target ?? "");
    const outboundExpr = removeNumberLiterals(info.outbound ?? "");

    // If there is no discernible target AND no other iterators to choose from,
    // skip the wizard and add a blank default iterator at the element's position
    // (Java doAssignToIterator :608-620).
    const entries = findIteratorEntries(elements, selectedPath);
    if (getExpressionParts(dragExpr, false).length === 0 && entries.length === 0) {
      const indexVariable = getValidIndexVariable(
        getAncestorIndexVariables(elements, selectedPath),
        getDescendantIndexVariables(elements, selectedPath)
      );
      assignToIterator({ action: "createNew", target: "", indexVariable, prefixSubstitutions: [] });
      return;
    }

    setAssignInfo({ dragExpr, outboundExpr, excludePath: selectedPath });
    setAssignToIteratorOpen(true);
  }

  function handleAssignToIteratorComplete(result: WizardResult) {
    setAssignToIteratorOpen(false);
    assignToIterator(result);
  }

  /**
   * Move the currently-selected element into an Iterator (new or existing) and
   * rewrite its expression fields to reference the iterator's index variable.
   * Mirrors Java BaseEditorPane.doAssignToIterator.
   */
  function assignToIterator(result: WizardResult) {
    if (!selectedPath) return;

    // Strip the element's current ancestor iterator variables before detaching,
    // then work from that stripped tree so the moved element carries clean
    // fields into its new location.
    const stripped = cloneElements(elements);
    removeIteratorVarsFromSubtree(stripped, selectedPath);
    const el = getElementAtPath(stripped, selectedPath);
    if (!el) return;

    const withoutEl = deleteElementAtPath(stripped, selectedPath);

    if (result.action === "createNew") {
      const { target, indexVariable, prefixSubstitutions } = result;
      const parentPath = selectedPath.slice(0, -1);
      const childIndex = selectedPath[selectedPath.length - 1];
      const parentEmpty =
        parentPath.length === 0
          ? withoutEl.length === 0
          : ((getElementAtPath(withoutEl, parentPath) as IteratorRule | IteratorStep | null)
              ?.children.length ?? 0) === 0;

      let iterEl: IteratorRule | IteratorStep;
      if (mode === "filter") {
        const r = defaultRule("Iterator", parentEmpty ? "NONE" : "AND") as IteratorRule;
        r.target = target;
        r.indexVariable = indexVariable;
        r.prefixSubstitutions = prefixSubstitutions;
        r.name = generateIteratorRuleName(target, false);
        (el as Exclude<Rule, UnknownElement>).operator = "NONE";
        r.children = [el as Rule];
        iterEl = r;
      } else {
        const s = defaultStep("Iterator") as IteratorStep;
        s.target = target;
        s.indexVariable = indexVariable;
        s.prefixSubstitutions = prefixSubstitutions;
        s.name = generateIteratorStepName(target);
        s.children = [el as Step];
        iterEl = s;
      }
      // Insert the new iterator at the element's former position (Java inserts at
      // childIndex), not at the end of the top level.
      const raw = insertElementAtIndex(withoutEl, parentPath, childIndex, iterEl);
      const cloned = cloneElements(raw);
      const childPath = [...parentPath, childIndex, 0];
      // Inject the new iterator's index variable into the moved element's fields.
      applyIteratorVarsToSubtree(cloned, childPath);
      assignSequenceNumbers(cloned);
      applyElements(cloned);
      setSelectedPath(childPath);
    } else {
      // useExisting — insert into the existing iterator.
      // The wizard returned iteratorPath relative to the original `elements`, but we've already
      // deleted the selected element (withoutEl). If the deleted element came before the iterator
      // in the same parent, the iterator's index has shifted by -1.
      const { iteratorPath } = result;
      const adjustedPath = adjustPathAfterDelete(iteratorPath, selectedPath);
      const raw = insertElementAtPath(withoutEl, adjustedPath, el);
      const cloned = cloneElements(raw);
      const iterAfter = getElementAtPath(cloned, adjustedPath) as IteratorRule | IteratorStep;
      const childPath = [...adjustedPath, iterAfter.children.length - 1];
      // Inject the existing iterator's index variable into the moved element's fields.
      applyIteratorVarsToSubtree(cloned, childPath);
      assignSequenceNumbers(cloned);
      applyElements(cloned);
      setSelectedPath(childPath);
    }
  }

  function handleAssignToIteratorCancel() {
    setAssignToIteratorOpen(false);
  }

  // ── Remove From Iterator ────────────────────────────────────────────────────

  function handleRemoveFromIterator() {
    if (!selectedPath || selectedPath.length < 2) return;

    // Strip iterator variables against the OLD parent chain before detaching.
    const beforeMove = cloneElements(elements);
    removeIteratorVarsFromSubtree(beforeMove, selectedPath);

    const raw = moveElementOutUp(beforeMove, selectedPath);
    const iterPath = selectedPath.slice(0, -1);
    const iterIdx = iterPath[iterPath.length - 1];
    const parentPath = iterPath.slice(0, -1);
    const newPath = [...parentPath, iterIdx];

    // Re-apply against the NEW parent chain after reattaching.
    const cloned = cloneElements(raw);
    applyIteratorVarsToSubtree(cloned, newPath);
    assignSequenceNumbers(cloned);
    applyElements(cloned);
    setSelectedPath(newPath);
  }

  // ── Import / Export ─────────────────────────────────────────────────────────

  function handleImportFile(fileContent: string) {
    try {
      const newElements =
        mode === "filter"
          ? parseFilterFromXml(fileContent).elements
          : parseTransformerFromXml(fileContent).elements;

      if (elements.length === 0) {
        // Nothing to conflict with — replace directly
        const cloned = cloneElements(newElements);
        assignSequenceNumbers(cloned);
        applyElements(cloned);
        setSelectedPath(null);
      } else {
        // Prompt user: append or replace
        setImportConfirm({ elements: newElements });
      }
    } catch {
      // Surface parse error via a thrown error so the caller can display it
      throw new Error(`Invalid ${mode === "filter" ? "filter" : "transformer"} XML file.`);
    }
  }

  function handleImportAppend() {
    if (!importConfirm) return;
    const merged = [...elements, ...importConfirm.elements];
    const cloned = cloneElements(merged);
    assignSequenceNumbers(cloned);
    applyElements(cloned);
    setImportConfirm(null);
    setSelectedPath(null);
  }

  function handleImportReplace() {
    if (!importConfirm) return;
    const cloned = cloneElements(importConfirm.elements);
    assignSequenceNumbers(cloned);
    applyElements(cloned);
    setImportConfirm(null);
    setSelectedPath(null);
  }

  function handleImportCancel() {
    setImportConfirm(null);
  }

  function handleExport(title: string) {
    // Export always uses the <transformer> root (matches the Java client's
    // transformer export files, which deserialize as Transformer); the
    // response-transformer rootTag only matters when splicing back into a
    // connector, which export does not do.
    const xmlContent =
      mode === "filter"
        ? serializeFilterToXml(baseXmlRef.current, parsed as FilterState)
        : serializeTransformerToXml(baseXmlRef.current, parsed as TransformerState);
    const blob = new Blob([xmlContent], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = title.replace(/[^a-z0-9_-]/gi, "_");
    a.href = url;
    a.download = `${safeName}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleElementChange(newEl: Rule | Step) {
    if (!selectedPath) return;
    const raw = updateElementAtPath(elements, selectedPath, () => newEl);
    const cloned = cloneElements(raw);
    assignSequenceNumbers(cloned);
    applyElements(cloned);
  }

  function handleToggleEnabled(path: number[]) {
    const raw = updateElementAtPath(elements, path, (e) => ({ ...e, enabled: !e.enabled }));
    const cloned = cloneElements(raw);
    applyElements(cloned);
  }

  function handleOperatorChange(path: number[], op: Operator) {
    const raw = updateElementAtPath(elements, path, (e) => ({ ...e, operator: op }));
    const cloned = cloneElements(raw);
    applyElements(cloned);
  }

  // Whether an element still matches its type's defaults (ignoring name +
  // sequenceNumber). Mirrors Java's reflectionEquals(el, plugin.getDefaults(),
  // "name", "sequenceNumber") guard: a pristine element loses nothing on a type
  // change, so no confirm is needed. #62.
  function isPristineElement(el: Rule | Step): boolean {
    const def =
      mode === "filter"
        ? defaultRule(
            el.type as Rule["type"],
            (el as Rule & { operator?: Operator }).operator ?? "AND"
          )
        : defaultStep(el.type as Step["type"]);
    const strip = (x: Rule | Step) => stableStringify({ ...x, name: "", sequenceNumber: "0" });
    return strip(el) === strip(def);
  }

  function performTypeChange(path: number[], newType: Rule["type"] | Step["type"]) {
    const el = getElementAtPath(elements, path);
    if (!el) return;
    // New element uses the target type's defaults; carry position + enabled state
    // but NOT the old name — Java resets to the new type's default name so a stale
    // auto-generated name (e.g. "For each …") does not persist. #62.
    let newEl: Rule | Step;
    if (mode === "filter") {
      const r = el as Rule;
      const base = defaultRule(
        newType as Rule["type"],
        (r as Rule & { operator?: Operator }).operator ?? "AND"
      );
      newEl = { ...base, sequenceNumber: r.sequenceNumber, enabled: r.enabled };
    } else {
      const s = el as Step;
      const base = defaultStep(newType as Step["type"]);
      newEl = { ...base, sequenceNumber: s.sequenceNumber, enabled: s.enabled };
    }
    const raw = updateElementAtPath(elements, path, () => newEl);
    const cloned = cloneElements(raw);
    assignSequenceNumbers(cloned);
    applyElements(cloned);
  }

  function handleTypeChange(path: number[], newType: Rule["type"] | Step["type"]) {
    const el = getElementAtPath(elements, path);
    if (!el || el.type === newType) return;
    // An Iterator with children cannot change type — its children would be silently
    // discarded. Java hard-blocks this (BaseEditorPane:1703-1706). #62.
    if (el.type === "Iterator" && ((el as IteratorRule | IteratorStep).children?.length ?? 0) > 0) {
      toast.error("Please remove all children before changing an Iterator to a different type.");
      return;
    }
    // Pristine → change immediately; otherwise confirm the data loss. The type
    // dropdown is controlled by the element's own type, so cancelling (no state
    // change) naturally reverts the selection. #62.
    if (isPristineElement(el)) {
      performTypeChange(path, newType);
    } else {
      setTypeChangeConfirm({ path, newType });
    }
  }

  function handleTypeChangeConfirmed() {
    if (typeChangeConfirm) performTypeChange(typeChangeConfirm.path, typeChangeConfirm.newType);
    setTypeChangeConfirm(null);
  }

  function handleTypeChangeCancelled() {
    setTypeChangeConfirm(null);
  }

  // ── Validation handlers ─────────────────────────────────────────────────────

  function handleValidateStep() {
    if (!selectedItem) return;
    const err = validateElement(selectedItem);
    setStepValidation(err ? { ok: false, msg: err } : { ok: true, msg: "Step is valid." });
  }

  function handleValidateAll() {
    const errors: string[] = [];
    for (const item of displayItems) {
      const err = validateElement(item.element);
      if (err) {
        const label = item.element.name?.trim() || `(unnamed, #${item.element.sequenceNumber})`;
        errors.push(`${label}: ${err}`);
      }
    }
    if (errors.length === 0) {
      setAllValidation({
        ok: true,
        msgs: [
          `All ${mode === "filter" ? "rules" : mode === "responseTransformer" ? "response transformer steps" : "steps"} validated successfully.`,
        ],
      });
    } else {
      setAllValidation({ ok: false, msgs: errors });
    }
    if (selectedItem) {
      const err = validateElement(selectedItem);
      setStepValidation(err ? { ok: false, msg: err } : { ok: true, msg: "Step is valid." });
    }
  }

  // ── Tree DnD / context menu → auto-create step/rule ─────────────────────────

  function varNameFromExpr(expr: string): string {
    const matches = expr.match(/\['([^']+)'\]/g);
    if (matches && matches.length > 0) {
      const last = matches[matches.length - 1];
      return last.replace(/\['/g, "").replace(/']/g, "");
    }
    return "";
  }

  function addCreatedElement(newEl: Rule | Step) {
    const raw = insertElementAtPath(elements, [], newEl);
    const cloned = cloneElements(raw);
    assignSequenceNumbers(cloned);
    applyElements(cloned);
    setSelectedPath([cloned.length - 1]);
  }

  function createElementFromDrop(
    source: "inbound" | "outbound",
    dragExpr: string,
    nodeLabel?: string,
    ancestorLabels?: string[]
  ) {
    if (mode === "filter" && source === "inbound") {
      const rule = defaultRule("Rule Builder", elements.length === 0 ? "NONE" : "AND");
      (rule as RuleBuilderRule).field = dragExpr;
      rule.name = generateRuleBuilderName(dragExpr, "EXISTS", []);
      addCreatedElement(rule);
    } else if (mode !== "filter" && source === "inbound") {
      const step = defaultStep("Mapper");
      const varName =
        nodeLabel !== undefined && ancestorLabels !== undefined
          ? varNameFromTree(nodeLabel, ancestorLabels) || varNameFromExpr(dragExpr)
          : varNameFromExpr(dragExpr);
      (step as MapperStep).mapping = dragExpr;
      (step as MapperStep).variable = varName;
      step.name = varName;
      addCreatedElement(step);
    } else if (mode !== "filter" && source === "outbound") {
      const step = defaultStep("Message Builder");
      const varName =
        nodeLabel !== undefined && ancestorLabels !== undefined
          ? varNameFromTree(nodeLabel, ancestorLabels) || varNameFromExpr(dragExpr)
          : varNameFromExpr(dragExpr);
      (step as MessageBuilderStep).messageSegment = dragExpr;
      step.name = varName;
      addCreatedElement(step);
    }
  }

  function handleCreateFromTreeDrop(
    source: "inbound" | "outbound",
    dragExpr: string,
    nodeLabel: string,
    ancestorLabels: string[]
  ) {
    const prefs = loadAdminPrefs();
    if (
      prefs.filterTransformerShowIteratorDialog &&
      getExpressionParts(dragExpr, false).length > 0
    ) {
      setDropInteraction({
        stage: "confirm",
        source,
        dragExpr,
        nodeLabel,
        ancestorLabels,
        kind: "mapper",
      });
      return;
    }
    createElementFromDrop(source, dragExpr, nodeLabel, ancestorLabels);
  }

  function handleDropConfirmYes(dontShowAgain: boolean) {
    if (dontShowAgain) saveAdminPref("filterTransformerShowIteratorDialog", false);
    setDropInteraction((prev) => (prev ? { ...prev, stage: "wizard" } : null));
  }

  function handleDropConfirmNo(dontShowAgain: boolean) {
    if (dontShowAgain) saveAdminPref("filterTransformerShowIteratorDialog", false);
    const interaction = dropInteraction;
    setDropInteraction(null);
    if (!interaction) return;
    if (interaction.kind === "messageBuilder" && interaction.outboundExpr !== undefined) {
      handleCreateMessageBuilderFromTrees(interaction.outboundExpr, interaction.dragExpr);
      return;
    }
    createElementFromDrop(
      interaction.source,
      interaction.dragExpr,
      interaction.nodeLabel,
      interaction.ancestorLabels
    );
  }

  function handleDropConfirmCancel() {
    setDropInteraction(null);
  }

  function handleWizardComplete(result: WizardResult) {
    const interaction = dropInteraction;
    setDropInteraction(null);
    if (!interaction) return;
    const { source, dragExpr, nodeLabel, ancestorLabels, kind, outboundExpr } = interaction;

    function friendlyVarName(fallbackExpr: string): string {
      return (
        varNameFromTree(nodeLabel, ancestorLabels) ||
        varNameFromExpr(fallbackExpr) ||
        varNameFromExpr(dragExpr)
      );
    }

    function buildChild(expr: string, adjustedOutbound?: string): Rule | Step {
      if (kind === "messageBuilder") {
        const step = defaultStep("Message Builder") as MessageBuilderStep;
        step.messageSegment = adjustedOutbound ?? outboundExpr ?? "";
        step.mapping = expr;
        step.name = friendlyVarName(expr);
        return step;
      }
      if (mode === "filter" && source === "inbound") {
        const rule = defaultRule("Rule Builder", "AND") as RuleBuilderRule;
        rule.field = expr;
        rule.name = generateRuleBuilderName(expr, "EXISTS", []);
        return rule;
      } else if (mode !== "filter" && source === "inbound") {
        const step = defaultStep("Mapper") as MapperStep;
        step.mapping = expr;
        step.variable = friendlyVarName(expr);
        step.name = step.variable;
        return step;
      } else {
        const step = defaultStep("Message Builder") as MessageBuilderStep;
        step.messageSegment = expr;
        step.name = friendlyVarName(expr);
        return step;
      }
    }

    if (result.action === "createNew") {
      const { target, indexVariable, prefixSubstitutions } = result;
      const adjustedExpr = applyIteratorVariables(dragExpr, prefixSubstitutions, indexVariable);
      const adjustedOutbound =
        outboundExpr !== undefined
          ? applyIteratorVariables(outboundExpr, prefixSubstitutions, indexVariable)
          : undefined;
      const childEl = buildChild(adjustedExpr, adjustedOutbound);

      let iterEl: IteratorRule | IteratorStep;
      if (mode === "filter") {
        const r = defaultRule("Iterator", elements.length === 0 ? "NONE" : "AND") as IteratorRule;
        r.target = target;
        r.indexVariable = indexVariable;
        r.prefixSubstitutions = prefixSubstitutions;
        r.name = generateIteratorRuleName(target, false);
        (childEl as RuleBuilderRule).operator = "NONE";
        r.children = [childEl as Rule];
        iterEl = r;
      } else {
        const s = defaultStep("Iterator") as IteratorStep;
        s.target = target;
        s.indexVariable = indexVariable;
        s.prefixSubstitutions = prefixSubstitutions;
        s.name = generateIteratorStepName(target);
        s.children = [childEl as Step];
        iterEl = s;
      }

      const raw = insertElementAtPath(elements, [], iterEl);
      const cloned = cloneElements(raw);
      assignSequenceNumbers(cloned);
      applyElements(cloned);
      setSelectedPath([cloned.length - 1, 0]);
    } else {
      const { iteratorPath } = result;
      const adjustedExpr = replaceIteratorVariables(dragExpr, elements, iteratorPath);
      const adjustedOutbound =
        outboundExpr !== undefined
          ? replaceIteratorVariables(outboundExpr, elements, iteratorPath)
          : undefined;
      const childEl = buildChild(adjustedExpr, adjustedOutbound);
      const existingIter = getElementAtPath(elements, iteratorPath) as IteratorRule | IteratorStep;
      if (mode === "filter") {
        (childEl as Exclude<Rule, UnknownElement>).operator =
          existingIter.children.length === 0 ? "NONE" : "AND";
      }
      const raw = insertElementAtPath(elements, iteratorPath, childEl);
      const cloned = cloneElements(raw);
      assignSequenceNumbers(cloned);
      applyElements(cloned);
      const iterAfter = getElementAtPath(cloned, iteratorPath) as IteratorRule | IteratorStep;
      setSelectedPath([...iteratorPath, iterAfter.children.length - 1]);
    }
  }

  function handleWizardCancel() {
    setDropInteraction(null);
  }

  function handleTreeContextAction(action: TreeContextAction) {
    if (
      (action.action === "createRuleBuilder" && mode === "filter") ||
      (action.action === "createMapper" && mode !== "filter")
    ) {
      // Both are inbound-sourced creations (Rule Builder for filters, Mapper for
      // transformers). Route through the shared drag-drop entry point so the
      // iteration-prompt setting is honored identically to drag and drop. When the
      // setting is off (or the expression isn't iterable) it falls through to
      // createElementFromDrop, which builds the same element this used to.
      handleCreateFromTreeDrop("inbound", action.dragExpr, action.nodeLabel, action.ancestorLabels);
    } else if (action.action === "createMessageBuilder" && mode !== "filter") {
      // The right-clicked node is the write target → Message Segment.
      // Strip the inbound tree's `.toString()` suffix: Message Segment is an
      // assignment target (data is written into it), so it must not end in
      // `.toString()` (matches Java Swing admin, which uses an empty suffix here).
      // Mapping is left blank for the user to supply.
      const messageSegment = stripToStringSuffix(action.dragExpr);
      const prefs = loadAdminPrefs();
      if (
        prefs.filterTransformerShowIteratorDialog &&
        getExpressionParts(messageSegment, false).length > 0
      ) {
        // Honor the iteration prompt: the confirm → wizard flow rebuilds the
        // Message Builder from source="outbound" via buildChild (messageSegment = expr).
        setDropInteraction({
          stage: "confirm",
          source: "outbound",
          dragExpr: messageSegment,
          nodeLabel: action.nodeLabel,
          ancestorLabels: action.ancestorLabels,
          kind: "mapper",
        });
        return;
      }
      const step = defaultStep("Message Builder");
      const varName =
        varNameFromTree(action.nodeLabel, action.ancestorLabels) ||
        varNameFromExpr(action.dragExpr);
      (step as MessageBuilderStep).messageSegment = messageSegment;
      step.name = varName;
      addCreatedElement(step);
    }
  }

  function handleCreateMessageBuilderFromTrees(
    messageSegment: string,
    mapping: string,
    inboundNodeLabel?: string,
    inboundAncestorLabels?: string[]
  ) {
    const step = defaultStep("Message Builder");
    (step as MessageBuilderStep).messageSegment = messageSegment;
    (step as MessageBuilderStep).mapping = mapping;
    const friendly =
      inboundNodeLabel !== undefined && inboundAncestorLabels !== undefined
        ? varNameFromTree(inboundNodeLabel, inboundAncestorLabels)
        : "";
    step.name = friendly || varNameFromExpr(messageSegment);
    addCreatedElement(step);
  }

  /**
   * Inbound → Outbound tree drop entry point.  Mirrors the transformer-list iterator
   * flow ([[handleCreateFromTreeDrop]]) but creates a Message Builder with both fields
   * (messageSegment + mapping) substituted through the iterator on completion.
   */
  function handleCreateMessageBuilderFromTreesWithIterator(
    messageSegment: string,
    mapping: string,
    inboundNodeLabel?: string,
    inboundAncestorLabels?: string[]
  ) {
    const prefs = loadAdminPrefs();
    if (
      prefs.filterTransformerShowIteratorDialog &&
      getExpressionParts(mapping, false).length > 0
    ) {
      setDropInteraction({
        stage: "confirm",
        source: "inbound",
        dragExpr: mapping,
        outboundExpr: messageSegment,
        nodeLabel: inboundNodeLabel ?? "",
        ancestorLabels: inboundAncestorLabels ?? [],
        kind: "messageBuilder",
      });
      return;
    }
    handleCreateMessageBuilderFromTrees(
      messageSegment,
      mapping,
      inboundNodeLabel,
      inboundAncestorLabels
    );
  }

  function onStepListDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(TREE_NODE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setStepListDragOver(true);
    }
  }

  function onStepListDragLeave() {
    setStepListDragOver(false);
  }

  function onStepListDrop(e: React.DragEvent) {
    e.preventDefault();
    setStepListDragOver(false);
    const raw = e.dataTransfer.getData(TREE_NODE_MIME);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as TreeNodeDragData;
      handleCreateFromTreeDrop(
        data.source,
        data.dragExpr,
        data.nodeLabel ?? "",
        data.ancestorLabels ?? []
      );
    } catch {
      // Invalid drag data
    }
  }

  // ── Reference panel data type / template handlers ───────────────────────────

  function handleRefTypeChange(side: "inbound" | "outbound", dt: string, propsXml: string | null) {
    if (side === "inbound" && !isSource && mode !== "responseTransformer") return;
    if (mode === "transformer" || mode === "responseTransformer") {
      const ts = parsed as TransformerState;
      const next: TransformerState =
        side === "inbound"
          ? { ...ts, inboundDataType: dt, inboundPropertiesXml: propsXml }
          : { ...ts, outboundDataType: dt, outboundPropertiesXml: propsXml };
      setParsed(next);
      onChange(serializeTransformerToXml(baseXmlRef.current, next, txRootTag));
    } else if (mode === "filter" && side === "inbound" && transformerState && onTransformerChange) {
      const next: TransformerState = {
        ...transformerState,
        inboundDataType: dt,
        inboundPropertiesXml: propsXml,
      };
      onTransformerChange(serializeTransformerToXml(transformerXmlRef.current, next));
    }
  }

  function handleRefTemplateChange(side: "inbound" | "outbound", text: string) {
    if (mode === "transformer" || mode === "responseTransformer") {
      const ts = parsed as TransformerState;
      const next: TransformerState =
        side === "inbound"
          ? { ...ts, inboundTemplate: text || null }
          : { ...ts, outboundTemplate: text || null };
      setParsed(next);
      onChange(serializeTransformerToXml(baseXmlRef.current, next, txRootTag));
    } else if (mode === "filter" && side === "inbound" && transformerState && onTransformerChange) {
      const next: TransformerState = { ...transformerState, inboundTemplate: text || null };
      onTransformerChange(serializeTransformerToXml(transformerXmlRef.current, next));
    }
  }

  return {
    // Parsed state (needed for reference panel config derivation)
    parsed,
    transformerState,

    // UI state
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

    // Derived values
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

    // DnD
    stepListDragOver,
    onStepListDragOver,
    onStepListDragLeave,
    onStepListDrop,

    // Iterator dialog interaction
    dropInteraction,
    handleDropConfirmYes,
    handleDropConfirmNo,
    handleDropConfirmCancel,
    handleWizardComplete,
    handleWizardCancel,

    // Move-out-of-iterator confirmation
    moveOutConfirm,
    handleMoveOutConfirmed,
    handleMoveOutCancelled,

    // Destructive-op confirmations #62/#63)
    typeChangeConfirm,
    handleTypeChangeConfirmed,
    handleTypeChangeCancelled,
    deleteConfirm,
    handleDeleteConfirmed,
    handleDeleteCancelled,

    // Element mutation handlers
    handleAdd,
    handleDelete,
    handleMoveUp,
    handleMoveDown,
    handleElementChange,
    handleToggleEnabled,
    handleOperatorChange,
    handleTypeChange,

    // Assign To Iterator
    assignToIteratorOpen,
    assignInfo,
    handleAssignToIterator,
    handleAssignToIteratorComplete,
    handleAssignToIteratorCancel,

    // Remove From Iterator
    handleRemoveFromIterator,

    // Import / Export
    importConfirm,
    handleImportFile,
    handleImportAppend,
    handleImportReplace,
    handleImportCancel,
    handleExport,

    // Validation handlers
    handleValidateStep,
    handleValidateAll,

    // Tree DnD/context menu handlers
    handleTreeContextAction,
    handleCreateMessageBuilderFromTrees,
    handleCreateMessageBuilderFromTreesWithIterator,

    // Reference panel handlers
    handleRefTypeChange,
    handleRefTemplateChange,
  };
}
