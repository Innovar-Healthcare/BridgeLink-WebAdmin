/**
 * Server-side data type tree parsing.
 *
 * The Java Swing client builds its message-tree preview by running a raw sample
 * message through the data type's own `IMessageSerializer.toXML()` (the same Reader
 * used for real inbound processing). The WebUI has historically approximated this by
 * porting each Reader to TypeScript (`lib/dicom-tag-parser.ts`,
 * `app/(app)/channels/_datatypes/{delimited,ncpdp,hl7v2,edix12}.tsx`), which drifts
 * from Core whenever a server Reader changes and — for DICOM — pulls in the ~11MB
 * `dcmjs` dependency just to decode the binary. `POST /datatypes/_toTree` gives true
 * Reader parity, one round-trip, for any data type.
 *
 * Gated by {@link MIN_SERVER_DATATYPE_ENDPOINTS}: callers use the server when the
 * connected Core is new enough and fall back to the client-side port otherwise, so
 * older servers keep working (the fallback is removed in a later cleanup release once
 * `MIN_SUPPORTED_SERVER_VERSION` clears the floor). See for the approach.
 *
 * The endpoint returns raw XML (not the XStream envelope), so this uses `rawText`.
 */

import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";
import { request } from "./api-core";

/** Core release that first shipped `POST /datatypes/_toTree`. */
export const MIN_SERVER_DATATYPE_ENDPOINTS = "26.9.0";

/**
 * True when the connected Core is new enough to serve `_toTree`. Missing or
 * unparseable server versions return `false` (via {@link isVersionAtLeast}), so
 * callers route to the client-side fallback rather than a doomed request.
 */
export function serverSupportsDataTypeEndpoints(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_DATATYPE_ENDPOINTS);
}

/**
 * Parse a raw inbound message with the server's data type serializer, returning the
 * structured message tree as XML — the same shape `IMessageSerializer.toXML()`
 * produces for real message processing, i.e. what the Java Swing client's own Msg
 * Tree preview is built from.
 *
 * `dataType` is sent as a query parameter (not a path segment) because values like
 * `EDI/X12` contain a slash that would otherwise break path matching.
 *
 * Throws `ApiError` (400) when `dataType` is unknown/blank or `message` fails to
 * parse as that data type — callers should surface the error text as the tree's
 * parse-error state, matching how the client-side fallback reports a bad template.
 */
export async function dataTypeToTree(dataType: string, message: string): Promise<string> {
  return request<string>(`/datatypes/_toTree?dataType=${encodeURIComponent(dataType)}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: message,
    rawText: true,
  });
}
