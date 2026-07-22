"use client";

/**
 * Settings-tab binding for runtime plugin manifests.
 *
 * `createRuntimeSettingsTab(panel, entry)` builds the component the loader
 * registers as a Settings page plugin tab. Load/save go through the existing
 * `usePluginSettings` hook (GET/PUT /extensions/{name}/properties) with
 * `preserveExtraKeys` — property keys the manifest does not declare survive
 * saves untouched (the don't-drop-what-you-don't-understand rule, settings
 * side). Wires the standard PluginTabProps contract (actionsRef save/refresh,
 * saveRef for the unsaved-changes guard, onDirty) exactly like the built-in
 * plugin tabs.
 */

import { useEffect } from "react";
import type { ComponentType } from "react";
import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsTabScroll } from "@/components/settings/settings-tab-scroll";
import { compileSettingsValidator } from "@/lib/runtime-plugins/compile-validate";
import type { SettingsPanelContribution } from "@/lib/runtime-plugins/manifest-types";
import type { PluginTabProps } from "@/lib/plugin-registry";
import { SchemaFormSection } from "./schema-form-section";

export function createRuntimeSettingsTab(
  panel: SettingsPanelContribution,
  entry: { name: string }
): ComponentType<PluginTabProps> {
  const fields = panel.sections.flatMap((section) => section.fields);
  const validate = compileSettingsValidator(panel);

  /** Server record → form: declared keys only, schema defaults for missing ones. */
  function fromRecord(record: Record<string, string>): Record<string, string> {
    const form: Record<string, string> = {};
    for (const field of fields) {
      form[field.key] = record[field.key] ?? field.defaultValue ?? "";
    }
    return form;
  }

  function toRecord(form: Record<string, string>): Record<string, string> {
    return { ...form };
  }

  function RuntimeSettingsTab({ actionsRef, onActionsChanged, onDirty, saveRef }: PluginTabProps) {
    const { props, loading, saving, error, dirty, set, load, save, saveOrThrow } =
      usePluginSettings<Record<string, string>>({
        pluginName: entry.name,
        fromRecord,
        toRecord,
        validate,
        preserveExtraKeys: true,
      });

    // Parent-owned refs, written during render so the host toolbar and
    // navigation guard always see the current handlers (the built-in plugin
    // tabs' pattern).
    if (actionsRef) {
      actionsRef.current = { save, refresh: load, dirty, saving, loading };
    }
    if (saveRef) {
      saveRef.current = saveOrThrow;
    }

    useEffect(() => {
      onActionsChanged?.();
    }, [dirty, saving, loading, onActionsChanged]);

    useEffect(() => {
      onDirty?.(dirty);
    }, [dirty, onDirty]);

    if (loading) {
      return (
        <div className="p-6 space-y-4">
          <Skeleton className="h-24 w-full" />
        </div>
      );
    }

    if (!props) {
      return (
        <div className="p-6">
          <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
            {error || `Failed to load ${panel.tabLabel} settings.`}
          </div>
        </div>
      );
    }

    return (
      <SettingsTabScroll contentClassName="p-6 space-y-5">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}
        <SchemaFormSection
          sections={panel.sections}
          actions={panel.actions}
          values={props}
          onValueChange={(key, value) => set(key, value)}
          attribution={entry.name}
          disabled={saving}
        />
      </SettingsTabScroll>
    );
  }
  RuntimeSettingsTab.displayName = `RuntimeSettingsTab(${panel.tabKey})`;
  return RuntimeSettingsTab;
}
