"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { inputCls } from "./shared/styles";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { getServerUrl } from "@/lib/api/api-core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Column {
  name: string;
  type: string;
}

export interface Table {
  name: string;
  columns: Column[];
}

// ─── selectLimit per JDBC driver ──────────────────────────────────────────────
//
// This string is sent to the BridgeLink server as the `selectLimit` query parameter
// for POST /connectors/jdbc/_getTables. The server uses it as a SQL template
// (with `?` replaced by the table name) to execute a single-row SELECT and
// discover the column metadata for each table.
//
// Values mirror DriverInfo constants in the BridgeLink server source.

const SELECT_LIMITS: Record<string, string> = {
  "oracle.jdbc.driver.OracleDriver": "SELECT * FROM ? WHERE ROWNUM < 2",
  "net.sourceforge.jtds.jdbc.Driver": "SELECT TOP 1 * FROM ?",
  "com.microsoft.sqlserver.jdbc.SQLServerDriver": "SELECT TOP 1 * FROM ?",
};

const DEFAULT_SELECT_LIMIT = "SELECT * FROM ? LIMIT 1";

export function getSelectLimitForDriver(driver: string): string {
  return SELECT_LIMITS[driver] ?? DEFAULT_SELECT_LIMIT;
}

// ─── Connection boilerplate strings ──────────────────────────────────────────
//
// Inserted into the Monaco editor when the user clicks "Connection".
// Placeholders are replaced with the live field values.

export function buildSelectConnectionScript(
  driver: string,
  url: string,
  username: string,
  password: string
): string {
  return (
    "var dbConn;\n\ntry {\n" +
    `\tdbConn = DatabaseConnectionFactory.createDatabaseConnection('${driver}','${url}','${username}','${password}');\n\n` +
    "\t// You may access this result below with $('column_name')\n" +
    "\treturn result;\n" +
    "} finally {\n" +
    "\tif (dbConn) { \n" +
    "\t\tdbConn.close();\n" +
    "\t}\n" +
    "}"
  );
}

export function buildWriterConnectionScript(
  driver: string,
  url: string,
  username: string,
  password: string
): string {
  // Mirrors DatabaseWriter.generateConnectionString() in the Java client —
  // simpler than the reader script (no result/return).
  return (
    "var dbConn;\n\ntry {\n" +
    `\tdbConn = DatabaseConnectionFactory.createDatabaseConnection('${driver}','${url}','${username}','${password}');\n\n` +
    "} finally {\n" +
    "\tif (dbConn) { \n" +
    "\t\tdbConn.close();\n" +
    "\t}\n" +
    "}"
  );
}

export function buildUpdateConnectionScript(
  driver: string,
  url: string,
  username: string,
  password: string,
  /** true = runs after EACH message; false = runs ONCE after all messages */
  perRow: boolean,
  /** true = aggregate results enabled — adds extra comment about `results` List */
  aggregateResults = false
): string {
  // Matches Java DatabaseReader.generateUpdateConnectionString() exactly:
  // comment goes BEFORE var dbConn, and text matches Java strings.
  const lines: string[] = [];
  if (perRow) {
    lines.push(
      "// This update script will be executed once for every result returned from the above query."
    );
  } else {
    lines.push(
      "// This update script will be executed once after all results have been processed."
    );
  }
  if (aggregateResults) {
    lines.push('// If "Aggregate Results" is enabled, you have access to "results",');
    lines.push("// a List of Map objects representing all rows returned from the above query.");
  }
  lines.push("var dbConn;");
  lines.push("");
  lines.push("try {");
  lines.push(
    `\tdbConn = DatabaseConnectionFactory.createDatabaseConnection('${driver}','${url}','${username}','${password}');`
  );
  lines.push("");
  lines.push("} finally {");
  lines.push("\tif (dbConn) { ");
  lines.push("\t\tdbConn.close();");
  lines.push("\t}");
  lines.push("}");
  return lines.join("\n");
}

