import type { BeforeMount } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";

/**
 * The app's Monaco color themes — one for light mode, one for dark, both
 * carrying the token rules for *every* language the app renders.
 *
 * Why one merged theme instead of a theme per language:
 *
 * Monaco themes are **global per Monaco instance**, not per editor.
 * `monaco.editor.setTheme()` re-colors every editor on the page, and
 * `@monaco-editor/react` calls it on each editor mount and on each change of the
 * `theme` prop. So the last editor to mount wins for the whole page, and two
 * themes with disjoint token rules silently strip each other's colors.
 *
 * That cost us the same bug twice. a template editor on plain
 * vs/vs-dark clobbered a sibling HL7 template editor's colors. Its fix — pinning
 * every template editor to an hl7v2 theme — then produced opening the
 * Message Templates panel stripped every mirth-js color from the JavaScript step
 * on the same page, and switching that page's detail pane to the Generated
 * Script tab stripped the HL7 colors right back. Both panes are visible at once,
 * so no mount-order rule can settle it.
 *
 * The rules of the two languages have no token names in common, so a single
 * theme carrying the union serves both at once. Monaco matches theme rules by
 * dotted-segment prefix, which is also why the Rhino E4X rules here
 * (`tag.xml.js` and friends) leave a plain `xml` editor identical to stock `vs`:
 * `tag.xml.js` is not a prefix of the XML language's `tag.xml`.
 *
 * `components/monaco-editor.tsx` owns applying this. No other module should name
 * a theme — `MonacoEditor` does not accept a `theme` prop, because per-editor
 * theming is not something Monaco can deliver.
 */

/** A Monaco theme token rule. Narrower than Monaco's own type, which allows `background`. */
export interface ThemeTokenRule {
  /** Token name as emitted by a tokenizer, e.g. `mirthGlobalBlue.js` or `hl7-pipe`. */
  token: string;
  /** Six-digit hex, no leading `#`. */
  foreground?: string;
  fontStyle?: string;
}

/**
 * Rhino JS (`rhino-js`) token colors, matching the Java UI's
 * MirthJavaScriptTokenMaker:
 *   Blue   (#0000FF) — context vars, maps, shorthand helpers  (MARKUP_TAG_NAME)
 *   Purple (#7B2D8B) — utility classes, logger, HL7 segments  (LITERAL_BOOLEAN)
 *   Brown  (#7B5000) — helper functions                        (FUNCTION)
 *
 * The tokenizer sets `tokenPostfix: ".js"`, hence the suffix on every name.
 * These must stay in step with `buildRhinoMonarchLanguage()` in
 * `lib/monaco-rhino.ts`; `__tests__/unit/monaco-theme.test.ts` locks the list.
 */
const RHINO_RULES_LIGHT: ThemeTokenRule[] = [
  { token: "mirthGlobalBlue.js", foreground: "0000FF" },
  { token: "mirthGlobalPurple.js", foreground: "7B2D8B" },
  { token: "mirthGlobalFunction.js", foreground: "7B5000" },
  // E4X XML tokens — approximate RSyntaxTextArea XML-in-JS colors
  { token: "tag.xml.js", foreground: "800000" },
  { token: "attribute.name.xml.js", foreground: "FF0000" },
  { token: "attribute.value.xml.js", foreground: "0000FF" },
  { token: "comment.xml.js", foreground: "3F7F5F" },
  // JSDoc — exact RSyntaxTextArea defaults from the Java client.
  // Without these, comment.doc.js falls back to the inherited "comment" rule
  // and JSDoc renders in plain comment green.
  { token: "comment.doc.js", foreground: "A40000" }, // COMMENT_DOCUMENTATION
  { token: "comment.doc.tag.js", foreground: "FF9800" }, // COMMENT_KEYWORD
  { token: "comment.doc.markup.js", foreground: "808080" }, // COMMENT_MARKUP
];

const RHINO_RULES_DARK: ThemeTokenRule[] = [
  { token: "mirthGlobalBlue.js", foreground: "6CB6FF" }, // light blue
  { token: "mirthGlobalPurple.js", foreground: "D4AAFF" }, // light lavender
  { token: "mirthGlobalFunction.js", foreground: "FFAB70" }, // light amber
  // E4X XML tokens
  { token: "tag.xml.js", foreground: "F28B82" }, // salmon
  { token: "attribute.name.xml.js", foreground: "9CDCFE" }, // light blue
  { token: "attribute.value.xml.js", foreground: "CE9178" }, // orange-tan
  { token: "comment.xml.js", foreground: "6A9955" }, // muted green
  // JSDoc. The Java client has no dark theme, so these are
  // lightened analogs of its light values, kept clear of the nearest hues
  // already in use here (tag.xml F28B82, mirthGlobalFunction FFAB70).
  { token: "comment.doc.js", foreground: "C48B8B" }, // muted brick
  { token: "comment.doc.tag.js", foreground: "E5B567" }, // muted gold
  { token: "comment.doc.markup.js", foreground: "9A9A9A" }, // gray
];

/**
 * HL7 v2 (`hl7v2`) token colors. Must stay in step with the tokenizer in
 * `lib/monaco-hl7v2.ts`; the unit test locks the list.
 */
