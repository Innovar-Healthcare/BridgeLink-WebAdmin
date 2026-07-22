"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getChannelExportData, getChannelGroupsXml } from "@/lib/api-client";
import { downloadBlob } from "@/lib/download";
import type { Channel, ChannelGroup } from "@/lib/types";
import { stripEmptyExportDataFields, escapeXml } from "../_lib/export-helpers";

/** A channel enriched with dashboard status fields. */
interface EnrichedChannel extends Channel {
  deployedState?: string;
  deployedDate?: string;
  received?: number;
  errored?: number;
}

export interface ExportGroupSpec {
  group: ChannelGroup;
  /** Full enriched channel objects that belong to this group */
  channels: EnrichedChannel[];
}

/**
 * ExportGroupsDialog — mirrors Java UI's per-group export with code template library prompt.
 *
 * Behaviour:
 *   1. On open, fetches every channel in each group (with libraries) in parallel, with
 *      a progress bar tracking completion.
 *   2. After fetching, checks whether any channel has linked code template libraries.
 *      - None found  -> shows "No libraries linked" with Export / Cancel
 *      - Some found  -> shows "...include these libraries in each respective channel export?"
 *                        with Yes / No / Cancel (matching Java UI wording)
 *   3. On Yes/No: builds per-group XML and triggers one download per group.
 *
 * XML format: the Java UI serialises a full <channelGroup> document that wraps the full
 * <channel> XML for each channel in a <channels> list.  We reconstruct this here by
 * fetching individual channel XMLs and composing them inside a <channelGroup> skeleton.
 */
