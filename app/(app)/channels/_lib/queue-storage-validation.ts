/**
 * queue-storage-validation.ts
 *
 * Mirrors Java `ChannelSetup.getQueueErrorString()` — the save-time guard that
 * blocks saving a channel when queueing is incompatible with the selected
 * message storage mode. `ChannelSetup.saveChanges()` aborts the save and alerts
 * with this message when it is non-null.
 *
 * Rules (matching the Java switch's fall-through):
 *   - METADATA / DISABLED: source queue must be off; destination queue must be off
 *   - RAW:                 destination queue must be off (source queue is allowed)
 *   - DEVELOPMENT / PRODUCTION: no restriction
 */

import type { MessageStorageMode } from "./channel-xml";

/** Uppercase the first character only (mirrors Apache StringUtils.capitalize). */
function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Returns the blocking error message when queueing is unsupported by the storage
 * mode, or `null` when the combination is valid.
 */
export function getQueueStorageError(
  messageStorageMode: MessageStorageMode,
  sourceQueueEnabled: boolean,
  destinationQueueEnabled: boolean
): string | null {
  const fragments: string[] = [];

  // Source queue is only restricted by METADATA / DISABLED (NOT RAW).
  if (
    (messageStorageMode === "METADATA" || messageStorageMode === "DISABLED") &&
    sourceQueueEnabled
  ) {
    fragments.push("source");
  }

  // Destination queue is restricted by RAW, METADATA, and DISABLED.
  if (
    (messageStorageMode === "METADATA" ||
      messageStorageMode === "DISABLED" ||
      messageStorageMode === "RAW") &&
    destinationQueueEnabled
  ) {
    fragments.push("destination");
  }

  if (fragments.length === 0) return null;

  return `${capitalize(fragments.join(" & "))} queueing must be disabled first before using the selected message storage mode.`;
}
