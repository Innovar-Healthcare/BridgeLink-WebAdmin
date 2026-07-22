"use client";

import type { Rule, Step, Operator, DisplayItem } from "../../_lib/filter-transformer-xml";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface Props {
  item: DisplayItem;
  isSelected: boolean;
  mode: "filter" | "transformer" | "responseTransformer";
  rowPy: string;
  selectCls: string;
  childTypes: (Rule["type"] | Step["type"])[];
  availableTypes: (Rule["type"] | Step["type"])[];
  onSelect: (path: number[]) => void;
  onToggleEnabled: (path: number[]) => void;
  onOperatorChange: (path: number[], op: Operator) => void;
  onTypeChange: (path: number[], type: Rule["type"] | Step["type"]) => void;
  // Context menu callbacks
  onAdd: () => void;
  onDelete: () => void;
  onAssignToIterator: () => void;
  onRemoveFromIterator: () => void;
  onImport: () => void;
  onExport: () => void;
  onValidateAll: () => void;
  onValidateStep: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  // Context menu enable states
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isInsideIterator: boolean;
  hasElements: boolean;
}

export function ElementRow({
  item,
  isSelected,
  mode,
  rowPy,
  selectCls,
  childTypes,
  availableTypes,
  onSelect,
  onToggleEnabled,
  onOperatorChange,
  onTypeChange,
  onAdd,
  onDelete,
  onAssignToIterator,
  onRemoveFromIterator,
  onImport,
  onExport,
  onValidateAll,
  onValidateStep,
  onMoveUp,
  onMoveDown,
  canDelete,
  canMoveUp,
  canMoveDown,
  isInsideIterator,
  hasElements,
}: Props) {
  const isFirst = item.path[item.path.length - 1] === 0;
  const rule = item.element as Rule;
  const op = (rule as Rule & { operator?: Operator }).operator;
  const rowTypes = item.isChild ? childTypes : availableTypes;
  // Opaque, unrecognized element: rendered read-only — it is preserved
  // verbatim and must not be toggled, re-typed, or otherwise mutated here.
  const isUnknown = item.element.type === "unknown";

  const stepLabel = mode === "filter" ? "Rule" : "Step";
  const containerLabel =
    mode === "filter"
      ? "Filter"
      : mode === "responseTransformer"
        ? "Response Transformer"
        : "Transformer";

  return (
    <ContextMenu onOpenChange={(open) => open && onSelect(item.path)}>
      <ContextMenuTrigger asChild>
        <div
          onClick={() => onSelect(item.path)}
          data-testid={`ft-element-${item.path.join("-")}`}
          className={
            `flex items-center gap-1 px-2 ${rowPy} cursor-pointer border-b border-border text-xs ` +
            (isSelected
              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100"
              : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300")
          }
        >
          {/* Enabled checkbox */}
          <input
            type="checkbox"
            className="w-3 h-3 shrink-0"
            checked={item.element.enabled}
            disabled={isUnknown}
            onChange={(e) => {
              e.stopPropagation();
              if (isUnknown) return;
              onToggleEnabled(item.path);
            }}
          />

          {/* Sequence # */}
          <span className="w-7 text-center shrink-0 font-mono text-gray-400 dark:text-gray-500">
            {item.element.sequenceNumber}
          </span>

          {/* Operator (filter only) */}
          {mode === "filter" && (
            <span className="w-[70px] shrink-0" onClick={(e) => e.stopPropagation()}>
              {!isFirst && op !== undefined && (
                <select
                  value={op}
                  onChange={(e) => onOperatorChange(item.path, e.target.value as Operator)}
                  className={selectCls + " w-full"}
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              )}
            </span>
          )}

          {/* Name */}
          <span
            className="flex-1 truncate min-w-0"
            style={{ paddingLeft: item.depth > 0 ? `${item.depth * 12}px` : 0 }}
          >
            {item.depth > 0 && <span className="text-gray-300 dark:text-gray-600 mr-1">└</span>}
            <span title={item.element.name}>
              {item.element.name || (
                <span className="italic text-gray-400 dark:text-gray-500">(unnamed)</span>
              )}
            </span>
          </span>

          {/* Type dropdown — read-only static label for unrecognized elements */}
          <span className="w-[170px] shrink-0" onClick={(e) => e.stopPropagation()}>
            {isUnknown ? (
              <span
                className="block w-full truncate italic text-gray-400 dark:text-gray-500"
                title="Unsupported element — preserved unchanged"
              >
                Unsupported (preserved)
              </span>
            ) : (
              <select
                value={item.element.type}
                onChange={(e) =>
                  onTypeChange(item.path, e.target.value as Rule["type"] | Step["type"])
                }
                className={selectCls + " w-full"}
              >
                {rowTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {/* Pin the element's current type when it is gated off by
                    server-enablement, so the select shows the real
                    type (disabled) instead of the first option — where a stray
                    click would convert the step and destroy its config. */}
                {!rowTypes.includes(item.element.type) && (
                  <option value={item.element.type} disabled>
                    {item.element.type} (unavailable)
                  </option>
                )}
              </select>
            )}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={onAdd}>Add New {stepLabel}</ContextMenuItem>
        <ContextMenuItem onSelect={onDelete} disabled={!canDelete} variant="destructive">
          Delete {stepLabel}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={onAssignToIterator} disabled={!canDelete}>
          Assign To Iterator
        </ContextMenuItem>
        <ContextMenuItem onSelect={onRemoveFromIterator} disabled={!isInsideIterator}>
          Remove From Iterator
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={onImport}>Import {containerLabel}</ContextMenuItem>
        <ContextMenuItem onSelect={onExport}>Export {containerLabel}</ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={onValidateAll} disabled={!hasElements}>
          Validate {containerLabel}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onValidateStep} disabled={!canDelete}>
          Validate {stepLabel}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={onMoveUp} disabled={!canMoveUp}>
          Move {stepLabel} Up
        </ContextMenuItem>
        <ContextMenuItem onSelect={onMoveDown} disabled={!canMoveDown}>
          Move {stepLabel} Down
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