export function ExportGroupsDialog({
  open,
  onClose,
  specs,
}: {
  open: boolean;
  onClose: () => void;
  /** One entry per group to export */
  specs: ExportGroupSpec[];
}) {
  type Phase = "fetching" | "confirm" | "error";
  const [phase, setPhase] = useState<Phase>("fetching");
  const [progress, setProgress] = useState(0); // 0-100
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [libraryNames, setLibraryNames] = useState<string[]>([]);

  // channelXmlMap: channelId -> { xml: string, hasLibraries: boolean }
  const channelXmlMapRef = useRef<Map<string, { xml: string; hasLibraries: boolean }>>(new Map());
  // groupLastModifiedXmlRef: groupId -> raw <lastModified>...</lastModified> XML block from server
  const groupLastModifiedXmlRef = useRef<Map<string, string>>(new Map());

  // Reset state each time the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in the
  // effect below, which avoids the cascading-render warning from
  // react-hooks/set-state-in-effect. The effect is left to perform only the
  // async fetch (its setState calls run inside async callbacks, not synchronously).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPhase("fetching");
      setProgress(0);
      setProgressLabel("Fetching group data…");
      setError(null);
      setLibraryNames([]);
    }
  }

  useEffect(() => {
    if (!open) return;
    // Ref resets stay in the effect (not the render-time guard above) per react-hooks/refs.
    channelXmlMapRef.current = new Map();
    groupLastModifiedXmlRef.current = new Map();

    const allChannels = specs.flatMap((s) => s.channels);
    // Total fetch count = groups XML (1) + individual channels
    const total = 1 + allChannels.length;
    let done = 0;
    let failed = false;

    function tick() {
      done++;
      setProgress(Math.round((done / total) * 100));
    }

    function fail(e: unknown) {
      if (!failed) {
        failed = true;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    }

    function finishIfDone() {
      if (failed || done < total) return;
      const allLibNames = new Set<string>();
      channelXmlMapRef.current.forEach(({ xml }) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");
        doc
          .querySelectorAll("exportData > codeTemplateLibraries > codeTemplateLibrary")
          .forEach((el) => {
            const name = el.querySelector(":scope > name")?.textContent?.trim();
            if (name) allLibNames.add(name);
          });
      });
      setLibraryNames([...allLibNames]);
      setProgress(100);
      setProgressLabel("");
      setPhase("confirm");
    }

    // 1. Fetch raw groups XML to extract <lastModified> blocks per group ID.
    //    We use the XML endpoint to get the original Calendar representation
    //    (time + timezone) exactly as the Java UI would serialize it, since
    //    normalizeXStream converts Calendar -> ISO string (losing timezone).
    //    The "Fetching group data\u2026" progress label is set in the render-time reset above.
    getChannelGroupsXml()
      .then((xml) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");
        doc.querySelectorAll("channelGroup").forEach((groupEl) => {
          const id = groupEl.querySelector(":scope > id")?.textContent?.trim();
          const lmEl = groupEl.querySelector(":scope > lastModified");
          if (id && lmEl) {
            groupLastModifiedXmlRef.current.set(id, lmEl.outerHTML);
          }
        });
        tick();
        finishIfDone();
      })
      .catch(fail);

    if (allChannels.length === 0) {
      // No channels — the groups XML fetch is the only thing to wait for.
      // finishIfDone will fire once it completes (done===total after tick()).
      return;
    }

    // 2. Fetch all channels in parallel (up to 6 at a time).
    const CONCURRENCY = 6;
    const queue = [...allChannels];
    let active = 0;

    function next() {
      while (active < CONCURRENCY && queue.length > 0) {
        const ch = queue.shift()!;
        active++;
        setProgressLabel(`Fetching "${ch.name}"\u2026`);
        getChannelExportData(ch.id)
          .then(({ xml, libraryNames: libs }) => {
            channelXmlMapRef.current.set(ch.id, { xml, hasLibraries: libs.length > 0 });
            tick();
          })
          .catch(fail)
          .finally(() => {
            active--;
            if (failed) return;
            if (queue.length > 0) {
              next();
            } else if (active === 0) {
              finishIfDone();
            }
          });
      }
    }
    next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Build a <channelGroup> XML document for a single group.
   *
   * Matches Java UI output exactly:
   *   - No <?xml?> declaration (Java's ObjectXMLSerializer.serialize() omits it)
   *   - version attribute from server (PlatformUI.SERVER_VERSION)
   *   - <lastModified> block preserved verbatim from the server's XML response
   *     (keeps the original time millis and timezone string)
   *   - No <description> element (Java omits it when empty/null)
   *   - Full embedded <channel> XML for each channel in server storage order
   */
  function buildGroupXml(spec: ExportGroupSpec, includeLibraries: boolean): string {
    const { group, channels } = spec;

    // Server version fetched at login — mirrors Java's PlatformUI.SERVER_VERSION
    const serverVersion = getSession()?.serverVersion ?? "";
    const versionAttr = serverVersion ? ` version="${escapeXml(serverVersion)}"` : "";

    // Raw <lastModified> block from the server's own XML — preserves time+timezone exactly
    const lastModifiedXml = groupLastModifiedXmlRef.current.get(group.id) ?? "";

    const channelsXml = channels
      .map((ch) => {
        const entry = channelXmlMapRef.current.get(ch.id);
        if (!entry) return `  <channel><id>${ch.id}</id></channel>`;
        let xml = entry.xml;
        if (!includeLibraries) {
          xml = xml.replace(/<codeTemplateLibraries>[\s\S]*?<\/codeTemplateLibraries>\s*/g, "");
        }
        // Strip empty exportData fields that server emits but Java UI omits
        xml = stripEmptyExportDataFields(xml);
        // Strip the XML declaration — it doesn't belong inside an embedded element
        xml = xml.replace(/^<\?xml[^?]*\?>\s*/i, "");
        // Indent the embedded channel element by 2 spaces
        return xml
          .split("\n")
          .map((line) => "  " + line)
          .join("\n");
      })
      .join("\n");

    // No <?xml?> header — Java's ObjectXMLSerializer.serialize() does not emit one
    return `<channelGroup${versionAttr}>
  <id>${group.id}</id>
  <name>${escapeXml(group.name)}</name>
  <revision>${group.revision ?? 1}</revision>
${lastModifiedXml ? `  ${lastModifiedXml}\n` : ""}<channels>
${channelsXml}
  </channels>
</channelGroup>`;
  }

  async function doExport(includeLibraries: boolean) {
    const { zipSync, strToU8 } = await import("fflate");
    const files: Record<string, Uint8Array> = {};
    for (const spec of specs) {
      const safeName = spec.group.name.replace(/[^a-z0-9_\-]/gi, "_");
      const xml = buildGroupXml(spec, includeLibraries);
      files[`channel-group-${safeName}.xml`] = strToU8(xml);
    }
    const blob = new Blob([zipSync(files)], { type: "application/zip" });
    downloadBlob(blob, "bridgelink-channel-groups-export.zip");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && phase !== "fetching") onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          if (phase === "fetching") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (phase === "fetching") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {specs.length === 1
              ? `Export Group: ${specs[0].group.name}`
              : `Export All Groups (${specs.length})`}
          </DialogTitle>
          <DialogDescription>
            Export channel groups and their channels to a ZIP file.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {phase === "fetching" && (
            <>
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                <span className="truncate">{progressLabel || "Fetching channel data\u2026"}</span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 text-right">{progress}%</p>
            </>
          )}
          {phase === "error" && (
            <div className="px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded">
              {error}
            </div>
          )}
          {phase === "confirm" && libraryNames.length === 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {specs.length === 1
                ? "No code template libraries are linked to channels in this group."
                : "No code template libraries are linked to channels in any of the selected groups."}
            </p>
          )}
          {phase === "confirm" && libraryNames.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                One or more channels{" "}
                {specs.length === 1 ? "in this group have" : "in the selected groups have"} code
                template libraries linked to them. Do you wish to include these libraries in each
                respective channel export?
              </p>
              <ul className="list-disc list-inside space-y-1 pl-1 max-h-40 overflow-y-auto">
                {libraryNames.map((name) => (
                  <li key={name} className="text-sm text-gray-700 dark:text-gray-300">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          {phase === "error" && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
          {phase === "confirm" && libraryNames.length === 0 && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void doExport(false)}>Export</Button>
            </>
          )}
          {phase === "confirm" && libraryNames.length > 0 && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => void doExport(false)}>
                No
              </Button>
              <Button onClick={() => void doExport(true)}>Yes</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
