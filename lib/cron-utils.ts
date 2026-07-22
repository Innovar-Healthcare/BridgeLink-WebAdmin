/**
 * Quartz cron helpers shared by the channel polling connectors and the
 * Data Pruner schedule settings.
 *
 * Quartz format: seconds minutes hours day-of-month month day-of-week [year]
 */

import { CronExpressionParser } from "cron-parser";

/**
 * Generate a human-readable description for the most common Quartz cron
 * expressions. Returns "" for anything unrecognised.
 */
export function describeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 6) return "";
  const [sec, min, hr, dom, mon] = parts;

  // */N * * * * ? → every N seconds
  const evSec = sec.match(/^\*\/(\d+)$/);
  if (evSec && min === "*" && hr === "*" && dom === "*" && mon === "*") {
    const n = parseInt(evSec[1], 10);
    return `Run every ${n} second${n === 1 ? "" : "s"}.`;
  }

  // 0 */N * * * ? → every N minutes
  const evMin = min.match(/^\*\/(\d+)$/);
  if (sec === "0" && evMin && hr === "*" && dom === "*" && mon === "*") {
    const n = parseInt(evMin[1], 10);
    return `Run every ${n} minute${n === 1 ? "" : "s"}.`;
  }

  // 0 0 */N * * ? → every N hours
  const evHr = hr.match(/^\*\/(\d+)$/);
  if (sec === "0" && min === "0" && evHr && dom === "*" && mon === "*") {
    const n = parseInt(evHr[1], 10);
    return `Run every ${n} hour${n === 1 ? "" : "s"}.`;
  }

  // 0 M H * * ? → daily at H:MM
  const hrNum = parseInt(hr, 10);
  const minNum = parseInt(min, 10);
  if (
    sec === "0" &&
    !isNaN(hrNum) &&
    !isNaN(minNum) &&
    String(hrNum) === hr &&
    String(minNum) === min &&
    dom === "*" &&
    mon === "*"
  ) {
    const hh = String(hrNum).padStart(2, "0");
    const mm = String(minNum).padStart(2, "0");
    return `Run daily at ${hh}:${mm}.`;
  }

  return "";
}

/**
 * Validate a Quartz cron expression with the same strictness as the Java client
 * (`PollConnectorJobHandler.validateExpression` → `CronExpression.isValidExpression`).
 *
 * Parity notes vs. the raw `cron-parser`:
 *  - Quartz requires the seconds field, so a valid expression has **6 or 7** fields.
 *    `cron-parser` would otherwise accept 5-field Unix cron — rejected here.
 *  - Quartz allows an optional 7th "year" field, but `cron-parser` rejects 7 fields,
 *    so the year token is validated separately and stripped before parsing.
 *  - A blank expression is invalid (Java treats blank as invalid).
 *
 * Known divergence: the Quartz `?` day-of-month/day-of-week mutual-exclusion rule
 * is not enforced (`cron-parser` treats `?` as `*`). This still rejects every
 * malformed expression; it only misses a rare Quartz strictness case.
 *
 * Quartz `W` / `LW` day-of-month tokens (`1W`, `15W`, `LW` = nearest weekday) are
 * accepted by Quartz but rejected by `cron-parser`, so we validate the token shape
 * and substitute a parseable stand-in before parsing.
 */
export function isValidCronExpression(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;

  const fields = trimmed.split(/\s+/);
  if (fields.length < 6 || fields.length > 7) return false;

  const workFields = fields.slice(0, 6);
  if (fields.length === 7) {
    // Quartz year field: "*" or 4-digit years, optionally as ranges/lists/steps.
    if (!/^(\*|\d{4}([,\-/]\d{1,4})*)$/.test(fields[6])) return false;
  }

  // Day-of-month is field index 3 (sec min hour dom month dow). Quartz `W`/`LW`
  // are single-token only; cron-parser rejects them, so map to a parseable stand-in
  // (`LW`→`L`, `NW`→`N`). Quartz upper-cases the whole expression before parsing, so
  // the token is case-insensitive (`15w`/`lw` are valid). Malformed W tokens (`0W`,
  // `33W`) fall through and are rejected.
  const dom = workFields[3];
  if (/^(?:[1-9]|[12]\d|3[01])W$/i.test(dom)) {
    workFields[3] = dom.slice(0, -1);
  } else if (/^LW$/i.test(dom)) {
    workFields[3] = "L";
  }

  try {
    CronExpressionParser.parse(workFields.join(" "));
    return true;
  } catch {
    return false;
  }
}
