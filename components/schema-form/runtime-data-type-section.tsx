"use client";

/**
 * Set Data Types dialog binding for runtime plugin manifests.
 *
 * `createRuntimeDataTypeSection(dataType, entry, compiled)` builds the
 * component the loader registers as the compiled type's PropertiesSection.
 * Unlike compiled-in data types — which hardcode their group gating — this
 * component derives which property groups render from the Java
 * DataTypePropertiesTableModel rules (PLAN-RuntimeDataTypes-BusinessLogic.md §4):
 *
 *   source      + inbound  → Serialization, Batch, Response Generation
 *   destination + inbound  → Serialization
 *   response    + inbound  → Serialization, Response Validation
 *   any         + outbound → Deserialization, Template Serialization
 *
 * Template Serialization is the serialization group's fields RE-rendered on
 * the outbound side, editing the outbound document's own
 * <serializationProperties> element — Java parity, not a bug. Response
 * Validation renders on the response transformer's INBOUND panel (collected
 * for RESPONSE, rendered when inbound — the one non-obvious Java mapping).
 *
 * Values bind one level down (group element → field) via the nested
 * xml-field-binding helpers; every write is a surgical DOM edit that
 * re-serializes the whole document, so any group or element the manifest
 * doesn't model round-trips verbatim. Rendered for every runtime type (even
 * a group-less one) so the "Provided by <extension>" attribution always
 * shows — a third-party section can never impersonate a built-in — and so
 * Restore Defaults stays available.
 *
 * "javascript" fields render the host's ScriptEditorDialog (the compiled-in
 * batchScript pattern): the script VALUE is user-authored channel data
 * executed by the engine at message time — WebAdmin only edits text.
 */

