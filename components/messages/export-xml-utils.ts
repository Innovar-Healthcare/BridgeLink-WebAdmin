/**
 * Helpers for assembling re-importable XStream `<message>` XML for the Message Browser's local
 * ("My Computer") export. Server-side export already produces this on the server; these utilities
 * reproduce it in the browser by stitching together the server's own XStream output (the message
 * document and the attachments list), so no client-side base64 / XStream encoding is required.
 *
 * Mirrors Java `MessageExporter`/`MessageWriterFile` (contentType == null): the raw content keeps its
 * `${ATTACH:id}` tokens and the attachment list is appended to the serialized message.
 */

/**
 * Extract the inner content of an XStream `<list>…</list>` wrapper.
 *
 * The attachments REST endpoint serializes `List<Attachment>` as `<list><attachment>…</attachment>…
 * </list>` (or `<list/>` when empty). Returns the concatenated `<attachment>` blocks, or "" when the
 * list is empty/self-closing.
 */
export function extractListInner(attachmentsListXml: string): string {
  const match = attachmentsListXml.match(/<list\b[^>]*>([\s\S]*)<\/list>/);
  return match ? match[1].trim() : "";
}

/**
 * Splice an attachments list into a `<message>` document so it round-trips on import.
 *
 * Inside `<message>`, the `attachments` field serializes as `<attachments><attachment>…</attachment>
 * </attachments>` (field name `attachments`, item alias `attachment`). We take the `<attachment>`
 * blocks from the attachments-list XML and insert them, wrapped in `<attachments>`, immediately
 * before the closing `</message>`. Element order inside `<message>` is irrelevant to XStream
 * deserialization, so the insertion point is safe.
 *
 * When there are no attachments (`<list/>` or empty list), the message XML is returned unchanged.
 */
export function embedAttachmentsXml(messageXml: string, attachmentsListXml: string): string {
  const inner = extractListInner(attachmentsListXml);
  if (!inner) return messageXml;

  const closeIdx = messageXml.lastIndexOf("</message>");
  if (closeIdx === -1) return messageXml;

  const attachmentsBlock = `<attachments>${inner}</attachments>`;
  return messageXml.slice(0, closeIdx) + attachmentsBlock + messageXml.slice(closeIdx);
}

/**
 * Build a ZIP archive (as bytes) from a map of `filename → text content`, for the local
 * ("My Computer") export when Compression = zip. Mirrors the server-side archive export, which the
 * local path otherwise ignored gap #3).
 *
 * `fflate` is lazy-imported so it stays out of the initial page bundle, and its async `zip` runs on
 * a Web Worker (allowed by the app CSP's `worker-src 'self' blob:`) so large exports don't block the
 * UI. fflate has no eval-class module init, unlike jszip. Plain (unencrypted) zips only — fflate
 * cannot produce password/AES-encrypted archives, which is why the dialog disables Password-Protect
 * for local export.
 */
export async function buildMessagesZip(files: Record<string, string>): Promise<Uint8Array> {
  const { zip, strToU8 } = await import("fflate");
  const data: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    data[name] = strToU8(content);
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}
