import { getCache } from "@/lib/cache-store";
import { getChannelSummary } from "@/lib/api/api-channels";
import type { Message } from "@/lib/types";
import type { SendMessageInitialData } from "@/components/messages/send-message-dialog";

/**
 * True when the given connector has RAW content, mirroring Java `ConnectorMessage.getRaw() != null`.
 * A content-pruned (or never-stored-raw) connector yields false. Used to gate reprocess/resend the
 * way Java does: `MessageBrowser.canReprocessMessage` (source connector, metaDataId 0,
 * `MessageBrowser.java:1743-1756`) and the double-click edit-and-resend guard (drilled-into
 * connector, `MessageBrowser.java:1307`). Uses the same raw lookup as `buildResendInitialData`.
 *
 * Note: this is intentionally slightly stricter than Java. Java's `canReprocessMessage` is lenient
 * when the source connector message is absent (`sourceMessage == null` → true), and its message
 * cache is connector-filtered, so a filter excluding source degenerates the guard to "allow". The
 * WebUI always fetches the full unfiltered message, so it enforces the guard even in those cases —
 * correctly, since a server-side reprocess of pruned raw would fail anyway.
 */
export function hasRawContent(msg: Message, metaDataId: number): boolean {
  const cm = msg.connectorMessages?.[String(metaDataId)];
  return (cm?.raw ?? cm?.content?.["RAW"]) != null;
}

/**
 * Build the pre-population data for the "Edit & Resend" dialog from a fully-fetched
 * message, mirroring Java's MessageBrowser double-click handler
 * (`MessageBrowser.java:1290-1309`).
 *
 * @param fullMsg  the message fetched with content (getMessage)
 * @param targetId the connector the user drilled into: a destination metaDataId (> 0)
 *                 or 0 for the source/parent (whole-message) gesture.
 *
 * Java parity notes (all keyed off the drilled-into connector = `getConnectorMessages().get(metaDataId)`):
 * - Destination pre-selection (`MessageBrowser.java:1301-1305`): `metaDataId == 0` passes
 *   `selectedMetaDataIds = null` (= all channel destinations checked, see
 *   `ItemSelectionTableModel.java:44`); a destination row passes `[metaDataId]` (only that one).
 *   Here `destinationMetaDataIds = targetId > 0 ? [targetId] : null`.
 * - The source map is copied from the **target** connector (`MessageBrowser.java:1295-1296`,
 *   `connectorMessage.getSourceMap()`), with `destinationSet` stripped (`MessageBrowser.java:1298`)
 *   — "that will be determined by the selected metadata IDs". Because SOURCE_MAP is persisted only
 *   for the source connector (metaDataId 0), a destination-row resend yields an empty map, matching
 *   Java; the engine recomputes destinationSet at dispatch regardless.
 * - Content comes from the target connector's RAW (`connectorMessage.getRaw().getContent()`),
 *   with dataType from the same RawMessage for the editor's syntax highlighting.
 */
export function buildResendInitialData(fullMsg: Message, targetId: number): SendMessageInitialData {
  const sourceConnector = fullMsg.connectorMessages?.["0"];
  const targetConnector = fullMsg.connectorMessages?.[String(targetId)] ?? sourceConnector;

  // Mirror content-viewer's getContentForType: try the direct .raw field first,
  // then fall back to the content map keyed by "RAW".
  const rawField = targetConnector?.raw ?? targetConnector?.content?.["RAW"];
  const rawContent = rawField?.content;
  // rawContent may be a string, a number (XStream serializes numeric-only messages without
  // quotes), or an object (e.g. not yet unwrapped). Only stringify primitives.
  const content = rawContent != null && typeof rawContent !== "object" ? String(rawContent) : "";

  // Copy the target connector's source map, dropping "destinationSet" (Java
  // MessageBrowser.java:1295-1298) — the engine determines it from the selected metadata IDs at
  // dispatch, so a stale copy is just noise.
  const rawSourceMap = targetConnector?.sourceMap ?? {};
  const sourceMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawSourceMap)) {
    if (k === "destinationSet") continue;
    sourceMap[k] = String(v);
  }

  // targetId > 0 (a destination row) pre-checks only that destination; 0 (source/whole-message
  // gesture) pre-checks all — represented as null, matching Java's `selectedMetaDataIds = null`.
  const destinationMetaDataIds = targetId > 0 ? [targetId] : null;

  return { content, dataType: rawField?.dataType, destinationMetaDataIds, sourceMap };
}

/**
 * Resolve the source connector's inbound data type for the fresh "Send Message" dialog, so the
 * editor gets the right syntax highlighting. Mirrors Java `Frame.doSendMessage`
 * (`Frame.java:3851-3878`): read `sourceConnector.getTransformer().getInboundDataType()` from the
 * cached channel, lazily fetching the channel summary if it isn't cached.
 *
 * Returns `undefined` (→ plaintext editor) when the type can't be resolved — the faithful
 * equivalent of Java's `"RAW"` fallback when the user lacks VIEW_CHANNEL or the channel is gone.
 */
export async function resolveSourceInboundDataType(channelId: string): Promise<string | undefined> {
  const cached =
    getCache().channelMap.get(channelId)?.sourceConnector?.transformer?.inboundDataType;
  if (cached) return cached;

  try {
    // ChannelHeader(revision 0, deployedDate omitted, codeTemplatesChanged true) forces the
    // server to treat the channel as changed and return the full Channel object — the same
    // trick Java uses (`new ChannelHeader(0, null, true)`).
    const summaries = await getChannelSummary(
      { [channelId]: { revision: 0, codeTemplatesChanged: true } },
      true
    );
    const channel = summaries.find((s) => s.channelId === channelId)?.channelStatus?.channel;
    return channel?.sourceConnector?.transformer?.inboundDataType;
  } catch {
    return undefined;
  }
}
