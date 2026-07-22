import { CronExpressionParser } from "cron-parser";
import {
  DEFAULT_ADVANCED_POLLING,
  type AdvancedPollingSettings,
  type CronJob,
  type PollConnectorState,
} from "@/app/(app)/channels/_lib/channel-xml";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Computes the next time a polling connector will fire, taking into account
 * polling type (INTERVAL, TIME, CRON) and any advanced day-of-week / time-window
 * restrictions. Mirrors Java's `PollConnectorJobHandler.getNextFireTime()`.
 *
 * Returns `null` when:
 *   - polling settings are invalid (e.g. INTERVAL with frequency ≤ 0, no cron jobs)
 *   - restrictions are unsatisfiable within the search horizon (e.g. all days
 *     inactive, or TIME mode at HH:MM that falls outside the active window)
 *   - cron expressions cannot be parsed
 */
export function computeNextFireTime(
  state: PollConnectorState,
  now: Date = new Date()
): Date | null {
  switch (state.pollingType) {
    case "INTERVAL":
      return computeIntervalNext(state, now);
    case "TIME":
      return computeTimeNext(state, now);
    case "CRON":
      return computeCronNext(state, now);
  }
}

/**
 * Formats a next-fire-time `Date` for display. Mirrors Java's
 * `"EEEE, MMM d, h:mm:ss a"` pattern (e.g. "Tuesday, May 5, 2:30:00 PM").
 * Returns "—" for null.
 */
export function formatNextFireTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/**
 * Returns a compact one-line summary of advanced polling restrictions, or
 * `null` when settings match `DEFAULT_ADVANCED_POLLING` (no restriction).
 *
 * Examples: `"Mon–Fri"`, `"Sat–Sun • 08:00–17:00"`, `"Day 15 • 09:00–18:00"`.
 */
export function summarizeAdvancedPolling(adv: AdvancedPollingSettings): string | null {
  if (isDefaultAdvanced(adv)) return null;

  const parts: string[] = [];

  if (adv.weekly) {
    const activeDays: number[] = [];
    for (let i = 0; i < 7; i++) {
      if (!adv.inactiveDays[i]) activeDays.push(i);
    }
    if (activeDays.length < 7) {
      parts.push(formatDayList(activeDays));
    }
  } else {
    parts.push(`Day ${adv.dayOfMonth}`);
  }

  if (!adv.allDay) {
    parts.push(
      `${pad2(adv.startingHour)}:${pad2(adv.startingMinute)}–${pad2(adv.endingHour)}:${pad2(adv.endingMinute)}`
    );
  }

  return parts.length > 0 ? parts.join(" • ") : null;
}

// ─── Per-polling-type computation ────────────────────────────────────────────

const MAX_DAY_ITERATIONS = 366; // covers a full leap year for monthly safety
const MAX_CRON_ITERATIONS = 100;

function computeIntervalNext(state: PollConnectorState, now: Date): Date | null {
  if (state.pollingFrequency <= 0) return null;
  const candidate = new Date(now.getTime() + state.pollingFrequency);
  return snapToActiveWindow(candidate, state.advanced);
}

