"use client";

import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { RadioGroup } from "./radio-group";
import { inputCls, inputErrorCls } from "./styles";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { NumberInput } from "@/components/ui/number-input";
import { TRANSMISSION_MODE_REGISTRY } from "./transmission-modes";
import type { TransmissionModeSettings } from "./transmission-modes/types";

export type { TransmissionModeSettings } from "./transmission-modes/types";
// ─── Byte abbreviation map ────────────────────────────────────────────────────

const CONTROL_ABBREVIATIONS: Record<number, string> = {
  0: "NUL",
  1: "SOH",
  2: "STX",
  3: "ETX",
  4: "EOT",
  5: "ENQ",
  6: "ACK",
  7: "BEL",
  8: "BS",
  9: "TAB",
  10: "LF",
  11: "VT",
  12: "FF",
  13: "CR",
  14: "SO",
  15: "SI",
  16: "DLE",
  17: "DC1",
  18: "DC2",
  19: "DC3",
  20: "DC4",
  21: "NAK",
  22: "SYN",
  23: "ETB",
  24: "CAN",
  25: "EM",
  26: "SUB",
  27: "ESC",
  28: "FS",
  29: "GS",
  30: "RS",
  31: "US",
  32: "SP",
  127: "DEL",
};

/** All 128 ASCII byte abbreviations for the reference panel. */
const BYTE_ABBREVIATIONS: Array<{ hex: string; abbr: string; decimal: number }> = Array.from(
  { length: 128 },
  (_, i) => {
    const hex = i.toString(16).toUpperCase().padStart(2, "0");
    const abbr = i in CONTROL_ABBREVIATIONS ? CONTROL_ABBREVIATIONS[i]! : String.fromCharCode(i);
    return { hex, abbr, decimal: i };
  }
);

/** Lookup map for O(1) abbreviation lookup by 2-char hex string (uppercase). */
const ABBR_MAP = new Map<string, string>(BYTE_ABBREVIATIONS.map(({ hex, abbr }) => [hex, abbr]));

/**
 * Converts a hex string of concatenated byte pairs to a bracket-wrapped
 * abbreviation string. e.g. "0B" → "<VT>", "1C0D" → "<FS><CR>"
 */
export function hexToAbbreviation(hex: string): string {
  const normalized = hex.toUpperCase().trim();
  if (!normalized) return "";
  // Split into 2-char byte pairs
  const pairs: string[] = [];
  for (let i = 0; i < normalized.length; i += 2) {
    pairs.push(normalized.slice(i, i + 2));
  }
  return pairs
    .map((pair) => {
      const abbr = ABBR_MAP.get(pair);
      return abbr ? `<${abbr}>` : `<0x${pair}>`;
    })
    .join("");
}

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

  const label = transmissionMode === "MLLP" ? "MLLP Sample Frame:" : "Sample Frame:";

  return (
    <div className="text-xs text-gray-500 dark:text-gray-400 italic ml-1">
      {label} {sample}
    </div>
  );
}

// ─── Drag-and-drop data key ───────────────────────────────────────────────────

const DRAG_TYPE = "text/x-bl-hex-byte";

// ─── Hex input row ────────────────────────────────────────────────────────────

function HexFieldRow({
  label,
  value,
  onChange,
  disabled = false,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { viewDensity } = useCompactMode();
  const abbr = hexToAbbreviation(value);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-48 text-sm text-right text-gray-700 dark:text-gray-300 shrink-0">
        {label}
      </span>
      <span className="text-sm text-gray-500 dark:text-gray-400 font-mono">0x</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        disabled={disabled}
        className={`${inputCls(viewDensity)} w-28 font-mono transition-colors ${
          dragOver && !disabled
            ? "border-blue-500 dark:border-blue-400 ring-1 ring-blue-500/30"
            : invalid
              ? inputErrorCls
              : ""
        }`}
        onDragOver={(e) => {
          if (disabled) return;
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          const hex = e.dataTransfer.getData(DRAG_TYPE);
          if (hex) {
            e.preventDefault();
            onChange((value + hex).toUpperCase());
          }
          setDragOver(false);
        }}
      />
      {abbr && <span className="text-sm text-gray-500 dark:text-gray-400 font-mono">{abbr}</span>}
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
  const { viewDensity } = useCompactMode();
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

  function set<K extends keyof TransmissionModeSettings>(key: K, val: TransmissionModeSettings[K]) {
    setLocal((prev) => ({ ...prev, [key]: val }));
    // Clear the highlight + error for a field once the user edits it.
    setInvalidFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setError(null);
  }

  const isMLLP = local.transmissionMode === "MLLP";
  const title = isMLLP ? "MLLP Settings" : "Basic Settings";

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      submitLabel="OK"
      maxWidth="sm:max-w-3xl"
      error={error}
      onSubmit={() => {
        const def = TRANSMISSION_MODE_REGISTRY.find((m) => m.name === local.transmissionMode);
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
            {isMLLP ? "MLLP Settings" : "Basic Settings"}
          </p>

          <HexFieldRow
            label="Start of Message Bytes:"
            value={local.startOfMessageBytes}
            onChange={(v) => set("startOfMessageBytes", v)}
            invalid={invalidFields.has("startOfMessageBytes")}
          />
          <HexFieldRow
            label="End of Message Bytes:"
            value={local.endOfMessageBytes}
            onChange={(v) => set("endOfMessageBytes", v)}
            invalid={invalidFields.has("endOfMessageBytes")}
          />

          {isMLLP && (
            <>
              <div className="flex items-center gap-3 py-1.5">
                <span className="w-48 text-sm text-right text-gray-700 dark:text-gray-300 shrink-0">
                  Use MLLPv2:
                </span>
                <RadioGroup
                  name="tm-dialog-mllpv2"
                  value={local.useMLLPv2 ? "yes" : "no"}
                  onChange={(v) => set("useMLLPv2", v === "yes")}
                  options={[
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                  ]}
                  title="Select Yes to use MLLPv2 (bi-directional acknowledgements)."
                />
              </div>

              <HexFieldRow
                label="Commit ACK Bytes:"
                value={local.ackBytes}
                onChange={(v) => set("ackBytes", v)}
                disabled={!local.useMLLPv2}
                invalid={invalidFields.has("ackBytes")}
              />
              <HexFieldRow
                label="Commit NACK Bytes:"
                value={local.nackBytes}
                onChange={(v) => set("nackBytes", v)}
                disabled={!local.useMLLPv2}
                invalid={invalidFields.has("nackBytes")}
              />

              <div className="flex items-center gap-3 py-1.5">
                <span className="w-48 text-sm text-right text-gray-700 dark:text-gray-300 shrink-0">
                  Max Retry Count:
                </span>
                <NumberInput
                  value={local.maxRetries}
                  onChange={(maxRetries) => set("maxRetries", maxRetries)}
                  disabled={!local.useMLLPv2}
                  className={`${inputCls(viewDensity)} w-20 ${
                    invalidFields.has("maxRetries") ? inputErrorCls : ""
                  }`}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Right: Byte Abbreviations reference ─────────────────────────── */}
        <div className="w-40 shrink-0 border border-border rounded p-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 text-center">
            Byte Abbreviations
          </p>
          <div className="max-h-72 overflow-y-auto">
            <ul className="divide-y divide-border">
              {BYTE_ABBREVIATIONS.map(({ hex, abbr }) => (
                <li
                  key={hex}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, hex);
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
    </FormDialog>
  );
}
