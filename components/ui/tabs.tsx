"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn("group/tabs flex data-[orientation=horizontal]:flex-col", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // BridgeLink Blue folder-tab strip
        "group/tabs-list inline-flex w-full items-end",
        "bg-[#1B3D6D] border-b border-[#0F2542]",
        "px-2 pt-1 shrink-0",
        // Vertical orientation
        "group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Shape
        "relative inline-flex items-center justify-center gap-1.5",
        "rounded-t border border-b-0 px-3 py-1.5 text-xs font-bold whitespace-nowrap",
        "transition-colors",
        // Unselected — white text on blue strip
        "border-transparent text-white hover:bg-white/10",
        // Selected — white card lifted out of the strip
        "data-[state=active]:bg-white data-[state=active]:border-border",
        "data-[state=active]:text-gray-800 data-[state=active]:-mb-px data-[state=active]:z-10",
        // Dark mode selected
        "dark:data-[state=active]:bg-gray-900 dark:data-[state=active]:text-gray-100",
        // Focus
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
        // Disabled
        "disabled:pointer-events-none disabled:opacity-50",
        // Vertical orientation
        "group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start",
        // SVGs
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
