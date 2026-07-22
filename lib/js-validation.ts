/**
 * Lightweight client-side JS syntax checking that is aware of BridgeLink's Rhino
 * scripting environment.
 *
 * BridgeLink executes channel scripts via Rhino, which supports E4X (ECMAScript for XML)
 * — constructs like `for each (var x in obj)`, `msg..OBX`, `.@attr`, and inline XML literals
 * (`new XML(<OBX/>)`) that standard JS parsers reject as syntax errors. To still catch real
 * syntax errors sitting alongside E4X, we handle E4X in two ways before parsing:
 *
 *   1. **XML literals** are parsed natively by `acorn-jsx` — E4X XML-literal syntax is nearly
 *      identical to JSX, so acorn extended with the JSX plugin accepts `<OBX/>`, `<foo>bar</foo>`,
 *      fragments, and namespaced tags while still throwing on genuine JS errors next to them.
 *   2. **E4X operators** (`for each`, descendant `..`, attribute `.@`, namespace `::`, filter
 *      `.(pred)`) are rewritten to equivalent plain JS by `neutralizeE4XOperators`. Every one uses
 *      characters illegal in plain JS, so the rewrite is length-preserving and cannot corrupt valid
 *      code — which keeps acorn's error line/column exact (no remapping needed).
 *
 * A few rarer forms acorn-jsx still cannot represent (CDATA, array comprehensions, Rhino
 * conditional `catch`, `default xml namespace`) are deferred via `hasResidualE4X` — returning
 * "no error" rather than risk a false positive that would wrongly block a save. The future
 * server-side Rhino validation endpoint is the path to validating those too.
 *
 * Parser: `acorn` + `acorn-jsx`. Acorn's error messages include line:column info that we
 * re-format into "Error on line N: <message>" to match the Java client's `ScriptPanel.java`
 * formatting and give the user a clear pointer to the offending line.
 */

import { Parser, tokenizer as acornTokenizer, type Options } from "acorn";
import acornJsx from "acorn-jsx";

