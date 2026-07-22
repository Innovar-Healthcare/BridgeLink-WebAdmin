/**
 * Summary-tab validation helpers — faithful mirror of the Java Swing client
 * (`com.mirth.connect.client.ui.ChannelSetup`).
 *
 * Shared between the Summary tab UI (live red-border / warning feedback) and
 * `use-channel-editor.ts` `doSave()` (save-time blocking). Keeping the rules in
 * one place guarantees the two paths can never drift apart.
 */

/**
 * Reserved custom-metadata column names. These collide with BridgeLink's built-in
 * message/metadata id columns and are rejected (case-insensitively) by the Java
 * client (`ChannelSetup.java:1189-1209`).
 */
export const RESERVED_METADATA_COLUMN_NAMES = ["MESSAGE_ID", "METADATA_ID"] as const;

/**
 * Allowed characters for a custom-metadata column name — letters, digits, underscore.
 * Mirrors the Java `MirthFieldConstraints("^[a-zA-Z_0-9]*$")` (`ChannelSetup.java:2171`).
 */
export const METADATA_COLUMN_NAME_RE = /^[a-zA-Z_0-9]*$/;

/** Maximum custom-metadata column name length (Java `constraints.setLimit(30)`). */
export const METADATA_COLUMN_NAME_MAXLEN = 30;

/**
 * Validate a single custom-metadata column name against the Java client's rules.
 * Returns a Java-parity error message, or `null` when the name is acceptable.
 *
 * The name is expected to already be trimmed by the caller; an empty name is
 * rejected (the Java client blocks empty column names at save).
 */
export function validateMetaDataColumnName(name: string): string | null {
  const trimmed = name.trim();

  if (trimmed === "") {
    return "Empty column name detected in custom metadata table. Column names cannot be empty.";
  }

  if (RESERVED_METADATA_COLUMN_NAMES.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
    return `${trimmed} is a reserved keyword and cannot be used as a column name in the custom metadata table.`;
  }

  if (!METADATA_COLUMN_NAME_RE.test(trimmed)) {
    return `"${trimmed}" is not a valid column name. Use only letters, numbers, and underscores.`;
  }

  if (trimmed.length > METADATA_COLUMN_NAME_MAXLEN) {
    return `Column name "${trimmed}" exceeds the ${METADATA_COLUMN_NAME_MAXLEN}-character limit.`;
  }

  return null;
}

/** True when `name` (case-insensitive) is one of the reserved built-in column names. */
export function isReservedMetaDataColumnName(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  return RESERVED_METADATA_COLUMN_NAMES.some((r) => r.toLowerCase() === trimmed);
}

/**
 * Validate the pruning settings relationship. The age of content to prune cannot
 * be greater than the age of metadata to prune (`ChannelSetup.java:1167-1175`).
 * Returns the Java error message, or `null` when valid (including when either
 * value is unset).
 */
export function validatePruning(
  metaDays: number | null,
  contentDays: number | null
): string | null {
  if (metaDays !== null && contentDays !== null && contentDays > metaDays) {
    return "The age of content to prune cannot be greater than the age of metadata to prune.";
  }
  return null;
}

/**
 * Sanitize a pruning day-field keystroke to digits only, max 3 characters — mirrors
 * Java's `MirthFieldConstraints(3, false, false, true)` on the pruning day fields
 * (`ChannelSetup.java:2070,2098`): digits-only, at most 3 chars (0–999). Rejects
 * negatives, decimals, and 4+ digit values by construction.
 */
export function sanitizeDayInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 3);
}

/** Minimal shape of a custom-metadata column needed for save-time validation. */
export interface MetaDataColumnLike {
  name: string;
  type: string;
}

/**
 * Validate the full custom-metadata column list at save time — a faithful port of
 * the Java client's checks (`ChannelSetup.java:1189-1209`), applied to the RAW list
 * (empty rows are rejected, NOT silently filtered — matching Java, which blocks the
 * save on a blank column name). Returns the first Java-parity error message, or
 * `null` when every column is acceptable.
 */
export function validateMetaDataColumns(columns: readonly MetaDataColumnLike[]): string | null {
  const seen = new Set<string>();
  for (const col of columns) {
    const colError = validateMetaDataColumnName(col.name);
    if (colError) return colError;
    const key = col.name.trim();
    if (seen.has(key)) {
      return `Duplicate metadata column name: "${key}". All column names must be unique.`;
    }
    seen.add(key);
  }
  return null;
}

/**
 * Detect a custom-metadata schema change that would delete existing column data on
 * deploy — a rename, delete, or type change of an already-saved column. Mirrors
 * `ChannelSetup.java:1179-1216`: build a map of the SAVED columns keyed by name→type,
 * remove each entry whose name AND type are still present unchanged in the outgoing
 * set, and report data loss if any saved column remains (it was renamed away, deleted,
 * or had its type changed). Adding brand-new columns or reordering is NOT data loss.
 */
export function findMetaDataColumnDataLoss(
  saved: readonly MetaDataColumnLike[],
  next: readonly MetaDataColumnLike[]
): boolean {
  const savedByName = new Map<string, string>();
  for (const col of saved) {
    const name = col.name.trim();
    if (name) savedByName.set(name, col.type);
  }
  for (const col of next) {
    const name = col.name.trim();
    if (savedByName.get(name) === col.type) savedByName.delete(name);
  }
  return savedByName.size > 0;
}

/**
 * True when `name` collides (case-insensitively) with an existing channel name,
 * excluding the channel being edited. Mirrors `Frame.checkChannelName:4941-4946`
 * (`equalsIgnoreCase`, self excluded by id).
 */
export function channelNameCollides(
  name: string,
  selfId: string | undefined,
  entries: Iterable<[string, string]>
): boolean {
  const target = name.toLowerCase();
  for (const [otherId, otherName] of entries) {
    if (otherId === selfId) continue;
    if (otherName.toLowerCase() === target) return true;
  }
  return false;
}
