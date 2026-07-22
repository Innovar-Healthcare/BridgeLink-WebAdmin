import type { CSSProperties, ReactNode } from "react";

/**
 * Bottom gutter (px) reserved below the editor so the native resize grip sits in
 * clear space. See the Safari note below for why this is required.
 */
export const RESIZE_GUTTER_PX = 12;

export interface ResizableEditorBoxProps {
  /** Default height. A number is treated as px. Also the box's min height unless `minHeight` is set. */
  height: number | string;
  /** Minimum height the box can shrink to. Defaults to `height` (grow-only, matching the prior behavior). */
  minHeight?: number | string;
  /** Border/layout classes. Passed through verbatim so each call site keeps its exact border + invalid styling. */
  className?: string;
  /** Extra inline styles merged after the resize styles (rare — e.g. a background). */
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Resizable container for a Monaco `<Editor>` (or any editor-like content). Renders a
 * box with a native vertical resize grip, centralizing the cross-browser resize handling.
 *
 * Safari note: WebKit hit-tests the editor's own DOM over the bottom-right
 * corner where the UA resize grip lives, so the grip is unclickable there — even though
 * Chrome and Firefox paint it on top and let it win. We reserve a small bottom gutter
 * (`paddingBottom` + `box-sizing: border-box`) that the editor doesn't cover, so the grip
 * sits in clear space and drags correctly in all three browsers.
 *
 * The child `<Editor>` should use `height="100%"` with `automaticLayout: true` (already in
 * `MONACO_BASE_OPTIONS` / `getRhinoEditorOptions`) so it reflows as the box is dragged.
 */
export function ResizableEditorBox({
  height,
  minHeight,
  className,
  style,
  children,
}: ResizableEditorBoxProps) {
  return (
    <div
      className={className}
      style={{
        resize: "vertical",
        overflow: "hidden",
        minHeight: minHeight ?? height,
        height,
        paddingBottom: RESIZE_GUTTER_PX,
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
