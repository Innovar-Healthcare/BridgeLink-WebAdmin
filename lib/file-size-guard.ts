/**
 * Size guards for user-selected files.
 *
 * Every import surface in the app reads a picked file fully into memory, and the
 * message-import path additionally decompresses ZIP archives in-browser. Without a
 * cap, a decompression bomb — or simply an absurdly large file — exhausts the tab's
 * memory and hangs the operator's admin console.
 *
 * Two distinct guards live here because they defend against two different things:
 *   - `MAX_IMPORT_BYTES` bounds how much we will read off disk at all. It is a plain
 *     backstop, set far above any realistic import.
 *   - `ZIP_LIMITS` bounds what an archive is allowed to *expand into*. This is the
 *     one that matters: the danger of a ZIP is the multiplier, not the input size.
 */

import type { UnzipFileFilter } from "fflate";

/**
 * Largest file we will read into memory from a file picker.
 *
 * Deliberately one flat cap rather than per-surface tiers. A tighter limit buys no
 * safety a generous one does not — reading 100 MB of text costs roughly 200 MB as a
 * UTF-16 string, which a browser absorbs without trouble — while every extra tier is
 * another chance to reject a legitimate import. For scale: an entire server's channel
 * export is single-digit MB (317 channels measured at 5.5 MB), so this sits ~20x above
 * the largest artifact the product actually produces.
 */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/**
 * Caps applied to a ZIP central directory's *declared* entry sizes before any entry is
 * inflated.
 *
 * Set generously on purpose: real bombs overshoot by orders of magnitude (the classic
 * 42.zip is 42 KB declaring 4.5 PB), so a loose ceiling catches them just as reliably
 * as a tight one while leaving real archives untouched. Text compresses well, so a
 * legitimate archive can exceed a naive compression-ratio check — hence absolute
 * ceilings rather than a ratio test.
 */
export const ZIP_LIMITS = {
  /** Declared uncompressed size of any single entry. */
  MAX_ENTRY_BYTES: 100 * 1024 * 1024,
  /** Running total of declared uncompressed sizes across all extracted entries. */
  MAX_TOTAL_BYTES: 500 * 1024 * 1024,
  /**
   * Number of entries we are willing to extract.
   *
   * Sized against the product's own output, not intuition: a local message export writes
   * ONE ZIP entry per message (the default file pattern in `export-results-dialog`), so a
   * routine bulk archive legitimately runs to tens of thousands of entries. This cap only
   * has to stop central-directory abuse — a million near-empty entries that slip past
   * MAX_TOTAL_BYTES while still blowing up the entry map. MAX_TOTAL_BYTES is the real
   * memory bound.
   *
   * An export past this count is therefore refused by local import — loudly, with a clear
   * message, and the Server import path (which has no client-side cap) still handles it.
   * That is the intended trade: before such an archive "imported" a silent fraction
   * of itself instead.
   */
  MAX_ENTRIES: 100_000,
} as const;

export type ZipLimits = {
  MAX_ENTRY_BYTES: number;
  MAX_TOTAL_BYTES: number;
  MAX_ENTRIES: number;
};

/** Thrown when a picked file exceeds the size cap. Distinguishes "too big" from "cancelled". */
export class FileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileTooLargeError";
  }
}

/** Human-readable byte count for error messages: 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // Drop the decimal on whole numbers so caps read as "100 MB", not "100.0 MB".
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${units[unit]}`;
}

/**
 * Checks a picked file against the size cap.
 *
 * Returns a ready-to-display message, or null when the file is acceptable — so callers
 * can feed it straight into their existing `setError` / `toast.error` path.
 */
export function checkFileSize(file: File, maxBytes: number = MAX_IMPORT_BYTES): string | null {
  if (file.size <= maxBytes) return null;
  return `"${file.name}" is ${formatBytes(file.size)}, which exceeds the ${formatBytes(maxBytes)} import limit.`;
}

/**
 * Checks each file in a selection individually, ignoring the combined total.
 *
 * This is the right check when the caller reads files ONE AT A TIME, since peak memory is
 * then bounded by the largest single file and an aggregate cap would reject a selection the
 * code can handle perfectly well.
 */
