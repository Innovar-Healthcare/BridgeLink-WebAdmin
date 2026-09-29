"use client";

import { createContext, useContext } from "react";

/**
 * A one-shot "scroll to this line when you mount" request, handed from the
 * filter/transformer editor down to whichever step editor Monaco ends up in
 *.
 *
 * Context rather than a prop because `JavaScriptPanel` is reached two ways —
 * directly from `detail-pane-content.tsx` for a filter *rule*, and through
 * `TransformerStepDefinition.EditorPanel` for a transformer *step*. Threading a
 * prop would mean widening `TransformerStepEditorProps` and every step
 * definition that implements it, including plugin-contributed ones, to carry a
 * concern none of them have.
 *
 * `take()` is deliberately consuming: the reveal must happen once, on the
 * editor the deep link named, and never again when the user clicks back onto
 * that same step later.
 */
export interface PendingReveal {
  /** 1-based line, not yet clamped to the buffer — it may be older than the code. */
  line: number;
}

export interface PendingRevealHandle {
  /** Returns the pending reveal and clears it, or null if there is none. */
  take: () => PendingReveal | null;
}

const NO_REVEAL: PendingRevealHandle = { take: () => null };

export const PendingRevealContext = createContext<PendingRevealHandle>(NO_REVEAL);

/** Step editors call this; outside a filter/transformer editor it is a no-op. */
export function usePendingReveal(): PendingRevealHandle {
  return useContext(PendingRevealContext);
}