// The reader/writer "Connection" buttons prepend generated connection boilerplate
// above whatever the user has already written, mirroring the Java client's
// generateConnectionActionPerformed (setText(boilerplate + "\n\n" + existing)) in
// DatabaseReader/DatabaseWriter — NOT a wholesale replace.
export function prependConnectionScript(boilerplate: string, existing: string): string {
  return existing ? `${boilerplate}\n\n${existing}` : boilerplate;
}

// ─── SQL generation from selected table + columns ─────────────────────────────

const MAX_ALIAS_LENGTH = 30;

// Mirrors DatabaseMetadataDialog.java column-alias dedup (MAX_ALIAS_LENGTH = 30):
// prefer `table_col`, fall back to `col`, truncate to 30 chars, and disambiguate
// collisions with a counter starting at 2 (shrinking the base so the total stays
// within 30 chars). The alias also becomes the inbound-template element
// name, so it must match the Java client exactly.
function columnAlias(table: string, column: string, used: Set<string>): string {
  let alias = `${table}_${column}`;
  if (alias.length > MAX_ALIAS_LENGTH) alias = column;
  if (alias.length > MAX_ALIAS_LENGTH) alias = alias.substring(0, MAX_ALIAS_LENGTH);
  const original = alias;
  let i = 2;
  while (used.has(alias)) {
    alias = original + i;
    if (alias.length > MAX_ALIAS_LENGTH) {
      alias = original.substring(0, MAX_ALIAS_LENGTH - String(i).length) + i;
    }
    i++;
  }
  used.add(alias);
  return alias;
}

// Mirrors DatabaseMetadataDialog.java (lines ~241-289):
//   SELECT table.col AS table_col, ...
//   FROM table
export function generateSelectSql(table: string, columns: Column[]): string {
  if (columns.length === 0) return `SELECT *\nFROM ${table}`;
  const used = new Set<string>();
  const cols = columns
    .map((c) => `${table}.${c.name} AS ${columnAlias(table, c.name, used)}`)
    .join(", ");
  return `SELECT ${cols}\nFROM ${table}`;
}

// Mirrors DatabaseMetadataDialog.createUpdateFromMetaData() in the Java client:
//   UPDATE table
//   SET col = ?, ...
// Java intentionally emits no WHERE clause; the generated SQL is a starting
// template the user then edits.
export function generateUpdateSql(table: string, columns: Column[]): string {
  if (columns.length === 0) return `UPDATE ${table}\nSET `;
  const sets = columns.map((c) => `${c.name.trim()} = ?`).join(", ");
  return `UPDATE ${table}\nSET ${sets}`;
}

// Shared by DatabaseWriter.setInsertText() and DatabaseReader.setUpdateText() in
// the Java client — the two paths use identical logic. SQL mode prepends the
// statement (with `?` placeholders stripped, matching the Java behaviour); JS
// mode appends a `dbConn.executeUpdate("...")` wrapper with newlines collapsed
// to spaces.
//
// L-13 (accepted Swing→web simplification): the Java client inserts the JS-mode
// wrapper at the editor caret; here we append it at the end. The generated
// content is identical — only the insertion point differs.
function composeExecuteUpdateText(
  generatedSql: string,
  existing: string,
  useScript: boolean
): string {
  if (!useScript) {
    const stripped = generatedSql.replace(/\?/g, "");
    return existing ? `${stripped}\n\n${existing}` : stripped;
  }
  const oneLine = generatedSql.replace(/\n/g, " ");
  const wrapped = `\tvar result = dbConn.executeUpdate("${oneLine}");\n`;
  return existing ? `${existing}\n${wrapped}` : wrapped;
}

// DatabaseWriter Insert button (Java DatabaseWriter.setInsertText()).
export const composeWriterInsertText = composeExecuteUpdateText;

