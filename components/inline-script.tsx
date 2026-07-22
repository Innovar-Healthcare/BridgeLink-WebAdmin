/**
 * Renders an inline `<script>` that runs synchronously during HTML parsing on
 * the server (so it can mutate the DOM before first paint — e.g. to apply the
 * saved theme and avoid a flash), without tripping React 19's warning about
 * script tags rendered inside components.
 *
 * On the server the tag is emitted as `type="text/javascript"`, so the browser
 * executes it while parsing the initial HTML. On the client it renders as
 * `type="text/plain"`, so React never tries to (re-)execute it and stays quiet.
 * `suppressHydrationWarning` covers the intentional `type` attribute mismatch.
 *
 * This is the pattern documented in the Next.js "Preventing flash before
 * hydration" guide.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
