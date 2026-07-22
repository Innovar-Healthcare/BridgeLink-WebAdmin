"use client";

import { useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Braces } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverTooltip } from "@/components/hover-tooltip";
import { inputCls } from "./styles";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

interface VariableInsertInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: readonly string[];
  placeholder?: string;
  /** Extra Tailwind classes applied to the `<input>` (e.g. width). */
  className?: string;
}

/**
 * A plain text input with an inline variable-insert button.
 *
 * Clicking the `{ }` button opens a popover listing the provided variable
 * names. Clicking a variable inserts `${variableName}` at the tracked cursor
 * position in the input and closes the popover.
 */
export function VariableInsertInput({
  value,
  onChange,
  variables,
  placeholder,
  className,
}: VariableInsertInputProps) {
  const { viewDensity } = useCompactMode();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorPosRef = useRef<number>(value.length);

  function saveCursor() {
    const el = inputRef.current;
    if (el) cursorPosRef.current = el.selectionStart ?? el.value.length;
  }

  function handleVariableClick(varName: string) {
    const insertion = `\${${varName}}`;
    const pos = cursorPosRef.current;
    const newValue = value.slice(0, pos) + insertion + value.slice(pos);
    const newCursor = pos + insertion.length;
    onChange(newValue);
    setOpen(false);
    // Restore focus and cursor position after React re-renders
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
        cursorPosRef.current = newCursor;
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        className={cn(inputCls(viewDensity), className)}
        onChange={(e) => {
          saveCursor();
          onChange(e.target.value);
        }}
        onSelect={saveCursor}
        onClick={saveCursor}
        onFocus={saveCursor}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <HoverTooltip content="Insert variable">
          <Popover.Trigger
            className="shrink-0 p-1.5 rounded border border-border
              text-gray-700 dark:text-gray-300
              hover:bg-gray-50 dark:hover:bg-gray-700
              hover:border-border transition-colors"
          >
            <Braces size={14} />
          </Popover.Trigger>
        </HoverTooltip>
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="start"
            sideOffset={4}
            className="z-50 rounded border border-border bg-white dark:bg-gray-900 shadow-md overflow-y-auto"
            style={{ maxHeight: 220, minWidth: 140 }}
          >
            {variables.map((varName) => (
              <button
                key={varName}
                type="button"
                onClick={() => handleVariableClick(varName)}
                className="block w-full text-left px-2 py-1 text-xs font-mono text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900 truncate"
              >
                {varName}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
