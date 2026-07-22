import { getServerUrl } from "@/lib/api-client";

/**
 * Resolve the connected server's host for read-only listener URL previews.
 *
 * Mirrors the Java client's `new URI(PlatformUI.SERVER_URL).getHost()` with a
 * "<server ip>" fallback when the URL can't be parsed (see
 * HttpListener.updateHttpUrl() and WebServiceListener.updateWSDL()).
 *
 * Reads sessionStorage via getServerUrl(), so call only after mount (guard with
 * useMounted) to avoid an SSR/hydration mismatch.
 */
export function resolveServerHost(): string {
  try {
    const url = getServerUrl();
    if (url) return new URL(url).hostname;
  } catch {
    // ignore — fall through to placeholder
  }
  return "<server ip>";
}
