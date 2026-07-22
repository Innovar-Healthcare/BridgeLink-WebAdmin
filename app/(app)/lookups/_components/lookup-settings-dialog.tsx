"use client";

import { Loader2 } from "lucide-react";
import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import { FormDialog } from "@/components/form-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { LOOKUP_PLUGIN_NAME } from "@/lib/api-client";

interface LookupSettingsForm {
  pruneEnabled: boolean;
  retentionDays: number;
}

function fromRecord(r: Record<string, string>): LookupSettingsForm {
  return {
    pruneEnabled: r["dynamiclookup.audit.prune.enabled"] === "true",
    retentionDays: parseInt(r["dynamiclookup.audit.prune.retentionDays"] || "30", 10) || 30,
  };
}

function toRecord(f: LookupSettingsForm): Record<string, string> {
  return {
    "dynamiclookup.audit.prune.enabled": String(f.pruneEnabled),
    "dynamiclookup.audit.prune.retentionDays": String(f.retentionDays),
  };
}

function validate(f: LookupSettingsForm): string | null {
  if (f.pruneEnabled && f.retentionDays < 1) {
    return "Retention days must be at least 1 when purge is enabled.";
  }
  return null;
}

export function LookupSettingsDialog({ onClose }: { onClose: () => void }) {
  const {
    props: form,
    loading,
    saving,
    error,
    set,
    save,
  } = usePluginSettings<LookupSettingsForm>({
    pluginName: LOOKUP_PLUGIN_NAME,
    fromRecord,
    toRecord,
    validate,
    preserveExtraKeys: true,
  });

  async function handleSave() {
    const ok = await save();
    if (ok) onClose();
  }

  return (
    <FormDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Lookup Settings"
      onSubmit={handleSave}
      saving={saving}
      error={error}
      submitDisabled={loading || !form}
      maxWidth="sm:max-w-sm"
    >
      {loading ? (
        <div className="flex items-center justify-center py-6 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading settings…
        </div>
      ) : form ? (
        <div className="space-y-4">
          {/* Purge enabled */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-700 dark:text-gray-300">
              Purge Old Audit History:
            </label>
            <FormCheckbox
              label="Enabled"
              checked={form.pruneEnabled}
              onChange={(v) => set("pruneEnabled", v)}
            />
          </div>

          {/* Retention days */}
          <div className="flex items-center justify-between">
            <label
              className={`text-sm ${form.pruneEnabled ? "text-gray-700 dark:text-gray-300" : "text-gray-400 dark:text-gray-500"}`}
            >
              Retention days:
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={form.retentionDays}
              onChange={(e) => set("retentionDays", Math.max(1, parseInt(e.target.value) || 1))}
              disabled={!form.pruneEnabled}
              className="w-20 rounded-md border border-border bg-white dark:bg-gray-900 px-2 py-1 text-sm text-right disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      ) : null}
    </FormDialog>
  );
}
