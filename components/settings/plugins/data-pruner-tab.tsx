"use client";

/**
 * DataPrunerSettingsTab — mirrors DataPrunerPanel.java + MessageExportPanel.java
 *
 * Plugin name (exact match): "Data Pruner"
 * Properties endpoint: GET/PUT /extensions/Data%20Pruner/properties (java.util.Properties format)
 * Status endpoint: GET /extensions/datapruner/status
 * Control: POST /extensions/datapruner/_start  |  POST /extensions/datapruner/_stop
 */

import React, { startTransition, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity, Archive, Calendar, Scissors } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";

import { getDataPrunerStatus, startDataPruner, stopDataPruner } from "@/lib/api-client";
import { usePluginSettings } from "@/lib/hooks/use-plugin-settings";
import {
  type Compression,
  type EncryptionType,
  type IntervalUnit,
  type PrunerForm,
  type PrunerStatus,
  type ScheduleType,
  CONTENT_TYPE_OPTIONS,
  DEFAULT_CRON_JOB,
  FILE_PATTERN_VARIABLES,
  formToProps,
  parseStatus,
  propsToForm,
  validatePruner,
} from "@/lib/data-pruner-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { SecretInput } from "@/components/ui/secret-input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { SettingsSection, FieldRow, RadioField } from "../settings-section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { CronJobsTable } from "@/components/cron-jobs-table";
import { inputCls } from "@/app/(app)/channels/_connectors/shared/styles";

const PLUGIN_NAME = "Data Pruner";

export interface DataPrunerTabActions {
  save: () => void;
  refresh: () => void;
  discard: () => void;
  viewEvents: () => void;
  pruneNow: () => void;
  stop: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  isRunning: boolean;
  actionLoading: boolean;
  /** False when the pruner status could not be fetched — Prune Now / Stop are hidden. */
  statusKnown: boolean;
}

interface DataPrunerSettingsTabProps {
  actionsRef?: React.MutableRefObject<DataPrunerTabActions>;
  onActionsChanged?: () => void;
  onDirty?: (isDirty: boolean) => void;
  saveRef?: React.MutableRefObject<() => Promise<void>>;
}

