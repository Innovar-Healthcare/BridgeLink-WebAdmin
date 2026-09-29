"use client";

/**
 * Settings-tab binding for runtime plugin manifests,.
 *
 * `createRuntimeSettingsTab(panel, entry)` builds the component the loader
 * registers as a Settings page plugin tab. Load/save go through the existing
 * `usePluginSettings` hook (GET/PUT /extensions/{name}/properties) with
 * `preserveExtraKeys` — property keys the manifest does not declare survive
 * saves untouched (the don't-drop-what-you-don't-understand rule, settings
 * side). Wires the standard PluginTabProps contract (actionsRef save/refresh,
 * saveRef for the unsaved-changes guard, onDirty) exactly like the built-in
 * plugin tabs.
 *
 * v3 collection fields: settings values are a flat string property
 * record (no XML document to surgically edit), so each collection field stores
 * its rows as canonical JSON in that field's property value (collection-json.ts).
 * The tab decodes the JSON into rows for the renderer and re-encodes on change;
 * the field's own property key plus a variableToggle's companion keys are seeded
 * from the server record so they load and round-trip like any scalar property.
 */

import { useEffect, useMemo } from "react";
import type { ComponentType } from "react";
import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsTabScroll } from "@/components/settings/settings-tab-scroll";
import { compileSettingsValidator } from "@/lib/runtime-plugins/compile-validate";
import {
  COLLECTION_FIELD_TYPES,
  type FieldDescriptor,
  type SettingsPanelContribution,
} from "@/lib/runtime-plugins/manifest-types";
import { decodeCollectionJson, encodeCollectionJson } from "@/lib/runtime-plugins/collection-json";
import { collectionSpec } from "@/lib/runtime-plugins/xml-collection-binding";
import type { PluginTabProps } from "@/lib/plugin-registry";
import { SchemaFormSection } from "./schema-form-section";
import type { CollectionFieldValue } from "./schema-collection-field";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

export function createRuntimeSettingsTab(
  panel: SettingsPanelContribution,
  entry: { name: string }
): ComponentType<PluginTabProps> {
  const fields = panel.sections.flatMap((section) => section.fields);
  const collectionFields = fields.filter((f) => COLLECTION_TYPES.has(f.type));
  const collectionByKey = new Map<string, FieldDescriptor>(collectionFields.map((f) => [f.key, f]));
  // variableToggle companion elements are ordinary property keys, but they are
  // not declared fields — seed them so an existing value loads and round-trips.
  const toggleKeys = collectionFields.flatMap((f) =>
    f.variableToggle ? [f.variableToggle.variableKey, f.variableToggle.useVariableKey] : []
  );
  const validate = compileSettingsValidator(panel);

  /** Server record → form: declared keys + toggle keys, schema defaults for missing ones. */
  function fromRecord(record: Record<string, string>): Record<string, string> {
    const form: Record<string, string> = {};
    for (const field of fields) {
      form[field.key] = record[field.key] ?? field.defaultValue ?? "";
    }
    for (const key of toggleKeys) {
      form[key] = record[key] ?? "";
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

    const collectionValues = useMemo(() => {
      const out: Record<string, CollectionFieldValue> = {};
      if (props) {
        for (const field of collectionFields) {
          out[field.key] = decodeCollectionJson(collectionSpec(field), props[field.key] ?? "");
        }
      }
      return out;
    }, [props]);

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
          collectionValues={collectionValues}
          onCollectionChange={(key, rows) => {
            const field = collectionByKey.get(key);
            if (field) set(key, encodeCollectionJson(collectionSpec(field), rows));
          }}
          attribution={entry.name}
          disabled={saving}
        />
      </SettingsTabScroll>
    );
  }
  RuntimeSettingsTab.displayName = `RuntimeSettingsTab(${panel.tabKey})`;
  return RuntimeSettingsTab;
}
