"use client";

/**
 * Reusable "Polling Settings" section used by all polling-based source connectors
 * (JavaScript Reader, File Reader, Database Reader, DICOM Listener, JMS Listener, …).
 *
 * Callers wrap this in their own TopSection component and supply the
 * connector-specific `defaultPropertiesXml` fallback.
 */

import { useMemo, useState } from "react";
import { Clock, Settings2 } from "lucide-react";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import { AdvancedPollingSettingsDialog } from "@/components/advanced-polling-settings-dialog";
import { CronJobsTable } from "@/components/cron-jobs-table";
import type { PollConnectorState, PollingType } from "../../_lib/channel-xml";
import {
  parsePollConnectorFromPropertiesXml,
  updatePollConnectorInPropertiesXml,
} from "../../_lib/channel-xml";
import type { ConnectorSectionProps } from "../types";
import { inputCls, selectCls } from "./styles";
import { RadioGroup } from "./radio-group";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { VariableOrNumberInput } from "@/components/ui/variable-or-number-input";
import {
  computeNextFireTime,
  formatNextFireTime,
  summarizeAdvancedPolling,
} from "@/lib/poll-next-fire-time";

// ─── Unit helpers ──────────────────────────────────────────────────────────────

function unitFactor(unit: string): number {
  if (unit === "hours") return 3_600_000;
  if (unit === "minutes") return 60_000;
  if (unit === "seconds") return 1_000;
  return 1; // milliseconds
}

function inferUnit(ms: number): "milliseconds" | "seconds" | "minutes" | "hours" {
  if (ms % 3_600_000 === 0) return "hours";
  if (ms % 60_000 === 0) return "minutes";
  if (ms % 1_000 === 0) return "seconds";
  return "milliseconds";
}

