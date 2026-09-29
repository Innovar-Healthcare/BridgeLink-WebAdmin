/**
 * ZIP64 end-of-central-directory repair.
 *
 * A classic ZIP end-of-central-directory (EOCD) record stores the entry count in a
 * **16-bit** field. An archive with more than 65,535 entries must therefore also carry a
 * ZIP64 EOCD record, which stores the count in 64 bits.
 *
 * `fflate`'s writer never emits one. Its reader trusts the 16-bit count. Together that
 * means an archive of, say, 70,000 entries reports `70000 % 65536 = 4464` entries and reads
 * back as 4,464 files — with no error. In BridgeLink that is silent data loss: the local
 * message export writes one entry per message, so a bulk export of a busy channel restores
 * a fraction of itself while reporting complete success.
 *
 * The good news, and the reason this fix is small: `fflate` writes every central-directory
 * record correctly. Only the EOCD's count fields are wrong. So the repair is a pure header
 * rewrite — no entry data is touched, moved, or re-compressed — and `fflate`'s reader
 * already understands the ZIP64 records once they are present, as does every standard tool.
 *
 * Used on both sides:
 *   - **export**, so the archives we produce are standards-compliant;
 *   - **import**, so an archive produced by an already-shipped build is read in full
 *     instead of being silently truncated.
 */

/** Classic EOCD: signature + 18 bytes of fields. */
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
/** A trailing comment may push the EOCD up to 64 KB from the end of the file. */
const MAX_EOCD_SEARCH = EOCD_SIZE + 0xffff;

const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
/** Fixed part of a central-directory file header, before name/extra/comment. */
const CENTRAL_FILE_HEADER_SIZE = 46;

const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_SIZE = 56;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;

/** The 16-bit sentinel meaning "the real count lives in the ZIP64 record". */
const COUNT_NEEDS_ZIP64 = 0xffff;
/** Largest entry count a classic EOCD can represent without the sentinel. */
export const MAX_CLASSIC_ZIP_ENTRIES = 0xfffe;

const u16 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number): number =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function writeU16(b: Uint8Array, i: number, v: number): void {
  b[i] = v & 0xff;
  b[i + 1] = (v >>> 8) & 0xff;
}

function writeU32(b: Uint8Array, i: number, v: number): void {
  b[i] = v & 0xff;
  b[i + 1] = (v >>> 8) & 0xff;
  b[i + 2] = (v >>> 16) & 0xff;
  b[i + 3] = (v >>> 24) & 0xff;
}

/** Writes a 64-bit little-endian value. Counts and offsets here are far below 2^53. */
function writeU64(b: Uint8Array, i: number, v: number): void {
  writeU32(b, i, v >>> 0);
  writeU32(b, i + 4, Math.floor(v / 0x100000000) >>> 0);
}

