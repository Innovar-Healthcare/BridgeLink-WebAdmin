"use client";

/**
 * Envelope inputs (name/path/version) for the Manifest Preview page — the
 * fields the real engine populates from the installed extension's metadata,
 * never from inside the manifest itself. They are deliberately NOT part of
 * webadmin.json (engine-authoritative identity); `path` in particular gates the
 * action-endpoint namespace check in the validator, so it must be user-editable
 * to preview that rule.
 *
 * Collapsed by default (a first-time author cares about the manifest, not the
 * simulated identity), with a one-line summary. The page auto-suggests `path`
 * from the first action endpoint until the author edits it by hand.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTooltip } from "@/components/info-tooltip";
import { MANIFEST_CAPS } from "@/lib/runtime-plugins/manifest-types";
import type { PreviewEnvelope } from "../_lib/preview-model";

const ENVELOPE_HELP =
  "The engine's extension identity — supplied from the installed extension's metadata, not from webadmin.json. The path is load-bearing: action-button endpoints must live under /extensions/{path}/…, and the validator rejects any endpoint outside that namespace.";

function FieldLabel({ htmlFor, label, help }: { htmlFor: string; label: string; help: string }) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      <InfoTooltip text={help} />
    </div>
  );
}

export function EnvelopeFields({
  envelope,
  onChange,
  open,
  onOpenChange,
  onPathUserEdit,
  pathSuggested = false,
}: {
  envelope: PreviewEnvelope;
  onChange: (envelope: PreviewEnvelope) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the user types in the path field, so the page stops auto-suggesting. */
  onPathUserEdit?: () => void;
  /** Show the "suggested from action endpoint" hint under the path field. */
  pathSuggested?: boolean;
}) {
  return (
    <div className="shrink-0 border-b border-border p-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span>Envelope (from extension.json — not part of webadmin.json)</span>
        <InfoTooltip text={ENVELOPE_HELP} />
        {!open && (
          <span className="ml-1 truncate font-mono font-normal">
            {envelope.name} · {envelope.path} · {envelope.version}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <FieldLabel
              htmlFor="preview-envelope-name"
              label="Extension name"
              help="Extension name as reported by the engine. Rendered as the “Provided by …” attribution on each panel."
            />
            <Input
              id="preview-envelope-name"
              value={envelope.name}
              maxLength={MANIFEST_CAPS.MAX_NAME_LENGTH}
              onChange={(e) => onChange({ ...envelope, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <FieldLabel
              htmlFor="preview-envelope-path"
              label="Extension path"
              help="The extension's install directory. Action-button endpoints must live under /extensions/{path}/… — the validator rejects any endpoint outside this namespace."
            />
            <Input
              id="preview-envelope-path"
              value={envelope.path}
              maxLength={MANIFEST_CAPS.MAX_NAME_LENGTH}
              onChange={(e) => {
                onChange({ ...envelope, path: e.target.value });
                onPathUserEdit?.();
              }}
            />
            {pathSuggested && (
              <p className="text-[11px] text-muted-foreground">
                Suggested from the first action endpoint.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <FieldLabel
              htmlFor="preview-envelope-version"
              label="Version"
              help="Extension version string (informational; shown in the Extensions status UI)."
            />
            <Input
              id="preview-envelope-version"
              value={envelope.version}
              maxLength={MANIFEST_CAPS.MAX_NAME_LENGTH}
              onChange={(e) => onChange({ ...envelope, version: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
