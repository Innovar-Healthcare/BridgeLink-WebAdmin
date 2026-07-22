import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Given a hex color string (e.g. "#cc0000"), returns "white" if white text
 * is more readable on that background, or "black" otherwise.
 * Uses the same luminance formula as tagForegroundColor in tag-chip.tsx.
 */
export function readableForegroundFor(hex: string): "white" | "black" {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance >= 0.5 ? "white" : "black";
}

/**
 * Format a large integer compactly for display in stat cards.
 * Returns abbreviated strings like "1.2M", "15k", "1.2k" for large values,
 * falling back to toLocaleString() for small values (< 1,000).
 *
 * Use the full toLocaleString() value as a title tooltip for precision.
 */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

/**
 * Generate a UUID v4.
 *
 * crypto.randomUUID() is only available in secure contexts (HTTPS / localhost).
 * When the app is served over plain HTTP we fall back to crypto.getRandomValues(),
 * which IS available in all contexts including HTTP.
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 UUID via getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Split a dotted version string into its numeric components, dropping any
 * non-numeric suffix (snapshot tags, build IDs) and the trailing 4th build
 * segment used on some server builds. Mirrors the numeric-comparison intent of
 * the Java client's MigrationUtil.compareVersions.
 * "26.3.1-SNAPSHOT" → [26, 3, 1]; "26.3.1.5" → [26, 3, 1, 5]; "" → [].
 */
function parseVersionParts(v: string): number[] {
  return v
    .split(/[.\-+]/)
    .map((part) => parseInt(part, 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * Compare two dotted version strings numerically, component-by-component
 * (left-to-right, missing components treated as 0). Non-numeric suffixes are
 * ignored. Returns -1 when `a < b`, 0 when equal, 1 when `a > b`.
 *
 * A version with no parseable numeric components (empty / garbage) sorts as
 * "lowest" — `compareVersions("", "1.0")` is -1, `compareVersions("", "")` is 0.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

/**
 * Compare a server version string (e.g. "26.3.1", "26.3.1-SNAPSHOT") against a
 * required minimum and return true when the actual version is at least the
 * required one.
 *
 * Used to gate UI features that depend on server- or plugin-side changes that
 * only landed in a specific BridgeLink release. Numeric components are
 * compared left-to-right; non-numeric suffixes (snapshot tags, build IDs) are
 * ignored. Missing/unparseable `actual` is treated as "below required" so
 * features stay hidden until we can prove the server supports them.
 */
export function isVersionAtLeast(actual: string | null | undefined, required: string): boolean {
  if (!actual) return false;
  return compareVersions(actual, required) >= 0;
}

/** Format an ISO date string for display, with fallback for invalid dates. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "yyyy-MM-dd hh:mm a");
  } catch {
    return iso;
  }
}
