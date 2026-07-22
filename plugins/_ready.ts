/**
 * Plugin readiness barrier.
 *
 * Core route files and pages await `pluginsReady` before reading from
 * `pluginRegistry`, so the lookup waits for plugin registration to finish.
 *
 * Today, plugins are bundled at build time and `plugins/index.ts` (generated
 * by `scripts/generate-plugin-index.mjs`) calls `_markPluginsReady()` after
 * its synchronous static imports complete — `pluginsReady` resolves before
 * any awaiter sees it. When we move to runtime plugin loading, the same
 * promise resolves only after all `import()`s have completed; route files
 * keep working without changes.
 */

let resolveReady!: () => void;

export const pluginsReady: Promise<void> = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

/** Called by the plugin loader after all plugin modules have registered. */
export function _markPluginsReady(): void {
  resolveReady();
}
