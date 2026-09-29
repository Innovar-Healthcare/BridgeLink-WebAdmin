/**
 * Builds the destination URL for a Config Search result.
 *
 * Split out of the results component so the URL grammar is unit-testable and
 * lives next to the segmenter that produces the targets.
 *
 * A `line` is appended only where a destination actually reads it. Emitting
 * `&line=` at a page that ignores it would be dead API that reads, to the next
 * person, like a bug. Today that means the channel editor's filter/transformer
 * element deep link and the channel Scripts tab. Code templates and global
 * scripts still navigate to the right editor, just not to the line — see the
 * follow-ups.
 */

import { formatIndexPath } from "@/app/(app)/channels/_lib/ft-deep-link";
import type { NavigationTarget } from "./search-types";

/**
 * Whether the destination for `target` reads a `line` param today.
 *
 * A segment can be a verbatim editor buffer (`lineBasis === "editor"`) and still
 * open somewhere that ignores the line — code templates and global scripts are
 * both in that state pending the follow-ups. The results UI uses this
 * so it does not label a row "Open in editor at line 17" and then land on line 1.
 */
export function targetSupportsLine(target: NavigationTarget): boolean {
  switch (target.type) {
    case "channel-scripts":
      return true;
    case "channel-source":
    case "channel-destination":
      // A line is only meaningful once an element names which editor it is in.
      return target.element != null;
    default:
      return false;
  }
}

/**
 * @param target Where the matching segment lives.
 * @param line   1-based line of the specific match, when the segment's
 *               `lineBasis` is "editor". Ignored for targets that cannot use it.
 */
export function buildSearchResultHref(target: NavigationTarget, line?: number): string {
  switch (target.type) {
    case "channel-summary":
      return `/channels/${target.channelId}/edit`;

    case "channel-scripts": {
      const params = new URLSearchParams({ tab: "scripts", script: target.script });
      if (line) params.set("line", String(line));
      return `/channels/${target.channelId}/edit?${params}`;
    }

    case "channel-source": {
      const params = new URLSearchParams({ tab: "source", sub: target.sub });
      appendElement(params, target.element, line);
      return `/channels/${target.channelId}/edit?${params}`;
    }

    case "channel-destination": {
      const params = new URLSearchParams({
        tab: "destination",
        dest: String(target.destIndex),
        sub: target.sub,
      });
      appendElement(params, target.element, line);
      return `/channels/${target.channelId}/edit?${params}`;
    }

    case "channel-attachment":
      return `/channels/${target.channelId}/edit?tab=summary`;

    case "code-template":
      return `/code-templates?templateId=${encodeURIComponent(target.templateId)}`;

    case "global-script":
      return `/global-scripts?tab=${encodeURIComponent(target.scriptKey)}`;

    case "config-map":
      return `/settings?tab=configuration-map`;
  }
}

/**
 * A `line` without a `path` would be ambiguous — the filter/transformer overlay
 * has one editor per step, so a line only means something once a step is named.
 */
function appendElement(
  params: URLSearchParams,
  element: { path: number[] } | undefined,
  line: number | undefined
): void {
  if (!element) return;
  params.set("path", formatIndexPath(element.path));
  if (line) params.set("line", String(line));
}
