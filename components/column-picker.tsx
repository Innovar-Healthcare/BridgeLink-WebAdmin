"use client";

import { useState, useRef } from "react";
import { Popover } from "radix-ui";
import { Columns, RotateCcw, GripVertical } from "lucide-react";
import type { ColDef, ColStateMap } from "@/lib/hooks/use-column-config";

interface ColumnPickerProps<K extends string> {
  /** All columns in current display order */
  cols: ColDef<K>[];
  colState: ColStateMap<K>;
  onToggle: (key: K) => void;
  onReset: () => void;
  /** Called when a column is dragged to a new position */
  onMove: (fromIndex: number, toIndex: number) => void;
}

export function ColumnPicker<K extends string>({
  cols,
  colState,
  onToggle,
  onReset,
  onMove,
}: ColumnPickerProps<K>) {
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);

  function handleDragStart(e: React.DragEvent, idx: number) {
    dragIdx.current = idx;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(idx);
  }

  function handleDrop(e: React.DragEvent, toIdx: number) {
    e.preventDefault();
    const fromIdx = dragIdx.current;
    if (fromIdx !== null && fromIdx !== toIdx) {
      onMove(fromIdx, toIdx);
    }
    dragIdx.current = null;
    setDragOver(null);
  }

  function handleDragEnd() {
    dragIdx.current = null;
    setDragOver(null);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          title="Show/hide/reorder columns"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border rounded-md transition-colors ${
            open
              ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
              : "border-border text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          <Columns className="w-3.5 h-3.5" />
          Columns
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        {/* Outer container: flex column capped to the viewport space Radix actually
            measured (--radix-popover-content-available-height), so a long column list
            (e.g. Message Browser, 15+ static + dynamic metadata cols) scrolls internally
            instead of overflowing — and, since this is portaled to document.body, it's
            never clipped by an ancestor's overflow-hidden (e.g. a docked detail pane
            shrinking the table container). See,. */}
        <Popover.Content
          align="end"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 flex flex-col bg-white dark:bg-gray-800 border border-border rounded-lg shadow-lg min-w-[180px] max-h-[min(70vh,var(--radix-popover-content-available-height))] overflow-hidden"
        >
          {/* Sticky header */}
          <div className="px-3 py-1 text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide select-none border-b border-border shrink-0">
            Drag to reorder
          </div>

          {/* Scrollable column list */}
          <div className="flex-1 overflow-y-auto py-1">
            {cols.map((col, idx) => {
              const visible = colState[col.key]?.visible !== false;
              const canToggle = col.canHide !== false;
              const isOver = dragOver === idx;

              return (
                <div
                  key={col.key}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 px-2 py-1.5 text-sm select-none transition-colors ${
                    isOver
                      ? "bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-400 dark:border-blue-500"
                      : "hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {/* Drag grip */}
                  <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0 cursor-grab active:cursor-grabbing" />

                  {/* Visibility checkbox */}
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={!canToggle}
                    onChange={() => canToggle && onToggle(col.key)}
                    onClick={(e) => e.stopPropagation()}
                    className={`rounded border-border text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 shrink-0 ${
                      !canToggle ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                    }`}
                  />

                  <span
                    className={`text-gray-700 dark:text-gray-300 truncate ${!canToggle ? "opacity-40" : ""}`}
                  >
                    {col.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Sticky footer */}
          <div className="border-t border-border pt-1 pb-1 shrink-0">
            <button
              onClick={() => {
                onReset();
                setOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 w-full"
            >
              <RotateCcw className="w-3 h-3" /> Reset to defaults
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