import { lazy, Suspense, useMemo, useState } from "react";
import type { FunctionComponent } from "react";
import type { ContextType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { validateFieldValues } from "@/lib/runtime-plugins/compile-validate";
import { evaluateCondition } from "@/lib/runtime-plugins/condition-eval";
import {
  findDirectChild,
  parsePropertiesDoc,
  readNestedFieldValues,
  writeNestedFieldValue,
} from "@/lib/runtime-plugins/xml-field-binding";
import {
  collectionSpec,
  readCollectionFrom,
  writeCollectionInto,
} from "@/lib/runtime-plugins/xml-collection-binding";
import {
  COLLECTION_FIELD_TYPES,
  type DataTypeContribution,
  type DataTypeGroupName,
  type DataTypePropertyGroup,
  type FieldDescriptor,
} from "@/lib/runtime-plugins/manifest-types";
import { SchemaCollectionField } from "./schema-collection-field";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

/** Reads a collection field's rows from a data-type group element (one level down). */
function readGroupCollection(xml: string, groupTag: string, field: FieldDescriptor) {
  const root = parsePropertiesDoc(xml)?.documentElement ?? null;
  const group = root ? findDirectChild(root, groupTag) : null;
  return readCollectionFrom(group, collectionSpec(field));
}

/** Writes a collection field's rows into a data-type group element, re-serializing the whole doc. */
function writeGroupCollection(
  xml: string,
  groupTag: string,
  field: FieldDescriptor,
  rows: ReturnType<typeof readCollectionFrom>
): string {
  const doc = parsePropertiesDoc(xml);
  if (!doc) return xml;
  const root = doc.documentElement;
  let group = findDirectChild(root, groupTag);
  if (!group) {
    group = doc.createElementNS(null, groupTag);
    root.appendChild(group);
  }
  writeCollectionInto(group, collectionSpec(field), rows, doc);
  return new XMLSerializer().serializeToString(doc);
}
import type {
  DataTypeDefinition,
  DataTypePropertiesSectionProps,
} from "@/app/(app)/channels/_datatypes/types";
import { FieldRow } from "@/components/settings/settings-section";
import { SchemaField } from "./schema-field";

// LAZY on purpose: this module sits in the boot-path loader's static graph
// (loader.ts imports createRuntimeDataTypeSection), and ScriptEditorDialog
// drags the Monaco wrapper + acorn-based rhino validation with it — an eager
// import here puts all of that into the app-shell initial chunks for every
// page load (the CLAUDE.md bundle rule). The chunk loads on the first click
// of a javascript field's Edit button instead.
const LazyScriptEditorDialog = lazy(() =>
  import("@/app/(app)/channels/_datatypes/panel-components").then((m) => ({
    default: m.ScriptEditorDialog,
  }))
);

/** Section titles and descriptions — Java DataTypePropertiesTableModel verbatim. */
const SECTION_TEXT: Record<string, { title: string; description: string }> = {
  serialization: {
    title: "Serialization",
    description: "These properties are used to convert the inbound message to XML.",
  },
  deserialization: {
    title: "Deserialization",
    description:
      "These properties are used to convert the transformed XML message into the specified data type",
  },
  templateSerialization: {
    title: "Template Serialization",
    description: "These properties are used to convert the outbound message template to XML.",
  },
  batch: {
    title: "Batch",
    description:
      "These properties have no effect unless Process Batch is enabled in the source connector.",
  },
  responseGeneration: {
    title: "Response Generation",
    description: "These properties are used when responses are automatically generated.",
  },
  responseValidation: {
    title: "Response Validation",
    description:
      "These properties have no effect unless Validate Response is enabled in the destination connector.",
  },
};

interface VisibleSection {
  /** Key into SECTION_TEXT (NOT always the group name — see templateSerialization). */
  textKey: string;
  /** The backing property group whose element the fields bind into. */
  group: DataTypePropertyGroup;
}

/** The Java two-stage gating, reduced per (transformerType × side). */
function visibleSections(
  side: "inbound" | "outbound",
  transformerType: "source" | "destination" | "response",
  groups: ReadonlyMap<DataTypeGroupName, DataTypePropertyGroup>
): VisibleSection[] {
  const sections: VisibleSection[] = [];
  const push = (textKey: string, groupName: DataTypeGroupName) => {
    const group = groups.get(groupName);
    if (group) sections.push({ textKey, group });
  };
  if (side === "inbound") {
    push("serialization", "serialization");
    if (transformerType === "source") {
      push("batch", "batch");
      push("responseGeneration", "responseGeneration");
    }
    if (transformerType === "response") push("responseValidation", "responseValidation");
  } else {
    push("deserialization", "deserialization");
    push("templateSerialization", "serialization");
  }
  return sections;
}

/**
 * A "javascript" field: label + Edit button opening the host's Monaco script
 * dialog (the compiled-in batchScript pattern — ScriptEditorDialog already
 * handles Monaco-in-Radix-modal,/. The value is plain
 * element text like every other field.
 *
 * Exported so the runtime transformer-step editor reuses the SAME
 * lazy ScriptEditorDialog entry point — keeping Monaco/acorn out of the
 * boot-path loader graph with one shared React.lazy import, no drift.
 * `contextType` scopes Monaco completions (Java ContextType); `description`
 * is the dialog subtitle (the data-type caller omits it for the batch script).
 */
export function ScriptField({
  field,
  value,
  onChange,
  disabled,
  invalid,
  channelId,
  contextType,
  description,
}: {
  field: FieldDescriptor;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  channelId?: string;
  contextType?: ContextType;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <FieldRow label={field.label} tooltip={field.tooltip}>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`Edit ${field.label}`}
        className={cn(
          "justify-self-start px-2 py-0.5 text-xs rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed",
          invalid && "border-red-500"
        )}
      >
        Edit
      </button>
      {/* Mounted only while open so the Monaco chunk loads on first use. */}
      {open && (
        <Suspense fallback={null}>
          <LazyScriptEditorDialog
            open={open}
            onOpenChange={setOpen}
            title={field.label}
            value={value}
            onSave={onChange}
            channelId={channelId}
            contextType={contextType}
            description={description}
          />
        </Suspense>
      )}
    </FieldRow>
  );
}

/**
 * Stable, module-level render body. The `dataType`/`entry`/`compiled` the
 * factory closes over are passed as props so the component identity never
 * changes — which lets the Manifest Preview page render it directly (calling
 * the factory during render would mint a new component type each render,
 * tripping the React Compiler `react-hooks/static-components` rule). The factory
 * below wraps it for the loader's registry contract, where it's instantiated
 * once at registration.
 */
