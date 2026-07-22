/**
 * One-time Monaco loader configuration.
 *
 * `@monaco-editor/react`'s underlying loader defaults to fetching monaco-editor
 * from the jsdelivr CDN at runtime. We instead serve it same-origin from
 * `/monaco/<version>/vs` — vendored at build time by `scripts/copy-monaco.mjs` —
 * so editors work offline / air-gapped and satisfy the app CSP (`script-src 'self'`).
 *
 * `loader.config()` must run before the first `loader.init()` (which
 * `@monaco-editor/react` calls in each editor's mount effect): the first init wins
 * and ignores any later config. Calling `configureMonacoLoader()` at module-eval
 * time — via the side-effect import at the top of the `(app)` shell, which wraps
 * every route that renders an editor — guarantees that ordering, because module
 * evaluation precedes any child component's effects.
 *
 * The version-namespaced path matches `NEXT_PUBLIC_MONACO_VERSION` (injected from
 * the installed monaco-editor in `next.config.ts`), keeping the served path and the
 * vendored assets in lockstep.
 *
 * Note: the worker URLs Monaco derives resolve against `document.baseURI`. If a
 * Next.js `basePath` or a `<base>` tag is ever introduced, revisit the path here.
 */

import { loader } from "@monaco-editor/react";

let configured = false;

/**
 * Point the Monaco loader at the self-hosted assets. Idempotent and a no-op
 * during SSR (no `window`); safe to call from multiple module entry points.
 */
export function configureMonacoLoader(): void {
  if (configured) return;
  // SSR: defer to the client. Don't mark configured, so the browser can retry.
  if (typeof window === "undefined") return;
  configured = true;
  const version = process.env.NEXT_PUBLIC_MONACO_VERSION;
  const vs = version ? `/monaco/${version}/vs` : "/monaco/vs";
  loader.config({ paths: { vs } });
}

configureMonacoLoader();
