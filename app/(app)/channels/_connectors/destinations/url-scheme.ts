/**
 * Whether a URL uses the https scheme, mirroring Java's `isUsingHttps()` (WebServiceSender /
 * HttpSender): read the URI scheme and compare it to "https". Java's `new URI(...)` accepts
 * scheme-less strings (scheme = null → not https), so we match the scheme with a URI-scheme
 * regex rather than JS `new URL()`, which is stricter and would wrongly treat e.g.
 * "https-no-scheme" as https.
 *
 * Shared by the Web Service Sender and HTTP Sender destination panels, which both render an
 * "SSL Not Configured" decoration on https URLs (see.
 */
export function isUsingHttps(url: string): boolean {
  if (!url || !url.trim()) return false;
  const scheme = url.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return scheme ? scheme[1].toLowerCase() === "https" : false;
}
