/**
 * CSP violation report sink.
 *
 * Browsers send violation reports to this endpoint when the
 * Content-Security-Policy-Report-Only header in next.config.ts fires. The
 * route accepts both report formats, which use DIFFERENT field naming:
 *
 *   - Legacy:  application/csp-report   → {"csp-report": {hyphenated keys}}
 *                                          e.g. "blocked-uri", "effective-directive"
 *   - Modern:  application/reports+json → [{type, body: {camelCase keys}}, ...]
 *                                          e.g. "blockedURL", "effectiveDirective"
 *
 * Modern Chrome prefers the Reporting API (report-to) and ignores report-uri
 * when both are present, so the camelCase path is the common one in practice.
 * logViolation() reads both schemes.
 *
 * Reports are logged with [csp] tags for operator visibility and then discarded
 * — no persistent storage, no PHI (reports contain only directives and URLs,
 * never page content). Returns 204 on success and on any parse error so the
 * browser does not retry indefinitely.
 *
 * The endpoint is unauthenticated (browsers send reports without credentials),
 * so logging is rate-limited to bound a log-flooding / disk-fill attack, and
 * oversized bodies are rejected before parsing.
 */

import { type NextRequest, NextResponse } from "next/server";
import { logServerError } from "@/lib/server-log";

/**
 * A single CSP violation. Both the legacy (hyphenated) and modern (camelCase)
 * field names are optional so logViolation can read whichever the browser sent.
 */
interface CspViolation {
  // Legacy application/csp-report keys.
  "document-uri"?: string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "blocked-uri"?: string;
  "source-file"?: string;
  "line-number"?: number;
  // Modern application/reports+json (Reporting API) keys.
  documentURL?: string;
  violatedDirective?: string;
  effectiveDirective?: string;
  blockedURL?: string;
  sourceFile?: string;
  lineNumber?: number;
}

/** Largest report body we will read, in bytes. Real CSP reports are < 2 KB. */
const MAX_BODY_BYTES = 64 * 1024;

/** Rate limit: at most this many violations logged per window. */
const MAX_LOGS_PER_WINDOW = 30;
const WINDOW_MS = 60_000;

let windowStart = 0;
let loggedInWindow = 0;
let suppressedInWindow = 0;

/**
 * Log a CSP violation, rate-limited per fixed window. Beyond the cap, reports
 * are counted and a single summary line is emitted when the window rolls over,
 * so a flood of reports cannot fill the logs.
 */
function rateLimitedLog(message: string): void {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    if (suppressedInWindow > 0) {
      logServerError("csp", `Suppressed ${suppressedInWindow} additional CSP report(s).`);
    }
    windowStart = now;
    loggedInWindow = 0;
    suppressedInWindow = 0;
  }

  if (loggedInWindow < MAX_LOGS_PER_WINDOW) {
    logServerError("csp", message);
    loggedInWindow++;
  } else {
    suppressedInWindow++;
  }
}

function logViolation(v: CspViolation): void {
  const directive =
    v.effectiveDirective ??
    v["effective-directive"] ??
    v.violatedDirective ??
    v["violated-directive"] ??
    "unknown";
  const blocked = v.blockedURL ?? v["blocked-uri"] ?? "(inline)";
  const file = v.sourceFile ?? v["source-file"];
  const line = v.lineNumber ?? v["line-number"] ?? 0;
  const where = file ? ` ${file}:${line}` : "";
  rateLimitedLog(`CSP violation: ${directive} blocked ${blocked}${where}`);
}

/** Reset rate-limit state. Exported for unit tests only. */
export function __resetCspReportRateLimit(): void {
  windowStart = 0;
  loggedInWindow = 0;
  suppressedInWindow = 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Reject oversized bodies before buffering them into memory.
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    const body: unknown = await req.json();

    if (contentType.includes("application/reports+json") && Array.isArray(body)) {
      // Modern Reporting API: array of report objects.
      for (const report of body) {
        if (
          report != null &&
          typeof report === "object" &&
          "body" in report &&
          report.body != null &&
          typeof report.body === "object"
        ) {
          logViolation(report.body as CspViolation);
        }
      }
    } else if (
      body != null &&
      typeof body === "object" &&
      "csp-report" in body &&
      body["csp-report"] != null &&
      typeof body["csp-report"] === "object"
    ) {
      // Legacy application/csp-report format.
      logViolation(body["csp-report"] as CspViolation);
    }
  } catch {
    // Malformed or empty body — still return 204 so the browser stops retrying.
  }

  return new NextResponse(null, { status: 204 });
}
