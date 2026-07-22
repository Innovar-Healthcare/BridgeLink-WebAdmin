"use client";

import { Download } from "lucide-react";
import { AdaptiveBtn } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface EventsActionPanelProps {
  position: ToolbarPosition;
  onExportAll: () => void;
}

export function EventsActionPanel({ position, onExportAll }: EventsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";

  return (
    <AdaptiveBtn
      orientation={orientation}
      onClick={onExportAll}
      icon={<Download className="w-4 h-4" />}
      label="Export All"
      title="Export all events"
    />
  );
}
