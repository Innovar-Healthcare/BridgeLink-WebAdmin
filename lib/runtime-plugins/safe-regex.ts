/**
 * Length- and structure-bounded regex testing for runtime plugin manifests
 *.
 *
 * A hostile or accidentally catastrophic-backtracking pattern must not hang
 * the administrator's page. Containment is three layers:
 *
 *  1. Pattern source capped at MAX_PATTERN_LENGTH (also compile-checked at
 *     manifest validation time).
 *  2. Nested quantifiers rejected (`(a+)+`, `(a*)*`, ...): the classic
 *     exponential-backtracking construction blows up on inputs as short as
 *     ~30 characters, so length caps alone cannot contain it. The structural
 *     check is a conservative "star height > 1" scan — a quantifier applied
 *     to a group that itself contains a quantifier. Group-syntax modifiers
 *     (`(?:`, `(?=`, `(?!`, `(?<name>`, `(?<=`, `(?<!`) are NOT quantifiers,
 *     and an EXACT bounded count (`{3}` — no comma) is unambiguous and does
 *     not count toward nesting; ranged counts (`{1,3}`, `{2,}`) behave like
 *     `+`/`*` (their decomposition ambiguity backtracks exponentially).
 *  3. Ambiguous alternation under an iterating quantifier rejected
 *     (`(a|aa)+`, `(a|ab)*`, `(?:x|xx){2,}` —: each iteration can
 *     split the same input two ways, which backtracks exponentially just like
 *     nested quantifiers and equally escapes the length caps. The check is
 *     conservative: an alternation inside an iterated group is allowed ONLY
 *     when every top-level alternative is a single-character atom (literal,
 *     simple escape, or non-negated character class) and the alternatives'
 *     character sets are pairwise disjoint — then the branch choice is forced
 *     by the next input character, the alternation is deterministic, and no
 *     backtracking blow-up exists. Anything unparseable, negated, or
 *     multi-character is rejected when iterated; authors rewrite (e.g.
 *     `(?:ab|cd)` unquantified, or `[abcd]+` instead of `(a|b|c|d)+`).
 *  4. Inputs capped at MAX_PATTERN_INPUT_LENGTH — over-length inputs FAIL
 *     CLOSED as "too-long" and the regex never runs.
 */

import { MANIFEST_CAPS } from "./manifest-types";

export type BoundedRegexResult = "match" | "no-match" | "too-long" | "invalid";

type BraceQuantifier = "exact" | "ranged" | null;

/** Classifies a `{...}` at `i`: exact count, ranged count, or not a quantifier. */
function braceQuantifierAt(pattern: string, i: number): BraceQuantifier {
  const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
  if (!match) return null;
  // {n} or {n,n} repeat a fixed number of times — no decomposition ambiguity.
  if (match[2] === undefined || match[3] === match[1]) return "exact";
  return "ranged";
}

/** True when the character/sequence at `i` is an ambiguity-creating quantifier. */
function isAmbiguousQuantifierAt(pattern: string, i: number): boolean {
  const ch = pattern[i];
  if (ch === "*" || ch === "+" || ch === "?") return true;
  return ch === "{" && braceQuantifierAt(pattern, i) === "ranged";
}

/**
 * Conservative star-height scan: true when a quantifier applies to a group
 * that itself contains an ambiguity-creating quantifier (directly or via a
 * nested group). Escapes and character classes are skipped; `{n,m}` braces
 * count as quantifiers only when they parse as one (otherwise they are
 * literals, matching JS RegExp).
 */
