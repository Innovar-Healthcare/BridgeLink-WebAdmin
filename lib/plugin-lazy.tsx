"use client";

/**
 * Lazy plugin UI components.
 *
 * The client-side counterpart to `registerRouteHandlerLazy()`,
 * lib/plugin-registry.ts): the single documented way for a plugin to contribute
 * a UI surface (page, channel-editor tab, dialog, overlay, attachment viewer)
 * WITHOUT its component graph landing in the app-shell's initial-load chunks.
 *
 * `lazyPluginComponent(() => import("./x").then((m) => m.X))` returns a
 * `ComponentType` whose `() => import(...)` thunk is deferred until the surface
 * first renders, so a dormant plugin's heavy component code (react-markdown,
 * node-forge paths, big dialogs) is code-split into an on-demand chunk. The
 * plugin's manifest metadata (slug, nav entry, gates, `licensedPluginId`) stays
 * eager and synchronous — only the component payload is lazy.
 *
 * Why this lives OUTSIDE lib/plugin-manifest.ts: the manifest is imported by
 * server route files (via the `@/plugins` barrel) for login/route bundle
 * hygiene, and must stay free of `next/dynamic`. This module is `"use client"`,
 * and `next/dynamic({ ssr: false })` is only valid in a client module — so
 * plugins call `lazyPluginComponent` from a `"use client"` `lazy-surfaces`
 * module, never from a server-reachable barrel path.
 *
 * Fallback rule (see docs/PLUGIN-DEVELOPMENT.md):
 *   - Pages / channel-editor tabs mount only when navigated-to/selected — pass a
 *     visible fallback (`{ loading: PluginSurfaceFallback }`).
 *   - Dialog / overlay slots are mounted-but-`open`-controlled (they render in
 *     the tree whenever the slot is filled + enabled, regardless of `open`) —
 *     omit `loading` so the default `() => null` shows nothing behind a closed
 *     dialog. The chunk loads on first mount; the delay on first open is
 *     imperceptible.
 */

import dynamic from "next/dynamic";
import type { DynamicOptions } from "next/dynamic";
import { Component, type ComponentType, type ReactNode } from "react";
import { logWarn } from "@/lib/dev-logger";

/**
 * Visible loading fallback for lazy plugin pages and channel-editor tabs.
 * `h-full` (not `flex-1`) so it centers correctly regardless of whether the
 * immediate parent is itself a flex container: it resolves against any
 * ancestor with a definite height (the `/p/{slug}` page's `<main>` is a plain
 * block element sized via an ancestor flex chain; the channel-editor tab host
 * IS a flex column) — `flex-1` only has an effect in the latter case.
 */
export function PluginSurfaceFallback() {
  return (
    <div className="h-full flex items-center justify-center p-6 text-xs text-muted-foreground">
      Loading…
    </div>
  );
}

interface LazyErrorBoundaryProps {
  children: ReactNode;
}
interface LazyErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches a failed plugin chunk load (e.g. a stale reference to a chunk a
 * newer deploy removed) and shows a reload prompt instead of crashing the
 * app's top-level error boundary.
 *
 * `next/dynamic`'s `loading` prop CANNOT see this failure: despite
 * `DynamicOptionsLoadingProps` declaring `error`/`retry` fields, the installed
 * runtime (next/dist/shared/lib/lazy-dynamic/loadable.js) always calls
 * `loading` with the fixed `{ isLoading: true, pastDelay: true, error: null }`
 * while the import is pending — a REJECTED import throws during render for
 * `React.lazy` to surface, which only an Error Boundary above it can catch.
 * A full reload (not a soft retry) is the only correct recovery: a stale chunk
 * reference comes from an old page load whose asset manifest no longer matches
 * the server, so re-attempting the same `import()` would fail again.
 */
class LazyErrorBoundary extends Component<LazyErrorBoundaryProps, LazyErrorBoundaryState> {
  state: LazyErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    logWarn("plugin-lazy", "plugin chunk failed to load", error);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
          <span>Failed to load. A newer version may be available.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-primary underline underline-offset-2"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Wrap a dynamic import thunk as a lazy plugin `ComponentType`. Mirrors
 * `registerRouteHandlerLazy` for UI: the module is imported on first render, not
 * at plugin-registration time. The returned component is wrapped in a
 * `LazyErrorBoundary` so a failed chunk load degrades to a reload prompt
 * instead of an uncaught render-time crash.
 *
 * @param loader thunk resolving to the component, e.g.
 *   `() => import("./version-history-page").then((m) => m.VersionHistoryPage)`
 * @param opts.loading fallback shown while the chunk loads. Defaults to
 *   `() => null` (correct for mounted-but-closed dialogs/overlays); pass
 *   `PluginSurfaceFallback` for pages/tabs.
 */
export function lazyPluginComponent<P extends object = Record<string, never>>(
  loader: () => Promise<ComponentType<P>>,
  opts?: { loading?: DynamicOptions["loading"] }
): ComponentType<P> {
  const Lazy = dynamic(loader, {
    ssr: false,
    loading: opts?.loading ?? (() => null),
  });

  function LazyPluginSurface(props: P): ReactNode {
    return (
      <LazyErrorBoundary>
        <Lazy {...props} />
      </LazyErrorBoundary>
    );
  }

  return LazyPluginSurface;
}
