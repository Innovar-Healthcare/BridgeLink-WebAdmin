/**
 * Render a connector-message map value the way the Java Swing client does.
 *
 * Port of BridgeLink server's StringUtil.valueOf: maps render as {k=v}, arrays/lists as
 * [a, b], recursively; everything else via String(). The message browser's Mappings tab
 * uses this so values like HTTP response headers display as
 *   {content-length=[0], content-type=[application/json;charset=utf-8]}
 * instead of JSON..
 */
export function formatMapValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (Array.isArray(val)) return "[" + val.map(formatMapValue).join(", ") + "]";
  if (typeof val === "object") {
    return (
      "{" +
      Object.entries(val as Record<string, unknown>)
        .map(([k, v]) => `${k}=${formatMapValue(v)}`)
        .join(", ") +
      "}"
    );
  }
  return String(val);
}
