/**
 * Types for the attachment viewer plugin registry.
 *
 * Mirrors Java's AttachmentViewer plugin extension point, which exposes
 * isContentTypeViewable(String contentType) and viewAttachments() per viewer.
 */

import type { ComponentType } from "react";
import type { MessageAttachment } from "@/app/(app)/channels/_datatypes/types";

export type { MessageAttachment };

/**
 * Props passed to every registered attachment viewer component.
 *
 * The viewer receives the attachment metadata (id + type, content optional)
 * plus the channel/message coordinates so it can self-fetch full content
 * via getAttachment(channelId, messageId, attachment.id) if needed.
 */
export interface AttachmentViewerProps {
  attachment: MessageAttachment;
  channelId: string;
  messageId: string | number;
}

/**
 * A viewer contributed via registerAttachmentViewer().
 *
 * The registry is keyed by canView() predicates rather than exact MIME strings
 * so viewers can match partial types, wildcards, or any attachment field.
 */
export interface AttachmentViewerDefinition {
  /** Unique name identifying this viewer (e.g. "DIMSEAttachmentViewer"). */
  name: string;

  /**
   * Returns true when this viewer can render the given attachment.
   * Typically inspects att.type (MIME string) but may inspect any field.
   * Mirrors Java's AttachmentViewer.isContentTypeViewable().
   */
  canView: (att: MessageAttachment) => boolean;

  /** The React component that renders the attachment content. */
  Component: ComponentType<AttachmentViewerProps>;

  /**
   * Whether the viewer can render an array of attachments at once.
   * Mirrors Java's AttachmentViewer.handleMultiple(). Currently informational —
   * multi-select rendering is out of scope for the initial registry release.
   */
  handleMultiple?: boolean;

  /**
   * Resolution priority. When multiple registered viewers match the same
   * attachment, the one with the highest priority wins. Defaults to 0.
   */
  priority?: number;

  /**
   * Server plugin name (must match `GET /extensions/plugins/`) used for
   * server-enablement gating. When set, this viewer is skipped
   * during resolution unless that plugin is installed AND enabled on the
   * connected server (the message browser then falls back to the built-in
   * text/Monaco viewer). Stamped from the definition's `serverPluginName` by
   * `registerPlugin()`. Omit for built-in viewers (always available).
   */
  pluginName?: string;
}
