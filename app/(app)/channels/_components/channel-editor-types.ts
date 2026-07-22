// Shared types for ChannelEditorCore and useChannelEditor hook.

export type EditorTab = "summary" | "source" | "destination" | "scripts";

/** Identifies which filter/transformer panel is currently open (null = channel editor) */
export type FtView =
  | { mode: "filter" | "transformer"; target: "source" }
  | { mode: "filter" | "transformer" | "responseTransformer"; target: "dest"; destIndex: number };

export const TAB_LABELS: Record<EditorTab, string> = {
  summary: "Summary",
  source: "Source",
  destination: "Destinations",
  scripts: "Scripts",
};

export type ChannelEditorCoreProps =
  | {
      mode: "edit";
      channelId: string;
      initialTab?: EditorTab;
      initialDestIndex?: number;
      initialSub?: "filter" | "transformer" | "responseTransformer";
      initialScript?: string;
    }
  | { mode: "new"; defaultGroupId?: string };
