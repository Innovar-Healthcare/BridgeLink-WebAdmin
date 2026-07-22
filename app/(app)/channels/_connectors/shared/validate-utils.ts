/**
 * Shared helpers for connector validation functions.
 *
 * Each connector's `validate(propertiesXml)` parses the XML and checks
 * required fields, returning an array of ValidationError objects (empty = valid).
 */

import { isValidCronExpression } from "@/lib/cron-utils";
import { parsePollConnectorFromPropertiesXml } from "../../_lib/channel-xml";

/** A single field-level validation error with the XML field name and human-readable message. */
export interface ValidationError {
  /** XML element name that failed validation (e.g. "url", "host", "driver"). */
  field: string;
  /** Human-readable error message (e.g. "URL is required."). */
  message: string;
}

/** Maximum polling interval in milliseconds (exclusive): must be < 24 hours. */
const MAX_POLLING_FREQUENCY_MS = 86_400_000;

/**
 * Validates the polling settings shared by every polling source connector
 * (File Reader, JavaScript Reader, Database Reader, …). Mirrors Java
 * `PollingSettingsPanel.checkProperties`:
 *
 * - INTERVAL: polling frequency must be `> 0` and `< 86_400_000` ms (under 24h).
 * - CRON: at least one cron job is required, and every expression must be valid.
 *
 * Returns an empty array when the polling configuration is valid.
 */
export function validatePolling(propertiesXml: string | null): ValidationError[] {
  if (!propertiesXml) return [];
  const errors: ValidationError[] = [];
  const poll = parsePollConnectorFromPropertiesXml(propertiesXml);

  if (poll.pollingType === "INTERVAL") {
    const freq = poll.pollingFrequency;
    if (!(freq > 0 && freq < MAX_POLLING_FREQUENCY_MS)) {
      errors.push({
        field: "pollingFrequency",
        message: "Polling frequency must be greater than 0 and less than 24 hours.",
      });
    }
  } else if (poll.pollingType === "CRON") {
    if (poll.cronJobs.length === 0) {
      errors.push({ field: "cronJobs", message: "At least one cron job is required." });
    } else {
      for (const job of poll.cronJobs) {
        const expr = job.expression?.trim() ?? "";
        if (!expr || !isValidCronExpression(expr)) {
          errors.push({
            field: "cronJobs",
            message: expr
              ? `Invalid cron expression: "${expr}".`
              : "Cron expression cannot be blank.",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validates the shared Local Address (host) / Local Port fields common to every
 * socket-listener source connector (TCP, HTTP, Web Service, DICOM). Mirrors Java
 * `ListenerSettingsPanel.checkProperties` (empty host OR empty port → invalid),
 * which `ConnectorPanel.checkProperties` runs for any connector whose properties
 * implement `ListenerConnectorPropertiesInterface`.
 *
 * Keyed on the presence of a `<listenerConnectorProperties>` element, so it is a
 * no-op for connectors without a listening socket (e.g. JMS Listener, which uses a
 * connection factory, and all polling connectors) — matching Java's `instanceof` gate.
 *
 * Note: the stock Java client has an upstream bug in `ConnectorPanel.checkProperties`
 * (the listener validity boolean is overwritten by the source-settings check on the
 * next line), so Swing highlights an empty host/port red but does NOT block save.
 * We enforce the intended check — the invalid listener is blocked, not just flagged.
 *
 * We trim before the emptiness test (whitespace-only counts as empty); Java tests
 * raw `length() == 0`. This is intentionally stricter and matches the other WebUI
 * connector validators.
 *
 * Returns an empty array when host and port are both non-empty.
 */
export function validateListenerSettings(propertiesXml: string | null): ValidationError[] {
  const doc = parsePropsXml(propertiesXml);
  if (!doc) return [];
  const listener = doc.querySelector("listenerConnectorProperties");
  if (!listener) return [];
  const errors: ValidationError[] = [];
  const host = listener.querySelector("host")?.textContent?.trim() ?? "";
  const port = listener.querySelector("port")?.textContent?.trim() ?? "";
  if (!host) errors.push({ field: "host", message: "Local Address is required." });
  if (!port) errors.push({ field: "port", message: "Local Port is required." });
  return errors;
}

/** Parse propertiesXml to a Document. Returns null if xml is null/empty. */
export function parsePropsXml(xml: string | null): Document | null {
  if (!xml) return null;
  return new DOMParser().parseFromString(xml, "application/xml");
}

/** Read the trimmed text content of an element by tag name. Returns "" if not found. */
export function xmlText(doc: Document, tag: string): string {
  return doc.querySelector(tag)?.textContent?.trim() ?? "";
}
