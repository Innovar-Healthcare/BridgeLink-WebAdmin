"use client";

/**
 * Transmission-mode settings dialog shared by the TCP Listener / TCP Sender
 * connectors. Mirrors the Java *ModeSettingsDialog family.
 *
 * Mode-agnostic: the shared SOM/EOM hex rows render for every mode,
 * and everything mode-specific comes from the registered definition —
 * `def.SettingsSection` (MLLP's MLLPv2 block, a runtime mode's declared
 * fields), `def.validate` (blocks OK + highlights invalid fields), and the
 * dialog title from the mode name. The byte-abbreviation reference panel is a
 * drag source for the hex inputs.
 */

import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { TRANSMISSION_MODE_REGISTRY } from "./transmission-modes";
import {
  BYTE_ABBREVIATIONS,
  HEX_BYTE_DRAG_TYPE,
  HexFieldRow,
  hexToAbbreviation,
} from "./transmission-modes/hex-field-row";
import type { TransmissionModeSettings } from "./transmission-modes/types";

export type { TransmissionModeSettings } from "./transmission-modes/types";
export { hexToAbbreviation } from "./transmission-modes/hex-field-row";

// ─── Sample Frame Label ───────────────────────────────────────────────────────

/** Renders the frame format hint below the Transmission Mode dropdown. */
export function SampleFrameLabel({
  transmissionMode,
  startOfMessageBytes,
  endOfMessageBytes,
}: {
  transmissionMode: string;
  startOfMessageBytes: string;
  endOfMessageBytes: string;
}) {
  const startAbbr = hexToAbbreviation(startOfMessageBytes);
  const endAbbr = hexToAbbreviation(endOfMessageBytes);
  const sample =
    startAbbr || endAbbr ? `${startAbbr} <Message Data> ${endAbbr}`.trim() : "<Message Data>";

  // Java getSampleLabel(): the mode's own label ("MLLP Sample Frame:"), with
  // the frame-mode default for Basic, runtime modes, and unknown modes.
  const label =
    TRANSMISSION_MODE_REGISTRY.find((m) => m.name === transmissionMode)?.sampleLabel ??
    "Sample Frame:";

  return (
    <div className="text-xs text-gray-500 dark:text-gray-400 italic ml-1">
      {label} {sample}
    </div>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

interface TransmissionModeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: TransmissionModeSettings;
  onSave: (updated: TransmissionModeSettings) => void;
}

export function TransmissionModeSettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
}: TransmissionModeSettingsDialogProps) {
  const [local, setLocal] = useState<TransmissionModeSettings>(settings);
  // Validation error message + the set of invalid field keys (for red highlight).
  // Mirrors Java *ModeSettingsDialog, which blocks OK and highlights bad fields.
  const [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

  // Re-initialize draft when the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an
  // effect, which avoids the cascading-render warning from set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLocal(settings);
      setError(null);
      setInvalidFields(new Set());
    }
  }

  /**
   * Apply a partial edit to the draft; clears the highlight (and the error
   * line) for the fields the edit actually changed. This is also the onChange
   * contract handed to the mode's SettingsSection.
   */
  function patch(p: Partial<TransmissionModeSettings>) {
    const changed = new Set<string>();
    for (const [key, value] of Object.entries(p)) {
      if (key === "extra") {
        const nextExtra = value as Record<string, string>;
        for (const k of Object.keys(nextExtra)) {
          if (nextExtra[k] !== local.extra[k]) changed.add(k);
        }
      } else if (value !== local[key as keyof TransmissionModeSettings]) {
        changed.add(key);
      }
    }
    setLocal((prev) => ({ ...prev, ...p }));
    if (changed.size === 0) return;
    setInvalidFields((prev) => {
      const next = new Set(prev);
      for (const key of changed) next.delete(key);
      return next.size === prev.size ? prev : next;
    });
    setError(null);
  }

  const def = TRANSMISSION_MODE_REGISTRY.find((m) => m.name === local.transmissionMode);
  // The mode-specific block below the shared SOM/EOM rows (MLLP's MLLPv2
  // fields, a runtime mode's declared fields). Absent for Basic.
  const ModeSection = def?.SettingsSection;
  const title = `${local.transmissionMode} Settings`;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      submitLabel="OK"
      maxWidth="sm:max-w-3xl"
      error={error}
      onSubmit={() => {
        const errs = def?.validate?.(local) ?? [];
        if (errs.length > 0) {
          // Block close and surface the errors (parity with Java's JOptionPane).
          // Messages are sentence-style, so a space join reads cleanly inline.
          setInvalidFields(new Set(errs.map((e) => e.field)));
          setError(errs.map((e) => e.message).join(" "));
          return;
        }
        onSave(local);
        onOpenChange(false);
      }}
    >
      <div className="flex gap-4">
        {/* ── Left: form fields ──────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 border border-border rounded p-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            {title}
          </p>

          <HexFieldRow
            label="Start of Message Bytes:"
            value={local.startOfMessageBytes}
            onChange={(v) => patch({ startOfMessageBytes: v })}
            invalid={invalidFields.has("startOfMessageBytes")}
          />
          <HexFieldRow
            label="End of Message Bytes:"
            value={local.endOfMessageBytes}
            onChange={(v) => patch({ endOfMessageBytes: v })}
            invalid={invalidFields.has("endOfMessageBytes")}
          />

          {ModeSection && (
            <ModeSection settings={local} onChange={patch} invalidFields={invalidFields} />
          )}
        </div>

        {/* ── Right: Byte Abbreviations reference ─────────────────────────── */}
        <div className="w-40 shrink-0 flex flex-col min-h-72 border border-border rounded p-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 text-center">
            Byte Abbreviations
          </p>
          {/* The list fills the row's height instead of a fixed cap, so a mode with
              many declared fields (ASTM has nine) doesn't leave dead space below it,
              while min-h-72 on the column keeps a short mode (Basic declares none)
              from collapsing it. The scroller is absolutely positioned on purpose:
              flex-1 alone would let its 128 rows of content drive the row height —
              the dialog grew to ~3700px and stopped scrolling — so it must be taken
              out of flow and sized by the column instead.. */}
          <div className="relative flex-1">
            <div className="absolute inset-0 overflow-y-auto">
              <ul className="divide-y divide-border">
                {BYTE_ABBREVIATIONS.map(({ hex, abbr }) => (
                  <li
                    key={hex}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(HEX_BYTE_DRAG_TYPE, hex);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="flex hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-grab active:cursor-grabbing select-none"
                  >
                    <span className="py-0.5 px-1 text-gray-500 dark:text-gray-400 font-mono w-10">
                      {hex}
                    </span>
                    <span className="py-0.5 px-1 text-gray-700 dark:text-gray-300 font-mono">
                      {abbr.length === 1 ? abbr : `<${abbr}>`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </FormDialog>
  );
}
