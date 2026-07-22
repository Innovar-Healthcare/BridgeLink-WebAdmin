"use client";

/**
 * Generic Settings-page action panel for runtime plugin settings tabs
 *. The Settings host only renders a toolbar for a plugin tab when
 * the tab registers an actionPanel component; the built-in plugin tabs each
 * ship their own, so runtime tabs share this one. Receives the handlers the
 * runtime tab exposes through its actionsRef ({ save, refresh, dirty, saving,
 * loading }), wrapped by the host (mirrors MessageTrendsActionPanel).
 */

import { RefreshCw, Save } from "lucide-react";
import { AdaptiveBtn } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface RuntimeSettingsActionPanelProps {
  position: ToolbarPosition;
  save?: () => void;
  refresh?: () => void;
  dirty?: boolean;
  saving?: boolean;
  loading?: boolean;
  viewOnly?: boolean;
}

export function RuntimeSettingsActionPanel({
  position,
  save,
  refresh,
  dirty = false,
  saving = false,
  loading = false,
  viewOnly = false,
}: RuntimeSettingsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";

  return (
    <>
      <AdaptiveBtn
        orientation={orientation}
        onClick={() => save?.()}
        disabled={!dirty || saving || viewOnly}
        variant="primary"
        icon={<Save className="w-4 h-4" />}
        label={saving ? "Saving..." : "Save"}
        title="Save settings"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={() => refresh?.()}
        disabled={loading}
        icon={<RefreshCw className="w-4 h-4" />}
        label="Refresh"
        title="Refresh settings"
      />
    </>
  );
}
