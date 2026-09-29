/**
 * Poll-connector XML parsing — types, defaults, and the read path.
 *
 * <p>Extracted from `channel-xml.ts` for a module-boundary reason, not a tidiness one. This module is
 * a LEAF: it imports nothing but the DOM. `channel-xml.ts` value-imports `DATA_TYPE_REGISTRY`, which
 * eagerly pulls all eight client `.tsx` datatype modules — so anything reachable from a React Server
 * Component must not import `channel-xml.ts`, however indirectly.
 *
 * That is exactly what broke the build: connector plugins register through `plugins/index.ts`, which
 * server route handlers import by design, and a plugin's connector definition value-imported
 * `validatePolling` from `_connectors/shared/validate-utils.ts`, which reached
 * `parsePollConnectorFromPropertiesXml` here, which lived in `channel-xml.ts`. Every hop is a `.ts`
 * file, so nothing looked wrong at any single step and `lint:plugin-lazy` — which only inspects
 * direct `.tsx` imports from a plugin `index.ts` — could not see it.
 *
 * KEEP THIS MODULE A LEAF. Adding an import here that transitively reaches a client component
 * re-breaks `npm run build`, and the PR gate does not run `build`.
 *
 * The write path (`updatePollConnectorInPropertiesXml`) stays in `channel-xml.ts`: it needs that
 * module's private `ensureChild` helper, and only client components call it.
 */

export type PollingType = "INTERVAL" | "TIME" | "CRON";

/** A single Quartz cron job entry stored inside `<cronJobs>`. */
export interface CronJob {
  // Quartz cron expression (6-7 fields). Example: every 5 s = "*/5 * * * * ?"
  expression: string;
  // Human-readable description stored alongside the expression in the XML.
  description: string;
}

/**
 * Advanced day/time restriction settings for polling connectors.
 * Mirrors Java's `PollConnectorPropertiesAdvanced`.
 *
 * `inactiveDays` is INVERTED: `false` = active, `true` = inactive.
 *
 * This internal array is 0-based — index 0=Sun … 6=Sat (matches JS `Date.getDay()`).
 * The server's XML/Quartz form is Calendar-indexed instead (`<boolean>` position
 * 1=Sun … 7=Sat, position 0 unused), because the server feeds the array straight into
 * Quartz `WeeklyCalendar.setDaysExcluded`, which indexes by `java.util.Calendar` day
 * constants (SUNDAY=1 … SATURDAY=7). The +1 translation happens at the
 * `parsePollConnectorFromPropertiesXml` / `updatePollConnectorInPropertiesXml` boundary
 * below, so the emitted XML is byte-identical to the Java client's.
 */
export interface AdvancedPollingSettings {
  weekly: boolean;
  inactiveDays: boolean[]; // length 7+; index 0=Sun…6=Sat; true=inactive
  dayOfMonth: number; // 1–31, used only when weekly=false
  allDay: boolean;
  startingHour: number; // 0–23, used only when allDay=false
  startingMinute: number; // 0–59
  endingHour: number; // 0–23
  endingMinute: number; // 0–59
}

export const DEFAULT_ADVANCED_POLLING: AdvancedPollingSettings = {
  weekly: true,
  inactiveDays: [false, false, false, false, false, false, false],
  dayOfMonth: 1,
  allDay: true,
  startingHour: 8,
  startingMinute: 0,
  endingHour: 17,
  endingMinute: 0,
};

export interface PollConnectorState {
  pollingType: PollingType;
  pollOnStart: boolean;
  /** Polling interval in milliseconds. Used when pollingType === "INTERVAL". */
  pollingFrequency: number;
  /** Hour of day 0-23. Used when pollingType === "TIME". */
  pollingHour: number;
  /** Minute of hour 0-59. Used when pollingType === "TIME". */
  pollingMinute: number;
  /** Quartz cron schedules. Used when pollingType === "CRON". */
  cronJobs: CronJob[];
  /** Advanced day/time restrictions. Always present; defaults mean "no restrictions". */
  advanced: AdvancedPollingSettings;
}

