"use client";

import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface InfoTooltipProps {
  /** Tooltip text shown on hover. */
  text: string;
  /** Which side to show the tooltip on. Defaults to "top". */
  side?: "top" | "right" | "bottom" | "left";
  /** Tailwind size classes for the icon. Defaults to "w-3.5 h-3.5". */
  iconSize?: string;
}

/**
 * A small help-circle icon that shows a tooltip on hover.
 * Use alongside labels to provide inline help text.
 */
export function InfoTooltip({ text, side = "top", iconSize = "w-3.5 h-3.5" }: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle
          className={`${iconSize} text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help shrink-0`}
        />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs text-center">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
