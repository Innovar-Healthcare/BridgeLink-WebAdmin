/**
 * Shared attachment-viewer-type definitions for the Message Browser.
 *
 * Kept Monaco-free so the MIME→viewer mapping can be unit-tested and imported by
 * both the content viewer and the viewer-type picker dialog without import cycles.
 *
 * Mirrors the Java client's attachment viewer plugins (Text/Image/PDF/DICOM) and
 * their isContentTypeViewable() precedence.
 */

export const ATTACHMENT_VIEWER_OPTIONS = [
  { key: "text", label: "Text Viewer" },
  { key: "image", label: "Image Viewer" },
  { key: "pdf", label: "PDF Viewer" },
  { key: "dicom", label: "DICOM Viewer" },
] as const;

export type AttachmentViewerType = (typeof ATTACHMENT_VIEWER_OPTIONS)[number]["key"];

/**
 * Pick the default viewer for a MIME / content-type string. Falls back to the
 * Text viewer when nothing more specific matches — matching the Java dialog,
 * which defaults to "Text Viewer" when no plugin claims the content type.
 */
export function mimeToViewer(type: string): AttachmentViewerType {
  const t = (type || "").toLowerCase();
  if (t.includes("pdf")) return "pdf";
  if (t.includes("dicom") || t.endsWith(".dcm")) return "dicom";
  if (
    t.includes("png") ||
    t.includes("jpeg") ||
    t.includes("jpg") ||
    t.includes("gif") ||
    t.includes("webp") ||
    t.includes("svg")
  ) {
    return "image";
  }
  return "text";
}

/**
 * Normalize an attachment MIME to a safe, canonical image type, or null if it is
 * not on the allowlist. Matches on the MIME *essence* (the part before `;`) so a
 * spoofed type like "text/html;charset=png" is NOT treated as an image.
 *
 * Security: the inline image preview must never build its blob from the
 * raw server-supplied MIME. Callers use the returned canonical type for the blob and
 * fall back to the Text viewer when this returns null. SVG is intentionally excluded
 * — SVG can carry script and was never image-viewable in the Java client either
 * (`ImageViewer` uses `javax.imageio`, which has no SVG support).
 */
export function normalizeImageMime(type: string): string | null {
  const essence = (type || "").split(";")[0].trim().toLowerCase();
  switch (essence) {
    case "image/png":
      return "image/png";
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/gif":
      return "image/gif";
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}

/**
 * Whether a specific (non-Text) viewer claims this content type. Used by the
 * picker dialog to decide between the "select a viewer" and "viewer not found"
 * prompts and whether to offer the "always auto" opt-out (mirrors Java's
 * `found` flag in AttachmentTypeDialog).
 */
export function hasMatchingViewer(type: string): boolean {
  return mimeToViewer(type) !== "text" || (type || "").toLowerCase().includes("text");
}

/**
 * Whether this content type's viewer collapses all of its attachments into a
 * single row in the attachment list (mirrors Java AttachmentViewer.handleMultiple()).
 * Only the DICOM viewer returns true in the Java client (Text/Image/PDF return false).
 */
export function isMultiAttachmentType(type: string): boolean {
  return mimeToViewer(type) === "dicom";
}
