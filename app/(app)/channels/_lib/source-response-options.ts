/**
 * source-response-options.ts
 *
 * Builds the Source connector "Response" dropdown options, mirroring Java
 * `SourceSettingsPanel.updateResponseDropDown()`.
 *
 * Key parity rules:
 * - Built-in auto responses come first (QUEUE_ON when source queue is ON, the
 *   fuller QUEUE_OFF set when OFF). See `SourceConnectorProperties`.
 * - Destination entries persist the `d<metaDataId>` KEY but DISPLAY the connector
 *   name (Java stores a SimpleEntry whose toString() returns the name).
 * - Harvested response-map variables (from filters/transformers/response
 *   transformers + pre/post scripts) are added as plain key=label options.
 * - Any saved value not otherwise present stays selectable (so Java-authored
 *   channels and stale references round-trip instead of showing a blank select).
 */

/** Response options when Source Queue is ON (queue messages, immediate response). */
export const QUEUE_ON_RESPONSES = ["None", "Auto-generate (Before processing)"] as const;

/** Response options when Source Queue is OFF (respond after processing). */
export const QUEUE_OFF_RESPONSES = [
  "None",
  "Auto-generate (Before processing)",
  "Auto-generate (After source transformer)",
  "Auto-generate (Destinations completed)",
  "Postprocessor",
] as const;

export interface ResponseOption {
  /** Persisted value (built-in string, `d<metaDataId>`, or harvested var name). */
  value: string;
  /** Display label (connector name for destination entries). */
  label: string;
}

export interface DestinationRef {
  metaDataId: number;
  name: string;
}

/**
 * Build the ordered, de-duplicated Response option list.
 *
 * @param respondAfterProcessing  true = source queue OFF (full list), false = ON
 * @param destinations            destination connectors (metaDataId + name)
 * @param harvestedVars           response-map variable names harvested from the channel
 * @param savedValue              currently-persisted responseVariable (preserved if unknown)
 */
export function buildResponseOptions(
  respondAfterProcessing: boolean,
  destinations: DestinationRef[],
  harvestedVars: string[],
  savedValue: string | null | undefined
): ResponseOption[] {
  const options: ResponseOption[] = [];
  const seen = new Set<string>();
  const add = (value: string, label: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    options.push({ value, label });
  };

  if (respondAfterProcessing) {
    // Source queue OFF — full built-in set + destinations + harvested vars.
    for (const opt of QUEUE_OFF_RESPONSES) add(opt, opt);
    for (const d of destinations) add(`d${d.metaDataId}`, d.name);
    for (const v of [...harvestedVars].sort((a, b) => a.localeCompare(b))) add(v, v);
  } else {
    // Source queue ON — only the immediate-response built-ins are valid.
    for (const opt of QUEUE_ON_RESPONSES) add(opt, opt);
  }

  // Preserve an unknown saved value so the select never renders blank.
  if (savedValue && !seen.has(savedValue)) {
    const dest = destinations.find((d) => `d${d.metaDataId}` === savedValue);
    add(savedValue, dest ? dest.name : savedValue);
  }

  return options;
}
