/**
 * Attachment viewer registry.
 *
 * Plugins call registerAttachmentViewer() from their index.ts entry point
 * to contribute viewers for specific MIME types or attachment predicates.
 * The dispatch host (AttachmentViewerHost) calls resolveAttachmentViewer()
 * to pick the best viewer for a given attachment at render time.
 */

export type { AttachmentViewerDefinition, AttachmentViewerProps, MessageAttachment } from "./types";
export { AttachmentViewerHost } from "./attachment-viewer-host";

import { connectContributionSink, warnDuplicateContribution } from "@/lib/plugin-manifest";
import type { AttachmentViewerDefinition, MessageAttachment } from "./types";

/** Mutable attachment viewer registry. Plugins self-register here. */
let ATTACHMENT_VIEWER_REGISTRY: AttachmentViewerDefinition[] = [];

/**
 * Register an attachment viewer. Call from your plugin's index.ts entry point.
 *
 * The viewer's canView() predicate is evaluated at render time against each
 * attachment. When multiple registered viewers match, the one with the highest
 * priority (default 0) wins. Ties are broken by registration order (last wins).
 */
export function registerAttachmentViewer(def: AttachmentViewerDefinition): void {
  ATTACHMENT_VIEWER_REGISTRY = [...ATTACHMENT_VIEWER_REGISTRY, def];
}

// Receive definePlugin() manifest contributions (first-wins by viewer name).
connectContributionSink("attachmentViewers", (def, pluginId) => {
  if (ATTACHMENT_VIEWER_REGISTRY.some((v) => v.name === def.name)) {
    warnDuplicateContribution(pluginId, "attachment viewer", def.name);
    return false;
  }
  registerAttachmentViewer(def);
  return true;
});

/**
 * Resolve the best MIME-registry viewer for an attachment.
 *
 * Full precedence applied by AttachmentViewerHost:
 * 1. Per-data-type AttachmentViewer from DATA_TYPE_REGISTRY (handled by the host):
 *    checked when att.type contains the registered data type name.
 * 2. Highest-priority canView() match from this registry (what this function returns).
 * 3. null → host falls back to the built-in text/Monaco view.
 *
 * Server-enablement gating: a plugin viewer is skipped unless its
 * server extension is enabled — the caller passes the `isEnabled` predicate
 * (built-in viewers carry no pluginName so they always match). A gated-off
 * viewer simply drops to the built-in fallback; nothing about the attachment
 * itself is gated.
 *
 * @param att - The attachment to find a viewer for (type field is required; content optional).
 * @param isEnabled - Predicate: is a viewer's pluginName enabled? (undefined → yes).
 * @returns The best matching AttachmentViewerDefinition, or null if nothing matches.
 */
export function resolveAttachmentViewer(
  att: MessageAttachment,
  isEnabled: (pluginName: string | undefined) => boolean
): AttachmentViewerDefinition | null {
  const candidates = [...ATTACHMENT_VIEWER_REGISTRY]
    .filter((d) => d.canView(att) && isEnabled(d.pluginName))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return candidates[0] ?? null;
}