export function checkEachFileSize(
  files: readonly File[],
  maxBytes: number = MAX_IMPORT_BYTES
): string | null {
  for (const file of files) {
    const problem = checkFileSize(file, maxBytes);
    if (problem) return problem;
  }
  return null;
}

/**
 * Checks each file individually AND their combined total.
 *
 * Use only when the caller holds every file's contents in memory at once (e.g. a
 * `Promise.all` over the selection); for sequential readers prefer `checkEachFileSize`.
 */
export function checkTotalFileSize(
  files: readonly File[],
  maxBytes: number = MAX_IMPORT_BYTES
): string | null {
  const problem = checkEachFileSize(files, maxBytes);
  if (problem) return problem;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > maxBytes) {
    return `The selected files total ${formatBytes(total)}, which exceeds the ${formatBytes(maxBytes)} import limit.`;
  }
  return null;
}

/** Reads a file's text after a size check. Throws FileTooLargeError when over cap. */
export async function readFileTextGuarded(
  file: File,
  maxBytes: number = MAX_IMPORT_BYTES
): Promise<string> {
  const problem = checkFileSize(file, maxBytes);
  if (problem) throw new FileTooLargeError(problem);
  return file.text();
}

/** ZIP entries that carry no importable content and should never be inflated. */
function isArchiveCruft(name: string): boolean {
  // macOS "Compress" adds AppleDouble resource forks under __MACOSX/ (named ._foo.xml,
  // so an extension filter would not catch them) plus .DS_Store. Skipping them by name
  // avoids decompressing bytes that the caller's content scan would discard anyway.
  return (
    name.startsWith("__MACOSX/") ||
    name.endsWith("/.DS_Store") ||
    name === ".DS_Store" ||
    /(^|\/)\._/.test(name)
  );
}

/**
 * Builds an fflate `UnzipFileFilter` that rejects a decompression bomb before any entry
 * is inflated, together with a `violation()` accessor reporting why it rejected.
 *
 * fflate calls the filter while walking the central directory, handing over each entry's
 * declared sizes, so returning false means those bytes are never allocated.
 *
 * The filter records the problem and returns false rather than throwing, so the refusal
 * carries one stable, operator-readable message and the archive fails atomically rather
 * than part-way through the central-directory walk. Callers MUST therefore check
 * `violation()` after `unzip` resolves and fail the whole archive — treating a filtered
 * entry as merely absent would import a partial result while telling the operator it
 * succeeded. (fflate runs this filter synchronously on the calling thread while walking
 * the central directory; only inflation is offloaded to a worker.)
 *
 * Known limitation, accepted for fflate sizes its output buffer from the
 * declared uncompressed size but grows it if the stream produces more, so an archive
 * with a deliberately forged central-directory header can still overrun this guard.
 * Closing that gap means replacing `unzip` with the streaming `Unzip`/`AsyncUnzipInflate`
 * pair and counting real inflated bytes. It is not worth rewriting a working decode path
 * for it here: the operator picks the file themselves, and the worst case is their own
 * tab dying with no data loss and no cross-user effect.
 */
export function createUnzipGuard(limits: ZipLimits = ZIP_LIMITS): {
  filter: UnzipFileFilter;
  violation: () => string | null;
} {
  let violation: string | null = null;
  let entries = 0;
  let total = 0;

  const filter: UnzipFileFilter = (file) => {
    // Directory entries and archive cruft carry nothing worth inflating, and must not
    // count against the entry budget.
    if (file.name.endsWith("/") || isArchiveCruft(file.name)) return false;

    if (violation) return false;

    if (++entries > limits.MAX_ENTRIES) {
      violation = `The archive contains more than ${limits.MAX_ENTRIES.toLocaleString()} files, which exceeds the import limit.`;
      return false;
    }
    if (file.originalSize > limits.MAX_ENTRY_BYTES) {
      violation = `"${file.name}" expands to ${formatBytes(file.originalSize)}, which exceeds the ${formatBytes(limits.MAX_ENTRY_BYTES)} per-file limit.`;
      return false;
    }
    total += file.originalSize;
    if (total > limits.MAX_TOTAL_BYTES) {
      violation = `The archive expands to more than ${formatBytes(limits.MAX_TOTAL_BYTES)}, which exceeds the import limit.`;
      return false;
    }
    return true;
  };

  return { filter, violation: () => violation };
}
