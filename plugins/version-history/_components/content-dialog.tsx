"use client";

/**
 * Content Dialog
 *
 * Displays raw XML content for an entity at a specific commit revision.
 * Fetched via GET /plugins/version-history/content?id=<id>&revision=<sha>&mode=<mode>.
 * Mirrors Java's ChannelDiffDialog / "View Raw" action.
 */

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";

import { InfoDialog } from "@/components/info-dialog";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { getEntityContentAtRevision, getShortHash, type VhMode } from "../api-version-history";

interface ContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  entityName: string;
  revision: string;
  mode: VhMode;
}

export function ContentDialog({
  open,
  onOpenChange,
  entityId,
  entityName,
  revision,
  mode,
}: ContentDialogProps) {
  const [xml, setXml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoading(true);
      setError(null);
      setXml(null);
      try {
        const content = await getEntityContentAtRevision(entityId, revision, mode);
        setXml(content);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load content");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, entityId, revision, mode]);

  async function handleCopy() {
    if (!xml) return;
    try {
      await navigator.clipboard.writeText(xml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied
    }
  }

  const shortRev = revision === "HEAD" ? "HEAD" : getShortHash(revision);

  return (
    <InfoDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`XML — ${entityName}`}
      description={`Revision: ${shortRev}`}
      maxWidth="sm:max-w-3xl"
      resizable
      defaultWidth={820}
      minHeight={300}
      footerLeft={
        xml ? (
          <HoverTooltip content="Copy XML to clipboard">
            <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? (
                <Check className="w-4 h-4 mr-1.5 text-green-600" />
              ) : (
                <Copy className="w-4 h-4 mr-1.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </HoverTooltip>
        ) : undefined
      }
    >
      <ApiErrorAlert error={error} />
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      )}
      {!loading && xml && (
        <pre className="text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-border rounded p-3 min-h-full whitespace-pre-wrap break-all">
          {xml}
        </pre>
      )}
    </InfoDialog>
  );
}
