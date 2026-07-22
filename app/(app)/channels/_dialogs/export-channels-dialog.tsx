"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { getChannelExportData } from "@/lib/api-client";
import { downloadBlob } from "@/lib/download";
import { stripEmptyExportDataFields } from "../_lib/export-helpers";

export interface ExportChannelSpec {
  id: string;
  name: string;
}

/**
 * ExportChannelsDialog — multi-channel export with code template library prompt.
 *
 * Mirrors the Java UI's ExportChannelLibrariesDialog behaviour for multiple channels:
 *   1. Fetches each channel's export XML in parallel (up to 6 concurrent).
 *   2. Aggregates linked library names across all channels.
 *   3. Prompts Yes / No / Cancel for library inclusion.
 *   4. Downloads one .xml file per channel.
 */
export function ExportChannelsDialog({
  open,
  onClose,
  channels,
}: {
  open: boolean;
  onClose: () => void;
  channels: ExportChannelSpec[];
}) {
  type Phase = "fetching" | "confirm" | "error";
  const [phase, setPhase] = useState<Phase>("fetching");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [libraryNames, setLibraryNames] = useState<string[]>([]);

  // channelId -> { xml: string }
  const xmlMapRef = useRef<Map<string, string>>(new Map());

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
      setProgressLabel("");
      setError(null);
      setLibraryNames([]);
    }
  }

  useEffect(() => {
    if (!open || channels.length === 0) return;
    // Ref reset stays in the effect (not the render-time guard above) per react-hooks/refs.
    xmlMapRef.current = new Map();

    const total = channels.length;
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
      xmlMapRef.current.forEach((xml) => {
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

    const CONCURRENCY = 6;
    const queue = [...channels];
    let active = 0;

    function next() {
      while (active < CONCURRENCY && queue.length > 0) {
        const ch = queue.shift()!;
        active++;
        setProgressLabel(`Fetching "${ch.name}"\u2026`);
        getChannelExportData(ch.id)
          .then(({ xml }) => {
            xmlMapRef.current.set(ch.id, xml);
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

  async function doExport(includeLibraries: boolean) {
    const { zipSync, strToU8 } = await import("fflate");
    const files: Record<string, Uint8Array> = {};
    for (const ch of channels) {
      let xml = xmlMapRef.current.get(ch.id) ?? "";
      if (!includeLibraries) {
        xml = xml.replace(/<codeTemplateLibraries>[\s\S]*?<\/codeTemplateLibraries>\s*/g, "");
      }
      xml = stripEmptyExportDataFields(xml);
      const safeName = ch.name.replace(/[^a-z0-9_\-]/gi, "_");
      files[`channel-${safeName}.xml`] = strToU8(xml);
    }
    const blob = new Blob([zipSync(files)], { type: "application/zip" });
    downloadBlob(blob, "bridgelink-channels-export.zip");
    onClose();
  }

  const count = channels.length;

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
            Export {count} Channel{count !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {phase === "fetching" && (
            <>
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                <span className="truncate">
                  {progressLabel || "Checking linked code template libraries\u2026"}
                </span>
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
              No code template libraries are linked to the selected channels.
            </p>
          )}
          {phase === "confirm" && libraryNames.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                One or more selected channels have code template libraries linked to them. Do you
                wish to include these libraries in each respective channel export?
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
