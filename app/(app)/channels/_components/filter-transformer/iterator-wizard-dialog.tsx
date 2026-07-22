"use client";

import { useState, useMemo } from "react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { FormDialog } from "@/components/form-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getExpressionParts,
  buildPrefix,
  findIteratorEntries,
  getValidIndexVariable,
  getAncestorIndexVariables,
  getDescendantIndexVariables,
  type IteratorEntry,
} from "../../_lib/iterator-utils";
import type { WizardResult } from "./use-filter-transformer-state";
import type { Rule, Step } from "../../_lib/filter-transformer-xml";

interface IteratorWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The inbound expression that was dragged from the message tree */
  dragExpr: string;
  /** The outbound expression (Message Builder drops only) */
  outboundExpr?: string;
  /** All current elements — used to find existing iterators */
  elements: (Rule | Step)[];
  /**
   * Path of the element being assigned. Excluded (with its subtree) from the
   * candidate-iterator list so an Iterator can't be assigned into its own
   * descendant. Mirrors Java IteratorWizardDialog.fillIteratorEntries.
   */
  excludePath?: number[];
  /** "filter" or transformer mode — affects labeling */
  mode: "filter" | "transformer" | "responseTransformer";
  onComplete: (result: WizardResult) => void;
}

export function IteratorWizardDialog({
  open,
  onOpenChange,
  dragExpr,
  outboundExpr,
  elements,
  excludePath,
  mode,
  onComplete,
}: IteratorWizardDialogProps) {
  const { viewDensity } = useCompactMode();
  const elementName = mode === "filter" ? "rule" : "step";

  // Parse the inbound expression into parts (number literals excluded, matching Java)
  const exprParts = useMemo(() => getExpressionParts(dragExpr, false), [dragExpr]);

  // Parse the outbound expression into parts (only for Message Builder drops)
  const outboundParts = useMemo(
    () => getExpressionParts(outboundExpr ?? "", false),
    [outboundExpr]
  );
  const hasOutbound = outboundParts.length > 0;

  // Existing iterators for the "Choose Existing" option (excluding the element
  // being assigned and its own subtree, so it can't be assigned into itself).
  const iteratorEntries = useMemo(
    () => findIteratorEntries(elements, excludePath),
    [elements, excludePath]
  );
  const hasExisting = iteratorEntries.length > 0;

  // ── Local state ──────────────────────────────────────────────────────────────

  const [selectMode, setSelectMode] = useState<"createNew" | "useExisting">(
    hasExisting ? "useExisting" : "createNew"
  );

  // Default inbound selection: prefer a non-root part (index > 0), matching Java
  const defaultPartIndex = useMemo(() => {
    const firstNonZero = exprParts.findIndex((_, i) => i > 0);
    return firstNonZero >= 0 ? firstNonZero : 0;
  }, [exprParts]);

  const [selectedPartIndex, setSelectedPartIndex] = useState(defaultPartIndex);

  // Default outbound selection: same index as inbound, clamped to outbound length
  const defaultOutboundIndex = useMemo(
    () => Math.min(defaultPartIndex, Math.max(0, outboundParts.length - 1)),
    [defaultPartIndex, outboundParts.length]
  );
  const [selectedOutboundIndex, setSelectedOutboundIndex] = useState(defaultOutboundIndex);

  // Reset when dragExpr/outboundExpr change (dialog re-opened)
  const [lastExpr, setLastExpr] = useState(dragExpr);
  const [lastOutboundExpr, setLastOutboundExpr] = useState(outboundExpr);
  if (dragExpr !== lastExpr || outboundExpr !== lastOutboundExpr) {
    setLastExpr(dragExpr);
    setLastOutboundExpr(outboundExpr);
    setSelectedPartIndex(defaultPartIndex);
    setSelectedOutboundIndex(defaultOutboundIndex);
    setSelectMode(hasExisting ? "useExisting" : "createNew");
  }

  const [selectedIteratorPath, setSelectedIteratorPath] = useState<string>(
    iteratorEntries[0] ? JSON.stringify(iteratorEntries[0].path) : ""
  );

  // ── Derived values ───────────────────────────────────────────────────────────

  // The inbound target prefix up to and including the selected part
  const target = useMemo(
    () => buildPrefix(exprParts, selectedPartIndex + 1),
    [exprParts, selectedPartIndex]
  );

  // The outbound target prefix up to and including the selected outbound part
  const outboundTarget = useMemo(
    () => (hasOutbound ? buildPrefix(outboundParts, selectedOutboundIndex + 1) : ""),
    [outboundParts, selectedOutboundIndex, hasOutbound]
  );

  // Auto-generated index variable, derived from context so it never collides
  // with an enclosing or nested iterator (e.g. proposes "j" under an "i"
  // ancestor). The new iterator takes the assigned element's position, so its
  // ancestors are the element's ancestors and its descendants are the iterators
  // within the element being wrapped. Mirrors Java IteratorWizardDialog:79-81.
  const indexVariable = useMemo(
    () =>
      getValidIndexVariable(
        excludePath ? getAncestorIndexVariables(elements, excludePath) : [],
        excludePath ? getDescendantIndexVariables(elements, excludePath) : []
      ),
    [elements, excludePath]
  );

  // Preview lines: prefix → prefix[i]suffix
  const inboundSuffix = target ? dragExpr.slice(target.length) : "";
  const outboundSuffix = outboundTarget ? (outboundExpr ?? "").slice(outboundTarget.length) : "";

  // ── Inbound selection handler (mirrors outbound when both present, matching Java) ──

  function handleInboundSelect(index: number) {
    setSelectedPartIndex(index);
    // Auto-select the same index on the outbound side if available (Java coupling)
    if (hasOutbound) {
      setSelectedOutboundIndex(Math.min(index, outboundParts.length - 1));
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  function handleSubmit() {
    if (selectMode === "createNew") {
      // With no discernible target (e.g. "Assign To Iterator" on an element with
      // no source expression), create a blank default iterator — no prefix
      // substitutions. Mirrors Java's blank-default-iterator fallback.
      const prefixSubstitutions: string[] = [];
      if (target) {
        prefixSubstitutions.push(target);
        if (hasOutbound) {
          // Use the user-selected outbound prefix (matches Java fillIteratorProperties)
          prefixSubstitutions.push(outboundTarget);
        } else if (target.startsWith("msg")) {
          // Mapper fallback: mirror msg → tmp when no outbound expression (unchanged)
          prefixSubstitutions.push("tmp" + target.slice("msg".length));
        }
      }
      onComplete({
        action: "createNew",
        target,
        indexVariable,
        prefixSubstitutions,
      });
    } else {
      const path = selectedIteratorPath ? (JSON.parse(selectedIteratorPath) as number[]) : null;
      if (!path) return;
      onComplete({ action: "useExisting", iteratorPath: path });
    }
  }

  // Create-new is always available (a blank default iterator is valid even with
  // no expression to iterate on); choose-existing needs a selected iterator.
  const submitDisabled = selectMode === "createNew" ? false : !selectedIteratorPath;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Iterator Wizard"
      description={`Configure an Iterator for this ${elementName}.`}
      onSubmit={handleSubmit}
      submitLabel="OK"
      submitDisabled={submitDisabled}
      maxWidth="sm:max-w-lg"
    >
      <div className="space-y-4">
        {/* ── Select iterator mode ──────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Select an Iterator</Label>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="iterator-mode"
                value="createNew"
                checked={selectMode === "createNew"}
                onChange={() => setSelectMode("createNew")}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-sm">Create New Iterator</span>
            </label>
            <label
              className={`flex items-center gap-2 ${hasExisting ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
            >
              <input
                type="radio"
                name="iterator-mode"
                value="useExisting"
                checked={selectMode === "useExisting"}
                onChange={() => setSelectMode("useExisting")}
                disabled={!hasExisting}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-sm">Choose Existing Iterator</span>
            </label>
          </div>
        </div>

        {/* ── Choose existing ───────────────────────────────────────────────── */}
        {selectMode === "useExisting" && (
          <div className="space-y-1.5">
            <Label htmlFor="existing-iter" className="text-sm">
              Iterator
            </Label>
            <Select value={selectedIteratorPath} onValueChange={setSelectedIteratorPath}>
              <SelectTrigger id="existing-iter" density={viewDensity} className="text-sm">
                <SelectValue placeholder="Select an iterator…" />
              </SelectTrigger>
              <SelectContent>
                {iteratorEntries.map((entry: IteratorEntry) => (
                  <SelectItem key={JSON.stringify(entry.path)} value={JSON.stringify(entry.path)}>
                    <span style={{ paddingLeft: `${entry.depth * 12}px` }} className="text-sm">
                      {entry.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ── Create new: inbound object selector ──────────────────────────── */}
        {selectMode === "createNew" && exprParts.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Iterate On</Label>
            <p className="text-xs text-muted-foreground">
              {hasOutbound
                ? "Select the part of the object to iterate on:"
                : "Select the expression level to iterate over:"}
            </p>
            <div className="space-y-1.5 rounded border bg-muted/30 p-2.5">
              {exprParts.map((part, i) => {
                const prefix = buildPrefix(exprParts, i + 1);
                return (
                  <label key={i} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="expr-part"
                      value={String(i)}
                      checked={selectedPartIndex === i}
                      onChange={() => handleInboundSelect(i)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <code className="text-xs font-mono">{prefix}</code>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Create new: outbound message selector (Message Builder drops only) */}
        {selectMode === "createNew" && hasOutbound && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Outbound Message</Label>
            <p className="text-xs text-muted-foreground">
              Select the part of the outbound message to iterate through:
            </p>
            <div className="space-y-1.5 rounded border bg-muted/30 p-2.5">
              {outboundParts.map((part, i) => {
                const prefix = buildPrefix(outboundParts, i + 1);
                return (
                  <label key={i} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="outbound-part"
                      value={String(i)}
                      checked={selectedOutboundIndex === i}
                      onChange={() => setSelectedOutboundIndex(i)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <code className="text-xs font-mono">{prefix}</code>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Preview ───────────────────────────────────────────────────────── */}
        {selectMode === "createNew" && target && (
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Substitution Preview</Label>
            <div className="rounded border bg-muted/30 px-3 py-2 space-y-1">
              <code className="text-xs font-mono block">
                {target}
                {inboundSuffix} {"→"} {target}[{indexVariable}]{inboundSuffix}
              </code>
              {hasOutbound && outboundTarget && (
                <code className="text-xs font-mono block">
                  {outboundTarget}
                  {outboundSuffix} {"→"} {outboundTarget}[{indexVariable}]{outboundSuffix}
                </code>
              )}
            </div>
          </div>
        )}
      </div>
    </FormDialog>
  );
}
