/**
 * Parses a SQL SELECT statement for column names.
 *
 * Port of com.mirth.connect.client.ui.util.SQLParserUtil from the Java client.
 * Used by the Database Reader connector to extract column references for the
 * post-process variable list.
 */

const SQL_KEYWORDS = ["INTO", "DISTINCT", "UNIQUE", "FIRST", "MIDDLE", "SKIP", "LIMIT"];
const SELECT_FROM_RE = /select.*?from[\s]/gi;

/** Remove innermost parenthesised groups, recursively, to strip function calls. */
function removeNestedFunctions(str: string): string {
  // Iteratively strip innermost (...) groups until none remain
  let prev = "";
  let cur = str;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(/\([^()]*\)/g, "");
  }
  return cur;
}

/**
 * Parse column names from a SQL statement (or multiple).
 *
 * Handles:
 * - Simple selects: `SELECT a, b FROM t`
 * - Aliases: `SELECT a AS alias FROM t` → extracts `alias`
 * - Table-qualified: `SELECT t.col FROM t` → extracts `col`
 * - Backtick/bracket-quoted identifiers: `` SELECT `col` FROM t ``
 * - Nested functions: `SELECT COUNT(id) FROM t` → skipped
 * - SQL keywords stripped: INTO, DISTINCT, etc.
 * - Quoted column names (single/double) are unquoted
 *
 * Returns lowercase column name strings matching the Java parser output.
 */
export function parseSqlColumns(statement: string): string[] {
  if (!statement) return [];

  // Pre-process: strip square brackets and normalize newlines (matches Java)
  const cleaned = statement
    .replace(/\[/g, "")
    .replace(/\]/g, "")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");

  const results: string[] = [];

  SELECT_FROM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELECT_FROM_RE.exec(cleaned)) !== null) {
    const key = match[0];
    const upper = key.toUpperCase();
    const fromIdx = upper.indexOf(" FROM ");
    if (fromIdx <= 0) continue;

    // Extract the column text between SELECT and FROM
    let columnText = key.substring(6, fromIdx).replace(/`/g, "");
    columnText = removeNestedFunctions(columnText);

    const vars = columnText.split(",");

    for (let i = 0; i < vars.length; i++) {
      let v = vars[i];
      if (v.length === 0) continue;

      // Strip SQL keywords
      for (const kw of SQL_KEYWORDS) {
        const vUpper = v.toUpperCase();
        const idx = vUpper.indexOf(kw);
        if (idx === -1) continue;
        const size = kw.length;
        if (idx > 0) {
          if (v[idx - 1] === " " && (v.length === idx + size || v[idx + size] === " ")) {
            v = v.substring(0, idx) + v.substring(idx + size);
          }
        } else if (v.length === idx + size || v[idx + size] === " ") {
          v = v.substring(0, idx) + v.substring(idx + size);
        }
      }

      if (v.length === 0) continue;

      let col: string;

      if (v.toUpperCase().indexOf(" AS ") !== -1) {
        // Alias: take the part after AS
        col = v
          .substring(v.toUpperCase().indexOf(" AS ") + 4)
          .replace(/ /g, "")
          .replace(/\(/g, "")
          .replace(/\)/g, "");
      } else if (/[(){}*]/.test(v)) {
        // Skip function calls, wildcards, etc.
        continue;
      } else {
        v = v.trim();
        col = v.replace(/ /g, "").replace(/\(/g, "").replace(/\)/g, "");

        // Table-qualified: extract after last dot
        const dotIdx = col.lastIndexOf(".");
        if (dotIdx !== -1) {
          col = col.substring(dotIdx + 1);
        }
      }

      // Strip surrounding quotes (double or single)
      if (
        (col.startsWith('"') && col.endsWith('"')) ||
        (col.startsWith("'") && col.endsWith("'"))
      ) {
        col = col.substring(1, col.length - 1);
      }

      // Strip escaped quotes
      if (
        (col.startsWith('\\"') && col.endsWith('\\"')) ||
        (col.startsWith("\\'") && col.endsWith("\\'"))
      ) {
        col = col.substring(2, col.length - 2);
      }

      col = col.toLowerCase();
      if (col.length > 0) {
        results.push(col);
      }
    }
  }

  return results;
}

/**
 * Extract SQL from a JavaScript Database Reader script.
 *
 * When "Use JavaScript" is enabled, the SELECT statement is wrapped inside
 * `dbConn.executeCachedQuery("SELECT ...")`. This function extracts the SQL
 * string from that call so parseSqlColumns can parse it.
 */
export function extractSqlFromScript(script: string): string {
  const match = /executeCachedQuery\(\s*"([^"]+)"\s*\)/i.exec(script);
  return match ? match[1] : "";
}
