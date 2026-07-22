"use client";

/**
 * StarterSettingsTab — minimal settings-tab scaffold.
 *
 * Demonstrates the load → edit → save pattern via `usePluginSettings`
 * (Pattern A: property bag). It exposes a single boolean field (`enabled`) so
 * the template renders out of the box. Replace the form and the properties
 * shape with whatever your plugin actually configures.
 *
 * For Pattern B (typed REST endpoints with read-only computed fields or action
 * endpoints), replace `usePluginSettings` with manual
 * useState/useEffect/useCallback and call your typed API wrappers directly. See
 * the notes in api-template.ts.
 */

import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { SettingsSection, FieldRow } from "@/components/settings/settings-section";
import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import { STARTER_PLUGIN_NAME, fromRecord, toRecord, type StarterProperties } from "./api-template";

export function StarterSettingsTab() {
  const { props, loading, saving, error, dirty, set, save } = usePluginSettings<StarterProperties>({
    pluginName: STARTER_PLUGIN_NAME,
    fromRecord,
    toRecord,
  });

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!props) {
    return <ApiErrorAlert error={error} />;
  }

  return (
    <div className="space-y-4 p-4">
      <ApiErrorAlert error={error} />

      <SettingsSection title="Starter" icon={Settings}>
        <FieldRow label="Enabled" htmlFor="starter-enabled">
          <FormCheckbox
            label="Enable the Starter plugin"
            checked={props.enabled}
            onChange={(checked) => set("enabled", checked)}
          />
        </FieldRow>
      </SettingsSection>

      <div className="flex justify-end">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
