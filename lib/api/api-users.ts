/**
 * API users — user CRUD + password management.
 */

import type { User } from "../types";
import { PROXY_BASE, getServerUrl, request, throwForStatus } from "./api-core";

export async function getUsers(): Promise<User[]> {
  return request<User[]>("/users");
}

/**
 * POST /users
 * Creates a new user. Mirrors Java's mirthClient.createUser(user).
 * Password is NOT included in the user payload — set separately via updateUserPassword().
 * Sends XStream-wrapped body: {"user": {...}}.
 */
export async function createUser(user: Omit<User, "id" | "lastLogin">): Promise<void> {
  return request<void>("/users", {
    method: "POST",
    body: JSON.stringify({ user }),
  });
}

/**
 * PUT /users/{userId}
 * Updates an existing user. Mirrors Java's mirthClient.updateUser(user).
 * Password is NOT included — update separately via updateUserPassword() if needed.
 * `lastLogin` is excluded: it's a read-only Calendar on the server side; XStream cannot
 * deserialize an ISO timestamp string back to java.util.Calendar → 500.
 * `id` MUST be included in the body: the server's uniqueness check uses user.getId() from
 * the request body (not the URL path param) to exclude the current user from the check.
 * Without it, the server treats it as a create and rejects the existing username as duplicate.
 * Sends XStream-wrapped body: {"user": {...}}.
 */
export async function updateUser(
  userId: number,
  user: Omit<User, "lastLogin" | "gracePeriodStart" | "lastStrikeTime">
): Promise<void> {
  return request<void>(`/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ user }),
  });
}

/**
 * DELETE /users/{userId}
 * Removes a user. Mirrors Java's mirthClient.removeUser(userId).
 * Server prevents self-deletion (responds with error).
 */
export async function deleteUser(userId: number): Promise<void> {
  return request<void>(`/users/${userId}`, { method: "DELETE" });
}

/** Unwraps XStream `{"list":{"string": string | string[]}}` → `string[]`. */
function parseXStreamStringList(text: string): string[] {
  if (!text) return [];
  const raw = JSON.parse(text) as Record<string, unknown>;
  const list = raw?.list as Record<string, unknown> | undefined;
  const inner = list?.string;
  if (!inner) return [];
  return Array.isArray(inner) ? (inner as unknown[]).map(String) : [String(inner)];
}

/** Common headers for the plain-text password endpoints. */
function passwordHeaders(serverUrl: string | null): Record<string, string> {
  return {
    "Content-Type": "text/plain",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
  };
}

/**
 * POST /users/_checkPassword
 * Validates a plain-text password against the server's password policy WITHOUT updating it.
 * Mirrors Java's mirthClient.checkOrUpdateUserPassword(null, user, password) [check-only path].
 * Returns [] if valid; returns array of error strings if policy violations found.
 * Sends Content-Type: text/plain (not JSON).
 * Response: XStream list → {"list":{"string":[]}} or {"list":{"string":["err1",...]}}.
 * Note: NOT /users/password (→ 405 Method Not Allowed) — check-only endpoint is /_checkPassword.
 */
export async function checkUserPassword(plainPassword: string): Promise<string[]> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/users/_checkPassword`, {
    method: "POST",
    headers: passwordHeaders(serverUrl),
    credentials: "include",
    body: plainPassword,
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  return parseXStreamStringList(await res.text());
}

/**
 * PUT /users/{userId}/password
 * Validates AND updates a user's password.
 * Mirrors Java's mirthClient.checkOrUpdateUserPassword(userId, user, password).
 * Returns [] if valid/updated; returns array of error strings if policy violations.
 * Sends Content-Type: text/plain (not JSON).
 */
export async function updateUserPassword(userId: number, plainPassword: string): Promise<string[]> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${PROXY_BASE}/users/${userId}/password`, {
    method: "PUT",
    headers: passwordHeaders(serverUrl),
    credentials: "include",
    body: plainPassword,
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  return parseXStreamStringList(await res.text());
}
