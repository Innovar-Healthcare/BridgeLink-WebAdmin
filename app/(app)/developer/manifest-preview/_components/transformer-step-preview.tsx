"use client";

/**
 * Right-pane preview for one declared transformer step.
 *
 * Renders the real production `RuntimeTransformerStepEditorImpl` directly (the
 * stable render body behind the loader factory): the transformer-step grammar
 * has NO action buttons, so there is no props-widening concern (unlike
 * connector panels / sections), and rendering the Impl is zero-drift. We render
 * the Impl, not the factory result, because calling the factory during render
 * would mint a new component type each render (react-hooks/static-components).
 *
 * User edits are kept as OVERRIDES layered over the step's live-derived
 * defaults (the SettingsPanelPreview pattern). `lastGood` gets a fresh object
 * identity on every debounce tick, so anchoring reset on identity would wipe
 * the author's edits on any unrelated manifest/envelope keystroke; merging
 * overrides over live defaults instead means a new field shows its default
 * while edited fields persist.
 *
 * The real host sets `showErrors` on a save attempt; here the Validate button
 * plays that role — it surfaces the step's validation message and flips on the
 * per-field invalid highlighting the panel does under `showErrors`.
 */

import { useMemo, useState } from "react";
import { RuntimeTransformerStepEditorImpl } from "@/components/schema-form/runtime-transformer-step-section";
import { compileTransformerStep } from "@/lib/runtime-plugins/compile-transformer-step";
import type { RuntimeTransformerStep } from "@/lib/runtime-plugins/compile-transformer-step";
import type { CollectionRows } from "@/lib/runtime-plugins/xml-collection-binding";
import type { TransformerStepContribution } from "@/lib/runtime-plugins/manifest-types";
import type { ContextType } from "@/lib/types";
import { ValidateBar, type ValidateError } from "./validate-bar";

/** Monaco completion context for a javascript field, from the step's first declared context. */
function contextTypeFor(contexts: ("source" | "destination")[]): ContextType | undefined {
  if (contexts.includes("source")) return "SOURCE_FILTER_TRANSFORMER";
  if (contexts.includes("destination")) return "DESTINATION_FILTER_TRANSFORMER";
  return undefined;
}

export function TransformerStepPreview({
  step,
  attribution,
  isDark,
}: {
  step: TransformerStepContribution;
  attribution: string;
  isDark?: boolean;
}) {
  const compiled = useMemo(() => compileTransformerStep(step), [step]);
  const contextType = useMemo(() => contextTypeFor(step.contexts), [step.contexts]);
  const defaults = useMemo(() => compiled.defaults(), [compiled]);

  const [valueOverrides, setValueOverrides] = useState<Record<string, string>>({});
  const [collectionOverrides, setCollectionOverrides] = useState<Record<string, CollectionRows>>(
    {}
  );
  const [showErrors, setShowErrors] = useState(false);
  const [errors, setErrors] = useState<ValidateError[] | null>(null);

  const stepState = useMemo<RuntimeTransformerStep>(
    () => ({
      ...defaults,
      values: { ...defaults.values, ...valueOverrides },
      collections: { ...defaults.collections, ...collectionOverrides },
    }),
    [defaults, valueOverrides, collectionOverrides]
  );

  function handleValidate() {
    const message = compiled.validate(stepState);
    setShowErrors(true);
    setErrors(message ? [{ field: "", message }] : []);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>Appears in:</span>
        {step.contexts.map((c) => (
          <span key={c} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
            {c}
          </span>
        ))}
      </div>
      <div className="rounded-md border border-border">
        <RuntimeTransformerStepEditorImpl
          contribution={step}
          entry={{ name: attribution }}
          step={stepState}
          onChange={(next) => {
            setValueOverrides(next.values);
            setCollectionOverrides(next.collections);
            setShowErrors(false);
            setErrors(null);
          }}
          isDark={isDark}
          showErrors={showErrors}
          contextType={contextType}
        />
      </div>
      <ValidateBar onValidate={handleValidate} errors={errors} />
    </div>
  );
}
