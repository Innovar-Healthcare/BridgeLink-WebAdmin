import { resolveConfigVar } from "@/lib/hooks/use-cache";
import type { Channel } from "@/lib/types";

export interface PortConflict {
  port: string;
  channels: string[];
}

/** Extract the listening port from a source connector's properties XML blob. Returns "" if absent. */
export function extractListenerPort(sourcePropertiesXml: string | null): string {
  if (!sourcePropertiesXml) return "";
  const doc = new DOMParser().parseFromString(sourcePropertiesXml, "application/xml");
  return doc.querySelector("listenerConnectorProperties > port")?.textContent?.trim() ?? "";
}

function channelListenerPort(ch: Channel): string {
  const lcp = (ch.sourceConnector?.properties as Record<string, unknown> | undefined)
    ?.listenerConnectorProperties as Record<string, unknown> | undefined;
  return lcp?.port != null ? String(lcp.port) : "";
}

/**
 * In-memory conflict check — no network calls.
 *
 * Returns a PortConflict (with resolved port + list of conflicting channel names) if any OTHER
 * cached channel has a source listener already configured on the same resolved port. Returns null
 * if the current source has no port, or if no other channel conflicts.
 */
export function findListenerPortConflict(
  sourcePropertiesXml: string | null,
  selfChannelId: string,
  channels: Channel[],
  configMap: Map<string, string>
): PortConflict | null {
  const rawSelf = extractListenerPort(sourcePropertiesXml);
  if (!rawSelf) return null;
  const selfPort = resolveConfigVar(rawSelf, configMap);
  if (!selfPort) return null;

  const conflicting: string[] = [];
  for (const ch of channels) {
    if (ch.id === selfChannelId) continue;
    const rawOther = channelListenerPort(ch);
    if (!rawOther) continue;
    const otherPort = resolveConfigVar(rawOther, configMap);
    if (otherPort === selfPort) {
      conflicting.push(ch.name);
    }
  }

  if (conflicting.length === 0) return null;
  conflicting.sort();
  return { port: selfPort, channels: conflicting };
}
