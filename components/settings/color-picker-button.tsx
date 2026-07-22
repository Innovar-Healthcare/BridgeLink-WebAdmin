/**
 * ColorPickerButton — small color swatch that opens the browser's native color picker.
 * Used in Server tab (default background color) and Tags tab (tag color).
 *
 * The native color input is the actual click target, layered transparently over the
 * visible swatch. Avoids programmatic .click() forwarding, which Safari/WebKit refuses
 * to honor on hidden/zero-size color inputs.
 */

"use client";

interface ColorPickerButtonProps {
  value: string; // hex "#rrggbb"
  onChange: (hex: string) => void;
  disabled?: boolean;
  size?: number;
}

export function ColorPickerButton({
  value,
  onChange,
  disabled = false,
  size = 24,
}: ColorPickerButtonProps) {
  return (
    <label
      className={`relative inline-block border border-border rounded ${
        disabled ? "opacity-50 pointer-events-none" : "cursor-pointer"
      }`}
      style={{ width: size, height: size, backgroundColor: value }}
      title="Click to change color"
    >
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label="Pick color"
      />
    </label>
  );
}