// E4X XML *literals* — matched against the RAW source. Their text content can hold //, ', or "
// (URLs, apostrophes), which a comment/string scanner would misread, and XML literals essentially
// never appear in comments — so matching raw is both safe (no false errors) and correct. Every
// well-formed XML literal carries a closing tag, self-close, or CDATA marker, so these suffice.
const E4X_XML_PATTERNS: RegExp[] = [
  /<\/[A-Za-z_][\w.:-]*\s*>/, // closing tag </foo> or </ns:foo> (namespaced QName)
  /<[A-Za-z_][\w.:-]*(?:\s+[^<>]*)?\/>/, // self-closing <foo/> or <ns:foo/>
  /<>|<\/>/, // empty XMLList literal — e.g. var list = <>{a}{b}</>;
  /<!\[CDATA\[/, // CDATA literal
];

// E4X operator/keyword forms — matched against a source with comments blanked out, because they
// commonly appear in commented-out code (e.g. the default code-template stub's
// `// for each (var seg in msg['PID']) {}`), which must not suppress validation of live code
//. Strings and regex literals are consumed and blanked by the scanner too, so a match
// inside one can only cause a (safe) skip, never a false error. Also covers a couple of
// Rhino/legacy-SpiderMonkey extensions acorn rejects.
const E4X_OPERATOR_PATTERNS: RegExp[] = [
  /\bfor\s+each\s*\(/, // for each (var x in obj) — E4X iterator
  /\bdefault\s+xml\s+namespace/i, // default xml namespace = ...
  /\.@/, // attribute accessor — e.g. tmp.PID.@value
  /[A-Za-z_$][\w$]*::/, // namespace qualifier — e.g. msg.ns::OBX
  /[\w$)\]]\s*\.\./, // descendant accessor — e.g. msg..OBX or msg .. OBX
  /\.\(/, // filtering predicate — e.g. msg.OBX.(OBX1 == 'x')
  /\bcatch\s*\([^)]*\bif\b/, // Rhino conditional catch — e.g. catch (e if e instanceof Error)
  /\[[^\]]*\bfor\s*\(/, // JS 1.7 array comprehension — e.g. [i * 2 for (i in list)]
];

// ── E4X operator neutralization ────────────────────────────────────────────────────────────
//
// The E4X *operators* below are rewritten to equivalent plain JS so acorn-jsx can parse the rest
// of the script and surface any real syntax error. E4X operators center on characters that are
// (almost always) illegal in plain JS (`@`, `::`, `for each`, and `..`/`.(` in operator position),
// so — with the few genuine plain-JS overlaps guarded against (the spread `...`, optional-call
// `?.(`, and the numeric-member `1..toString()` idiom, all excluded by the anchors/lookarounds
// below) — the substitutions do not turn valid JS into invalid JS. Each is length-preserving (same
// char count, no newlines added or removed), so acorn's reported line/column map 1:1 onto the
// original source with no remapping. Because they keep length, running them on raw text is safe
// even inside strings/comments/regex: a rewrite there only changes literal *content*, never its
// validity or length — with one guarded exception. The wildcard/attribute-wildcard rules must not
// consume the `*` of a block-comment close delimiter (a comment ending in `word.` immediately
// before it reads as an E4X `.*`/`.@*`); both therefore refuse a `*` that is immediately followed
// by `/`, which is only ever a comment close, never a real E4X wildcard follow-up).

// A left operand a descendant/wildcard accessor can attach to: an identifier (at a token
// boundary, so it can't anchor mid-token inside a numeric literal like `1_000`), `)`, or `]`.
const E4X_LEFT_OPERAND = /((?<![\w$])[A-Za-z_$][\w$]*|[)\]])/.source;

// A well-formed XML open/close/self-close tag — `<foo …>`, `</foo>`, `<foo/>`. Attributes are
// matched with `[^<>]` (which stops at the tag's own `>`, the same simplification the self-closing
// `E4X_XML_PATTERNS` entry already uses; an attribute value containing a literal `>` is vanishingly
// rare in HL7/E4X XML). Used to scope the period-in-name rewrite to XML names only (see below).
const E4X_XML_TAG = /<\/?[A-Za-z_][\w.:-]*(?:\s+[^<>]*?)?\/?\s*>/g;

function neutralizeE4XOperators(script: string): string {
  return (
    script
      // Period inside an XML tag/attribute *name* — `<PID.3/>`, `<foo attribute1.a="x">`. E4X allows
      // a period anywhere in an XML name but the first char; acorn-jsx reads `<PID.3>` as a JSX
      // member expression (`PID` `.` `3`) and rejects it. Within a well-formed XML tag, rewrite each
      // word-bounded period to `_` — a valid JSX name char. Word-bounded (`\w.\w`) so it can't merge
      // tokens across whitespace; scoped to a matched tag so ordinary member access outside XML is
      // untouched. An open tag and its matching close tag rewrite identically, so they stay balanced
      // (`<foo.bar>…</foo.bar>` → `<foo_bar>…</foo_bar>`); namespaced names keep the `:`. A period in
      // a tag's quoted value or `{expr}` interpolation is only rewritten to another valid form
      // (masking a rare in-attribute error, never a false error). Length-preserving, so acorn's
      // error line/column still map 1:1 onto the original source.
      .replace(E4X_XML_TAG, (tag) => tag.replace(/(?<=[\w])\.(?=[\w])/g, "_"))
      // `for each (` → `for      (`   (blank the 4-char `each` keyword)
      .replace(/\bfor(\s+)each\b/g, (_m, ws: string) => "for" + ws + "    ")
      // computed attribute `.@[expr]` / `..@[expr]` → computed member (blank every `.`/`@`). Must
      // precede the descendant and bare-`@` rules, which would otherwise leave a stray `.`/`@`.
      .replace(/\.{1,2}\s*@(?=\s*\[)/g, (m) => m.replace(/[.@]/g, " "))
      // descendant `msg..OBX` → `msg. OBX`. Anchored to a left operand (with optional whitespace)
      // so it neutralizes real E4X descendants — incl. digit-suffixed names (`seg1..OBX`) and
      // `arr[0]..OBX` — without touching the numeric-member idiom `1..toString()` (where `1.` is
      // the number, not a descendant) or the spread `...`.
      .replace(new RegExp(E4X_LEFT_OPERAND + /(\s*)\.\.(?!\.)/.source, "g"), "$1$2. ")
      // wildcard selector `msg.*` → `msg.a` (and the `msg. *` left by the descendant rule on
      // `msg..*`). Same left anchor keeps the multiplication `1.*2` untouched. The `(?!\/)` refuses a
      // `*` that is a block-comment close (`word. */`) — never a real E4X wildcard — so a comment
      // ending in a period stays terminated.
      .replace(new RegExp(E4X_LEFT_OPERAND + /(\s*)\.(\s*)\*(?!\/)/.source, "g"), "$1$2.$3a")
      // filtering predicate `x.(pred)` → call `x (pred)`   (blank only the `.`; not optional-call `?.(`)
      .replace(/(?<!\?)\.\(/g, " (")
      // namespace qualifier before a computed local name `ns::[expr]` (incl. `.*::[expr]`, after the
      // wildcard rule above rewrote `.*` → `.a`) → blank, NOT `. ` — a `.` before `[` is illegal JS
      // (`x.a.['recordTarget']`). Must precede the general `::` rule below.
      .replace(/::(?=\s*\[)/g, "  ")
      // namespace qualifier `ns::name` → member `ns. name`
      .replace(/::/g, ". ")
      // attribute wildcard `.@*` → `.a `   (valid member; must precede the bare-`@` rule). `(?!\/)`
      // leaves a block-comment close (`@*/`) for the bare-`@` rule below, which blanks only the `@`
      // and keeps the `*/` terminator intact.
      .replace(/@\*(?!\/)/g, "a ")
      // attribute sigil `.@name` → `. name`   (and standalone `@id` in predicates → ` id`)
      .replace(/@/g, " ")
  );
}

// E4X forms that survive neutralization AND acorn-jsx still cannot parse. We defer (report "no
// error") when one is present, preserving the never-a-false-error invariant. The future
// server-side Rhino validation endpoint will cover these. Matched on the neutralized source; a
// stray match inside a string/regex only causes a safe defer, never a false error.
const RESIDUAL_E4X_PATTERNS: RegExp[] = [
  /<!\[CDATA\[/, // CDATA literal — <![CDATA[ ... ]]>
  /<!--/, // XML comment inside a literal — <a><!-- ... --></a>
  /<\?/, // XML processing instruction inside a literal — <a><?pi ...?></a>
  /<\/?\{/, // computed XML tag name — <{expr}> ... </{expr}>
  /\bdefault\s+xml\s+namespace/i, // default xml namespace = ...
  /\bcatch\s*\([^)]*\bif\b/, // Rhino conditional catch — catch (e if ...)
  // JS 1.7 array comprehension — `[expr for (x in y)]`. Requires the comprehension shape
  // (`for ( [var] ident in|of`), so a plain array containing a for-loop or a `.for(...)` method
  // call is still validated rather than deferred. `;` before `for` (a broken array) also disqualifies.
  /\[[^\];]*\bfor\s*\(\s*(?:var\s+|let\s+|const\s+)?[A-Za-z_$][\w$]*\s+(?:in|of)\b/,
];

function hasResidualE4X(code: string): boolean {
  return RESIDUAL_E4X_PATTERNS.some((re) => re.test(code));
}

// acorn-jsx emits these messages only from JSX/XML text context — a bare `>` or `}` in element
// text (valid E4X character data that JSX rejects). Deferring on them can never mask a real
// plain-JS syntax error, which always surfaces as a generic "Unexpected token".
const JSX_TEXT_ONLY_ERROR = /Did you mean `&(?:gt|rbrace);`/;

// acorn extended with the JSX plugin: parses E4X XML literals (JSX-shaped) while still rejecting
// genuine JS syntax errors. Built once at module load.
const JsxParser = Parser.extend(acornJsx());

// Punctuation after which a `/` starts a regex literal rather than a division operator.
const REGEX_ALLOWED_AFTER = new Set([
  "",
  "(",
  "[",
  "{",
  ",",
  ";",
  ":",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "?",
  "&",
  "|",
  "^",
  "~",
  "<",
  ">",
]);

// Keywords after which a `/` starts a regex literal (e.g. `return /re/`).
const REGEX_ALLOWED_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * Blank out line/block comments (replaced with spaces so offsets and line breaks are preserved),
 * so the E4X operator heuristics only see live code — commented-out E4X must not suppress
 * validation of real code. String, template, and regex literals are consumed as whole
 * spans (so a `//`, `'`, `"`, or `*` inside them can't open a phantom comment) and blanked;
 * template literals are emitted verbatim so E4X in a `${…}` interpolation still counts. This is a
 * heuristic for the E4X operator gate only — XML literals are matched separately on the raw source.
 */
function blankComments(src: string): string {
  let out = "";
  let prev = ""; // last emitted non-whitespace char, to tell a regex `/` from division
  let prevWord = ""; // last identifier/keyword run, for `return /re/`-style regex context
  const n = src.length;
  for (let i = 0; i < n; ) {
    const c = src[i];
    const c2 = src[i + 1];

    // line comment → blank to end of line
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    // block comment → blank, preserving newlines
    if (c === "/" && c2 === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      prev = "";
      prevWord = "";
      continue;
    }

    // regex literal → consume the whole span (so its /, //, quotes don't misfire) and blank it
    if (c === "/" && (REGEX_ALLOWED_AFTER.has(prev) || REGEX_ALLOWED_AFTER_WORD.has(prevWord))) {
      out += " ";
      i++;
      let inClass = false;
      while (i < n) {
        const rc = src[i];
        if (rc === "\n") break; // unterminated; bail without consuming the newline
        if (rc === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
        if (rc === "[") inClass = true;
        else if (rc === "]") inClass = false;
        else if (rc === "/" && !inClass) break; // closing delimiter
      }
      prev = "/";
      prevWord = "";
      continue;
    }

    // string / template literal → consume the whole span; blank quotes but keep template
    // interpolations verbatim so `${msg..OBX}` still counts as E4X. Only backtick templates may
    // span raw newlines — a raw newline inside a '/" literal means it was never a real string, so
    // we bail there, confining any misparse (e.g. a stray quote in a mis-detected regex) to one line.
    if (c === '"' || c === "'" || c === "`") {
      const verbatim = c === "`";
      out += verbatim ? c : " ";
      i++;
      while (i < n && src[i] !== c) {
        if (!verbatim && src[i] === "\n") break; // unterminated '/" literal — stop at the newline
        if (src[i] === "\\") {
          out += verbatim ? src[i] : " ";
          i++;
          if (i < n) {
            out += verbatim ? src[i] : src[i] === "\n" ? "\n" : " ";
            i++;
          }
          continue;
        }
        out += verbatim ? src[i] : src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n && src[i] === c) {
        out += verbatim ? src[i] : " "; // closing delimiter
        i++;
      }
      prev = c;
      prevWord = "";
      continue;
    }

    // normal character
    out += c;
    i++;
    if (/\s/.test(c)) continue;
    prev = c;
    prevWord = /[\w$]/.test(c) ? prevWord + c : "";
  }
  return out;
}

export function looksLikeE4X(script: string): boolean {
  // XML literals: raw source (their text content would break the scanner). Operator/keyword
  // forms: comment-blanked source (so commented-out E4X doesn't suppress validation of live code).
  if (E4X_XML_PATTERNS.some((re) => re.test(script))) return true;
  const code = blankComments(script);
  return E4X_OPERATOR_PATTERNS.some((re) => re.test(code));
}

interface AcornSyntaxError extends Error {
  loc?: { line: number; column: number };
  pos?: number;
}

/** Acorn parse options shared by every validation entry point below. */
const ACORN_PARSE_OPTIONS: Options = {
  ecmaVersion: "latest",
  sourceType: "script",
  // BridgeLink scripts use top-level `return` (Rhino wraps them in a function).
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowHashBang: true,
};

/** A single syntax error located in the user's source. */
export interface JsSyntaxError {
  /** 1-based line of the error. */
  line: number;
  /** 0-based column from acorn (add 1 for 1-based UIs such as Monaco markers). */
  column: number;
  /** Error text with acorn's trailing " (line:col)" suffix stripped. */
  message: string;
}

/**
 * Parse `script` and return the first syntax error (structured), or `null` if it parses
 * cleanly. E4X XML literals are parsed via acorn-jsx and E4X operators are neutralized first
 * (see the module header), so real errors are caught even alongside E4X. Scripts using a
 * residual E4X form acorn-jsx cannot represent (CDATA, comprehensions, conditional catch,
 * `default xml namespace`) return `null` — deferred to the server's Rhino rather than risk a
 * false error. Non-strict, mirroring the Java client's Rhino validation (`Context.VERSION_DEFAULT`,
 * no `"use strict"`).
 *
 * Use this when you need the line/column (e.g. to place an editor marker); use
 * `tryParseJs` when a display string is enough.
 */
export function findJsSyntaxError(script: string): JsSyntaxError | null {
  const code = neutralizeE4XOperators(script);
  if (hasResidualE4X(code)) return null;
  try {
    // Length-preserving neutralization keeps error line/column aligned with the original source.
    JsxParser.parse(code, ACORN_PARSE_OPTIONS);
    return null;
  } catch (e) {
    const err = e as AcornSyntaxError;
    if (JSX_TEXT_ONLY_ERROR.test(err.message ?? "")) return null; // valid E4X text JSX rejects — defer
    const message = (err.message ?? "Syntax error").replace(/\s*\(\d+:\d+\)\s*$/, "");
    return { line: err.loc?.line ?? 1, column: err.loc?.column ?? 0, message };
  }
}

/**
 * One-line, Java-client-style message ("Error on line N: <message>") for inline/field
 * display, or `null` if the script is valid (or uses E4X).  Mirrors the Java UI's
 * `ScriptPanel.java` formatting.
 *
 * Pass `strict: true` to prepend a `"use strict";` directive (legacy mode kept for its
 * callers/tests); the default non-strict mode matches the Java client's Rhino
 * validation and is what the editors use.
 */
export function tryParseJs(script: string, strict = false): string | null {
  if (!strict) {
    const err = findJsSyntaxError(script);
    return err ? `Error on line ${err.line}: ${err.message}` : null;
  }
  const code = neutralizeE4XOperators(script);
  if (hasResidualE4X(code)) return null;
  try {
    JsxParser.parse(`"use strict";\n${code}`, ACORN_PARSE_OPTIONS);
    return null;
  } catch (e) {
    const err = e as AcornSyntaxError;
    if (JSX_TEXT_ONLY_ERROR.test(err.message ?? "")) return null; // valid E4X text JSX rejects — defer
    return formatAcornError(err);
  }
}

/**
 * Compare two channel scripts for semantic equality — used by the Summary tab's
 * "Scripts (N)" badge to decide whether a script still matches its default template.
 *
 * Faithful-enough port of Java `ChannelSetup.compareScripts` (Rhino
 * compile→decompile→equals): comments and whitespace are normalized away, so a
 * comment-only edit still counts as "default" while an emptied script (tokens differ
 * from the non-empty default) counts as "non-default". Any tokenization failure
 * returns `false` (not equal), mirroring Java's "if it won't compile, assume unequal".
 *
 * E4X scripts (which acorn cannot tokenize) fall back to: equal only if textually
 * identical — a real E4X script differs from the plain-JS defaults, so it correctly
 * reads as non-default.
 */
export function scriptsSemanticallyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (looksLikeE4X(a) || looksLikeE4X(b)) return false;
  const ta = tokenizeValues(a);
  const tb = tokenizeValues(b);
  if (ta === null || tb === null) return false;
  if (ta.length !== tb.length) return false;
  return ta.every((t, i) => t === tb[i]);
}

/**
 * Tokenize a script with acorn, returning a comment- and whitespace-insensitive
 * sequence of `type + source-slice` tokens, or `null` if tokenization throws.
 */
function tokenizeValues(script: string): string[] | null {
  try {
    const tokens: string[] = [];
    const tk = acornTokenizer(script, ACORN_PARSE_OPTIONS);
    for (;;) {
      const t = tk.getToken();
      if (t.type.label === "eof") break;
      // Identify each token by its type label + raw source slice. The tokenizer skips comments
      // and whitespace is not tokenized, so reformatting and comment-only edits compare equal
      // while the token content still distinguishes genuinely different scripts.
      tokens.push(`${t.type.label} ${script.slice(t.start, t.end)}`);
    }
    return tokens;
  } catch {
    return null;
  }
}

/** Format a strict-mode acorn error, adjusting for the prepended `"use strict";\n`. */
function formatAcornError(err: AcornSyntaxError): string {
  const stripped = (err.message ?? "Syntax error").replace(/\s*\(\d+:\d+\)\s*$/, "");
  const reportedLine = err.loc?.line;
  // The `"use strict";\n` prefix shifts everything down a line; shift back.
  const line = reportedLine !== undefined ? Math.max(1, reportedLine - 1) : undefined;
  return line !== undefined ? `Error on line ${line}: ${stripped}` : stripped;
}
