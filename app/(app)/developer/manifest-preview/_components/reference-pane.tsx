"use client";

/**
 * Collapsible grammar reference for the Manifest Preview page.
 *
 * The field-type / kind-availability / caps tables are generated from the
 * published v3 JSON Schema (+ MANIFEST_CAPS) via buildReferenceModel, so the
 * on-page docs can't drift from what the validator accepts. Tables compose the
 * shared DataTable primitives (lint:tables). Doc references are plain repo
 * paths (they ship with the source; not served by the app), plus a copyable
 * local-validation command.
 */

import { useMemo } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { buildReferenceModel, isFieldTypeAllowed } from "../_lib/reference-model";

const YES = "✓";
const NO = "—";

// Columns are static (the six kinds are fixed); only the row DATA is derived.
const MATRIX_COLS: ColDef<string>[] = [
  { key: "type", label: "Field type", defaultWidth: 130, minWidth: 90, defaultVisible: true },
  {
    key: "connectorPanels",
    label: "Conn. panel",
    defaultWidth: 96,
    minWidth: 60,
    defaultVisible: true,
  },
  {
    key: "settingsPanels",
    label: "Settings",
    defaultWidth: 84,
    minWidth: 60,
    defaultVisible: true,
  },
  {
    key: "connectorSections",
    label: "Conn. section",
    defaultWidth: 104,
    minWidth: 60,
    defaultVisible: true,
  },
  {
    key: "transmissionModes",
    label: "Txn mode",
    defaultWidth: 92,
    minWidth: 60,
    defaultVisible: true,
  },
  { key: "dataTypes", label: "Data type", defaultWidth: 88, minWidth: 60, defaultVisible: true },
  { key: "transformerSteps", label: "Step", defaultWidth: 72, minWidth: 60, defaultVisible: true },
];

const KIND_CAP_COLS: ColDef<string>[] = [
  { key: "kind", label: "Contribution", defaultWidth: 160, minWidth: 100, defaultVisible: true },
  {
    key: "defaultValue",
    label: "defaultValue",
    defaultWidth: 110,
    minWidth: 70,
    defaultVisible: true,
  },
  {
    key: "actions",
    label: "Action buttons",
    defaultWidth: 120,
    minWidth: 70,
    defaultVisible: true,
  },
];

const CAPS_COLS: ColDef<string>[] = [
  { key: "limit", label: "Limit", defaultWidth: 320, minWidth: 160, defaultVisible: true },
  { key: "value", label: "Max", defaultWidth: 100, minWidth: 60, defaultVisible: true },
];

const VALIDATE_COMMAND = "npm run validate:manifest -- path/to/extension";

export function ReferencePane({
  schema,
  open,
  onOpenChange,
}: {
  schema: object | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const model = useMemo(() => (schema ? buildReferenceModel(schema) : null), [schema]);
  const matrixConfig = useColumnConfig(MATRIX_COLS, "bl-manifest-preview-reftypes-v1");
  const kindConfig = useColumnConfig(KIND_CAP_COLS, "bl-manifest-preview-refkinds-v1");
  const capsConfig = useColumnConfig(CAPS_COLS, "bl-manifest-preview-refcaps-v1");

  const kindByKey = useMemo(() => new Map((model?.kinds ?? []).map((k) => [k.key, k])), [model]);
  const fieldTypeRows = useMemo(
    () =>
      model
        ? // Dedupe in case standardFieldType ever grows a "javascript" entry.
          [...new Set([...model.standardTypes, "javascript", ...model.collectionTypes])].map(
            (type) => ({ type })
          )
        : [],
    [model]
  );
  const anyDefaultValueNote = model?.kinds.some((k) => k.defaultValueNote) ?? false;

  const copyCommand = () => {
    navigator.clipboard.writeText(VALIDATE_COMMAND).then(
      () => toast.success("Command copied to clipboard."),
      () => toast.error("Could not copy to clipboard.")
    );
  };

  return (
    <div className="shrink-0 border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Grammar reference (field types, per-kind availability, caps)
      </button>
      {open && (
        <div className="max-h-80 space-y-4 overflow-y-auto px-3 pb-3 text-xs">
          {!model ? (
            <p className="text-muted-foreground">
              Reference unavailable — the schema could not be read.
            </p>
          ) : (
            <>
              <section className="space-y-1">
                <h3 className="font-semibold">Field type availability by contribution kind</h3>
                <DataTable<{ type: string }, string>
                  variant="resizable"
                  cols={MATRIX_COLS}
                  rows={fieldTypeRows}
                  colConfig={matrixConfig}
                  rowKey={(r) => r.type}
                  renderCell={(row, col) => {
                    if (col === "type") return <span className="font-mono">{row.type}</span>;
                    const k = kindByKey.get(col);
                    return k && isFieldTypeAllowed(model, row.type, k) ? YES : NO;
                  }}
                  cellAlign={{
                    connectorPanels: "center",
                    settingsPanels: "center",
                    connectorSections: "center",
                    transmissionModes: "center",
                    dataTypes: "center",
                    transformerSteps: "center",
                  }}
                />
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold">Per-kind capabilities</h3>
                <DataTable<(typeof model.kinds)[number], string>
                  variant="resizable"
                  cols={KIND_CAP_COLS}
                  rows={model.kinds}
                  colConfig={kindConfig}
                  rowKey={(r) => r.key}
                  renderCell={(row, col) =>
                    col === "kind"
                      ? row.label
                      : col === "defaultValue"
                        ? row.allowsDefaultValue
                          ? row.defaultValueNote
                            ? `${YES} †`
                            : YES
                          : NO
                        : row.allowsActions
                          ? YES
                          : NO
                  }
                  cellAlign={{ defaultValue: "center", actions: "center" }}
                />
                {anyDefaultValueNote && (
                  <p className="text-muted-foreground">† defaultValue not on javascript fields.</p>
                )}
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold">Complexity caps</h3>
                <DataTable<(typeof model.caps)[number], string>
                  variant="resizable"
                  cols={CAPS_COLS}
                  rows={model.caps}
                  colConfig={capsConfig}
                  rowKey={(r) => r.key}
                  renderCell={(row, col) =>
                    col === "limit" ? row.label : <span className="font-mono">{row.value}</span>
                  }
                  cellAlign={{ value: "right" }}
                />
              </section>

              <section className="space-y-1.5">
                <h3 className="font-semibold">Learn more</h3>
                <p className="text-muted-foreground">
                  The full guides ship with the source (not served by this app):
                </p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>
                    <code className="font-mono">docs/customer/plugins/DECLARATIVE-PLUGINS.md</code>{" "}
                    — packaging, validation, preview, licensing
                  </li>
                  <li>
                    <code className="font-mono">
                      docs/customer/plugins/DECLARATIVE-REFERENCE.md
                    </code>{" "}
                    — the full manifest grammar
                  </li>
                </ul>
                <p className="text-muted-foreground">Validate a manifest locally:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded border border-border bg-muted px-2 py-1 font-mono">
                    {VALIDATE_COMMAND}
                  </code>
                  <button
                    type="button"
                    onClick={copyCommand}
                    aria-label="Copy validate command"
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-muted"
                  >
                    <Copy className="size-3.5" /> Copy
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
