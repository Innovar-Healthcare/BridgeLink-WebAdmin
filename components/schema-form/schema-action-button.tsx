"use client";

/**
 * A runtime plugin manifest action button.
 *
 * Calls the declared endpoint — validated at manifest time to live under the
 * contributing extension's own /extensions/<path>/ namespace — on the user's
 * existing session and shows the plain-text result as a toast. Nothing
 * user-typed is ever interpolated into the URL, and the optional confirmation
 * prompt renders as plain text.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { request } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ActionButton } from "@/lib/runtime-plugins/manifest-types";

/** Cap on the toast body — action responses are summaries, not documents. */
const MAX_RESULT_LENGTH = 500;

/** Prefer a JSON `{"message": "..."}` body; otherwise show the raw text. */
function resultText(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object") {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string" && message.trim() !== "") return message;
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return body;
}

export function SchemaActionButton({
  action,
  disabled = false,
}: {
  action: ActionButton;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      const body = await request<string>(action.endpoint, {
        method: action.method,
        rawText: true,
        // resultText() prefers a JSON {"message": ...} envelope, so ask for JSON
        // first rather than the XML-preferring rawText default..
        headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
      });
      const text = resultText(body ?? "").slice(0, MAX_RESULT_LENGTH);
      toast.success(action.label, { description: text || "Done." });
    } catch (err) {
      toast.error(`${action.label} failed`, {
        description: err instanceof Error ? err.message : "Request failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => (action.confirm ? setConfirming(true) : void run())}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {action.label}
      </Button>
      {confirming && (
        <ConfirmDialog
          title={action.label}
          description={action.confirm}
          confirmLabel={action.label}
          confirmVariant="default"
          onConfirm={() => void run()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
