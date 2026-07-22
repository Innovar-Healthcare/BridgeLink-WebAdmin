"use client";

import { ArrowUpCircle, ExternalLink, ScrollText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UpdateCheckResult } from "@/lib/hooks/use-update-check";

interface UpdateAvailableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: UpdateCheckResult;
  onDismiss: () => void;
}

export function UpdateAvailableDialog({
  open,
  onOpenChange,
  result,
  onDismiss,
}: UpdateAvailableDialogProps) {
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

  function handleGotIt() {
    onDismiss();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="w-5 h-5 text-orange-500 shrink-0" />
            Update Available
          </DialogTitle>
          <DialogDescription>A new version of WebAdmin is available.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2.5">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Current</div>
              <div className="font-mono">{currentVersion}</div>
            </div>
            <ArrowUpCircle className="w-4 h-4 text-muted-foreground mx-3" />
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-0.5">Latest</div>
              <div className="font-mono font-semibold text-orange-600 dark:text-orange-400">
                {result.latestVersion}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {result.releaseNotesUrl && (
              <a
                href={result.releaseNotesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
              >
                <Button variant="outline" size="sm" className="w-full">
                  <ScrollText className="w-3.5 h-3.5 mr-1.5" />
                  Release Notes
                  <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                </Button>
              </a>
            )}
            {result.downloadUrl && (
              <a
                href={result.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
              >
                <Button variant="outline" size="sm" className="w-full">
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Download
                  <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                </Button>
              </a>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Remind me later
          </Button>
          <Button size="sm" onClick={handleGotIt}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