// DatabaseReader post-process Update button (Java DatabaseReader.setUpdateText()).
// Identical wrapping to the writer's Insert path.
export const composeReaderUpdateText = composeExecuteUpdateText;

// DatabaseReader SELECT button (Java DatabaseReader.setSelectText()). SQL mode
// prepends the raw statement WITHOUT stripping `?` (unlike the update path); JS
// mode appends a `dbConn.executeCachedQuery("...")` wrapper with newlines
// collapsed to spaces. Same L-13 caret→append simplification as above.
export function composeReaderSelectText(
  generatedSql: string,
  existing: string,
  useScript: boolean
): string {
  if (!useScript) {
    return existing ? `${generatedSql}\n\n${existing}` : generatedSql;
  }
  const oneLine = generatedSql.replace(/\n/g, " ");
  const wrapped = `\tvar result = dbConn.executeCachedQuery("${oneLine}");\n`;
  return existing ? `${existing}\n${wrapped}` : wrapped;
}

// Builds the inbound message template from parsed SELECT column names,
// mirroring Java DatabaseReader.updateIncomingData(): an empty/unparseable query
// yields a self-closing `<result/>` (the DocumentSerializer output for an empty
// element), clearing any previously-generated template rather than leaving it stale.
export function buildInboundResultTemplate(columns: string[]): string {
  if (columns.length === 0) return "<result/>";
  return `<result>${columns.map((c) => `<${c}>value</${c}>`).join("")}</result>`;
}

// Mirrors DatabaseMetadataDialog.createInsertFromMetaData() in the Java client:
//   INSERT INTO <table> (col1, col2)
//   VALUES (?, ?)
// Empty column list still produces a syntactically-shaped statement.
export function generateInsertSql(table: string, columns: Column[]): string {
  const cols = columns.map((c) => c.name.trim()).join(", ");
  const values = columns.map(() => "?").join(", ");
  return `INSERT INTO ${table} (${cols})\nVALUES (${values})`;
}

// ─── Response normalisation ───────────────────────────────────────────────────
//
// The BridgeLink REST API serialises SortedSet<Table> via XStream + Staxon (JSON).
// The exact shape can vary depending on the server version:
//   - Array of objects:       [{ name, columns: [{ name, type }] }]
//   - XStream list wrapper:   { table: [...] } or { table: { ... } }
//   - Nested column wrapper:  { columns: { column: [...] } }
//
// This function normalises whatever comes back into a flat Table[] array.

export function normalizeTablesResponse(raw: unknown): Table[] {
  if (!raw) return [];

  let data: unknown = raw;

  // Unwrap the outer sorted-set envelope: { "sorted-set": ... }
  if (typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data as object);
    if (keys.length === 1) data = (data as Record<string, unknown>)[keys[0]];
  }

  // Unwrap the XStream FQN class key: { "com.mirth.connect.connectors.jdbc.Table": ... }
  // XStream emits a single object for one result and an array for multiple.
  if (typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data as object);
    if (keys.length === 1 && keys[0].includes(".")) {
      data = (data as Record<string, unknown>)[keys[0]];
    }
  }

  const arr: unknown[] = Array.isArray(data) ? data : data ? [data] : [];

  return arr
    .filter(Boolean)
    .map((t): Table => {
      const tObj = t as Record<string, unknown>;
      const name = String(tObj["name"] ?? "");

      // Unwrap columns FQN key: { "com.mirth.connect.connectors.jdbc.Column": [...] }
      let rawCols: unknown = tObj["columns"] ?? [];
      if (typeof rawCols === "object" && !Array.isArray(rawCols) && rawCols !== null) {
        const colKeys = Object.keys(rawCols as object);
        if (colKeys.length === 1) rawCols = (rawCols as Record<string, unknown>)[colKeys[0]];
      }
      const colArr = Array.isArray(rawCols) ? rawCols : rawCols ? [rawCols] : [];
      const columns: Column[] = colArr.filter(Boolean).map((c) => {
        const cObj = c as Record<string, unknown>;
        return { name: String(cObj["name"] ?? ""), type: String(cObj["type"] ?? "") };
      });

      return { name, columns };
    })
    .filter((t) => t.name);
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DatabaseMetadataDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "select" | "update" | "insert";
  driver: string;
  url: string;
  username: string;
  password: string;
  channelId: string;
  channelName: string;
  /**
   * Server-provided single-row probe query for the selected driver
   * (DriverInfo.selectLimit). Falls back to the local map / default when absent —
   * e.g. for a custom driver with no server entry.
   */
  selectLimit?: string;
  /**
   * The connector's library resource IDs (keys of its resourceIds map). Sent as
   * repeated `resourceId` query params so the server can build an isolated
   * classloader for custom driver jars attached via a Library Resource.
   */
  resourceIds?: string[];
  onConfirm: (sql: string) => void;
}

