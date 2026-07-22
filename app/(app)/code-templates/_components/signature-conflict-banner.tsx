"use client";

import { AlertTriangle } from "lucide-react";
import type { CodeTemplateLibrary } from "@/lib/types";
import type { SignatureConflict } from "@/lib/code-template-utils";

interface SignatureConflictBannerProps {
  templateId: string;
  conflict: SignatureConflict;
  libraries: CodeTemplateLibrary[];
}

/** Amber warning banner shown when two templates share the same function signature. */
export function SignatureConflictBanner({
  templateId,
  conflict,
  libraries,
}: SignatureConflictBannerProps) {
  const parentLib = libraries.find((l) => l.codeTemplateIds.includes(templateId));
  const otherLibNames = conflict.templates
    .filter((t) => t.libraryId !== parentLib?.id)
    .map((t) => `"${t.libraryName}"`)
    .join(", ");

  return (
    <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2 shrink-0">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        Signature conflict:{" "}
        <code className="font-mono font-semibold">
          {conflict.functionName}({conflict.paramCount} param
          {conflict.paramCount !== 1 ? "s" : ""})
        </code>{" "}
        is also defined in {otherLibNames}. Channels using both libraries will experience a
        collision.
      </span>
    </div>
  );
}