export function hasNestedQuantifier(pattern: string): boolean {
  // One frame per open group; index 0 is the top level.
  const containsQuantifier: boolean[] = [false];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      // Character class: quantifier chars inside are literals.
      i++;
      while (i < pattern.length && pattern[i] !== "]") {
        i += pattern[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    if (ch === "(") {
      containsQuantifier.push(false);
      i++;
      // Group-syntax modifiers are not quantifiers: skip `?:`, `?=`, `?!`,
      // `?<name>`, `?<=`, `?<!` so the `?` isn't miscounted below.
      if (pattern[i] === "?") {
        i++;
        if (pattern[i] === "<" && pattern[i + 1] !== "=" && pattern[i + 1] !== "!") {
          // Named group `(?<name>` — skip to the closing `>`.
          while (i < pattern.length && pattern[i] !== ">") i++;
          i++;
        } else {
          // `:`, `=`, `!`, or the `<` of a lookbehind (its `=`/`!` follows).
          i++;
        }
      }
      continue;
    }
    if (ch === ")") {
      const inner = containsQuantifier.length > 1 ? containsQuantifier.pop()! : false;
      i++;
      // Is the just-closed group quantified? (Any form counts here — even an
      // exact {n} multiplies the group's own inner ambiguity.)
      const next = pattern[i];
      const quantified =
        next === "*" ||
        next === "+" ||
        next === "?" ||
        (next === "{" && braceQuantifierAt(pattern, i) !== null);
      if (quantified && inner) return true;
      // The group's ambiguous quantifiers (own or applied) count toward the
      // enclosing level.
      if ((quantified && isAmbiguousQuantifierAt(pattern, i)) || inner) {
        containsQuantifier[containsQuantifier.length - 1] = true;
      }
      continue;
    }
    if (isAmbiguousQuantifierAt(pattern, i)) {
      containsQuantifier[containsQuantifier.length - 1] = true;
      i++;
      continue;
    }
    i++;
  }
  return false;
}

export type PatternHazard = "nested-quantifier" | "ambiguous-alternation" | null;

type CharInterval = [number, number];

// JS RegExp `\s` (ECMA-262 WhiteSpace + LineTerminator).
const WHITESPACE_INTERVALS: CharInterval[] = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

/**
 * Character set of a two-character escape (`\d`, `\.`, ...), or null when the
 * escape is outside the deliberately partial supported set (`\D \W \S \b
 * \xHH \uHHHH \p{..}` backreferences, ...) — callers treat null as
 * "not provably safe" and reject.
 */
function escapeIntervals(escaped: string): CharInterval[] | null {
  switch (escaped) {
    case "d":
      return [[0x30, 0x39]];
    case "w":
      return [
        [0x30, 0x39],
        [0x41, 0x5a],
        [0x5f, 0x5f],
        [0x61, 0x7a],
      ];
    case "s":
      return WHITESPACE_INTERVALS;
    case "t":
      return [[0x09, 0x09]];
    case "n":
      return [[0x0a, 0x0a]];
    case "v":
      return [[0x0b, 0x0b]];
    case "f":
      return [[0x0c, 0x0c]];
    case "r":
      return [[0x0d, 0x0d]];
    case "0":
      return [[0x00, 0x00]];
    default:
      // Escaped punctuation is that literal character; other escaped
      // letters/digits are complement classes, hex/unicode escapes, or
      // backreferences — bail.
      return /[a-zA-Z0-9]/.test(escaped) ? null : [[escaped.charCodeAt(0), escaped.charCodeAt(0)]];
  }
}

/** Bare (unescaped) characters that are never a plain single-char literal atom. */
const BARE_METACHARS = new Set([
  ".",
  "^",
  "$",
  "*",
  "+",
  "?",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  "|",
  "\\",
]);

/**
 * Character set of a NON-NEGATED class spanning exactly [start, end) —
 * `pattern[start] === "[" `, `pattern[end - 1] === "]"`. Supports literal
 * chars, literal ranges (`a-z`), and the simple escapes of escapeIntervals;
 * anything else (negation, escaped range endpoints, nested class syntax)
 * returns null.
 */
function classIntervals(pattern: string, start: number, end: number): CharInterval[] | null {
  let i = start + 1;
  if (pattern[i] === "^") return null;
  const out: CharInterval[] = [];
  const last = end - 1; // index of "]"
  while (i < last) {
    if (pattern[i] === "\\") {
      const intervals = escapeIntervals(pattern[i + 1] ?? "");
      if (intervals === null) return null;
      i += 2;
      // An escape as a range endpoint (`[\d-z]`) is ambiguous — bail.
      if (pattern[i] === "-" && i + 1 < last) return null;
      out.push(...intervals);
      continue;
    }
    const lo = pattern.charCodeAt(i);
    if (pattern[i + 1] === "-" && i + 2 < last) {
      // Literal range `a-z`; escaped end endpoints bail.
      if (pattern[i + 2] === "\\") return null;
      const hi = pattern.charCodeAt(i + 2);
      if (hi < lo) return null;
      out.push([lo, hi]);
      i += 3;
      continue;
    }
    out.push([lo, lo]);
    i++;
  }
  return out;
}

/**
 * Character set of ONE alternation branch spanning [start, end), when the
 * branch is a single single-character atom; null otherwise (empty, multi-atom,
 * group, `.`/anchor, negated or unparseable class, unsupported escape).
 */
function alternativeIntervals(pattern: string, start: number, end: number): CharInterval[] | null {
  if (start >= end) return null;
  const ch = pattern[start];
  if (ch === "\\") {
    if (start + 2 !== end) return null;
    return escapeIntervals(pattern[start + 1] ?? "");
  }
  if (ch === "[") {
    // The class must be the whole branch.
    let i = start + 1;
    while (i < end && pattern[i] !== "]") i += pattern[i] === "\\" ? 2 : 1;
    if (i !== end - 1) return null;
    return classIntervals(pattern, start, end);
  }
  if (start + 1 !== end || BARE_METACHARS.has(ch)) return null;
  return [[pattern.charCodeAt(start), pattern.charCodeAt(start)]];
}

/**
 * True when every top-level alternative of the group body [start, end) is a
 * single-character atom and the alternatives' character sets are pairwise
 * disjoint — the deterministic-alternation exemption.
 */
function alternativesDisjoint(
  pattern: string,
  start: number,
  end: number,
  altPositions: number[]
): boolean {
  const tagged: { lo: number; hi: number; branch: number }[] = [];
  let segStart = start;
  const bounds = [...altPositions, end];
  for (let branch = 0; branch < bounds.length; branch++) {
    const intervals = alternativeIntervals(pattern, segStart, bounds[branch]);
    if (intervals === null) return false;
    for (const [lo, hi] of intervals) tagged.push({ lo, hi, branch });
    segStart = bounds[branch] + 1;
  }
  // Pattern length is capped, so the interval count is tiny — O(n²) is fine.
  for (let a = 0; a < tagged.length; a++) {
    for (let b = a + 1; b < tagged.length; b++) {
      if (tagged[a].branch === tagged[b].branch) continue;
      if (tagged[a].lo <= tagged[b].hi && tagged[b].lo <= tagged[a].hi) return false;
    }
  }
  return true;
}

/**
 * True when the quantifier at `i` can repeat its atom (max repetitions ≥ 2) —
 * `?`/`{0,1}`/`{1}` cannot compound an alternation's ambiguity, iteration can.
 */
function iteratingQuantifierAt(pattern: string, i: number): boolean {
  const ch = pattern[i];
  if (ch === "*" || ch === "+") return true;
  if (ch !== "{") return false;
  const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
  if (!match) return false;
  const min = parseInt(match[1], 10);
  const max = match[2] === undefined ? min : match[3] === "" ? Infinity : parseInt(match[3], 10);
  return max >= 2;
}

/**
 * Conservative ambiguous-alternation scan: true when an iterating quantifier
 * applies to a group containing (at any depth) an alternation that is not
 * provably deterministic (see alternativesDisjoint). `(a|aa)+`, `(a|ab)*`,
 * `(?:x|xx){2,}`, `((a|aa)?)+` are caught; `(a|b)+`, `(\d|-)+`,
 * `(http|https)://` (unquantified) are not.
 */
export function hasAmbiguousAlternation(pattern: string): boolean {
  interface Frame {
    contentStart: number;
    altPositions: number[];
    propagated: boolean;
  }
  const stack: Frame[] = [{ contentStart: 0, altPositions: [], propagated: false }];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      i++;
      while (i < pattern.length && pattern[i] !== "]") {
        i += pattern[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    if (ch === "(") {
      i++;
      // Skip group-syntax modifiers exactly like hasNestedQuantifier.
      if (pattern[i] === "?") {
        i++;
        if (pattern[i] === "<" && pattern[i + 1] !== "=" && pattern[i + 1] !== "!") {
          while (i < pattern.length && pattern[i] !== ">") i++;
          i++;
        } else {
          i++;
        }
      }
      stack.push({ contentStart: i, altPositions: [], propagated: false });
      continue;
    }
    if (ch === "|") {
      stack[stack.length - 1].altPositions.push(i);
      i++;
      continue;
    }
    if (ch === ")") {
      const frame = stack.length > 1 ? stack.pop()! : stack[0];
      const ownAmbiguous =
        frame.altPositions.length > 0 &&
        !alternativesDisjoint(pattern, frame.contentStart, i, frame.altPositions);
      const ambiguous = ownAmbiguous || frame.propagated;
      i++;
      if (ambiguous && iteratingQuantifierAt(pattern, i)) return true;
      // Even unquantified (or `?`-quantified), the ambiguity survives into the
      // enclosing group — `((a|aa)?)+` and `((a|aa)x)+` blow up the same way.
      if (ambiguous) stack[stack.length - 1].propagated = true;
      continue;
    }
    i++;
  }
  return false;
}

/**
 * Classifies a pattern's catastrophic-backtracking hazard: nested quantifiers
 * (star-height scan), ambiguous alternation under iteration, or null when
 * neither structural check fires. Single entry point for both enforcement
 * layers (manifest validation and boundedRegexTest).
 */
export function scanPatternHazard(pattern: string): PatternHazard {
  if (hasNestedQuantifier(pattern)) return "nested-quantifier";
  if (hasAmbiguousAlternation(pattern)) return "ambiguous-alternation";
  return null;
}

/**
 * Tests `input` against `pattern` (JS RegExp source, no flags, unanchored —
 * authors anchor with ^/$ themselves). Returns "invalid" for over-length,
 * non-compiling, or structurally hazardous patterns (see scanPatternHazard)
 * and "too-long" for over-length inputs.
 */
export function boundedRegexTest(pattern: string, input: string): BoundedRegexResult {
  if (pattern.length > MANIFEST_CAPS.MAX_PATTERN_LENGTH) return "invalid";
  if (scanPatternHazard(pattern) !== null) return "invalid";
  if (input.length > MANIFEST_CAPS.MAX_PATTERN_INPUT_LENGTH) return "too-long";
  let re: RegExp;
  try {
    // Flagless: no `g` statefulness, no `i`/`m` surprises — the contract is
    // exact-case, single-line matching.
    re = new RegExp(pattern);
  } catch {
    return "invalid";
  }
  return re.test(input) ? "match" : "no-match";
}
