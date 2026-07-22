"use client";

import { useState, useEffect } from "react";
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
import { downloadFile } from "@/lib/download";
import { stripEmptyExportDataFields } from "../_lib/export-helpers";
import { loadAdminPrefs } from "@/components/settings/admin-tab";

/**
 * Mirrors the Java UI's ExportChannelLibrariesDialog.
 * Fetches the channel XML (with libraries) once on open, shows the linked library
 * names, and lets the user choose:
 *   Yes    -> export the XML that already has libraries embedded
 *   No     -> strip exportData libraries from the XML before downloading
 *   Cancel -> abort
 */
export function ExportChannelDialog({
  open,
  onClose,
  channelId,
  channelName,
}: {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelName: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [xmlWithLibs, setXmlWithLibs] = useState<string>("");
  const [libraryNames, setLibraryNames] = useState<string[]>([]);

  // Reset state each time the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in the
  // effect below, which avoids the cascading-render warning from
  // react-hooks/set-state-in-effect. The effect is left to perform only the
  // async fetch (its setState calls run inside async callbacks, not synchronously).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLoading(true);
      setError(null);
      setXmlWithLibs("");
      setLibraryNames([]);
    }
  }

  // Fetch on open
  useEffect(() => {
    if (!open || !channelId) return;
    getChannelExportData(channelId)
      .then(({ xml, libraryNames: names }) => {
        setXmlWithLibs(xml);
        setLibraryNames(names);
        // Auto-answer based on the admin pref when libraries are present: download
        // and close immediately without showing the dialog. Pass the freshly
        // fetched xml directly since xmlWithLibs state isn't updated yet here.
        if (names.length > 0) {
          const pref = loadAdminPrefs().exportChannelCodeTemplateLibraries;
          if (pref === "yes") {
            doExport(true, xml);
            return;
          }
          if (pref === "no") {
            doExport(false, xml);
            return;
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // doExport is stable — only reads props (channelName, onClose) and its xml arg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channelId]);

  const safeName = channelName.replace(/[^a-z0-9_\-]/gi, "_");

  function doExport(includeLibraries: boolean, xmlOverride?: string) {
    let xml = xmlOverride ?? xmlWithLibs;
    if (!includeLibraries) {
      // Strip the <codeTemplateLibraries> block from exportData so it matches
      // what a plain GET /channels/{id} (no flag) would return.
      xml = xml.replace(/<codeTemplateLibraries>[\s\S]*?<\/codeTemplateLibraries>\s*/g, "");
    }
    // Strip empty exportData fields that the server always emits but Java UI omits
    xml = stripEmptyExportDataFields(xml);
    downloadFile(xml, `channel-${safeName}.xml`, { mimeType: "application/xml" });
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !loading) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => {
          if (loading) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (loading) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Export Channel</DialogTitle>
        </DialogHeader>
        <div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Checking linked code template libraries\u2026
            </div>
          ) : error ? (
            <div className="px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded">
              {error}
            </div>
          ) : libraryNames.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              No code template libraries are linked to this channel.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                The following code template libraries are linked to this channel:
              </p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                {libraryNames.map((name) => (
                  <li key={name} className="text-sm text-gray-700 dark:text-gray-300">
                    {name}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                Do you wish to include these libraries in the channel export?
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          {!loading && !error && libraryNames.length === 0 ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => doExport(false)}>Export</Button>
            </>
          ) : !loading && !error ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => doExport(false)}>
                No
              </Button>
              <Button onClick={() => doExport(true)}>Yes</Button>
            </>
          ) : error ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