/** Offset of the classic EOCD record, or -1 when it cannot be found. */
function findEocd(bytes: Uint8Array): number {
  const earliest = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  for (let i = bytes.length - EOCD_SIZE; i >= earliest; i--) {
    if (u32(bytes, i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * Walks the central directory and returns the number of records actually present.
 *
 * Returns -1 if the walk does not land exactly on `end`, i.e. the directory is malformed or
 * not laid out the way we assume. Callers treat that as "do not touch this archive" — a
 * repair driven by a misread structure would be far worse than the truncation it fixes.
 *
 * The walk is on attacker-supplied bytes, so it is bounded twice over: each step advances at
 * least CENTRAL_FILE_HEADER_SIZE, and the cursor is checked against `end` every iteration.
 */
function countCentralDirectoryRecords(bytes: Uint8Array, start: number, end: number): number {
  if (start < 0 || start >= end || end > bytes.length) return -1;
  let offset = start;
  let count = 0;
  while (offset < end) {
    if (offset + CENTRAL_FILE_HEADER_SIZE > end) return -1;
    if (u32(bytes, offset) !== CENTRAL_FILE_HEADER_SIGNATURE) return -1;
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    offset += CENTRAL_FILE_HEADER_SIZE + nameLength + extraLength + commentLength;
    count++;
  }
  // A well-formed directory ends exactly where the EOCD (or the ZIP64 records) begin.
  return offset === end ? count : -1;
}

export interface Zip64RepairResult {
  /** The archive, rewritten only when a repair was required. */
  bytes: Uint8Array;
  /** True when ZIP64 records were added because the 16-bit count had wrapped. */
  repaired: boolean;
  /**
   * Entry count the archive will now read back as, or null when it could not be determined
   * (unrecognizable structure — the bytes are returned untouched).
   */
  entryCount: number | null;
}

/**
 * Adds ZIP64 end-of-central-directory records to an archive whose 16-bit entry count has
 * wrapped, so every entry is visible to readers again.
 *
 * A no-op — returning the original bytes — when the archive already carries a ZIP64 locator,
 * when the declared count matches the records actually present, or when the structure is not
 * what we expect. Only the trailing records are rewritten; entry data is never touched.
 */
export function ensureZip64Eocd(bytes: Uint8Array): Zip64RepairResult {
  const eocd = findEocd(bytes);
  if (eocd < 0) return { bytes, repaired: false, entryCount: null };

  // Already ZIP64: nothing to do, and nothing we should second-guess.
  if (
    eocd >= ZIP64_LOCATOR_SIZE &&
    u32(bytes, eocd - ZIP64_LOCATOR_SIZE) === ZIP64_LOCATOR_SIGNATURE
  ) {
    return { bytes, repaired: false, entryCount: null };
  }

  // Both count fields matter. fflate reads and gates on "entries on this disk" (+8), not the
  // "total entries" field (+10) — a zero at +8 makes it return an empty archive outright — so
  // the repair must agree with the field the reader actually uses. Writers set them equal; a
  // file where they disagree is not one we understand well enough to rewrite.
  const declaredDiskCount = u16(bytes, eocd + 8);
  const declaredCount = u16(bytes, eocd + 10);
  if (declaredDiskCount !== declaredCount) return { bytes, repaired: false, entryCount: null };

  const centralDirectorySize = u32(bytes, eocd + 12);
  const centralDirectoryOffset = u32(bytes, eocd + 16);

  const actualCount = countCentralDirectoryRecords(bytes, centralDirectoryOffset, eocd);
  if (actualCount < 0) return { bytes, repaired: false, entryCount: null };
  if (actualCount === declaredCount) {
    return { bytes, repaired: false, entryCount: actualCount };
  }
  // The directory must occupy exactly the span the EOCD claims. Copying an unvalidated size
  // into the ZIP64 record would propagate a corrupt archive's own lie into a record that
  // otherwise looks authoritative.
  if (centralDirectorySize !== eocd - centralDirectoryOffset) {
    return { bytes, repaired: false, entryCount: null };
  }

  // The only mismatch we understand is the 16-bit wrap. Anything else means our reading of
  // the archive is wrong, so leave it alone rather than rewriting on a bad premise.
  if (actualCount % 0x10000 !== declaredCount) {
    return { bytes, repaired: false, entryCount: null };
  }

  const out = new Uint8Array(eocd + ZIP64_EOCD_SIZE + ZIP64_LOCATOR_SIZE + EOCD_SIZE);
  // Everything up to the old EOCD — entries and the (already correct) central directory.
  out.set(bytes.subarray(0, eocd), 0);

  // ZIP64 end of central directory record.
  const z64 = eocd;
  writeU32(out, z64, ZIP64_EOCD_SIGNATURE);
  writeU64(out, z64 + 4, ZIP64_EOCD_SIZE - 12); // size of this record, excluding the first 12 bytes
  writeU16(out, z64 + 12, 45); // version made by — 4.5, the version that introduced ZIP64
  writeU16(out, z64 + 14, 45); // version needed to extract
  writeU32(out, z64 + 16, 0); // this disk
  writeU32(out, z64 + 20, 0); // disk holding the start of the central directory
  writeU64(out, z64 + 24, actualCount); // entries on this disk
  writeU64(out, z64 + 32, actualCount); // total entries
  writeU64(out, z64 + 40, centralDirectorySize);
  writeU64(out, z64 + 48, centralDirectoryOffset);

  // ZIP64 end of central directory locator.
  const loc = z64 + ZIP64_EOCD_SIZE;
  writeU32(out, loc, ZIP64_LOCATOR_SIGNATURE);
  writeU32(out, loc + 4, 0); // disk holding the ZIP64 EOCD
  writeU64(out, loc + 8, z64); // its offset
  writeU32(out, loc + 16, 1); // total number of disks

  // Classic EOCD, kept for readers that never look for ZIP64. Its count fields carry the
  // 0xFFFF sentinel; size and offset stay real, since they fit in 32 bits and a real value
  // is more compatible than a sentinel.
  const end = loc + ZIP64_LOCATOR_SIZE;
  writeU32(out, end, EOCD_SIGNATURE);
  writeU16(out, end + 4, 0); // this disk
  writeU16(out, end + 6, 0); // disk with the start of the central directory
  writeU16(out, end + 8, COUNT_NEEDS_ZIP64);
  writeU16(out, end + 10, COUNT_NEEDS_ZIP64);
  writeU32(out, end + 12, centralDirectorySize);
  writeU32(out, end + 16, centralDirectoryOffset);
  writeU16(out, end + 20, 0); // comment length — the original comment, if any, is dropped

  return { bytes: out, repaired: true, entryCount: actualCount };
}