// ─── Dialog component ─────────────────────────────────────────────────────────

export function DatabaseMetadataDialog({
  open,
  onClose,
  mode,
  driver,
  url,
  username,
  password,
  channelId,
  channelName,
  selectLimit: selectLimitProp,
  resourceIds,
  onConfirm,
}: DatabaseMetadataDialogProps) {
  const { viewDensity } = useCompactMode();
  const [tableFilter, setTableFilter] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  // L-12 (accepted Swing→web simplification): the Java client allows selecting
  // columns across multiple tables at once; this dialog binds to a single table.
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [checkedCols, setCheckedCols] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const title =
    mode === "select"
      ? "Generate SELECT SQL"
      : mode === "update"
        ? "Generate UPDATE SQL"
        : "Generate INSERT SQL";

  // ── Load tables from server ─────────────────────────────────────────────────
  //
  // Mirrors DatabaseMetadataDialog.java: the filter is split on `[, ]+` (comma or
  // space) and each token becomes a repeated `tableNamePattern` param; an empty
  // filter omits it entirely. The connector's library `resourceId`s are sent so
  // the server can build an isolated classloader for a custom driver jar, and
  // `selectLimit` comes from the server driver list (local map as fallback).
  // Sending empty values for `Set<String>` query params makes Jersey deserialize
  // them as a one-element set containing "", which then fails to match — so both
  // repeated params skip empty tokens and omit entirely when the list is empty.

  async function loadTables() {
    setLoading(true);
    setLoadError(null);
    setTables([]);
    setSelectedTable(null);
    setCheckedCols(new Set());

    try {
      const selectLimit = selectLimitProp || getSelectLimitForDriver(driver);
      const params = new URLSearchParams();
      params.append("channelId", channelId || "");
      params.append("channelName", channelName || "");
      params.append("driver", driver);
      params.append("url", url);
      params.append("username", username);
      params.append("password", password);
      params.append("selectLimit", selectLimit);

      // Wire name is singular `resourceId`, repeated once per id (Set<String>).
      for (const rid of resourceIds ?? []) {
        if (rid) params.append("resourceId", rid);
      }

      const trimmedFilter = tableFilter.trim();
      if (trimmedFilter) {
        for (const token of trimmedFilter
          .split(/[, ]+/)
          .map((t) => t.trim())
          .filter(Boolean)) {
          params.append("tableNamePattern", token);
        }
      }

      const serverUrl = getServerUrl();
      const resp = await fetch(`/api/proxy/connectors/jdbc/_getTables?${params}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
        },
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Server returned ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`);
      }

      const data = await resp.json();
      const list = normalizeTablesResponse(data);
      setTables(list);
      if (list.length === 0) setLoadError("No tables found matching the filter.");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setHasLoaded(true);
      setLoading(false);
    }
  }

  // ── Table / column selection ────────────────────────────────────────────────

  function handleSelectTable(t: Table) {
    setSelectedTable(t);
    // Java DatabaseMetadataDialog starts every column unchecked (opt-in); the
    // user selects columns explicitly (or via the All/None shortcuts).
    setCheckedCols(new Set());
  }

  function toggleCol(name: string) {
    setCheckedCols((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // ── Generate SQL ────────────────────────────────────────────────────────────

  function handleGenerate() {
    if (!selectedTable) return;
    const cols = selectedTable.columns.filter((c) => checkedCols.has(c.name));
    const sql =
      mode === "select"
        ? generateSelectSql(selectedTable.name, cols)
        : mode === "update"
          ? generateUpdateSql(selectedTable.name, cols)
          : generateInsertSql(selectedTable.name, cols);
    onConfirm(sql);
    onClose();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const btnBase = "px-3 py-1.5 text-sm rounded transition-colors";
  const btnPrimary = `${btnBase} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed`;
  const btnGhost = `${btnBase} text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[640px] max-h-[80vh] flex flex-col p-0 gap-0"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <DialogTitle className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </DialogTitle>
        </div>

        {/* ── Table filter row ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <span className="text-sm text-gray-600 dark:text-gray-400 shrink-0">
            Table Name Filter:
          </span>
          <input
            type="text"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadTables();
            }}
            placeholder="(empty = all tables)"
            className={`${inputCls(viewDensity)} flex-1`}
          />
          <button onClick={loadTables} disabled={loading} className={btnPrimary}>
            {loading ? "Loading…" : "Load Tables"}
          </button>
        </div>

        {/* ── Inline error banner (shows full server response so failures are diagnosable) ─ */}
        {loadError && hasLoaded && (
          <div className="px-5 py-2 border-b border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 shrink-0">
            <p className="text-xs text-red-700 dark:text-red-300 font-mono break-all whitespace-pre-wrap">
              {loadError}
            </p>
          </div>
        )}

        {/* ── Two-panel: Tables | Columns ─────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Tables */}
          <div className="w-52 shrink-0 border-r border-border flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-border shrink-0">
              Tables
            </div>
            <div className="flex-1 overflow-y-auto">
              {!hasLoaded && !loading && (
                <p className="px-3 py-4 text-xs text-gray-400 italic">
                  Click &quot;Load Tables&quot; to fetch the table list.
                </p>
              )}
              {loading && <p className="px-3 py-4 text-xs text-gray-400">Loading…</p>}
              {tables.map((t) => (
                <button
                  key={t.name}
                  onClick={() => handleSelectTable(t)}
                  className={`w-full text-left px-3 py-1.5 text-sm truncate transition-colors
                    ${
                      selectedTable?.name === t.name
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* Columns */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-border shrink-0">
              {selectedTable ? `Columns — ${selectedTable.name}` : "Columns"}
            </div>
            <div className="flex-1 overflow-y-auto">
              {!selectedTable ? (
                <p className="px-3 py-4 text-xs text-gray-400 italic">
                  Select a table to view its columns.
                </p>
              ) : selectedTable.columns.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-400 italic">
                  No columns returned for this table.
                </p>
              ) : (
                <div className="py-1">
                  {/* Select all / none shortcuts */}
                  <div className="flex gap-3 px-3 py-1 border-b border-border">
                    <button
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() =>
                        setCheckedCols(new Set(selectedTable.columns.map((c) => c.name)))
                      }
                    >
                      All
                    </button>
                    <button
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => setCheckedCols(new Set())}
                    >
                      None
                    </button>
                  </div>
                  {selectedTable.columns.map((col) => (
                    <FormCheckbox
                      key={col.name}
                      label={
                        <>
                          <span className="text-gray-800 dark:text-gray-200">{col.name}</span>
                          {col.type && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 ml-0.5">
                              ({col.type})
                            </span>
                          )}
                        </>
                      }
                      checked={checkedCols.has(col.name)}
                      onChange={() => toggleCol(col.name)}
                      className="px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-700"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!selectedTable || checkedCols.size === 0}
            className={btnPrimary}
          >
            Generate
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
