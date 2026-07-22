"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  startTransition,
  type MutableRefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Copy,
  Pencil,
  Plus,
  Trash2,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertCircle,
  SlidersHorizontal,
  Code2,
} from "lucide-react";
import type { ValuesTabActions } from "./lookups-action-panel";
import { ConfirmDialog, TypeToConfirmDialog } from "@/components/confirm-dialog";
import {
  searchLookupValues,
  searchLookupValuesAdvanced,
  setLookupValue,
  deleteLookupValue,
  importLookupValuesChunked,
  exportLookupGroup,
} from "@/lib/api-client";
import type {
  LookupGroup,
  LookupValue,
  LookupSearchFilter,
  AdvancedJsonFilter,
} from "@/lib/api-client";
import { toast } from "sonner";
import { ValueDialog } from "./value-dialog";
import { AdvancedSearchDialog } from "./advanced-search-dialog";
import { SnippetDialog } from "./snippet-dialog";
import { ImportProgressDialog } from "./import-progress-dialog";
import { downloadFile } from "@/lib/download";
import { fmtDate } from "@/lib/utils";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { parseLookupCsv, toLookupCsv, lookupCsvFilename } from "@/lib/lookup-csv";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Search Mode Options ───────────────────────────────────────────────────────

const SEARCH_MODES: { value: LookupSearchFilter["keyFilterMode"]; label: string }[] = [
  { value: "CONTAINS", label: "Contains" },
  { value: "PREFIX", label: "Starts with" },
  { value: "EXACT", label: "Exact match" },
  { value: "PATTERN", label: "Pattern (SQL wildcards)" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200, 500, 1000] as const;
const EMPTY_ADVANCED_FILTER: AdvancedJsonFilter = { conditions: [] };

// ─── Column infrastructure ────────────────────────────────────────────────────

type ValuesCol = "key" | "value" | "updated" | "actions";

const VALUES_COLS: ColDef<ValuesCol>[] = [
  {
    key: "key",
    label: "Key",
    defaultWidth: 288,
    minWidth: 100,
    defaultVisible: true,
    canHide: false,
  },
  {
    key: "value",
    label: "Value",
    defaultWidth: 400,
    minWidth: 100,
    defaultVisible: true,
    canHide: false,
  },
  {
    key: "updated",
    label: "Updated",
    defaultWidth: 176,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "actions",
    label: "",
    defaultWidth: 80,
    minWidth: 60,
    defaultVisible: true,
    canHide: false,
  },
];

// ─── Values Tab ───────────────────────────────────────────────────────────────

interface ValuesTabProps {
  group: LookupGroup;
  actionsRef?: MutableRefObject<ValuesTabActions>;
  onActionsChanged?: () => void;
}

export function ValuesTab({ group, actionsRef, onActionsChanged }: ValuesTabProps) {
  const { viewDensity } = useCompactMode();
  const barPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5";

  const [values, setValues] = useState<LookupValue[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Column infrastructure
  const colConfig = useColumnConfig(VALUES_COLS, "bl-lookups-values-cols-v1");
  const sortState = useSortable<ValuesCol>("key", "asc");

  // ── Simple search state ──────────────────────────────────────────────────
  const [simpleSearchMode, setSimpleSearchMode] =
    useState<LookupSearchFilter["keyFilterMode"]>("PREFIX");
  const [keyFilter, setKeyFilter] = useState("");
  const [valueFilter, setValueFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<LookupSearchFilter>({});

  // ── Advanced search state (JSON groups only) ─────────────────────────────
  const isJsonGroup = group.valueType === "JSON";
  const [searchTab, setSearchTab] = useState<"simple" | "advanced">("simple");
  const [activeAdvFilter, setActiveAdvFilter] = useState<AdvancedJsonFilter>(EMPTY_ADVANCED_FILTER);
  const [showAdvDialog, setShowAdvDialog] = useState(false);
  const [showSnippet, setShowSnippet] = useState(false);

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingKey, setEditingKey] = useState<string | undefined>(undefined);
  const [editingValue, setEditingValue] = useState<string | undefined>(undefined);

  // ── Row selection ─────────────────────────────────────────────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // ── Confirmation dialog state ──────────────────────────────────────────────
  type PendingDialog =
    | { mode: "delete-value"; key: string }
    | { mode: "delete-selected"; keys: string[] }
    | { mode: "remove-results"; count: number };
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);

  // CSV import: holds parsed rows pending the Replace/Append/Cancel choice.
  const [pendingCsvImport, setPendingCsvImport] = useState<Record<string, string> | null>(null);

  // Chunked import progress (null when no import is running). Mirrors the Java
  // client's "Importing CSV" progress dialog.
  const [importProgress, setImportProgress] = useState<{
    imported: number;
    total: number;
  } | null>(null);
  // Set by the progress dialog's Cancel button; checked between batches.
  const importCancelRef = useRef(false);

  // Import file input
  const importInputRef = useRef<HTMLInputElement>(null);

  // Page jump
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const [pageInput, setPageInput] = useState("1");
  // Keep the page input box in sync with the committed page (adjust during render).
  const [prevPage, setPrevPage] = useState(page);
  if (page !== prevPage) {
    setPrevPage(page);
    setPageInput(String(page + 1));
  }

  // ── Search runners ───────────────────────────────────────────────────────

  const runSimpleSearch = useCallback(
    async (filter: LookupSearchFilter, pageNum: number, limit: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await searchLookupValues(group.id, filter, pageNum * limit, limit);
        setValues(res.values ?? []);
        setTotalCount(res.totalCount ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [group.id]
  );

  const runAdvancedSearch = useCallback(
    async (filter: AdvancedJsonFilter, pageNum: number, limit: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await searchLookupValuesAdvanced(group.id, filter, pageNum * limit, limit);
        setValues(res.values ?? []);
        setTotalCount(res.totalCount ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [group.id]
  );

  function runCurrentSearch(pageNum: number, limit: number) {
    if (searchTab === "advanced" && isJsonGroup) {
      runAdvancedSearch(activeAdvFilter, pageNum, limit);
    } else {
      runSimpleSearch(activeFilter, pageNum, limit);
    }
  }

  // Auto-search on group change: reset all form/filter/selection state and fetch.
  useEffect(() => {
    startTransition(() => {
      setPage(0);
      setKeyFilter("");
      setValueFilter("");
      setSimpleSearchMode("PREFIX");
      setActiveFilter({});
      setSearchTab("simple");
      setActiveAdvFilter(EMPTY_ADVANCED_FILTER);
      setSelectedKeys(new Set());
      setError(null);
      runSimpleSearch({}, 0, pageSize);
    });
  }, [group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Simple search actions ────────────────────────────────────────────────

  function handleSimpleSearch() {
    const filter: LookupSearchFilter = {
      ...(keyFilter.trim() ? { keyFilter: keyFilter.trim() } : {}),
      ...(valueFilter.trim() ? { valueFilter: valueFilter.trim() } : {}),
      keyFilterMode: simpleSearchMode,
    };
    setActiveFilter(filter);
    setPage(0);
    runSimpleSearch(filter, 0, pageSize);
  }

  function handleSimpleClear() {
    setKeyFilter("");
    setValueFilter("");
    setSimpleSearchMode("PREFIX");
    const empty: LookupSearchFilter = {};
    setActiveFilter(empty);
    setPage(0);
    runSimpleSearch(empty, 0, pageSize);
  }

  // ── Advanced search actions ──────────────────────────────────────────────

  function handleApplyAdvanced(filter: AdvancedJsonFilter) {
    setActiveAdvFilter(filter);
    setPage(0);
    runAdvancedSearch(filter, 0, pageSize);
  }

  function handleAdvancedSearch() {
    setPage(0);
    runAdvancedSearch(activeAdvFilter, 0, pageSize);
  }

  function handleAdvancedClear() {
    setActiveAdvFilter(EMPTY_ADVANCED_FILTER);
    setPage(0);
    runAdvancedSearch(EMPTY_ADVANCED_FILTER, 0, pageSize);
  }

  // ── Search tab switching ─────────────────────────────────────────────────

  function switchToSimple() {
    setSearchTab("simple");
    setActiveFilter({});
    setKeyFilter("");
    setValueFilter("");
    setSimpleSearchMode("PREFIX");
    setPage(0);
    runSimpleSearch({}, 0, pageSize);
  }

  function switchToAdvanced() {
    setSearchTab("advanced");
    setActiveAdvFilter(EMPTY_ADVANCED_FILTER);
    setPage(0);
    runAdvancedSearch(EMPTY_ADVANCED_FILTER, 0, pageSize);
  }

  // ── Pagination ───────────────────────────────────────────────────────────

  function goToPage(n: number) {
    const clamped = Math.max(0, Math.min(n, totalPages - 1));
    setPage(clamped);
    runCurrentSearch(clamped, pageSize);
  }

  function applyPageJump() {
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) {
      setPageInput(String(page + 1));
      return;
    }
    const clamped = Math.max(1, Math.min(n, totalPages));
    setPageInput(String(clamped));
    goToPage(clamped - 1);
  }

  function handlePageSizeChange(newSize: number) {
    setPageSize(newSize);
    setPage(0);
    runCurrentSearch(0, newSize);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async function handleSaveValue(key: string, value: string) {
    await setLookupValue(group.id, key, value);
    setDialogMode(null);
    runCurrentSearch(page, pageSize);
  }

  function handleDeleteValue(key: string) {
    setPendingDialog({ mode: "delete-value", key });
  }

  async function executeDeleteValue(key: string) {
    setPendingDialog(null);
    setError(null);
    try {
      await deleteLookupValue(group.id, key);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      const newTotalPages = Math.ceil((totalCount - 1) / pageSize) || 1;
      const newPage = Math.min(page, newTotalPages - 1);
      setPage(newPage);
      runCurrentSearch(newPage, pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleRowClick(row: LookupValue, e: React.MouseEvent) {
    const key = row.keyValue;
    if (e.ctrlKey || e.metaKey) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else {
      setSelectedKeys(new Set([key]));
    }
  }

  function handleRowDoubleClick(row: LookupValue) {
    setEditingKey(row.keyValue);
    setEditingValue(row.valueData);
    setDialogMode("edit");
  }

  function handleRemoveSelected() {
    if (selectedKeys.size === 0) return;
    if (selectedKeys.size === 1) {
      handleDeleteValue([...selectedKeys][0]);
      return;
    }
    setPendingDialog({ mode: "delete-selected", keys: [...selectedKeys] });
  }

  async function executeDeleteSelected(keys: string[]) {
    setPendingDialog(null);
    setError(null);
    setLoading(true);
    try {
      // Mirror Java ValuePanel: delete each selected key. 404s are tolerated
      // (a concurrent delete or filter shift can leave stale keys in the set).
      for (const key of keys) {
        try {
          await deleteLookupValue(group.id, key);
        } catch {
          // ignore individual failures; surface the rest below if any
        }
      }
      setSelectedKeys(new Set());
      const newTotalPages = Math.ceil(Math.max(totalCount - keys.length, 0) / pageSize) || 1;
      const newPage = Math.min(page, newTotalPages - 1);
      setPage(newPage);
      runCurrentSearch(newPage, pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleRemoveResults() {
    if (totalCount === 0) return;
    setPendingDialog({ mode: "remove-results", count: totalCount });
  }

  async function executeRemoveResults() {
    setPendingDialog(null);
    setError(null);
    setLoading(true);
    try {
      // Page through all matching keys and delete each one
      let offset = 0;
      const limit = 100;
      while (true) {
        const res =
          searchTab === "advanced" && isJsonGroup
            ? await searchLookupValuesAdvanced(group.id, activeAdvFilter, offset, limit)
            : await searchLookupValues(group.id, activeFilter, offset, limit);
        for (const v of res.values ?? []) {
          await deleteLookupValue(group.id, v.keyValue);
        }
        if (!res.pagination?.hasMore) break;
        offset += limit;
      }
      setSelectedKeys(new Set());
      setPage(0);
      runCurrentSearch(0, pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Import/Export ─────────────────────────────────────────────────────────

  async function handleImportValuesFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseLookupCsv(text);
      if (Object.keys(parsed).length === 0) {
        setError("No values found in CSV file. Expected header 'key,value' followed by data rows.");
        return;
      }
      setPendingCsvImport(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function executeCsvImport(values: Record<string, string>, clearExisting: boolean) {
    setError(null);
    importCancelRef.current = false;
    setImportProgress({ imported: 0, total: Object.keys(values).length });
    try {
      const { cancelled } = await importLookupValuesChunked(group.id, values, clearExisting, {
        onProgress: (imported, total) => setImportProgress({ imported, total }),
        isCancelled: () => importCancelRef.current,
      });
      if (cancelled) {
        // Use a toast, not setError: the refresh below clears the error banner
        // synchronously, so a persistent message would never render.
        toast.info("Import cancelled. Values imported before cancelling were kept.");
      }
      setPage(0);
      runCurrentSearch(0, pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportProgress(null);
    }
  }

  async function handleExportValues() {
    setError(null);
    try {
      const data = await exportLookupGroup(group.id);
      downloadFile(toLookupCsv(data.values ?? {}), lookupCsvFilename(), {
        mimeType: "text/csv",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const hasNextPage = (page + 1) * pageSize < totalCount;
  const selectH = densityHeight(viewDensity);
  const selectCls = `${selectH} rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-gray-900`;

  const advConditionCount = activeAdvFilter.conditions.length;
  const advHasKeyPattern = !!activeAdvFilter.keyPattern?.trim();
  const advActiveLabel = [
    advConditionCount > 0
      ? `${advConditionCount} condition${advConditionCount > 1 ? "s" : ""}`
      : null,
    advHasKeyPattern ? "key pattern" : null,
  ]
    .filter(Boolean)
    .join(", ");

  // Sort full filtered set; pagination is server-side, so we sort the current page only.
  const sortedValues = sortState.sorted(values, (v) => {
    switch (sortState.sort.key) {
      case "key":
        return v.keyValue;
      case "value":
        return v.valueData;
      case "updated":
        return v.updatedDate;
      default:
        return undefined;
    }
  });

  // For DataTable's single selectedRowId, surface the most recently selected key.
  const primarySelectedKey =
    selectedKeys.size > 0 ? [...selectedKeys][selectedKeys.size - 1] : null;

  // Keep the imperative actions handle current. Written in a deps-less effect (not
  // during render) to satisfy react-hooks/refs. Declared after all handlers it
  // references (handleExportValues, handleRemoveSelected, handleRemoveResults) so
  // react-hooks/immutability doesn't flag use-before-declaration.
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        addValue: () => {
          setEditingKey(undefined);
          setEditingValue(undefined);
          setDialogMode("add");
        },
        importValues: () => importInputRef.current?.click(),
        exportValues: () => void handleExportValues(),
        editSelected: () => {
          const key = [...selectedKeys][0];
          const row = values.find((v) => v.keyValue === key);
          if (!row) return;
          setEditingKey(row.keyValue);
          setEditingValue(row.valueData);
          setDialogMode("edit");
        },
        copySelectedValue: () => {
          const key = [...selectedKeys][0];
          const row = values.find((v) => v.keyValue === key);
          if (!row) return;
          void navigator.clipboard.writeText(row.valueData);
        },
        removeSelected: () => void handleRemoveSelected(),
        removeResults: () => void handleRemoveResults(),
        selectedKeys,
        totalCount,
      };
    }
  });

  // Notify the parent only when button-state-relevant values change so it can
  // re-render the toolbar. Declared AFTER the ref-write effect above so that, on
  // a given commit, actionsRef.current is already fresh when bumpActions snapshots
  // it — otherwise the toolbar would lag one render behind the selection.
  useEffect(() => {
    onActionsChanged?.();
  }, [selectedKeys, totalCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Hidden file input for value import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportValuesFile}
      />

      {/* Search bar */}
      {searchTab === "simple" || !isJsonGroup ? (
        <div
          className={`px-4 ${barPy} border-b border-border flex items-center gap-2 shrink-0 flex-wrap`}
        >
          {/* Search mode toggle — JSON groups only */}
          {isJsonGroup && (
            <div className="flex items-center gap-0 rounded-md border border-border overflow-hidden mr-1">
              <button
                className={`px-3 py-1 text-xs transition-colors ${searchTab === "simple" ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                onClick={switchToSimple}
              >
                Simple
              </button>
              <button
                className={`px-3 py-1 text-xs transition-colors ${searchTab === "advanced" ? "bg-blue-600 text-white" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                onClick={switchToAdvanced}
              >
                Advanced
              </button>
            </div>
          )}
          <select
            className={selectCls}
            value={simpleSearchMode}
            onChange={(e) =>
              setSimpleSearchMode(e.target.value as LookupSearchFilter["keyFilterMode"])
            }
          >
            {SEARCH_MODES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Input
            density={viewDensity}
            className="text-sm flex-1 min-w-[120px]"
            placeholder="Key filter…"
            value={keyFilter}
            onChange={(e) => setKeyFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSimpleSearch()}
          />
          <Input
            density={viewDensity}
            className="text-sm flex-1 min-w-[120px]"
            placeholder="Value filter…"
            value={valueFilter}
            onChange={(e) => setValueFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSimpleSearch()}
          />
          <Button size="sm" onClick={handleSimpleSearch} disabled={loading}>
            <Search className="w-3.5 h-3.5 mr-1.5" />
            Search
          </Button>
          <Button size="sm" variant="outline" onClick={handleSimpleClear} disabled={loading}>
            <X className="w-3.5 h-3.5 mr-1.5" />
            Clear
          </Button>
        </div>
      ) : (
        /* Advanced search bar */
        <div
          className={`px-4 ${barPy} border-b border-border flex items-center gap-2 shrink-0 flex-wrap`}
        >
          <div className="flex items-center gap-0 rounded-md border border-border overflow-hidden mr-1">
            <button
              className="px-3 py-1 text-xs transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={switchToSimple}
            >
              Simple
            </button>
            <button
              className="px-3 py-1 text-xs transition-colors bg-blue-600 text-white"
              onClick={switchToAdvanced}
            >
              Advanced
            </button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAdvDialog(true)}>
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
            Advanced Search…
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowSnippet(true)}>
            <Code2 className="w-3.5 h-3.5 mr-1.5" />
            Snippet
          </Button>
          <Button size="sm" onClick={handleAdvancedSearch} disabled={loading}>
            <Search className="w-3.5 h-3.5 mr-1.5" />
            Search
          </Button>
          <Button size="sm" variant="outline" onClick={handleAdvancedClear} disabled={loading}>
            <X className="w-3.5 h-3.5 mr-1.5" />
            Clear
          </Button>
          {advActiveLabel && (
            <span className="text-xs text-gray-500 dark:text-gray-400 italic ml-1">
              Active: {advActiveLabel}
            </span>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {/* Table — wrapped in outer ContextMenu for empty-space "Add Value" */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex-1 min-h-0 flex flex-col">
            <DataTable<LookupValue, ValuesCol>
              variant="sortable"
              cols={VALUES_COLS}
              rows={sortedValues}
              colConfig={colConfig}
              sortState={sortState}
              rowKey={(v) => v.keyValue}
              loading={loading && values.length === 0}
              empty="No values found."
              containerClassName="flex-1 min-h-0"
              selectedRowId={primarySelectedKey}
              onRowClick={handleRowClick}
              onRowDoubleClick={(row) => handleRowDoubleClick(row)}
              cellMono={{ key: true, value: true }}
              rowWrapper={(v, rendered) => (
                <ContextMenu key={v.keyValue}>
                  <ContextMenuTrigger asChild>{rendered}</ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => {
                        setEditingKey(undefined);
                        setEditingValue(undefined);
                        setDialogMode("add");
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 mr-2" />
                      Add Value
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => {
                        setEditingKey(v.keyValue);
                        setEditingValue(v.valueData);
                        setDialogMode("edit");
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      Edit Value
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => {
                        void navigator.clipboard.writeText(v.valueData);
                      }}
                    >
                      <Copy className="w-3.5 h-3.5 mr-2" />
                      Copy Value
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => {
                        void handleDeleteValue(v.keyValue);
                      }}
                      className="text-red-600 dark:text-red-400 focus:text-red-700 dark:focus:text-red-300"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Remove Value
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )}
              renderCell={(v, col) => {
                if (col === "key") {
                  return v.keyValue;
                }
                if (col === "value") {
                  return (
                    <span title={v.valueData} className="block">
                      {v.valueData}
                    </span>
                  );
                }
                if (col === "updated") {
                  return fmtDate(v.updatedDate);
                }
                return (
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1 rounded text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                      title="Edit value"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingKey(v.keyValue);
                        setEditingValue(v.valueData);
                        setDialogMode("edit");
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      title="Copy value"
                      onClick={(e) => {
                        e.stopPropagation();
                        void navigator.clipboard.writeText(v.valueData);
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                      title="Delete value"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteValue(v.keyValue);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              setEditingKey(undefined);
              setEditingValue(undefined);
              setDialogMode("add");
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-2" />
            Add Value
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Pagination bar */}
      <div
        className={`px-4 ${barPy} border-t border-border bg-white dark:bg-gray-900 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 shrink-0`}
      >
        <div className="flex items-center gap-2">
          <span>Page size:</span>
          <select
            className={selectCls}
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            disabled={loading}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>
            {values.length > 0
              ? `Showing ${page * pageSize + 1}–${page * pageSize + values.length} of ${totalCount.toLocaleString()} entries`
              : loading
                ? ""
                : "No results"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(0)}
            disabled={page === 0 || loading}
            title="First page"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(page - 1)}
            disabled={page === 0 || loading}
            title="Previous page"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="flex items-center gap-1">
            <span className="text-xs">Page</span>
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={applyPageJump}
              onKeyDown={(e) => e.key === "Enter" && applyPageJump()}
              density={viewDensity}
              className="h-6 w-12 text-xs text-center px-1"
              disabled={loading}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">of {totalPages}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(page + 1)}
            disabled={!hasNextPage || loading}
            title="Next page"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => goToPage(totalPages - 1)}
            disabled={!hasNextPage || loading || page === totalPages - 1}
            title="Last page"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Value dialog */}
      {dialogMode !== null && (
        <ValueDialog
          mode={dialogMode}
          group={group}
          initialKey={editingKey}
          initialValue={editingValue}
          onSave={handleSaveValue}
          onClose={() => {
            setDialogMode(null);
            setEditingKey(undefined);
            setEditingValue(undefined);
          }}
        />
      )}

      {/* Delete single value dialog */}
      {pendingDialog?.mode === "delete-value" && (
        <ConfirmDialog
          title="Remove Value"
          description={
            <>
              Remove value <span className="font-mono font-semibold">{pendingDialog.key}</span>?
              This cannot be undone.
            </>
          }
          confirmLabel="Remove"
          onConfirm={() => void executeDeleteValue(pendingDialog.key)}
          onCancel={() => setPendingDialog(null)}
        />
      )}

      {/* Delete multiple selected values dialog */}
      {pendingDialog?.mode === "delete-selected" && (
        <ConfirmDialog
          title="Remove Selected Values"
          description={
            <>
              Remove{" "}
              <span className="font-semibold">
                {pendingDialog.keys.length.toLocaleString()} selected value
                {pendingDialog.keys.length !== 1 ? "s" : ""}
              </span>
              ? This cannot be undone.
            </>
          }
          confirmLabel="Remove"
          onConfirm={() => void executeDeleteSelected(pendingDialog.keys)}
          onCancel={() => setPendingDialog(null)}
        />
      )}

      {/* Remove results dialog */}
      {pendingDialog?.mode === "remove-results" && (
        <TypeToConfirmDialog
          title="Remove Results"
          description={
            <>
              This will remove all{" "}
              <span className="font-semibold">
                {pendingDialog.count.toLocaleString()} value
                {pendingDialog.count !== 1 ? "s" : ""}
              </span>{" "}
              matching the current search criteria. Type{" "}
              <span className="font-mono font-semibold">REMOVEALL</span> and click OK to continue.
            </>
          }
          confirmWord="REMOVEALL"
          onConfirm={() => void executeRemoveResults()}
          onCancel={() => setPendingDialog(null)}
        />
      )}

      {/* Advanced search dialog */}
      {showAdvDialog && (
        <AdvancedSearchDialog
          group={group}
          initialFilter={activeAdvFilter}
          onApply={handleApplyAdvanced}
          onClose={() => setShowAdvDialog(false)}
        />
      )}

      {/* Snippet dialog */}
      {showSnippet && (
        <SnippetDialog
          group={group}
          filter={activeAdvFilter}
          onClose={() => setShowSnippet(false)}
        />
      )}

      {/* CSV import: Replace existing / Append / Cancel */}
      {pendingCsvImport && (
        <Dialog open onOpenChange={(open) => !open && setPendingCsvImport(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Import {Object.keys(pendingCsvImport).length} values?</DialogTitle>
              <DialogDescription asChild>
                <div>
                  Choose how to handle existing values in{" "}
                  <span className="font-semibold">{group.name}</span>.
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingCsvImport(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const values = pendingCsvImport;
                  setPendingCsvImport(null);
                  void executeCsvImport(values, false);
                }}
              >
                Append
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  const values = pendingCsvImport;
                  setPendingCsvImport(null);
                  void executeCsvImport(values, true);
                }}
              >
                Replace existing
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Chunked import progress (mirrors Java "Importing CSV" dialog) */}
      <ImportProgressDialog
        open={importProgress !== null}
        imported={importProgress?.imported ?? 0}
        total={importProgress?.total ?? 0}
        onCancel={() => {
          importCancelRef.current = true;
        }}
      />
    </div>
  );
}
