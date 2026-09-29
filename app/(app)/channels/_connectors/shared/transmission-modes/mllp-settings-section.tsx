"use client";

/**
 * MLLP-specific rows of the transmission-mode settings dialog, registered as
 * the built-in MLLP definition's `SettingsSection`. Extracted from
 * the dialog's former hardcoded `isMLLP` block so the dialog renders every
 * mode — built-in, compiled-in plugin, or runtime manifest — through the same
 * `def.SettingsSection` hook.
 *
 * Mirrors MLLPModeSettingsDialog.java: the Use MLLPv2 radio enables/disables
 * the ACK/NACK/retry controls; field values live on the shared
 * TransmissionModeSettings draft owned by the dialog.
 */

import { RadioGroup } from "../radio-group";
import { inputCls, inputErrorCls } from "../styles";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { NumberInput } from "@/components/ui/number-input";
import { HexFieldRow } from "./hex-field-row";
import type { TransmissionModeSectionProps } from "./types";

export function MLLPSettingsSection({
  settings,
  onChange,
  invalidFields,
}: TransmissionModeSectionProps) {
  const { viewDensity } = useCompactMode();
  return (
    <>
      <div className="flex items-center gap-3 py-1.5">
        <span className="w-48 text-sm text-right text-gray-700 dark:text-gray-300 shrink-0">
          Use MLLPv2:
        </span>
        <RadioGroup
          name="tm-dialog-mllpv2"
          value={settings.useMLLPv2 ? "yes" : "no"}
          onChange={(v) => onChange({ useMLLPv2: v === "yes" })}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Select Yes to use MLLPv2 (bi-directional acknowledgements)."
        />
      </div>

      <HexFieldRow
        label="Commit ACK Bytes:"
        value={settings.ackBytes}
        onChange={(v) => onChange({ ackBytes: v })}
        disabled={!settings.useMLLPv2}
        invalid={invalidFields.has("ackBytes")}
      />
      <HexFieldRow
        label="Commit NACK Bytes:"
        value={settings.nackBytes}
        onChange={(v) => onChange({ nackBytes: v })}
        disabled={!settings.useMLLPv2}
        invalid={invalidFields.has("nackBytes")}
      />

      <div className="flex items-center gap-3 py-1.5">
        <span className="w-48 text-sm text-right text-gray-700 dark:text-gray-300 shrink-0">
          Max Retry Count:
        </span>
        <NumberInput
          value={settings.maxRetries}
          onChange={(maxRetries) => onChange({ maxRetries })}
          disabled={!settings.useMLLPv2}
          className={`${inputCls(viewDensity)} w-20 ${
            invalidFields.has("maxRetries") ? inputErrorCls : ""
          }`}
        />
      </div>
    </>
  );
}
