"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { inputCls } from "@/app/(app)/channels/_connectors/shared/styles";
import type { AdvancedPollingSettings, PollingType } from "@/app/(app)/channels/_lib/channel-xml";

export type { AdvancedPollingSettings };

// ─── Day labels (mirrors Java: Sun=index 0 … Sat=index 6) ────────────────────

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DAY_FULL_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ─── Time helpers ─────────────────────────────────────────────────────────────

function toTimeString(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function fromTimeString(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(":").map(Number);
  return { hour: isNaN(h) ? 0 : h, minute: isNaN(m) ? 0 : m };
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-h-[32px]">
      <span className="w-[120px] shrink-0 text-right text-sm text-gray-600 dark:text-gray-400 leading-snug py-1">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── Inline radio ─────────────────────────────────────────────────────────────

function Radio({
  name,
  label,
  value,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label
      className={`flex items-center gap-1.5 text-sm cursor-pointer select-none ${
        disabled
          ? "opacity-40 cursor-not-allowed text-gray-400 dark:text-gray-500"
          : "text-gray-700 dark:text-gray-300"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => !disabled && onChange(value)}
        className="accent-blue-600 disabled:cursor-not-allowed"
      />
      {label}
    </label>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded p-4 space-y-2.5">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide -mt-1 mb-1">
        {title}
      </p>
      {children}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AdvancedPollingSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current polling type — disables the Active Time section when CRON. */
  pollingType: PollingType;
  settings: AdvancedPollingSettings;
  onSave: (updated: AdvancedPollingSettings) => void;
}

// ─── AdvancedPollingSettingsDialog ────────────────────────────────────────────

export function AdvancedPollingSettingsDialog({
  open,
  onOpenChange,
  pollingType,
  settings,
  onSave,
}: AdvancedPollingSettingsDialogProps) {
  const { viewDensity } = useCompactMode();
  const [local, setLocal] = useState<AdvancedPollingSettings>(settings);
  const [errors, setErrors] = useState<{ days?: string; time?: string }>({});

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocal(settings);
      setErrors({});
    }
  }, [open, settings]);

  function patch(updates: Partial<AdvancedPollingSettings>) {
    setLocal((prev) => ({ ...prev, ...updates }));
  }

  // ── Day checkbox helpers ──────────────────────────────────────────────────

  function isDayActive(idx: number): boolean {
    return !local.inactiveDays[idx];
  }

  function toggleDay(idx: number, active: boolean) {
    const next = [...local.inactiveDays] as boolean[];
    next[idx] = !active; // inactiveDays is inverted: false=active, true=inactive
    patch({ inactiveDays: next });
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  // Java enables the Active Time controls only for INTERVAL schedules
  // (AdvancedPollingSettingsDialog.enableComponents:71-77); for TIME and CRON the engine ignores
  // any time range, so they are disabled here rather than editable-but-inert.
  const activeTimeDisabled = pollingType !== "INTERVAL";
  const startTime = toTimeString(local.startingHour, local.startingMinute);
  const endTime = toTimeString(local.endingHour, local.endingMinute);

  // ── Validation & save ─────────────────────────────────────────────────────

  function handleSubmit() {
    const newErrors: { days?: string; time?: string } = {};

    if (local.weekly) {
      const anyActive = local.inactiveDays.slice(0, 7).some((inactive) => !inactive);
      if (!anyActive) {
        newErrors.days = "At least one day must be selected.";
      }
    }

    if (!local.allDay && !activeTimeDisabled) {
      if (startTime === endTime) {
        newErrors.time = "Start time and end time must be different.";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSave(local);
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Advanced Polling Settings"
      submitLabel="OK"
      onSubmit={handleSubmit}
      maxWidth="sm:max-w-lg"
    >
      <div className="space-y-4">
        {/* ── Active Days ── */}
        <Section title="Active Days">
          <Row label="Schedule:">
            <Radio
              name="adv-schedule"
              label="Weekly"
              value="weekly"
              checked={local.weekly}
              onChange={() => patch({ weekly: true })}
            />
            <Radio
              name="adv-schedule"
              label="Monthly"
              value="monthly"
              checked={!local.weekly}
              onChange={() => patch({ weekly: false })}
            />
          </Row>

          {/* Weekly day checkboxes */}
          <Row label="Active Days:">
            <div className={`flex gap-2 ${!local.weekly ? "opacity-40 pointer-events-none" : ""}`}>
              {DAY_LABELS.map((letter, idx) => (
                <div key={idx} className="flex flex-col items-center gap-0.5">
                  <span
                    className="text-xs text-gray-500 dark:text-gray-400"
                    title={DAY_FULL_LABELS[idx]}
                  >
                    {letter}
                  </span>
                  <FormCheckbox
                    label=""
                    checked={isDayActive(idx)}
                    onChange={(active) => toggleDay(idx, active)}
                    disabled={!local.weekly}
                    size="xs"
                  />
                </div>
              ))}
            </div>
            {errors.days && (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.days}</span>
            )}
          </Row>

          {/* Monthly day-of-month */}
          <Row label="Day of Month:">
            <input
              type="number"
              min={1}
              max={31}
              value={local.dayOfMonth}
              disabled={local.weekly}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 1 && v <= 31) patch({ dayOfMonth: v });
              }}
              className={`${inputCls(viewDensity)} w-20 ${local.weekly ? "opacity-40" : ""}`}
            />
          </Row>
        </Section>

        {/* ── Active Time ── */}
        <Section title="Active Time">
          {activeTimeDisabled && (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              Time restrictions only apply to an Interval schedule.
            </p>
          )}
          <Row label="Time Range:">
            <Radio
              name="adv-time"
              label="All Day"
              value="allday"
              checked={local.allDay}
              disabled={activeTimeDisabled}
              onChange={() => patch({ allDay: true })}
            />
            <Radio
              name="adv-time"
              label="Range"
              value="range"
              checked={!local.allDay}
              disabled={activeTimeDisabled}
              onChange={() => patch({ allDay: false })}
            />
          </Row>

          <Row label="Start – End:">
            <input
              type="time"
              value={startTime}
              disabled={local.allDay || activeTimeDisabled}
              onChange={(e) => {
                const { hour, minute } = fromTimeString(e.target.value);
                patch({ startingHour: hour, startingMinute: minute });
              }}
              className={`${inputCls(viewDensity)} w-28 ${local.allDay || activeTimeDisabled ? "opacity-40" : ""}`}
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">–</span>
            <input
              type="time"
              value={endTime}
              disabled={local.allDay || activeTimeDisabled}
              onChange={(e) => {
                const { hour, minute } = fromTimeString(e.target.value);
                patch({ endingHour: hour, endingMinute: minute });
              }}
              className={`${inputCls(viewDensity)} w-28 ${local.allDay || activeTimeDisabled ? "opacity-40" : ""}`}
            />
            {errors.time && (
              <span className="text-xs text-red-600 dark:text-red-400">{errors.time}</span>
            )}
          </Row>
        </Section>
      </div>
    </FormDialog>
  );
}
