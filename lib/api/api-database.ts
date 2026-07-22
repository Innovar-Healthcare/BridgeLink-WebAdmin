/**
 * API database — JDBC driver configuration endpoints.
 * Mirrors Java's mirthClient.getDatabaseDrivers() and mirthClient.setDatabaseDrivers().
 */

import type { DriverInfo } from "../types";
import { request } from "./api-core";

/**
 * GET /server/databaseDrivers
 * Mirrors Java's mirthClient.getDatabaseDrivers().
 * Returns the server-registered list of JDBC driver configs.
 *
 * XStream serializes List<DriverInfo> as {"list": {"driverInfo": [...]}}.
 * normalizeXStream() unwraps the list; we post-process alternativeClassNames
 * because XStream collapses single-item List<String> to a scalar "string" field
 * which normalizeXStream doesn't automatically promote to string[].
 */
export async function getDatabaseDrivers(): Promise<DriverInfo[]> {
  const raw = await request<unknown>("/server/databaseDrivers");
  const items = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  return items.map(coerceDriverInfo);
}

/**
 * PUT /server/databaseDrivers
 * Mirrors Java's mirthClient.setDatabaseDrivers(drivers).
 * Sends the full list as a replacement (server does not support individual ops).
 * Requires DATABASE_DRIVERS_EDIT permission; throws on 403.
 */
export async function setDatabaseDrivers(drivers: DriverInfo[]): Promise<void> {
  await request<void>("/server/databaseDrivers", {
    method: "PUT",
    body: buildDriversBody(drivers),
  });
}

/**
 * Resolve a stored JDBC driver class name to its server-registered DriverInfo.
 * Matches the primary `className` first, then any `alternativeClassNames` entry —
 * mirrors Java DatabaseReader.updateDriverComboBoxFromField(), which maps a legacy
 * alternative class (e.g. `com.mysql.jdbc.Driver`) back to its driver (MySQL) rather
 * than treating it as a custom driver. Returns undefined when nothing matches.
 */
export function matchDriverByClassName(
  drivers: DriverInfo[],
  className: string
): DriverInfo | undefined {
  if (!className) return undefined;
  return drivers.find(
    (d) => d.className === className || d.alternativeClassNames.includes(className)
  );
}

// ─── XStream serialization helpers ───────────────────────────────────────────

/**
 * Coerce a raw (post-normalizeXStream) object into a typed DriverInfo.
 * Handles alternativeClassNames arriving as:
 *   - string[]            (normalizeXStream multi-item list)
 *   - {"string": "..."}   (single-item List<String> that normalizeXStream left as-is)
 *   - null/undefined      (empty list)
 */
function coerceDriverInfo(raw: unknown): DriverInfo {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    className: String(obj.className ?? ""),
    name: String(obj.name ?? ""),
    template: String(obj.template ?? ""),
    selectLimit: String(obj.selectLimit ?? ""),
    alternativeClassNames: coerceStringList(obj.alternativeClassNames),
  };
}

function coerceStringList(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return (val as unknown[]).map(String);
  if (typeof val === "string") return [val];
  if (typeof val === "object" && val !== null) {
    const inner = (val as Record<string, unknown>)["string"];
    if (Array.isArray(inner)) return (inner as unknown[]).map(String);
    if (inner != null) return [String(inner)];
  }
  return [];
}

/**
 * Build the XStream-compatible PUT body.
 * DriverInfo has @XStreamAlias("driverInfo") so the list key is "driverInfo".
 * Single-item lists must be sent as an object, not an array (XStream/Staxon convention).
 */
function buildDriversBody(drivers: DriverInfo[]): string {
  if (drivers.length === 0) {
    return JSON.stringify({ list: null });
  }
  const serialized = drivers.map(toXStreamDriverInfo);
  return JSON.stringify({
    list: { driverInfo: serialized.length === 1 ? serialized[0] : serialized },
  });
}

function toXStreamDriverInfo(d: DriverInfo): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    name: d.name,
    className: d.className,
    template: d.template,
    selectLimit: d.selectLimit,
  };
  if (d.alternativeClassNames.length > 0) {
    obj.alternativeClassNames = {
      string:
        d.alternativeClassNames.length === 1 ? d.alternativeClassNames[0] : d.alternativeClassNames,
    };
  }
  return obj;
}