const DEFAULT_POLL_STATE: PollConnectorState = {
  pollingType: "INTERVAL",
  pollOnStart: false,
  pollingFrequency: 5000,
  pollingHour: 0,
  pollingMinute: 0,
  cronJobs: [],
  advanced: { ...DEFAULT_ADVANCED_POLLING },
};

/**
 * Parses poll connector properties from a connector's `propertiesXml` blob
 * (the outer `<properties>` element XML stored in SourceConnectorState).
 */
export function parsePollConnectorFromPropertiesXml(
  propertiesXml: string | null
): PollConnectorState {
  if (!propertiesXml) return { ...DEFAULT_POLL_STATE };
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const pcp = doc.querySelector("pollConnectorProperties");
  if (!pcp) return { ...DEFAULT_POLL_STATE };

  function t(tag: string, def: string): string {
    return pcp!.querySelector(tag)?.textContent?.trim() ?? def;
  }
  function b(tag: string, def: boolean): boolean {
    const v = pcp!.querySelector(tag)?.textContent?.trim();
    return v === undefined ? def : v === "true";
  }
  function n(tag: string, def: number): number {
    const v = pcp!.querySelector(tag)?.textContent?.trim();
    const p = v !== undefined ? parseInt(v, 10) : NaN;
    return isNaN(p) ? def : p;
  }

  const pt = t("pollingType", "INTERVAL");

  // Parse <cronJobs><cronProperty>…</cronProperty></cronJobs>
  const cronJobs: CronJob[] = [];
  const cronJobsEl = pcp.querySelector(":scope > cronJobs");
  if (cronJobsEl) {
    for (const cp of Array.from(cronJobsEl.querySelectorAll(":scope > cronProperty"))) {
      cronJobs.push({
        expression: cp.querySelector("expression")?.textContent ?? "",
        description: cp.querySelector("description")?.textContent ?? "",
      });
    }
  }

  // Parse <pollConnectorPropertiesAdvanced>
  const adv = pcp.querySelector(":scope > pollConnectorPropertiesAdvanced");
  let advanced: AdvancedPollingSettings;
  if (adv) {
    function ab(tag: string, def: boolean): boolean {
      const v = adv!.querySelector(tag)?.textContent?.trim();
      return v === undefined ? def : v === "true";
    }
    function an(tag: string, def: number): number {
      const v = adv!.querySelector(tag)?.textContent?.trim();
      const p = v !== undefined ? parseInt(v, 10) : NaN;
      return isNaN(p) ? def : p;
    }
    // <inactiveDays> contains 8 Calendar-indexed <boolean> children: position 0 is the
    // unused reserved slot, positions 1–7 are Sun–Sat. Shift down by one into our 0-based
    // internal array (index 0=Sun … 6=Sat).
    const inactiveDaysEl = adv.querySelector(":scope > inactiveDays");
    const rawBools = inactiveDaysEl
      ? Array.from(inactiveDaysEl.querySelectorAll(":scope > boolean")).map(
          (el) => el.textContent?.trim() === "true"
        )
      : [];
    const inactiveDays: boolean[] = Array.from({ length: 7 }, (_, i) => rawBools[i + 1] ?? false);
    advanced = {
      weekly: ab("weekly", true),
      inactiveDays,
      dayOfMonth: an("dayOfMonth", 1),
      allDay: ab("allDay", true),
      startingHour: an("startingHour", 8),
      startingMinute: an("startingMinute", 0),
      endingHour: an("endingHour", 17),
      endingMinute: an("endingMinute", 0),
    };
  } else {
    advanced = { ...DEFAULT_ADVANCED_POLLING };
  }

  return {
    pollingType:
      pt === "INTERVAL" || pt === "TIME" || pt === "CRON" ? (pt as PollingType) : "INTERVAL",
    pollOnStart: b("pollOnStart", false),
    pollingFrequency: n("pollingFrequency", 5000),
    pollingHour: n("pollingHour", 0),
    pollingMinute: n("pollingMinute", 0),
    cronJobs,
    advanced,
  };
}
