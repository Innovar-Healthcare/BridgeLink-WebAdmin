"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HoverTooltipProps {
  /** Tooltip text or content. If falsy, children render unwrapped. */
  content: React.ReactNode;
  /** Which side to show the tooltip on. */
  side?: "top" | "right" | "bottom" | "left";
  /** Offset from the trigger element in px. */
  sideOffset?: number;
  /** Max-width Tailwind class. Defaults to "max-w-[300px]". */
  maxWidth?: string;
  /** The trigger element — must accept a ref (native HTML elements do). */
  children: React.ReactElement;
}

/**
 * Convenience wrapper that adds a Radix tooltip to any element.
 * Renders children unwrapped when `content` is falsy.
 */
export function HoverTooltip({
  content,
  side = "top",
  sideOffset = 4,
  maxWidth = "max-w-[300px]",
  children,
}: HoverTooltipProps) {
  if (!content) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={sideOffset} className={`${maxWidth} text-left`}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
