/**
 * Session-scoped, write-through cache of server `_validateCron` verdicts.
 *
 * The cron save-gate validators (`validatePolling`, `validatePruner`) are synchronous
 * functions on the connector `validate()` contract; making them async to call
 * `_validateCron` directly would ripple through that contract (deferred in.
 * Instead, `CronJobsTable` — the only place that calls `_validateCron` (per-row,
 * debounced, — writes each verdict it receives into this module-singleton
 * map, keyed by trimmed expression. The save-gate validators then do a synchronous read
 * here first, falling back to the client `isValidCronExpression` approximation on a
 * miss (an expression no table has gotten a verdict for yet this session, still
 * debouncing, or the server is unreachable / the version gate is off).
 *
 * Best-effort, not authoritative: a miss falls back exactly as it did before.
 * Reset on login/logout/401 like the other server-derived caches — a different Core
 * could validate the same expression string differently.
 *
 * Runtime import surface is deliberately just `registerCacheTeardown` (documented as
 * safe from any reachable path, including server-side); the `CronValidationResult`
 * import is type-only and erased at compile time, so this module is safe to import from
 * `validate-utils.ts`, which the plugin barrel's connector definitions can reach.
 */

import { registerCacheTeardown } from "@/lib/logout";
import type { CronValidationResult } from "@/lib/api/api-cron";

let cache = new Map<string, CronValidationResult>();

/** Synchronous read. Returns `null` on a miss — callers fall back to the client check. */
export function getCachedCronVerdict(expression: string): CronValidationResult | null {
  return cache.get(expression.trim()) ?? null;
}

/** Record a verdict `CronJobsTable` received from `_validateCron`. */
export function setCachedCronVerdict(expression: string, verdict: CronValidationResult): void {
  cache.set(expression.trim(), verdict);
}

/** Drop all cached verdicts. Registered as a cache teardown (login/logout/401). */
export function resetCronVerdictCache(): void {
  cache = new Map();
}

registerCacheTeardown(resetCronVerdictCache);