function computeTimeNext(state: PollConnectorState, now: Date): Date | null {
  const adv = state.advanced;
  // If the daily fire time falls outside the window, polling never fires.
  if (!adv.allDay) {
    const fireMins = state.pollingHour * 60 + state.pollingMinute;
    const startMins = adv.startingHour * 60 + adv.startingMinute;
    const endMins = adv.endingHour * 60 + adv.endingMinute;
    if (fireMins < startMins || fireMins > endMins) return null;
  }
  // Today at HH:MM, or tomorrow if already past.
  let candidate = withTimeOfDay(now, state.pollingHour, state.pollingMinute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate = withTimeOfDay(addDays(now, 1), state.pollingHour, state.pollingMinute, 0, 0);
  }
  for (let i = 0; i <= MAX_DAY_ITERATIONS; i++) {
    if (isDayActive(candidate, adv)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return null;
}

function computeCronNext(state: PollConnectorState, now: Date): Date | null {
  if (state.cronJobs.length === 0) return null;

  let current = cronNextFromAll(state.cronJobs, now);
  if (!current) return null;

  for (let i = 0; i < MAX_CRON_ITERATIONS; i++) {
    if (passesRestrictions(current, state.advanced)) return current;
    const snapTarget = nextWindowOrDayBoundary(current, state.advanced);
    if (!snapTarget) return null;
    const next = cronNextFromAll(state.cronJobs, snapTarget);
    if (!next || next.getTime() <= current.getTime()) return null;
    current = next;
  }
  return null;
}

// ─── Restriction predicates ──────────────────────────────────────────────────

function isDayActive(d: Date, adv: AdvancedPollingSettings): boolean {
  if (adv.weekly) {
    // Date.getDay() returns 0=Sun…6=Sat, matching the inactiveDays indexing.
    return !adv.inactiveDays[d.getDay()];
  }
  return d.getDate() === adv.dayOfMonth;
}

function passesRestrictions(d: Date, adv: AdvancedPollingSettings): boolean {
  if (!isDayActive(d, adv)) return false;
  if (adv.allDay) return true;
  const cMins = d.getHours() * 60 + d.getMinutes();
  const startMins = adv.startingHour * 60 + adv.startingMinute;
  const endMins = adv.endingHour * 60 + adv.endingMinute;
  // Inclusive both ends, mirroring Quartz DailyCalendar default.
  return cMins >= startMins && cMins <= endMins;
}

// ─── Snap-forward helpers ────────────────────────────────────────────────────

/** Snaps a candidate forward to the next time that satisfies all restrictions. */
function snapToActiveWindow(candidate: Date, adv: AdvancedPollingSettings): Date | null {
  let cur = candidate;
  for (let i = 0; i <= MAX_DAY_ITERATIONS; i++) {
    if (isDayActive(cur, adv)) {
      if (adv.allDay) return cur;
      const cMins = cur.getHours() * 60 + cur.getMinutes();
      const startMins = adv.startingHour * 60 + adv.startingMinute;
      const endMins = adv.endingHour * 60 + adv.endingMinute;
      if (cMins >= startMins && cMins <= endMins) return cur;
      if (cMins < startMins) {
        cur = withTimeOfDay(cur, adv.startingHour, adv.startingMinute, 0, 0);
      } else {
        // Past the window — advance to tomorrow at the window start, then re-check day.
        cur = withTimeOfDay(addDays(cur, 1), adv.startingHour, adv.startingMinute, 0, 0);
      }
    } else {
      cur = withTimeOfDay(addDays(cur, 1), 0, 0, 0, 0);
    }
  }
  return null;
}

/**
 * Returns the earliest moment after (or at) `d` when restrictions might be
 * satisfied. Used by CRON to advance past disallowed periods before re-querying.
 */
function nextWindowOrDayBoundary(d: Date, adv: AdvancedPollingSettings): Date | null {
  if (!isDayActive(d, adv)) {
    let cur = withTimeOfDay(addDays(d, 1), 0, 0, 0, 0);
    for (let i = 0; i < MAX_DAY_ITERATIONS; i++) {
      if (isDayActive(cur, adv)) return cur;
      cur = addDays(cur, 1);
    }
    return null;
  }
  if (adv.allDay) return d;
  const cMins = d.getHours() * 60 + d.getMinutes();
  const startMins = adv.startingHour * 60 + adv.startingMinute;
  if (cMins < startMins) {
    return withTimeOfDay(d, adv.startingHour, adv.startingMinute, 0, 0);
  }
  // Past the window end — advance to next active day at window start.
  let cur = withTimeOfDay(addDays(d, 1), adv.startingHour, adv.startingMinute, 0, 0);
  for (let i = 0; i < MAX_DAY_ITERATIONS; i++) {
    if (isDayActive(cur, adv)) return cur;
    cur = addDays(cur, 1);
  }
  return null;
}

// ─── Cron helpers ────────────────────────────────────────────────────────────

function cronNextFromAll(jobs: CronJob[], after: Date): Date | null {
  let earliest: Date | null = null;
  for (const job of jobs) {
    const expr = job.expression?.trim();
    if (!expr) continue;
    const next = cronNext(expr, after);
    if (next && (earliest === null || next.getTime() < earliest.getTime())) {
      earliest = next;
    }
  }
  return earliest;
}

function cronNext(expression: string, after: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(expression, { currentDate: after });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

// ─── Date utilities (local time, DST-safe) ───────────────────────────────────

function withTimeOfDay(d: Date, h: number, m: number, s: number, ms: number): Date {
  const c = new Date(d);
  c.setHours(h, m, s, ms);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

// ─── Summary formatting helpers ──────────────────────────────────────────────

function isDefaultAdvanced(adv: AdvancedPollingSettings): boolean {
  const d = DEFAULT_ADVANCED_POLLING;
  if (
    adv.weekly !== d.weekly ||
    adv.dayOfMonth !== d.dayOfMonth ||
    adv.allDay !== d.allDay ||
    adv.startingHour !== d.startingHour ||
    adv.startingMinute !== d.startingMinute ||
    adv.endingHour !== d.endingHour ||
    adv.endingMinute !== d.endingMinute
  ) {
    return false;
  }
  for (let i = 0; i < 7; i++) {
    if ((adv.inactiveDays[i] ?? false) !== (d.inactiveDays[i] ?? false)) return false;
  }
  return true;
}

function formatDayList(activeDays: number[]): string {
  // Common shortcut: Mon–Fri
  if (
    activeDays.length === 5 &&
    activeDays[0] === 1 &&
    activeDays[4] === 5 &&
    activeDays.every((d, i) => d === i + 1)
  ) {
    return "Mon–Fri";
  }
  // Sat–Sun (weekend)
  if (activeDays.length === 2 && activeDays.includes(0) && activeDays.includes(6)) {
    return "Sat–Sun";
  }
  const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return activeDays.map((i) => SHORT[i]).join(", ");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