export function DataPrunerSettingsTab({
  actionsRef,
  onActionsChanged,
  onDirty,
  saveRef,
}: DataPrunerSettingsTabProps) {
  const {
    props: form,
    loading,
    saving,
    error,
    setError,
    dirty,
    patch,
    load,
    save,
    saveOrThrow,
  } = usePluginSettings<PrunerForm>({
    pluginName: PLUGIN_NAME,
    fromRecord: propsToForm,
    toRecord: formToProps,
    validate: validatePruner,
  });

  const { viewDensity } = useCompactMode();
  const router = useRouter();
  const [status, setStatus] = useState<PrunerStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [pendingPrune, setPendingPrune] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const raw = await getDataPrunerStatus();
      setStatus(parseStatus(raw));
    } catch {
      // Mirror Java DataPrunerPanel: mark status Unknown, hide Start/Stop, and alert
      // (don't swallow — repo rule). statusKnown=false gates the action buttons below.
      setStatus(null);
      toast.error("An error occurred while attempting to retrieve the status of the data pruner.");
    }
  }, []);

  // Load status alongside properties (both fire on mount)
  useEffect(() => {
    startTransition(() => {
      loadStatus();
    });
  }, [loadStatus]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([load(), loadStatus()]);
  }, [load, loadStatus]);

  // Mirror Java DataPrunerPanel.doViewEvents → Frame.doShowEvents("Data Pruner"):
  // jump to the Events tab pre-filtered to Data Pruner events.
  const handleViewEvents = useCallback(() => {
    router.push(`/events?name=${encodeURIComponent(PLUGIN_NAME)}`);
  }, [router]);

  async function handleSave() {
    const saved = await save();
    if (saved) await loadStatus();
  }

  function handlePruneNow() {
    if (dirty) {
      setPendingPrune(true);
      return;
    }
    void executePrune();
  }

  async function executePrune() {
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }
    setActionLoading(true);
    try {
      await startDataPruner();
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    setActionLoading(true);
    try {
      await stopDataPruner();
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }

  const isRunning = status?.isRunning ?? false;
  const statusKnown = status !== null;

  if (actionsRef) {
    actionsRef.current = {
      save: handleSave,
      refresh: handleRefresh,
      discard: handleRefresh,
      viewEvents: handleViewEvents,
      pruneNow: handlePruneNow,
      stop: handleStop,
      dirty,
      saving,
      loading,
      isRunning,
      actionLoading,
      statusKnown,
    };
  }

  // Pure save for the Settings host's unsaved-changes guard / tab-switch prompt:
  // throws on failure so a failed save aborts navigation (no toast).
  if (saveRef) {
    saveRef.current = saveOrThrow;
  }

  useEffect(() => {
    onActionsChanged?.();
  }, [dirty, saving, loading, isRunning, actionLoading, statusKnown, onActionsChanged]);

  // Report dirty state up so plugin tabs join the host's unsaved-changes guard.
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // ── Error state (no data loaded) ──
  if (!form) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded p-3 text-sm">
          {error || "Failed to load Data Pruner settings."}
        </div>
      </div>
    );
  }

  const isXmlSerialized = !form.contentTypeKey || form.contentTypeKey === "|false";
  const isZip = form.compression === "zip";

  function handleCompressionChange(v: string) {
    const newCompression = v as Compression;
    // Reset password fields when switching away from ZIP (mirrors Java behavior)
    if (newCompression !== "zip") {
      patch({
        compression: newCompression,
        passwordEnabled: false,
        password: "",
        encryptionType: "AES256",
      });
    } else {
      patch({ compression: newCompression });
    }
  }

  function handleScheduleTypeChange(v: string) {
    const next = v as ScheduleType;
    // Mirror Java PollingSettingsPanel: switching to Cron with no rows seeds a default
    // "Run hourly." job so the table isn't empty (L28).
    if (next === "cron" && !form?.cronJobs.some((j) => j.expression.trim())) {
      patch({ scheduleType: next, cronJobs: [{ ...DEFAULT_CRON_JOB }] });
    } else {
      patch({ scheduleType: next });
    }
  }

  function handleContentTypeChange(v: string) {
    const newKey = v;
    const newIsXmlSerialized = !newKey || newKey === "|false";
    // Clear includeAttachments when switching away from XML Serialized (mirrors Java behavior)
    if (!newIsXmlSerialized && form?.includeAttachments) {
      patch({ contentTypeKey: newKey, includeAttachments: false });
    } else {
      patch({ contentTypeKey: newKey });
    }
  }

  return (
    <div className="p-6 space-y-4 min-w-[720px] max-w-3xl">
      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* ── Status ── */}
      <SettingsSection labelWidth="w-[180px]" title="Status" icon={Activity}>
        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <span className="text-gray-600 dark:text-gray-400 text-right">Current State:</span>
          <span
            className={
              isRunning
                ? "text-red-600 dark:text-red-400 font-medium"
                : status
                  ? "text-green-700 dark:text-green-400 font-medium"
                  : "text-gray-700 dark:text-gray-300"
            }
          >
            {status?.currentState ?? "Unknown"}
          </span>
          <span className="text-gray-600 dark:text-gray-400 text-right">Current Process:</span>
          <span className="text-gray-700 dark:text-gray-300">
            {status?.currentProcess ?? "Unknown"}
          </span>
          <span className="text-gray-600 dark:text-gray-400 text-right">Last Process:</span>
          <span className="text-gray-700 dark:text-gray-300">
            {status?.lastProcess ?? "Unknown"}
          </span>
          <span className="text-gray-600 dark:text-gray-400 text-right">Next Process:</span>
          <span className="text-gray-700 dark:text-gray-300">
            {form.enabled ? (status?.nextProcess ?? "Unknown") : "Not scheduled"}
          </span>
        </div>
      </SettingsSection>

      {/* ── Schedule ── */}
      <SettingsSection labelWidth="w-[180px]" title="Schedule" icon={Calendar}>
        <RadioField
          label="Enable:"
          name="pruner-enabled"
          value={String(form.enabled)}
          onChange={(v) => patch({ enabled: v === "true" })}
        />

        {form.enabled && (
          <>
            <FieldRow label="Schedule Type:">
              <Select value={form.scheduleType} onValueChange={handleScheduleTypeChange}>
                <HoverTooltip content="Select 'Interval' to prune each n units of time. Select 'Time' to prune once a day at the specified time. Select 'Cron' to prune at the specified cron expression(s).">
                  <SelectTrigger className="w-32" density={viewDensity}>
                    <SelectValue />
                  </SelectTrigger>
                </HoverTooltip>
                <SelectContent>
                  <SelectItem value="interval">Interval</SelectItem>
                  <SelectItem value="time">Time</SelectItem>
                  <SelectItem value="cron">Cron</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>

            {form.scheduleType === "interval" && (
              <FieldRow label="Interval:">
                <Input
                  density={viewDensity}
                  type="number"
                  min={1}
                  max={24}
                  value={form.intervalValue}
                  onChange={(e) => patch({ intervalValue: e.target.value })}
                  className="w-20"
                />
                <Select
                  value={form.intervalUnit}
                  onValueChange={(v) => patch({ intervalUnit: v as IntervalUnit })}
                >
                  <SelectTrigger className="w-28" density={viewDensity}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">hours</SelectItem>
                    <SelectItem value="minutes">minutes</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-500 dark:text-gray-400">(1–24 hours)</span>
              </FieldRow>
            )}

            {form.scheduleType === "time" && (
              <FieldRow label="Time (HH : MM):">
                <Input
                  density={viewDensity}
                  type="text"
                  inputMode="numeric"
                  value={String(form.pollingHour)}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 0 && n <= 23) patch({ pollingHour: n });
                    else if (e.target.value === "") patch({ pollingHour: 0 });
                  }}
                  placeholder="Hour"
                  className="w-20"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400 select-none">:</span>
                <Input
                  density={viewDensity}
                  type="text"
                  inputMode="numeric"
                  value={String(form.pollingMinute)}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 0 && n <= 59) patch({ pollingMinute: n });
                    else if (e.target.value === "") patch({ pollingMinute: 0 });
                  }}
                  placeholder="Minute"
                  className="w-20"
                />
              </FieldRow>
            )}

            {form.scheduleType === "cron" && (
              <FieldRow label="Cron Jobs:">
                <CronJobsTable
                  cronJobs={form.cronJobs}
                  onChange={(jobs) => patch({ cronJobs: jobs })}
                  inputClassName={inputCls(viewDensity)}
                />
              </FieldRow>
            )}
          </>
        )}
      </SettingsSection>

      {/* ── Prune Settings ── */}
      <SettingsSection labelWidth="w-[180px]" title="Prune Settings" icon={Scissors}>
        <FieldRow label="Block Size:">
          <HoverTooltip content="The number of messages that will be pruned at a time. This value must be between 50 and 10000. The recommended value for most servers is 1000.">
            <Input
              density={viewDensity}
              type="number"
              min={50}
              max={10000}
              value={form.blockSize}
              onChange={(e) => patch({ blockSize: e.target.value })}
              className="w-24"
            />
          </HoverTooltip>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            (50–10000, recommended: 1000)
          </span>
        </FieldRow>

        <RadioField
          label="Prune Events:"
          name="prune-events"
          value={String(form.pruneEvents)}
          onChange={(v) => patch({ pruneEvents: v === "true" })}
          tooltip="If Yes, event records older than the Event Age will be pruned. If No, event records will not be pruned."
        />

        {form.pruneEvents && (
          <FieldRow label="Prune Event Age:">
            <HoverTooltip content="Events older than this number of days will be pruned if Prune Events is set to Yes.">
              <Input
                density={viewDensity}
                type="number"
                min={1}
                value={form.maxEventAge}
                onChange={(e) => patch({ maxEventAge: e.target.value })}
                className="w-24"
              />
            </HoverTooltip>
            <span className="text-sm text-gray-600 dark:text-gray-400">days</span>
          </FieldRow>
        )}
      </SettingsSection>

      {/* ── Archive Settings ── */}
      <SettingsSection labelWidth="w-[180px]" title="Archive Settings" icon={Archive}>
        <RadioField
          label="Enable Archiving:"
          name="archive-enabled"
          value={String(form.archiveEnabled)}
          onChange={(v) => patch({ archiveEnabled: v === "true" })}
        />

        {form.archiveEnabled && (
          <>
            <FieldRow label="Archiver Block Size:">
              <HoverTooltip content="The number of messages cached by the archiver at a time. Must be between 1 and 1000. Recommended: 50.">
                <Input
                  density={viewDensity}
                  type="number"
                  min={1}
                  max={1000}
                  value={form.archiverBlockSize}
                  onChange={(e) => patch({ archiverBlockSize: e.target.value })}
                  className="w-24"
                />
              </HoverTooltip>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                (1–1000, recommended: 50)
              </span>
            </FieldRow>

            <FieldRow label="Content:">
              <Select value={form.contentTypeKey} onValueChange={handleContentTypeChange}>
                <SelectTrigger className="w-64" density={viewDensity}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>

            <FieldRow label="Include Attachments:">
              <FormCheckbox
                label="Include attachments when archiving"
                checked={form.includeAttachments}
                onChange={(v) => patch({ includeAttachments: v })}
                disabled={!isXmlSerialized}
              />
            </FieldRow>

            <FieldRow label="Encrypt Content:">
              <FormCheckbox
                label="Encrypt exported message content"
                checked={form.encryptContent}
                onChange={(v) => patch({ encryptContent: v })}
              />
            </FieldRow>

            <FieldRow label="Compression:">
              <Select value={form.compression} onValueChange={handleCompressionChange}>
                <SelectTrigger className="w-40" density={viewDensity}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="zip">ZIP</SelectItem>
                  <SelectItem value="tar_gz">TAR/GZIP</SelectItem>
                  <SelectItem value="tar_bz2">TAR/BZIP2</SelectItem>
                </SelectContent>
              </Select>
            </FieldRow>

            {isZip && (
              <>
                <RadioField
                  label="Password Protection:"
                  name="archive-password-enabled"
                  value={String(form.passwordEnabled)}
                  onChange={(v) => patch({ passwordEnabled: v === "true" })}
                />

                {form.passwordEnabled && (
                  <>
                    <FieldRow label="Encryption Type:">
                      <Select
                        value={form.encryptionType}
                        onValueChange={(v) => patch({ encryptionType: v as EncryptionType })}
                      >
                        <SelectTrigger className="w-40" density={viewDensity}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="STANDARD">Standard</SelectItem>
                          <SelectItem value="AES128">AES-128</SelectItem>
                          <SelectItem value="AES256">AES-256</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldRow>

                    <FieldRow label="Password:">
                      <SecretInput
                        value={form.password}
                        onChange={(e) => patch({ password: e.target.value })}
                        className="w-64"
                        density={viewDensity}
                        revealable
                      />
                    </FieldRow>
                  </>
                )}
              </>
            )}

            <FieldRow label="Root Path:">
              <HoverTooltip content="The root path on the server where archived files will be written. Relative paths are resolved from the BridgeLink home directory.">
                <Input
                  density={viewDensity}
                  type="text"
                  value={form.rootPath}
                  onChange={(e) => patch({ rootPath: e.target.value })}
                  placeholder="archives/datapruner"
                  className="w-72"
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="File Pattern:">
              <div className="flex flex-col gap-1">
                <Textarea
                  value={form.filePattern}
                  onChange={(e) => patch({ filePattern: e.target.value })}
                  className="w-72 font-mono text-xs"
                  rows={2}
                />
                <HoverTooltip
                  content={
                    <div className="text-xs space-y-1">
                      <p className="font-medium mb-1">Available variables:</p>
                      {FILE_PATTERN_VARIABLES.map(({ label, variable }) => (
                        <div key={variable} className="flex gap-2">
                          <span className="font-mono text-blue-300">{variable}</span>
                          <span className="text-gray-300">{label}</span>
                        </div>
                      ))}
                    </div>
                  }
                >
                  <span className="text-xs text-blue-600 dark:text-blue-400 cursor-help underline decoration-dotted w-fit">
                    Available variables
                  </span>
                </HoverTooltip>
              </div>
            </FieldRow>
          </>
        )}
      </SettingsSection>

      {pendingPrune && (
        <ConfirmDialog
          title="Save & Prune Now"
          description="Settings changes must be saved first. Would you like to save the settings and prune now?"
          confirmLabel="Save & Prune"
          confirmVariant="default"
          onConfirm={() => {
            setPendingPrune(false);
            void executePrune();
          }}
          onCancel={() => setPendingPrune(false)}
        />
      )}
    </div>
  );
}
