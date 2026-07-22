"use client";

/**
 * Message Trends Settings Tab
 *
 * Mirrors Java's MessageTrendsSettingPanel.java (extends AbstractSettingsPanel).
 *
 * Single setting: messagetrends.enabled (Yes/No radio group).
 *
 * API: GET /extensions/Message%20Trends/properties  → load
 *      PUT /extensions/Message%20Trends/properties  → save
 */

import React, { useEffect } from "react";
import { ToggleLeft } from "lucide-react";

import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection, RadioField } from "../settings-section";

// Matches MessageTrendsProperties.KEY_ENABLED in Java
const KEY_ENABLED = "messagetrends.enabled";
const PLUGIN_NAME = "Message Trends Management System";

interface MessageTrendsForm {
  enabled: boolean;
}

function fromRecord(record: Record<string, string>): MessageTrendsForm {
  return { enabled: record[KEY_ENABLED] === "true" };
}

function toRecord(form: MessageTrendsForm): Record<string, string> {
  return { [KEY_ENABLED]: String(form.enabled) };
}

export interface MessageTrendsTabActions {
  save: () => void;
  refresh: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
}

interface MessageTrendsSettingsTabProps {
  actionsRef?: React.MutableRefObject<MessageTrendsTabActions>;
  onActionsChanged?: () => void;
  onDirty?: (isDirty: boolean) => void;
  saveRef?: React.MutableRefObject<() => Promise<void>>;
}

export function MessageTrendsSettingsTab({
  actionsRef,
  onActionsChanged,
  onDirty,
  saveRef,
}: MessageTrendsSettingsTabProps) {
  const { props, loading, saving, error, dirty, set, load, save, saveOrThrow } =
    usePluginSettings<MessageTrendsForm>({
      pluginName: PLUGIN_NAME,
      fromRecord,
      toRecord,
    });

  if (actionsRef) {
    // eslint-disable-next-line react-hooks/refs -- actionsRef is parent-owned; writing .current during render exposes current handlers to parent toolbar
    actionsRef.current = {
      save,
      refresh: load,
      dirty,
      saving,
      loading,
    };
  }

  // Pure save for the Settings host's unsaved-changes guard / tab-switch prompt:
  // throws on failure so a failed save aborts navigation (no toast).
  if (saveRef) {
    // eslint-disable-next-line react-hooks/refs -- saveRef is parent-owned; writing .current during render exposes the current save handler to the host guard
    saveRef.current = saveOrThrow;
  }

  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, onActionsChanged]);

  // Report dirty state up so plugin tabs join the host's unsaved-changes guard.
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
          {error || "Failed to load Message Trends settings."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 min-w-[720px]">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
          {error}
        </div>
      )}

      {/* ── Enable ── */}
      <SettingsSection title="Enable" icon={ToggleLeft}>
        <RadioField
          label="Enable:"
          name="messageTrendsEnabled"
          value={String(props.enabled)}
          onChange={(v) => set("enabled", v === "true")}
          tooltip="Enable the Message Trends dashboard, which tracks message volume statistics over time."
        />
      </SettingsSection>
    </div>
  );
}
