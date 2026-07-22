"use client";

import type { ReactNode } from "react";
import type { AttachmentViewerProps, MessageAttachment } from "./types";
import { resolveAttachmentViewer } from "./index";
import { DATA_TYPE_REGISTRY } from "@/app/(app)/channels/_datatypes";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";

interface AttachmentViewerHostProps {
  /** The attachment to display. Content is optional; the viewer may self-fetch. */
  attachment: MessageAttachment;
  channelId: string;
  messageId: string | number;
  /**
   * Rendered when no registered viewer matches.
   * Pass the existing Monaco / text view as the fallback.
   */
  fallback?: ReactNode;
}

/**
 * Dispatch host for attachment viewers.
 *
 * Applies the full resolution precedence:
 * 1. Per-data-type AttachmentViewer from DATA_TYPE_REGISTRY — preferred when
 *    att.type contains the data type name (e.g. "dicom" in "application/dicom").
 *    The component receives only { attachment } to match the sub-ticket #3 contract.
 * 2. Highest-priority canView() match from ATTACHMENT_VIEWER_REGISTRY.
 *    The component receives { attachment, channelId, messageId } so it can self-fetch.
 * 3. fallback prop — the built-in text / Monaco view.
 */
export function AttachmentViewerHost({
  attachment,
  channelId,
  messageId,
  fallback = null,
}: AttachmentViewerHostProps) {
  // Server-enablement gating: a plugin-contributed viewer is used
  // only when its server extension is enabled; otherwise we fall through to the
  // built-in text/Monaco fallback. Built-in viewers carry no pluginName.
  const surfaceEnabled = usePluginSurfaceEnabled();

  // 1. Per-data-type viewer (DATA_TYPE_REGISTRY, from sub-ticket #3).
  for (const def of DATA_TYPE_REGISTRY.values()) {
    if (
      def.AttachmentViewer &&
      surfaceEnabled(def.pluginName) &&
      attachment.type.toLowerCase().includes(def.name.toLowerCase())
    ) {
      const DtViewer = def.AttachmentViewer;
      return <DtViewer attachment={attachment} />;
    }
  }

  // 2. MIME-type / predicate-based viewer (ATTACHMENT_VIEWER_REGISTRY).
  const entry = resolveAttachmentViewer(attachment, surfaceEnabled);
  if (entry) {
    const RegViewer = entry.Component;
    const props: AttachmentViewerProps = { attachment, channelId, messageId };
    return <RegViewer {...props} />;
  }

  // 3. Default fallback (built-in Monaco / text view).
  return <>{fallback}</>;
}
