"use client";

/**
 * DependencyPanel — shows "Calls" and "Called by" relationships for a code template.
 * Rendered below the Monaco editor in the template detail area.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  FileCode2,
  Layers,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Search,
} from "lucide-react";
import Link from "next/link";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import { getChannelXml } from "@/lib/api/api-channels";
import { findCalledFunctions, findCallers } from "../_lib/dependency-analysis";
import {
  extractFunctionName,
  findUsages,
  type FindUsageResult,
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

interface DependencyPanelProps {
  template: CodeTemplate;
  templates: Map<string, CodeTemplate>;
  libraries: CodeTemplateLibrary[];
  channels: Map<string, string>;
  onSelectTemplate: (templateId: string) => void;
}

export function DependencyPanel({
  template,
  templates,
  libraries,
  channels,
  onSelectTemplate,
}: DependencyPanelProps) {
  const fnName = extractFunctionName(template.code);

  // Synchronous analysis
  const calls = useMemo(
    () => findCalledFunctions(template, templates, libraries),
    [template, templates, libraries]
  );
  const callerTemplates = useMemo(
    () => findCallers(template, templates, libraries),
    [template, templates, libraries]
  );

  // Async channel search state
  const [channelResults, setChannelResults] = useState<FindUsageResult[] | null>(null);
  const [channelProgress, setChannelProgress] = useState<FindUsageProgress | null>(null);
  const [channelSearching, setChannelSearching] = useState(false);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  // Reset channel results when the template changes (adjust state during render).
  const [prevTemplateId, setPrevTemplateId] = useState(template.id);
  if (template.id !== prevTemplateId) {
    setPrevTemplateId(template.id);
    setChannelResults(null);
    setChannelProgress(null);
    setChannelSearching(false);
    setExpandedChannels(new Set());
  }

  // Abort any in-flight channel search when the template changes (ref work stays in an effect).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [template.id]);

  const searchChannels = useCallback(async () => {
    if (!fnName) return;
    const ownerLib = libraries.find((l) => l.codeTemplateIds.includes(template.id));
    if (!ownerLib) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setChannelSearching(true);
    setChannelResults(null);
    setChannelProgress(null);
    setExpandedChannels(new Set());

    try {
      const allChannelIds = Array.from(channels.keys());
      const scopeIds = getEnabledChannelIds(ownerLib, allChannelIds);

      if (scopeIds.length === 0) {
        setChannelResults([]);
        return;
      }

      const found = await findUsages(
        fnName,
        scopeIds,
        channels,
        getChannelXml,
        (p) => setChannelProgress(p),
        abort.signal
      );

      if (!abort.signal.aborted) {
        setChannelResults(found);
        setExpandedChannels(new Set(found.map((r) => r.channelId)));
      }
    } catch {
      // Silently handle — user can retry
    } finally {
      if (!abort.signal.aborted) {
        setChannelSearching(false);
      }
    }
  }, [fnName, template.id, libraries, channels]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function toggleChannel(channelId: string) {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }

  const hasCalls = calls.length > 0;
  const hasCallers =
    callerTemplates.length > 0 || (channelResults !== null && channelResults.length > 0);
  const isEmpty =
    !hasCalls && !hasCallers && channelResults !== null && channelResults.length === 0;

  return (
    <div className="border-t border-border bg-gray-50 dark:bg-gray-900 overflow-y-auto max-h-[240px]">
      {!fnName && (
        <div className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
          No function declaration found. Dependencies are tracked by function name.
        </div>
      )}

      {fnName && (
        <div className="divide-y divide-border">
          {/* ── Calls section ── */}
          <div className="px-4 py-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
              <ArrowUpRight className="w-3.5 h-3.5" />
              Calls ({calls.length})
            </div>
            {calls.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-gray-500 py-1">
                Does not call other template functions.
              </div>
            ) : (
              <div className="space-y-0.5">
                {calls.map((c) => (
                  <button
                    key={c.templateId}
                    onClick={() => onSelectTemplate(c.templateId)}
                    className="flex items-center gap-2 w-full px-2 py-1 text-left rounded hover:bg-gray-100 dark:hover:bg-gray-800 group"
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <code className="text-xs text-blue-600 dark:text-blue-400 group-hover:underline">
                      {c.functionName}()
                    </code>
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {c.libraryName} &rsaquo; {c.templateName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Called by section ── */}
          <div className="px-4 py-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
              <ArrowDownLeft className="w-3.5 h-3.5" />
              Called by
            </div>

            {/* Template callers */}
            {callerTemplates.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mb-1">
                  <FileCode2 className="w-3 h-3" />
                  Code Templates ({callerTemplates.length})
                </div>
                <div className="space-y-0.5">
                  {callerTemplates.map((c) => (
                    <button
                      key={c.templateId}
                      onClick={() => onSelectTemplate(c.templateId)}
                      className="flex items-center gap-2 w-full px-2 py-1 text-left rounded hover:bg-gray-100 dark:hover:bg-gray-800 group"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 group-hover:underline truncate">
                        {c.templateName}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                        {c.libraryName}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Channel callers */}
            {channelResults === null && !channelSearching && (
              <button
                onClick={searchChannels}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
              >
                <Search className="w-3 h-3" />
                Search channels
              </button>
            )}

            {channelSearching && (
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                {channelProgress
                  ? `Searching… ${channelProgress.searched} of ${channelProgress.total}`
                  : "Searching channels…"}
              </div>
            )}

            {channelResults !== null && channelResults.length > 0 && (
              <div>
                <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mb-1">
                  <Layers className="w-3 h-3" />
                  Channels ({channelResults.length})
                </div>
                <div className="space-y-0.5">
                  {channelResults.map((result) => {
                    const expanded = expandedChannels.has(result.channelId);
                    return (
                      <div key={result.channelId}>
                        <button
                          onClick={() => toggleChannel(result.channelId)}
                          className="flex items-center gap-2 w-full px-2 py-1 text-left rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          {expanded ? (
                            <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
                          )}
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                            {result.channelName}
                          </span>
                          <span className="text-xs text-gray-400 shrink-0">
                            {result.locations.length}
                          </span>
                          <Link
                            href={`/channels/${result.channelId}/edit`}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-auto text-blue-500 hover:text-blue-600 shrink-0"
                            title="Open channel"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </button>
                        {expanded && (
                          <div className="pl-8 pr-2 pb-1 space-y-0.5">
                            {result.locations.map((loc, i) => (
                              <Link
                                key={i}
                                href={`/channels/${result.channelId}/edit?${loc.navParams}`}
                                className="block text-xs text-blue-600 dark:text-blue-400 hover:underline truncate"
                              >
                                {loc.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {channelResults !== null &&
              channelResults.length === 0 &&
              callerTemplates.length === 0 && (
                <div className="text-xs text-gray-400 dark:text-gray-500 py-1">
                  Not called by any templates or channels.
                </div>
              )}

            {channelResults !== null &&
              channelResults.length === 0 &&
              callerTemplates.length > 0 && (
                <div className="text-xs text-gray-400 dark:text-gray-500 py-1 px-2">
                  No channel usages found.
                </div>
              )}
          </div>

          {isEmpty && (
            <div className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
              No dependencies found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
