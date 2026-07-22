"use client";

/**
 * Find Usage dialog — searches channel scripts and other code templates
 * for references to a code template function.
 */

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Search, ExternalLink, ChevronDown, ChevronRight, FileCode2, Layers } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import { getChannelXml } from "@/lib/api/api-channels";
import {
  extractFunctionName,
  findUsages,
  searchTemplatesForFunction,
  type FindUsageResult,
  type FindUsageTemplateResult,
  type FindUsageProgress,
} from "../_lib/find-usage";

// ─── Helper: determine which channels have a library enabled ──────────────────

function getEnabledChannelIds(library: CodeTemplateLibrary, allChannelIds: string[]): string[] {
  const { includeNewChannels = false, enabledChannelIds = [], disabledChannelIds = [] } = library;

  if (includeNewChannels) {
    const disabledSet = new Set(disabledChannelIds);
    return allChannelIds.filter((id) => !disabledSet.has(id));
  }
  return enabledChannelIds.filter((id) => allChannelIds.includes(id));
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FindUsageDialogProps {
  template: CodeTemplate;
  libraries: CodeTemplateLibrary[];
  channels: Map<string, string>; // channelId → channelName
  templates: Map<string, CodeTemplate>; // all loaded templates
  open: boolean;
  onClose: () => void;
  onSelectTemplate?: (templateId: string) => void;
}

export function FindUsageDialog({
  template,
  libraries,
  channels,
  templates,
  open,
  onClose,
  onSelectTemplate,
}: FindUsageDialogProps) {
  const [channelResults, setChannelResults] = useState<FindUsageResult[] | null>(null);
  const [templateResults, setTemplateResults] = useState<FindUsageTemplateResult[]>([]);
  const [progress, setProgress] = useState<FindUsageProgress | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const functionName = extractFunctionName(template.code);
  const ownerLib = libraries.find((l) => l.codeTemplateIds.includes(template.id));

  const doSearch = useCallback(async () => {
    if (!functionName || !ownerLib) return;

    setSearching(true);
    setError(null);
    setChannelResults(null);
    setTemplateResults([]);
    setProgress(null);
    setExpandedChannels(new Set());

    // Synchronous: search other templates
    const tmplResults = searchTemplatesForFunction(functionName, templates, template.id, libraries);
    setTemplateResults(tmplResults);

    // Async: search channels
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const allChannelIds = Array.from(channels.keys());
      const scopeIds = getEnabledChannelIds(ownerLib, allChannelIds);

      if (scopeIds.length === 0) {
        setChannelResults([]);
        return;
      }

      const found = await findUsages(
        functionName,
        scopeIds,
        channels,
        getChannelXml,
        (p) => setProgress(p),
        abort.signal
      );

      if (!abort.signal.aborted) {
        setChannelResults(found);
        setExpandedChannels(new Set(found.map((r) => r.channelId)));
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!abort.signal.aborted) {
        setSearching(false);
      }
    }
  }, [functionName, ownerLib, channels, templates, template.id, libraries]);

  // Auto-search when dialog opens. doSearch() kicks off real side effects
  // (AbortController + async fetch), so it must stay in an effect rather than a
  // render-time guard. Its synchronous setState resets (setSearching, setError,
  // etc.) are wrapped in startTransition so they don't trip the
  // set-state-in-effect cascading-render warning; the async setState calls in
  // doSearch's await continuations are already exempt.
  useEffect(() => {
    if (open) {
      startTransition(() => {
        doSearch();
      });
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [open, doSearch]);

  function handleClose() {
    abortRef.current?.abort();
    setChannelResults(null);
    setTemplateResults([]);
    setProgress(null);
    setSearching(false);
    setError(null);
    onClose();
  }

  function toggleChannel(channelId: string) {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }

  const scopeCount = ownerLib
    ? getEnabledChannelIds(ownerLib, Array.from(channels.keys())).length
    : 0;

  const hasNoResults =
    !searching &&
    channelResults !== null &&
    channelResults.length === 0 &&
    templateResults.length === 0;

  const totalChannelLocations = channelResults?.reduce((s, r) => s + r.locations.length, 0) ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        className="sm:max-w-[600px] max-h-[80vh] flex flex-col p-0 gap-0"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-blue-500 shrink-0" />
            <DialogTitle className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
              {functionName ? (
                <>
                  Usages of{" "}
                  <code className="text-blue-600 dark:text-blue-400">{functionName}()</code>
                </>
              ) : (
                "Find Usage"
              )}
            </DialogTitle>
          </div>
        </div>

        {/* Scope info */}
        <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-border shrink-0">
          {ownerLib ? (
            <>
              Searching {templates.size - 1} template{templates.size - 1 !== 1 ? "s" : ""} and{" "}
              {scopeCount} channel{scopeCount !== 1 ? "s" : ""} with library{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">{ownerLib.name}</span>{" "}
              enabled
            </>
          ) : (
            "No parent library found"
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!functionName && (
            <div className="px-4 py-8 text-sm text-gray-400 dark:text-gray-500 text-center">
              No function declaration found in this template.
              <br />
              Find Usage works with templates that contain a{" "}
              <code className="text-gray-500 dark:text-gray-400">function name()</code> declaration.
            </div>
          )}

          {functionName && searching && templateResults.length === 0 && (
            <div className="px-4 py-8 text-sm text-gray-500 dark:text-gray-400 text-center">
              <div className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2" />
              {progress
                ? `Searching… ${progress.searched} of ${progress.total} channels`
                : "Starting search…"}
            </div>
          )}

          {error && (
            <div className="mx-4 mt-3 px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded">
              {error}
            </div>
          )}

          {functionName && hasNoResults && (
            <div className="px-4 py-8 text-sm text-gray-400 dark:text-gray-500 text-center">
              No usages found in {templates.size - 1} template
              {templates.size - 1 !== 1 ? "s" : ""} or {scopeCount} channel
              {scopeCount !== 1 ? "s" : ""}.
            </div>
          )}

          {/* Template results */}
          {templateResults.length > 0 && (
            <div className="py-2">
              <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <FileCode2 className="w-3.5 h-3.5" />
                Code Templates ({templateResults.length})
              </div>
              {templateResults.map((r) => (
                <div key={r.templateId} className="border-b border-border last:border-b-0">
                  <button
                    onClick={() => {
                      onSelectTemplate?.(r.templateId);
                      handleClose();
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    title="Go to this template"
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {r.templateName}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                      {r.libraryName}
                    </span>
                  </button>
                  {r.snippet && (
                    <div className="pl-10 pr-4 pb-2">
                      <div className="text-xs text-gray-500 dark:text-gray-500 font-mono bg-gray-50 dark:bg-gray-900 rounded px-2 py-1 truncate">
                        {r.snippet}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Channel results */}
          {channelResults !== null && channelResults.length > 0 && (
            <div className="py-2">
              <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <Layers className="w-3.5 h-3.5" />
                Channels ({channelResults.length} — {totalChannelLocations} location
                {totalChannelLocations !== 1 ? "s" : ""})
              </div>
              {channelResults.map((result) => {
                const expanded = expandedChannels.has(result.channelId);
                return (
                  <div key={result.channelId} className="border-b border-border last:border-b-0">
                    <button
                      onClick={() => toggleChannel(result.channelId)}
                      className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    >
                      {expanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                        {result.channelName}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                        {result.locations.length} location
                        {result.locations.length !== 1 ? "s" : ""}
                      </span>
                      <Link
                        href={`/channels/${result.channelId}/edit?${result.locations[0].navParams}`}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto text-blue-500 hover:text-blue-600 shrink-0"
                        title="Open channel at first usage"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </button>
                    {expanded && (
                      <div className="pl-10 pr-4 pb-2 space-y-1.5">
                        {result.locations.map((loc, i) => (
                          <div key={i} className="text-xs">
                            <Link
                              href={`/channels/${result.channelId}/edit?${loc.navParams}`}
                              className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                              title="Open this script in the channel editor"
                            >
                              {loc.label}
                            </Link>
                            {loc.snippet && (
                              <div className="mt-0.5 text-gray-500 dark:text-gray-500 font-mono bg-gray-50 dark:bg-gray-900 rounded px-2 py-1 truncate">
                                {loc.snippet}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Channel search still in progress (show below template results) */}
          {functionName && searching && templateResults.length > 0 && (
            <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 text-center border-t border-border">
              <div className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-1.5" />
              {progress
                ? `Searching channels… ${progress.searched} of ${progress.total}`
                : "Searching channels…"}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
