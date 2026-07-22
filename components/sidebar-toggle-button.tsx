"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSidebarCollapsed } from "@/lib/hooks/use-sidebar-collapsed";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SidebarToggleButton() {
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={toggleCollapsed}
          className="absolute bottom-[36px] -right-3 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-white shadow-sm transition-shadow hover:shadow-md cursor-pointer dark:bg-gray-800"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {collapsed ? "Expand sidebar" : "Collapse sidebar"}
      </TooltipContent>
    </Tooltip>
  );
}
