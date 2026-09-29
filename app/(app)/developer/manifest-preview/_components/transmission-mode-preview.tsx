"use client";

/**
 * Right-pane preview for one declared transmission mode.
 *
 * Renders the real production `RuntimeTransmissionModeSectionImpl` directly (the
 * stable render body behind the loader factory): the transmission-mode grammar
 * has NO action buttons, so there is no `actionsDisabled` / props-widening
 * concern that forced ConnectorPanel/ConnectorSection to fork, and rendering the
 * Impl is zero-drift. We render the Impl, not the factory result, because
 * calling the factory during render would mint a new component type each render
 * (react-hooks/static-components).
 *
 * The dialog's shared Start/End-of-Message rows are chrome owned by the real
 * transmission-mode dialog; they're reproduced with the SAME `HexFieldRow` the
 * dialog uses (uppercases on entry, so "0b" → "0B" and never trips the
 * hex-only validator) rather than a plain input.
 *
 * User edits are kept as OVERRIDES layered over the mode's live-derived
 * defaults (the SettingsPanelPreview pattern), so manifest edits — a new field,
 * a changed default byte — show through while the author's own edits persist,
 * and Validate always runs against exactly what the form displays.
 */

import { useMemo, useState } from "react";
import { RuntimeTransmissionModeSectionImpl } from "@/components/schema-form/runtime-transmission-mode-section";
import { compileTransmissionMode } from "@/lib/runtime-plugins/compile-transmission-mode";
import type { TransmissionModeContribution } from "@/lib/runtime-plugins/manifest-types";
import type { TransmissionModeSettings } from "@/app/(app)/channels/_connectors/shared/transmission-modes/types";
import { HexFieldRow } from "@/app/(app)/channels/_connectors/shared/transmission-modes/hex-field-row";
import { ValidateBar, type ValidateError } from "./validate-bar";

export function TransmissionModePreview({
  mode,
  attribution,
}: {
  mode: TransmissionModeContribution;
  attribution: string;
}) {
  const compiled = useMemo(() => compileTransmissionMode(mode), [mode]);

  // Overrides layered over live defaults — see the header note.
  const [extraOverrides, setExtraOverrides] = useState<Record<string, string>>({});
  const [somOverride, setSomOverride] = useState<string | null>(null);
  const [eomOverride, setEomOverride] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<ValidateError[] | null>(null);

  const settings: TransmissionModeSettings = useMemo(
    () => ({
      transmissionMode: mode.name,
      startOfMessageBytes: somOverride ?? mode.defaultStartBytes,
      endOfMessageBytes: eomOverride ?? mode.defaultEndBytes,
      useMLLPv2: false,
      ackBytes: "",
      nackBytes: "",
      maxRetries: "0",
      extra: { ...(compiled.defaultExtra ?? {}), ...extraOverrides },
    }),
    [mode, compiled, extraOverrides, somOverride, eomOverride]
  );

  function clearValidation() {
    setErrors(null);
    setInvalidFields(new Set());
  }

  function handleValidate() {
    const result = compiled.validate?.(settings) ?? [];
    setErrors(result);
    setInvalidFields(new Set(result.map((e) => e.field)));
  }

  return (
    <div className="space-y-3">
      {/* Shared Start/End-of-Message rows — chrome the real dialog owns. */}
      <div className="space-y-1.5">
        <HexFieldRow
          label="Start of Message Bytes"
          value={settings.startOfMessageBytes}
          onChange={(v) => {
            setSomOverride(v);
            clearValidation();
          }}
          invalid={invalidFields.has("startOfMessageBytes")}
        />
        <HexFieldRow
          label="End of Message Bytes"
          value={settings.endOfMessageBytes}
          onChange={(v) => {
            setEomOverride(v);
            clearValidation();
          }}
          invalid={invalidFields.has("endOfMessageBytes")}
        />
      </div>
      <RuntimeTransmissionModeSectionImpl
        mode={mode}
        entry={{ name: attribution }}
        settings={settings}
        onChange={(next) => {
          if (next.extra) setExtraOverrides(next.extra);
          clearValidation();
        }}
        invalidFields={invalidFields}
      />
      <ValidateBar onValidate={handleValidate} errors={errors} />
    </div>
  );
}
