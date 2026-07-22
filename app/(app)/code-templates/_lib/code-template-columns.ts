/**
 * Column type and definitions for the Code Templates tree table.
 */

import type { ColDef } from "@/lib/hooks/use-column-config";
import { extractJsDocDescription } from "@/lib/code-template-utils";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";

export type CodeTemplateCol = "name" | "id" | "type" | "description" | "revision" | "lastModified";

export const CODE_TEMPLATE_COLS: ColDef<CodeTemplateCol>[] = [
  {
    key: "name",
    label: "Name",
    defaultWidth: 160,
    minWidth: 80,
    defaultVisible: true,
    canHide: false,
    align: "left",
  },
  {
    key: "id",
    label: "ID",
    defaultWidth: 200,
    minWidth: 80,
    defaultVisible: false,
    canHide: true,
    align: "left",
  },
  {
    key: "type",
    label: "Type",
    defaultWidth: 100,
    minWidth: 60,
    defaultVisible: false,
    canHide: true,
    align: "left",
  },
  {
    key: "description",
    label: "Description",
    defaultWidth: 120,
    minWidth: 60,
    defaultVisible: false,
    canHide: true,
    align: "left",
  },
  {
    key: "revision",
    label: "Revision",
    defaultWidth: 65,
    minWidth: 50,
    defaultVisible: true,
    canHide: true,
    align: "center",
  },
  {
    key: "lastModified",
    label: "Last Modified",
    defaultWidth: 135,
    minWidth: 90,
    defaultVisible: true,
    canHide: true,
    align: "left",
  },
];

/**
 * Top/bottom-layout column set. Same definitions as {@link CODE_TEMPLATE_COLS}, but Type and
 * Description default to visible — the wide table in top/bottom layout has room for the Java
 * client's default five columns (Name, Type, Description, Revision, Last Modified). Derived from
 * the base array so column widths/order never drift between the two sets.
 */
export const CODE_TEMPLATE_COLS_TOP: ColDef<CodeTemplateCol>[] = CODE_TEMPLATE_COLS.map((col) =>
  col.key === "type" || col.key === "description" ? { ...col, defaultVisible: true } : col
);

/** Map CodeTemplateType enum to display label */
export const CODE_TEMPLATE_TYPE_LABELS: Record<string, string> = {
  FUNCTION: "Function",
  DRAG_AND_DROP_CODE: "Drag-and-Drop",
  COMPILED_CODE: "Compiled",
};

/** Get a sortable/displayable value for a column from a library */
export function getLibraryColValue(
  lib: CodeTemplateLibrary,
  col: CodeTemplateCol
): string | number | undefined {
  switch (col) {
    case "name":
      return lib.name;
    case "id":
      return lib.id;
    case "type":
      // Java renders a blank Type cell for library rows
      // (CodeTemplateLibraryTreeTableNode.getValueAt returns null for the type column).
      return "";
    case "description":
      return lib.description ?? "";
    case "revision":
      return lib.revision;
    case "lastModified":
      return lib.lastModified ?? "";
  }
}

/** Get a sortable/displayable value for a column from a template */
export function getTemplateColValue(
  tmpl: CodeTemplate,
  col: CodeTemplateCol
): string | number | undefined {
  switch (col) {
    case "name":
      return tmpl.name;
    case "id":
      return tmpl.id;
    case "type":
      return CODE_TEMPLATE_TYPE_LABELS[tmpl.type] ?? tmpl.type;
    case "description":
      // Mirror Java CodeTemplateUtil.getDocumentation: the first JSDoc line,
      // blank when the template has no (non-placeholder) JSDoc description.
      return extractJsDocDescription(tmpl.code) ?? "";
    case "revision":
      return tmpl.revision;
    case "lastModified":
      return tmpl.lastModified ?? "";
  }
}
