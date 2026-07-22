import type { ColDef } from "@/lib/hooks/use-column-config";

export type CommitCol = "from" | "to" | "hash" | "date" | "author" | "message";

export const COMMIT_COLS: ColDef<CommitCol>[] = [
  { key: "hash", label: "Hash", defaultWidth: 80, minWidth: 60, defaultVisible: true },
  { key: "date", label: "Date", defaultWidth: 150, minWidth: 100, defaultVisible: true },
  { key: "author", label: "Author", defaultWidth: 120, minWidth: 80, defaultVisible: true },
  { key: "message", label: "Message", defaultWidth: 280, minWidth: 100, defaultVisible: true },
];

export const COMMIT_COLS_COMPARE: ColDef<CommitCol>[] = [
  {
    key: "from",
    label: "From",
    defaultWidth: 36,
    minWidth: 28,
    defaultVisible: true,
    canHide: false,
  },
  { key: "to", label: "To", defaultWidth: 36, minWidth: 28, defaultVisible: true, canHide: false },
  ...COMMIT_COLS,
];