function humanizeMs(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PollingSectionProps extends ConnectorSectionProps {
  /**
   * Default `<properties>` XML blob for this connector type.
   * Used as a fallback when `propertiesXml` is null (e.g., right after
   * the user switches to this connector type).
   */
  defaultPropertiesXml: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PollingSection({
  propertiesXml,
  onChange,
  defaultPropertiesXml,
  transportName,
}: PollingSectionProps) {
  const { viewDensity } = useCompactMode();
  const propsXml = propertiesXml ?? defaultPropertiesXml;
  const pollState = parsePollConnectorFromPropertiesXml(propsXml);

  const [intervalUnit, setIntervalUnit] = useState<string>(() =>
    inferUnit(
      parsePollConnectorFromPropertiesXml(propertiesXml ?? defaultPropertiesXml).pollingFrequency
    )
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const displayedInterval = pollState.pollingFrequency / unitFactor(intervalUnit);

  function updatePoll(updates: Partial<PollConnectorState>) {
    const next = { ...pollState, ...updates };
    const updated = updatePollConnectorInPropertiesXml(propsXml, next);
    onChange({ propertiesXml: updated });
  }

  // #54 — seed a default cron job when switching to CRON so the user isn't blocked by the
  // "at least one cron job is required" rule (mirrors Java PollingSettingsPanel's clearProperties,
  // which pre-fills "*/5 * * * * ?"). Kept minimal: no destructive confirm/reset of other poll props.
  function handleScheduleTypeChange(newType: PollingType) {
    if (newType === pollState.pollingType) return;
    const updates: Partial<PollConnectorState> = { pollingType: newType };
    if (newType === "CRON" && pollState.cronJobs.length === 0) {
      updates.cronJobs = [{ expression: "*/5 * * * * ?", description: "Run every 5 seconds." }];
    }
    updatePoll(updates);
  }

  // #59 — hold the interval as editable text so the field can be cleared/typed mid-edit; commit on
  // blur when it parses to a positive number, otherwise revert to the last committed value.
  const [intervalText, setIntervalText] = useState(String(displayedInterval));
  const [prevDisplayedInterval, setPrevDisplayedInterval] = useState(displayedInterval);
  if (displayedInterval !== prevDisplayedInterval) {
    setPrevDisplayedInterval(displayedInterval);
    setIntervalText(String(displayedInterval));
  }
  function commitInterval() {
    const n = parseFloat(intervalText);
    if (!isNaN(n) && n > 0) {
      updatePoll({ pollingFrequency: Math.round(n * unitFactor(intervalUnit)) });
    } else {
      setIntervalText(String(displayedInterval));
    }
  }

  function handleIntervalUnitChange(newUnit: string) {
    setIntervalUnit(newUnit);
    updatePoll({ pollingFrequency: Math.round(displayedInterval * unitFactor(newUnit)) });
  }

  const nextFireLabel = useMemo(
    () => formatNextFireTime(computeNextFireTime(pollState)),
    // propsXml changes whenever any poll setting changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [propsXml]
  );

  const advancedSummary = summarizeAdvancedPolling(pollState.advanced);

  const storageKey = transportName
    ? `bl-poll-${transportName.toLowerCase().replace(/ /g, "-")}`
    : undefined;

  const pad = (n: number) => String(n).padStart(2, "0");
  const pollSummary = (
    <>
      {pollState.pollingType === "INTERVAL" && (
        <SummaryChip label="Every" value={humanizeMs(pollState.pollingFrequency)} />
      )}
      {pollState.pollingType === "TIME" && (
        <SummaryChip
          label="At"
          value={`${pad(pollState.pollingHour)}:${pad(pollState.pollingMinute)}`}
        />
      )}
      {pollState.pollingType === "CRON" && <SummaryChip value="CRON" />}
      {pollState.pollingType === "CRON" && pollState.cronJobs.length > 0 && (
        <SummaryChip label="Jobs" value={String(pollState.cronJobs.length)} />
      )}
      <SummaryChip label="Poll on start" value={pollState.pollOnStart ? "Yes" : "No"} />
    </>
  );

  return (
    <>
      <SettingsSection
        title="Polling Settings"
        icon={Clock}
        defaultExpanded={true}
        storageKey={storageKey}
        summary={pollSummary}
      >
        <FieldRow label="Schedule Type:">
          <HoverTooltip content="This connector polls to determine when new messages have arrived. Select 'Interval' to poll each n units of time. Select 'Time' to poll once a day at the specified time. Select 'Cron' to poll at the specified cron expression(s).">
            <select
              value={pollState.pollingType}
              onChange={(e) => handleScheduleTypeChange(e.target.value as PollingType)}
              className={selectCls(viewDensity)}
            >
              <option value="INTERVAL">Interval</option>
              <option value="TIME">Time</option>
              <option value="CRON">CRON</option>
            </select>
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Poll Once on Start:">
          <RadioGroup
            name="pollOnStart"
            value={pollState.pollOnStart ? "yes" : "no"}
            onChange={(v) => updatePoll({ pollOnStart: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to immediately poll once on start. All subsequent polling will follow the specified schedule."
          />
        </FieldRow>

        {pollState.pollingType === "INTERVAL" && (
          <FieldRow label="Interval:">
            <div className="flex items-center gap-2">
              <HoverTooltip content="The specified repeating time interval. Units must be less than 24 hours of time when converted to milliseconds.">
                <VariableOrNumberInput
                  min={1}
                  value={intervalText}
                  onChange={(v) => setIntervalText(v)}
                  onBlur={commitInterval}
                  className={`${inputCls(viewDensity)} w-24`}
                />
              </HoverTooltip>
              <HoverTooltip content="The interval's unit of time.">
                <select
                  value={intervalUnit}
                  onChange={(e) => handleIntervalUnitChange(e.target.value)}
                  className={selectCls(viewDensity)}
                >
                  <option value="milliseconds">milliseconds</option>
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                </select>
              </HoverTooltip>
            </div>
          </FieldRow>
        )}

        {pollState.pollingType === "TIME" && (
          <FieldRow label="Time (HH : MM):">
            <div className="flex items-center gap-2">
              <HoverTooltip content="The time of day to poll.">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pollState.pollingHour}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 0 && n <= 23) updatePoll({ pollingHour: n });
                  }}
                  className={`${inputCls(viewDensity)} w-20`}
                  placeholder="Hour"
                />
              </HoverTooltip>
              <span className="text-sm text-gray-500 dark:text-gray-400 select-none">:</span>
              <HoverTooltip content="The time of day to poll.">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pollState.pollingMinute}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 0 && n <= 59) updatePoll({ pollingMinute: n });
                  }}
                  className={`${inputCls(viewDensity)} w-20`}
                  placeholder="Minute"
                />
              </HoverTooltip>
            </div>
          </FieldRow>
        )}

        {pollState.pollingType === "CRON" && (
          <FieldRow label="Cron Jobs:">
            <CronJobsTable
              cronJobs={pollState.cronJobs}
              onChange={(jobs) => updatePoll({ cronJobs: jobs })}
              inputClassName={inputCls(viewDensity)}
            />
          </FieldRow>
        )}
        {/* #22 — Java hides the Advanced button for CRON (PollingSettingsPanel.java:580); the
            day/time restrictions only apply to INTERVAL/TIME schedules. */}
        {pollState.pollingType !== "CRON" && (
          <FieldRow label="Advanced:">
            <div className="flex items-center gap-2">
              <HoverTooltip content="Restrict polling to specific days of the week (or a day of the month) and an optional time window.">
                <button
                  onClick={() => setAdvancedOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border
                border-border text-gray-600 dark:text-gray-400
                hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
                hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Advanced…
                </button>
              </HoverTooltip>
              {advancedSummary && (
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5">
                  {advancedSummary}
                </span>
              )}
            </div>
          </FieldRow>
        )}

        <div className="pt-0.5 pl-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Next poll at:{" "}
            <span className="font-medium text-gray-700 dark:text-gray-300">{nextFireLabel}</span>
          </span>
        </div>
      </SettingsSection>

      <AdvancedPollingSettingsDialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        pollingType={pollState.pollingType}
        settings={pollState.advanced}
        onSave={(updated) => updatePoll({ advanced: updated })}
      />
    </>
  );
}
