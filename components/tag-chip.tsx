/**
 * TagChip — renders a BridgeLink channel tag as a colored pill.
 *
 * Text color logic mirrors Java's ColorUtil.getForegroundColor():
 *   luminance = 1 - ((0.299*R + 0.587*G + 0.114*B) / 255)
 *   if luminance < 0.5 → black text (light background)
 *   else               → white text (dark background)
 *
 * backgroundColor may be:
 *   - An HTML hex string "#rrggbb"
 *   - An XStream-serialized java.awt.Color object: { r, g, b } or { red, green, blue }
 *   - An ARGB packed int in a { value } field
 *   - An "rgb(r,g,b)" CSS string
 */

import type { XStreamColor } from "@/lib/types";
import type { TagDisplayMode } from "@/lib/hooks/use-tag-display-mode";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type TagColor = XStreamColor | string | undefined | null;

/**
 * Java ColorUtil cycling palette used for new tag colors.
 * Matches the 12 colors from com.mirth.connect.util.ColorUtil.getNewColor().
 */
export const TAG_COLOR_PALETTE = [
  "#FF0000",
  "#800000",
  "#FFFF00",
  "#808000",
  "#00FF00",
  "#008000",
  "#00FFFF",
  "#008080",
  "#0000FF",
  "#000080",
  "#FF00FF",
  "#800080",
];

/** Normalize any tag color representation into [r, g, b] 0-255. */
export function parseTagColor(color: TagColor): [number, number, number] | null {
  if (!color) return null;

  // XStream Color object: { r, g, b } or { red, green, blue }
  if (typeof color === "object") {
    const r = color.r ?? color.red;
    const g = color.g ?? color.green;
    const b = color.b ?? color.blue;
    if (r !== undefined && g !== undefined && b !== undefined) {
      return [r, g, b];
    }
    // Packed ARGB int: bits 16-23 = R, 8-15 = G, 0-7 = B
    if (color.value !== undefined) {
      const v = color.value;
      return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    }
    return null;
  }

  // Hex string: #rgb or #rrggbb
  const hex = color.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.split("").map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  // CSS rgb(r, g, b)
  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];

  return null;
}

/** Convert a tag color to a CSS color string for use in style props. */
export function tagColorToCss(color: TagColor): string {
  const parsed = parseTagColor(color);
  if (!parsed) return "#c0c0c0"; // Java ChannelTag default: Color.lightGray (192,192,192)
  return `rgb(${parsed[0]},${parsed[1]},${parsed[2]})`;
}

/**
 * Returns "white" or "black" for the tag label text,
 * matching Java's ColorUtil.getForegroundColor() exactly:
 *   luminance = 1 - ((0.299*R + 0.587*G + 0.114*B) / 255)
 *   luminance >= 0.5 → white text (dark bg), < 0.5 → black text (light bg)
 */
export function tagForegroundColor(color: TagColor): "white" | "black" {
  const parsed = parseTagColor(color);
  if (!parsed) return "black";
  const [r, g, b] = parsed;
  const luminance = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance >= 0.5 ? "white" : "black";
}

/** Convert hex "#rrggbb" to XStreamColor for saving to server. */
export function hexToXStreamColor(hex: string): XStreamColor {
  const parsed = parseTagColor(hex);
  const [r, g, b] = parsed ?? [0, 0, 0];
  // Packed ARGB int: alpha=255, then R, G, B
  const value = ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0;
  return { r, g, b, value };
}

/** Convert any TagColor to a hex "#rrggbb" string for use in <input type="color">. */
export function tagColorToHex(color: TagColor): string {
  const parsed = parseTagColor(color);
  if (!parsed) return "#c0c0c0"; // Java ChannelTag default: Color.lightGray (192,192,192)
  const [r, g, b] = parsed;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

interface TagChipProps {
  name: string;
  backgroundColor?: TagColor;
  className?: string;
  mode?: TagDisplayMode;
}

export function TagChip({ name, backgroundColor, className = "", mode = "text" }: TagChipProps) {
  const bg = tagColorToCss(backgroundColor);

  if (mode === "icon") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${className}`}
              style={{ backgroundColor: bg }}
              aria-label={name}
            />
          </TooltipTrigger>
          <TooltipContent side="top">{name}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const fg = tagForegroundColor(backgroundColor);
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium shrink-0 ${className}`}
      style={{ backgroundColor: bg, color: fg }}
    >
      {name}
    </span>
  );
}
