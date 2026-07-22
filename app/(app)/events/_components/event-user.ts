/**
 * Format the "User" column as Java's EventBrowser does (EventBrowser.java:634-640):
 * lead with the numeric id, then append the resolved name in parens when known —
 * `1 (admin)`, `0 (System)`, or a bare `5` for an id with no matching user.
 *
 * userId=0 is BridgeLink's synthetic "System" actor — it is not returned by
 * GET /users, so it is hard-coded here (Java seeds its user map with 0 → "System").
 */
export function formatEventUser(
  userId: number | null | undefined,
  userMap: Map<number, string>
): string {
  if (userId == null) return "—";
  const name = userId === 0 ? "System" : userMap.get(userId);
  return name != null ? `${userId} (${name})` : String(userId);
}
