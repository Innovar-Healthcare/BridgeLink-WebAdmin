"use client";

import { type ReactNode, useState } from "react";
import {
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelBottom,
  GripVertical,
  GripHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { cn } from "@/lib/utils";
import { HoverTooltip } from "@/components/hover-tooltip";

interface DockableToolbarProps {
  position: ToolbarPosition;
  onPositionChange: (pos: ToolbarPosition) => void;
  children: ReactNode;
}

const POSITIONS: { pos: ToolbarPosition; icon: typeof PanelLeft; label: string }[] = [
  { pos: "left", icon: PanelLeft, label: "Left" },
  { pos: "top", icon: PanelTop, label: "Top" },
  { pos: "right", icon: PanelRight, label: "Right" },
  { pos: "bottom", icon: PanelBottom, label: "Bottom" },
];

/** Container styles for each dock position */
const CONTAINER_CLS: Record<ToolbarPosition, string> = {
  left: "shrink-0 flex flex-col w-[76px] border-r border-border bg-gray-50 dark:bg-gray-800 py-2 px-1.5 gap-0.5 overflow-y-auto",
  right:
    "shrink-0 flex flex-col w-[76px] border-l border-border bg-gray-50 dark:bg-gray-800 py-2 px-1.5 gap-0.5 overflow-y-auto",
  top: "shrink-0 flex flex-row flex-wrap items-center border-b border-border bg-gray-50 dark:bg-gray-800 px-2 py-1.5 gap-1 overflow-x-auto",
  bottom:
    "shrink-0 flex flex-row flex-wrap items-center border-t border-border bg-gray-50 dark:bg-gray-800 px-2 py-1.5 gap-1 overflow-x-auto",
};

/** Dropdown content alignment per position */
const MENU_SIDE: Record<ToolbarPosition, "top" | "bottom" | "left" | "right"> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

function PositionPicker({
  position,
  onPositionChange,
}: {
  position: ToolbarPosition;
  onPositionChange: (pos: ToolbarPosition) => void;
}) {
  const [open, setOpen] = useState(false);
  const isVertical = position === "left" || position === "right";

  function handlePick(pos: ToolbarPosition) {
    setOpen(false);
    onPositionChange(pos);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <HoverTooltip content="Move toolbar">
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center justify-center p-1 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            suppressHydrationWarning
          >
            {isVertical ? (
              <GripVertical className="w-3.5 h-3.5" />
            ) : (
              <GripHorizontal className="w-3.5 h-3.5" />
            )}
          </button>
        </DropdownMenuTrigger>
      </HoverTooltip>
      <DropdownMenuContent side={MENU_SIDE[position]} align="center" className="p-2">
        {/* Cross-pattern: top row, middle row (left + right), bottom row */}
        <div className="grid grid-cols-3 gap-1 w-[88px]">
          {/* Row 1: top center */}
          <div />
          <PosPick pos="top" current={position} onChange={handlePick} />
          <div />
          {/* Row 2: left + right */}
          <PosPick pos="left" current={position} onChange={handlePick} />
          <div />
          <PosPick pos="right" current={position} onChange={handlePick} />
          {/* Row 3: bottom center */}
          <div />
          <PosPick pos="bottom" current={position} onChange={handlePick} />
          <div />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PosPick({
  pos,
  current,
  onChange,
}: {
  pos: ToolbarPosition;
  current: ToolbarPosition;
  onChange: (p: ToolbarPosition) => void;
}) {
  const def = POSITIONS.find((p) => p.pos === pos)!;
  const Icon = def.icon;
  const active = pos === current;

  return (
    <HoverTooltip content={def.label}>
      <button
        onClick={() => onChange(pos)}
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded",
          active
            ? "bg-blue-600 text-white"
            : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        )}
      >
        <Icon className="w-4 h-4" />
      </button>
    </HoverTooltip>
  );
}

export function DockableToolbar({ position, onPositionChange, children }: DockableToolbarProps) {
  const isVertical = position === "left" || position === "right";

  return (
    <div className={CONTAINER_CLS[position]} data-testid="dockable-toolbar">
      {children}
      {/* Spacer pushes picker to end */}
      {isVertical ? <div className="flex-1" /> : null}
      {/* Separator before picker */}
      {isVertical ? (
        <span className="w-full h-px bg-border my-0.5" />
      ) : (
        <span className="w-px h-5 bg-border mx-0.5 shrink-0" />
      )}
      <PositionPicker position={position} onPositionChange={onPositionChange} />
    </div>
  );
}
