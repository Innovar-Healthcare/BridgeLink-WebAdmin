// Shared types for ChannelEditorCore and useChannelEditor hook.

export type EditorTab = "summary" | "source" | "destination" | "scripts";

/** Identifies which filter/transformer panel is currently open (null = channel editor) */
export type FtView =
  | { mode: "filter" | "transformer"; target: "source" }
  | { mode: "filter" | "transformer" | "responseTransformer"; target: "dest"; destIndex: number };

/**
 * A Config Search deep link into one element of the open filter/transformer
 * overlay. `path` uses the editor's own index-path selection model;
 * `line` is 1-based within that element's script, and is absent for element
 * types that have no script buffer to land in.
 */
export interface FtDeepLink {
  path: number[];
  line?: number;
}

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
      /**
       * Config Search deep link into one filter rule / transformer step
       *: an index path matching the editor's own selection model,
       * and optionally the line within that step's script.
       *
       * Deliberately kept alongside `initialSub` rather than folded into
       * `FtView`: FtView is live, user-mutable state with several setters, and a
       * deep-link target living inside it would have to be cleared at every one
       * of them or it would re-hijack the selection the next time the user
       * opened an unrelated transformer.
       */
      initialFtPath?: number[];
      initialFtLine?: number;
    }
  | { mode: "new"; defaultGroupId?: string };
