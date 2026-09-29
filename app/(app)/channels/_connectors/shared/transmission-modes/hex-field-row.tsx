"use client";

/**
 * Hex-byte input primitives shared by the transmission-mode dialog and the
 * mode-specific SettingsSection components (MLLP, runtime modes).
 *
 * Kept in a leaf module (imports nothing from the transmission-modes registry
 * or the dialog) so `index.ts` can register a SettingsSection that uses
 * HexFieldRow without creating a dialog ↔ registry import cycle.
 */

import { useState } from "react";
import { inputCls, inputErrorCls } from "../styles";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

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
export const BYTE_ABBREVIATIONS: Array<{ hex: string; abbr: string; decimal: number }> = Array.from(
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

// ─── Drag-and-drop data key ───────────────────────────────────────────────────

export const HEX_BYTE_DRAG_TYPE = "text/x-bl-hex-byte";

// ─── Hex input row ────────────────────────────────────────────────────────────

export function HexFieldRow({
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
        // The visible label is a plain span (the row's grid layout predates
        // FieldRow), so the input would otherwise have no accessible name.
        aria-label={label.replace(/:$/, "")}
        className={`${inputCls(viewDensity)} w-28 font-mono transition-colors ${
          dragOver && !disabled
            ? "border-blue-500 dark:border-blue-400 ring-1 ring-blue-500/30"
            : invalid
              ? inputErrorCls
              : ""
        }`}
        onDragOver={(e) => {
          if (disabled) return;
          if (e.dataTransfer.types.includes(HEX_BYTE_DRAG_TYPE)) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          const hex = e.dataTransfer.getData(HEX_BYTE_DRAG_TYPE);
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
