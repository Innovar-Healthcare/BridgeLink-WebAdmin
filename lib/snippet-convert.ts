/**
 * Converts Java-style `${placeholder}` code templates to Monaco snippet syntax.
 *
 * Monaco tab-stop rules:
 *  - `${1:text}` — tab stop with default text
 *  - Repeated use of the same placeholder name → same tab stop number (mirrors/linked edits)
 *  - `$` followed by `(`, letters, or punctuation is left untouched (not a tab stop)
 *
 * If the input contains no `${...}` patterns the string is returned unchanged.
 * This is the common case for reference-data.ts items, which use plain identifiers
 * as placeholders and are safe to pass directly to Monaco as snippet `insertText`.
 */
export function toMonacoSnippet(code: string): string {
  if (!code.includes("${")) return code;

  const seen = new Map<string, number>();
  let counter = 0;

  return code.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    if (!seen.has(name)) seen.set(name, ++counter);
    return `\${${seen.get(name)!}:${name}}`;
  });
}
