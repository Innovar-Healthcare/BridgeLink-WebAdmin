import type * as MonacoType from "monaco-editor";

/**
 * Keep Monaco's cached font metrics in sync with our self-hosted editor
 * typefaces.
 *
 * Monaco measures character widths once, when an editor is constructed, and
 * caches the result as trusted — it never re-reads it on its own (there is no
 * `document.fonts` / FontFaceSet handling anywhere in monaco-editor). Our editor
 * faces are webfonts declared `font-display: swap` in app/globals.css, so the
 * first editor on a cold cache measures the Menlo fallback, caches those widths,
 * and then the real face swaps in underneath it — leaving the cursor, selection
 * highlights, and indent guides visibly offset from the glyphs for the rest of
 * the editor's life.
 *
 * `monaco.editor.remeasureFonts()` clears that cache globally and fires a change
 * every live editor observes, so a single document-level listener fixes every
 * editor in the app. That is why this is a module-level singleton rather than a
 * per-editor registration like its siblings in `composeEditorMount`: calling it
 * once per editor would force one full relayout of every open editor per mount.
 */
let attached = false;

export function attachFontRemeasure(monaco: typeof MonacoType): void {
  if (attached) return;

  // FontFaceSet is not implemented in happy-dom, so this is a no-op under unit
  // test. `document.fonts` is non-optional in lib.dom, hence the explicit type.
  const fonts: FontFaceSet | undefined =
    typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return;

  attached = true;

  const remeasure = () => monaco.editor.remeasureFonts();

  // The common case: this editor's own measurement pass just referenced the
  // family, which kicked off the woff2 fetch, so loading is still in flight.
  void fonts.ready.then(remeasure);

  // Later settles that `ready` (captured above) will never see: a bold token
  // rendering for the first time pulls the 700 face, and switching families in
  // Settings pulls a face that was never fetched.
  fonts.addEventListener("loadingdone", remeasure);
}

/** Test-only: reset the module-level guard between cases. */
export function resetFontRemeasureForTests(): void {
  attached = false;
}