const HL7V2_RULES_LIGHT: ThemeTokenRule[] = [
  { token: "hl7-segment", foreground: "0000FF", fontStyle: "bold" },
  { token: "hl7-pipe", foreground: "999999" },
  { token: "hl7-caret", foreground: "CC7700" },
  { token: "hl7-tilde", foreground: "CC00CC" },
  { token: "hl7-amp", foreground: "009999" },
  { token: "hl7-escape", foreground: "AA0000", fontStyle: "italic" },
  { token: "hl7-value", foreground: "333333" },
];

const HL7V2_RULES_DARK: ThemeTokenRule[] = [
  { token: "hl7-segment", foreground: "79B8FF", fontStyle: "bold" },
  { token: "hl7-pipe", foreground: "6A737D" },
  { token: "hl7-caret", foreground: "E6A445" },
  { token: "hl7-tilde", foreground: "FF79C6" },
  { token: "hl7-amp", foreground: "56C8C8" },
  { token: "hl7-escape", foreground: "F97070", fontStyle: "italic" },
  { token: "hl7-value", foreground: "CDD5DE" },
];

/**
 * Shade the line-number gutter so it reads as a non-editable margin, delineated
 * from the edit area item 4). This began as a mirth-js-only treatment;
 * merging the themes applies it to every editor, which is the intended outcome —
 * the rationale is language-agnostic.
 */
const GUTTER_COLORS_LIGHT: Record<string, string> = {
  "editorGutter.background": "#f3f4f6",
  "editorLineNumber.foreground": "#9ca3af",
  "editorLineNumber.activeForeground": "#374151",
};

// Values match VS Code's dark gutter tone so it stays subtle against vs-dark.
const GUTTER_COLORS_DARK: Record<string, string> = {
  "editorGutter.background": "#252526",
  "editorLineNumber.foreground": "#858585",
  "editorLineNumber.activeForeground": "#c6c6c6",
};

export const MONACO_THEME_LIGHT = "bridgelink-light";
export const MONACO_THEME_DARK = "bridgelink-dark";

/** The theme name for the current color mode. */
export function monacoTheme(isDark: boolean): string {
  return isDark ? MONACO_THEME_DARK : MONACO_THEME_LIGHT;
}

// Mutable so plugin-contributed data types can append their own token colors
// (see registerMonacoThemeRules). Seeded with the app's own languages.
const lightRules: ThemeTokenRule[] = [...RHINO_RULES_LIGHT, ...HL7V2_RULES_LIGHT];
const darkRules: ThemeTokenRule[] = [...RHINO_RULES_DARK, ...HL7V2_RULES_DARK];

/** The Monaco instance we last registered against, for re-defining after a rule append. */
let lastMonaco: typeof MonacoType | null = null;
let themesDefined = false;

function defineThemes(monaco: typeof MonacoType): void {
  const light: MonacoType.editor.IStandaloneThemeData = {
    base: "vs",
    inherit: true,
    rules: lightRules,
    colors: GUTTER_COLORS_LIGHT,
  };
  const dark: MonacoType.editor.IStandaloneThemeData = {
    base: "vs-dark",
    inherit: true,
    rules: darkRules,
    colors: GUTTER_COLORS_DARK,
  };

  monaco.editor.defineTheme(MONACO_THEME_LIGHT, light);
  monaco.editor.defineTheme(MONACO_THEME_DARK, dark);

  // Safety net for any editor that never reaches our wrapper. @monaco-editor/react
  // defaults its `theme` prop to "light", which Monaco does not know and silently
  // resolves to "vs"; a direct monaco.editor.create() elsewhere would land there
  // too. Shadowing the two built-in names means even those editors carry our rules
  // instead of resetting the page. Redefining a built-in is safe — `inherit`
  // resolves through Monaco's static getBuiltinRules(base) table, not through the
  // registry we are writing to, so there is no recursion.
  monaco.editor.defineTheme("vs", light);
  monaco.editor.defineTheme("vs-dark", dark);
}

/**
 * Monaco BeforeMount hook that defines the app themes. Idempotent — safe to pass
 * to every editor. `beforeMount` runs before `editor.create()`, which is what
 * applies the theme, so registration always precedes the first setTheme.
 */
export const registerMonacoThemes: BeforeMount = (monaco) => {
  lastMonaco = monaco;
  if (themesDefined) return;
  themesDefined = true;
  defineThemes(monaco);
};

/**
 * Append token colors contributed by a data-type plugin (the `tokenMarker`
 * extension point) and re-define the themes so already-mounted editors pick them
 * up — Monaco re-applies the active theme when it is redefined, so no remount is
 * needed.
 *
 * Collisions are NOT guarded: Monaco gives the last rule for a selector
 * precedence, so a plugin reusing an app token name (`hl7-segment`, say) would
 * restyle it page-wide. Use token names unique to the plugin — the same warning
 * is on `MonacoTokenProvider.tokenRules`, which is where authors will read it.
 *
 * No-op until an editor has mounted at least once (nothing to register against);
 * the rules are still recorded and land on the next registerMonacoThemes call.
 */
export function registerMonacoThemeRules(
  light: readonly ThemeTokenRule[],
  dark?: readonly ThemeTokenRule[]
): void {
  if (light.length === 0 && !dark?.length) return;
  lightRules.push(...light);
  darkRules.push(...(dark ?? light));
  if (lastMonaco && themesDefined) defineThemes(lastMonaco);
}
