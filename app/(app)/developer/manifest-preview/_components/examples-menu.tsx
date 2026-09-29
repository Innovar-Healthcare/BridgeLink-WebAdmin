"use client";

/**
 * "Load example…" dropdown for the Manifest Preview page.
 *
 * The example manifests (shipped fixtures + corpus) are code-split into one
 * chunk: `_lib/examples-data` is dynamically imported the first time the menu
 * opens, so none of that JSON is in the page's initial-load bundle. Selecting
 * an example replaces the editor's envelope + manifest text.
 */

import { useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PreviewExample } from "../_lib/examples-data";

export function ExamplesMenu({ onLoad }: { onLoad: (example: PreviewExample) => void }) {
  const [examples, setExamples] = useState<PreviewExample[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function loadOnce() {
    if (examples || loading) return;
    setLoading(true);
    setError(false);
    try {
      const mod = await import("../_lib/examples-data");
      setExamples(mod.PREVIEW_EXAMPLES);
    } catch {
      // A stale deployment can 404 the hashed chunk; surface it and let a
      // reopen retry (examples stays null, so the guard above re-runs).
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const groups = examples
    ? (["Shipped fixtures", "Corpus"] as const).map((group) => ({
        group,
        items: examples.filter((e) => e.group === group),
      }))
    : [];

  return (
    <DropdownMenu onOpenChange={(open) => open && loadOnce()}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <BookOpen className="size-3.5" /> Load example…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading examples…
          </div>
        )}
        {!loading && error && (
          <div className="px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
            Couldn&apos;t load examples. Reopen to retry.
          </div>
        )}
        {!loading && examples && examples.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No examples available.</div>
        )}
        {groups.map(({ group, items }, gi) => (
          <div key={group}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {items.map((ex) => (
              <DropdownMenuItem key={ex.id} onSelect={() => onLoad(ex)}>
                {ex.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
