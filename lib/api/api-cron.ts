/**
 * Server-side Quartz cron helpers.
 *
 * The WebUI has historically approximated Quartz semantics client-side with
 * `cron-parser` (`lib/cron-utils.ts` validation, `lib/poll-next-fire-time.ts`
 * next-fire computation). That approximation can diverge from the real Quartz parser on
 * edge cases — the bug class fixed by exposing two WebAdmin endpoints backed by
 * the server's actual Quartz machinery:
 *
 *   - `POST /server/_validateCron`         — validate a single expression
 *   - `POST /connectors/poll/_nextFireTime` — compute the next fire time for a poll config
 *
 * Both are gated by {@link MIN_SERVER_CRON}: callers use the server when the connected
 * Core is new enough and fall back to the client approximation otherwise, so older
 * servers keep working (the fallback is removed in a later cleanup release once
 * `MIN_SUPPORTED_SERVER_VERSION` clears the floor). See for the approach; this
 * mirrors the connector-defaults adoption.
 *
 * Both endpoints return plain JSON (a `RawContent` body, NOT the XStream envelope), so
 * these use `rawText` + `JSON.parse` to bypass `normalizeXStream` entirely. With
 * `rawText` the default `Accept` is XML/plain-first, matching JSON only via `*​/*`; both
 * endpoints declare `@Produces(application/json)`, so we set `Accept: application/json`
 * explicitly rather than relying on the q-fallback.
 *
 * These are WebAdmin-only endpoints — no `Client.java` wrapper); there is no
 * Java-client call to mirror, matching how/1662/1663 adopted their endpoints.
 */

import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";
import { request } from "./api-core";

/** Core release that first shipped `_validateCron` / `_nextFireTime`. */
export const MIN_SERVER_CRON = "26.9.0";

/** Structured result of `POST /server/_validateCron` (Core `CronValidationResult`). */
export interface CronValidationResult {
  valid: boolean;
  message: string | null;
}

/**
 * True when the connected Core is new enough to serve the cron endpoints. Missing or
 * unparseable server versions return `false` (via {@link isVersionAtLeast}), so callers
 * route to the client-side approximation rather than a doomed request.
 */
export function serverSupportsCronEndpoints(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_CRON);
}

/**
 * Validate a single Quartz cron expression with the server's real Quartz parser.
 *
 * Returns `{ valid, message }` — `message` carries Quartz's parse error when invalid.
 * Throws `ApiError` on transport/HTTP failure; callers should treat a throw (and any
 * gate-off) as "fall back to the client `isValidCronExpression`", never as a hard
 * failure.
 */
export async function validateCron(expression: string): Promise<CronValidationResult> {
  const raw = await request<string>("/server/_validateCron", {
    method: "POST",
    body: expression,
    headers: { "Content-Type": "text/plain", Accept: "application/json" },
    rawText: true,
  });
  return JSON.parse(raw) as CronValidationResult;
}

/**
 * Compute the next fire time for a polling configuration using the server's real Quartz
 * scheduler machinery (day/time restrictions included).
 *
 * @param pollConnectorPropertiesXml the `<pollConnectorProperties>` fragment, exactly as
 *   embedded in channel XML (extract it from the connector `<properties>` blob via DOM so
 *   the `version` attribute is preserved).
 * @returns the server-formatted display string (`"EEEE, MMM d, h:mm:ss a"`, e.g.
 *   `"Tuesday, May 5, 2:30:00 PM"`), formatted in the **server's** time zone. Empty
 *   string or `"Invalid Schedule."` signal no/invalid schedule.
 *
 * Throws `ApiError` on transport/HTTP failure (the server 400s on e.g. an all-days-
 * inactive weekly restriction or malformed XML); callers should treat a throw (and any
 * gate-off) as "fall back to the client `computeNextFireTime`".
 */
export async function nextFireTime(pollConnectorPropertiesXml: string): Promise<string> {
  const raw = await request<string>("/connectors/poll/_nextFireTime", {
    method: "POST",
    body: pollConnectorPropertiesXml,
    headers: { "Content-Type": "application/xml", Accept: "application/json" },
    rawText: true,
  });
  return (JSON.parse(raw) as { nextFireTime: string }).nextFireTime;
}
