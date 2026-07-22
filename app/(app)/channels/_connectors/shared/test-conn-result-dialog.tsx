"use client";

import { InfoDialog } from "@/components/info-dialog";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { TestConnResult } from "./use-test-conn";

interface TestConnResultDialogProps {
  open: boolean;
  result: TestConnResult | null;
  onClose: () => void;
}

/**
 * TestConnResultDialog — modal dialog showing the outcome of a connector
 * test action (Test Connection / Test Write / Send Test Email). Mirrors the
 * Java client's JOptionPane pattern so the result never affects page layout.
 */
export function TestConnResultDialog({ open, result, onClose }: TestConnResultDialogProps) {
  if (!result) {
    return (
      <InfoDialog open={open} onOpenChange={(o) => !o && onClose()} title="">
        {null}
      </InfoDialog>
    );
  }

  const { Icon, title, accent } =
    result.type === "SUCCESS"
      ? {
          Icon: CheckCircle2,
          title: "Connection successful",
          accent: "text-green-600 dark:text-green-400",
        }
      : result.type === "TIME_OUT"
        ? {
            Icon: AlertTriangle,
            title: "Connection timed out",
            accent: "text-amber-600 dark:text-amber-400",
          }
        : {
            Icon: XCircle,
            title: "Connection failed",
            accent: "text-red-600 dark:text-red-400",
          };

  return (
    <InfoDialog open={open} onOpenChange={(o) => !o && onClose()} title={title}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${accent}`} aria-hidden="true" />
        <pre className="flex-1 text-sm whitespace-pre-wrap break-words font-sans text-foreground">
          {result.message || (result.type === "SUCCESS" ? "Connection succeeded." : "")}
        </pre>
      </div>
    </InfoDialog>
  );
}
