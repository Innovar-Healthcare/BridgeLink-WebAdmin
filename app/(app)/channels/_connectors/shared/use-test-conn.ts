"use client";

/**
 * useTestConn — shared hook for "Test Connection" / "Test Write" / "Send Test Email"
 * buttons on destination connector BottomSections.
 *
 * Usage:
 *   const { testing, result, test, clearResult } = useTestConn(
 *     "http",          // connector slug — used in URL: /connectors/{slug}/{action}
 *     "_testConnection", // action
 *     propertiesXml,   // raw body forwarded to the server (XML doc or plain string)
 *     channelId,       // optional — forwarded as query param
 *     channelName,     // optional — forwarded as query param
 *     { contentType }, // optional — defaults to "application/xml"
 *   );
 *
 * The hook POSTs the body to:
 *   /api/proxy/connectors/{slug}/{action}?channelId=...&channelName=...
 * with Content-Type: application/xml (default) and Accept: application/json.
 *
 * Most endpoints accept application/xml with the full connector properties as the body.
 * Exception: Document Writer's _testWrite expects Content-Type: text/plain with only
 * the directory string — pass { contentType: "text/plain" } and local.host as the body.
 *
 * The server returns ConnectionTestResponse: { type, message }
 * where type is "SUCCESS" | "TIME_OUT" | "FAILURE".
 */

import { useCallback, useState } from "react";
import { PROXY_BASE, getServerUrl, normalizeXStream } from "@/lib/api/api-core";
import { assertNoUnresolvedVersion } from "@/lib/connector-props-guard";

// Strips Java stack trace noise from a ConnectionTestResponse message so only
// the root-cause error is shown. The server serializes stack frames as
// <trace>...</trace> XML elements appended to the exception message.
function extractErrorMessage(text: string): string {
  if (!text) return text;
  // Try BridgeLink's standard XML error envelope: <detailMessage>
  const detailMatch = text.match(/<detailMessage>([\s\S]*?)<\/detailMessage>/);
  if (detailMatch) return detailMatch[1].trim();
  // Strip all <trace>…</trace> stack frame elements
  const withoutTraces = text.replace(/<trace>[\s\S]*?<\/trace>\s*/g, "").trim();
  if (withoutTraces) return withoutTraces;
  // Last resort: first non-blank, non-stack-frame line
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !/^<trace>/.test(t) && !/^\s*at /.test(t) && !/^Caused by:/.test(t)) return t;
  }
  return text;
}

export type TestConnResult = {
  type: "SUCCESS" | "TIME_OUT" | "FAILURE";
  message: string;
};

export function useTestConn(
  connectorSlug: string,
  action: string,
  propertiesXml: string | null,
  channelId?: string,
  channelName?: string,
  options?: { contentType?: string }
) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestConnResult | null>(null);

  // Destructure to a stable primitive so the React Compiler can preserve the
  // memoization below (passing `options?.contentType` directly as a dep trips
  // react-hooks/preserve-manual-memoization).
  const contentType = options?.contentType;

  const test = useCallback(async () => {
    if (!propertiesXml) return;
    // Send-boundary guard: fail loudly in dev/test if any injection
    // site let an unresolved {{VERSION}} placeholder reach this live API call.
    assertNoUnresolvedVersion(propertiesXml, `connectors/${connectorSlug}/${action}`);
    setTesting(true);
    setResult(null);

    const params = new URLSearchParams();
    if (channelId) params.set("channelId", channelId);
    if (channelName) params.set("channelName", channelName);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const serverUrl = getServerUrl();

    try {
      const res = await fetch(`${PROXY_BASE}/connectors/${connectorSlug}/${action}${qs}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": contentType ?? "application/xml",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
        },
        body: propertiesXml,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const message = text ? extractErrorMessage(text) : `HTTP ${res.status}: ${res.statusText}`;
        setResult({ type: "FAILURE", message });
        return;
      }

      // Try JSON first, fall back to plain text
      const text = await res.text();
      try {
        const raw = JSON.parse(text);
        // normalizeXStream handles XStream quirks (null strings, linked-hash-map, etc.)
        const normalized = normalizeXStream(raw) as Record<string, unknown>;
        // Unwrap single-key XStream envelope: {"connectionTestResponse": {"type":..,"message":..}}
        const keys = Object.keys(normalized ?? {});
        const data =
          keys.length === 1 &&
          typeof normalized[keys[0]] === "object" &&
          normalized[keys[0]] !== null
            ? (normalized[keys[0]] as { type?: string; message?: string })
            : (normalized as { type?: string; message?: string });

        setResult({
          type: (data.type === "SUCCESS" || data.type === "TIME_OUT"
            ? data.type
            : "FAILURE") as TestConnResult["type"],
          message: extractErrorMessage(data.message ?? ""),
        });
      } catch {
        // Server returned plain text (e.g. some versions return "SUCCESS" directly)
        const upper = text.trim().toUpperCase();
        setResult({
          type: (upper === "SUCCESS"
            ? "SUCCESS"
            : upper === "TIME_OUT"
              ? "TIME_OUT"
              : "FAILURE") as TestConnResult["type"],
          message: text.trim(),
        });
      }
    } catch (e) {
      setResult({ type: "FAILURE", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }, [connectorSlug, action, propertiesXml, channelId, channelName, contentType]);

  const clearResult = useCallback(() => setResult(null), []);

  return { testing, result, test, clearResult };
}