export function RuntimeDataTypeSectionImpl({
  dataType,
  entry,
  compiled,
  propsXml,
  side,
  transformerType,
  onChange,
  channelId,
}: DataTypePropertiesSectionProps & {
  dataType: DataTypeContribution;
  entry: { name: string };
  compiled: Pick<DataTypeDefinition, "defaultPropertiesXml">;
}) {
  const groups = useMemo(
    () =>
      new Map<DataTypeGroupName, DataTypePropertyGroup>(
        (dataType.propertyGroups ?? []).map((g) => [g.group, g])
      ),
    [dataType]
  );
  const { viewDensity } = useCompactMode();

  const unparseable = propsXml !== null && parsePropertiesDoc(propsXml) === null;
  // A null propsXml renders (and first-writes on top of) the compiled
  // engine defaults — the same self-seeding the compiled-in panels do via
  // parsePropsOrDefault. The version argument is ignored by the compiled
  // implementation (engine attributes are authoritative).
  const effectiveXml =
    propsXml ??
    compiled.defaultPropertiesXml(
      side === "inbound" ? "inboundProperties" : "outboundProperties",
      ""
    );
  const sections = visibleSections(side, transformerType, groups);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-3 py-3 space-y-4 text-xs">
          <p className="text-xs text-muted-foreground">Provided by {entry.name}</p>
          {unparseable ? (
            // Fail soft, never crash the dialog: leave broken XML alone and say so.
            <p className="text-sm text-muted-foreground">
              The data type properties XML could not be parsed, so the{" "}
              {dataType.displayName ?? dataType.name} properties form is unavailable. The stored XML
              has been left untouched.
            </p>
          ) : sections.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              No properties to configure for this context.
            </p>
          ) : (
            sections.map(({ textKey, group }) => {
              const groupTag = `${group.group}Properties`;
              // Scalar keys only — a collection container's concatenated text
              // must not mash into the scalar bag (collections bind separately).
              const keys = group.fields
                .filter((f) => !COLLECTION_TYPES.has(f.type))
                .map((f) => f.key);
              // Per-group value scope: conditions and validation evaluate
              // against THIS group's values only, matching the validator's
              // per-group condition-reference check.
              const values = readNestedFieldValues(effectiveXml, groupTag, keys);
              const invalidFields = new Set(
                validateFieldValues(group.fields, values).map((e) => e.field)
              );
              const text = SECTION_TEXT[textKey];
              return (
                <div key={textKey}>
                  <p className="font-semibold text-gray-700 dark:text-gray-200">{text.title}</p>
                  <p className="text-gray-500 dark:text-gray-400 mb-2">{text.description}</p>
                  {group.fields
                    .filter(
                      (field) => !field.visibleWhen || evaluateCondition(field.visibleWhen, values)
                    )
                    .map((field) => {
                      const value = values[field.key] ?? "";
                      const fieldOnChange = (next: string) =>
                        onChange(writeNestedFieldValue(effectiveXml, groupTag, field.key, next));
                      const disabled = field.enabledWhen
                        ? !evaluateCondition(field.enabledWhen, values)
                        : false;
                      const invalid = invalidFields.has(field.key);
                      if (COLLECTION_TYPES.has(field.type)) {
                        // Data-type collections bind one level down (group
                        // element); no variableToggle here (validator-forbidden).
                        return (
                          <SchemaCollectionField
                            key={field.key}
                            field={field}
                            value={readGroupCollection(effectiveXml, groupTag, field)}
                            onChange={(rows) =>
                              onChange(writeGroupCollection(effectiveXml, groupTag, field, rows))
                            }
                            useVariable={false}
                            variableValue=""
                            onUseVariableChange={() => {}}
                            onVariableValueChange={() => {}}
                            disabled={disabled}
                            density={viewDensity}
                          />
                        );
                      }
                      return field.type === "javascript" ? (
                        <ScriptField
                          key={field.key}
                          field={field}
                          value={value}
                          onChange={fieldOnChange}
                          disabled={disabled}
                          invalid={invalid}
                          channelId={channelId}
                          // Code-template completion scoping: only the batch
                          // group has a defined engine context.
                          contextType={group.group === "batch" ? "CHANNEL_BATCH" : undefined}
                          description={
                            group.group === "batch"
                              ? undefined
                              : "Edit the JavaScript for this data type property."
                          }
                        />
                      ) : (
                        <SchemaField
                          key={field.key}
                          field={field}
                          value={value}
                          onChange={fieldOnChange}
                          disabled={disabled}
                          invalid={invalid}
                          density={viewDensity}
                        />
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function createRuntimeDataTypeSection(
  dataType: DataTypeContribution,
  entry: { name: string },
  compiled: Pick<DataTypeDefinition, "defaultPropertiesXml">
): FunctionComponent<DataTypePropertiesSectionProps> {
  function RuntimeDataTypeSection(props: DataTypePropertiesSectionProps) {
    return (
      <RuntimeDataTypeSectionImpl
        dataType={dataType}
        entry={entry}
        compiled={compiled}
        {...props}
      />
    );
  }
  RuntimeDataTypeSection.displayName = `RuntimeDataTypeSection(${dataType.name})`;
  return RuntimeDataTypeSection;
}
