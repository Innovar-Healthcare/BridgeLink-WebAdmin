"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import type { DependencyTask } from "@/lib/dependency-graph";

/** A channel pulled into the action by the dependency chain. */
export interface DependencyWarningChannel {
  id: string;
  name: string;
}

/** The user's response to the prompt. `proceed: false` aborts the whole action. */
export interface DependencyWarningDecision {
  proceed: boolean;
  include: boolean;
}

/** Per-task wording — the passive form for the body, the imperative for the checkbox. */
const TASK_VERB: Record<DependencyTask, { passive: string; imperative: string }> = {
  start: { passive: "started", imperative: "Start" },
  resume: { passive: "resumed", imperative: "Resume" },
  stop: { passive: "stopped", imperative: "Stop" },
  pause: { passive: "paused", imperative: "Pause" },
  undeploy: { passive: "undeployed", imperative: "Undeploy" },
};

/**
 * Confirmation shown when a dashboard start/stop-style action would pull in
 * additional channels from the dependency chain. Mirrors the Java client's
 * ChannelDependenciesWarningDialog: the additional channels are listed, and an
 * "include" checkbox (unchecked by default, matching Java) controls whether they
 * are acted on alongside the original selection. Cancel aborts the action
 * entirely; OK proceeds — on the original selection only when the box is
 * unchecked, or the expanded set when it is checked.
 */
export function DependencyWarningDialog({
  task,
  additionalChannels,
  onResolve,
}: {
  task: DependencyTask;
  additionalChannels: DependencyWarningChannel[];
  onResolve: (decision: DependencyWarningDecision) => void;
}) {
  const { viewDensity } = useCompactMode();
  const [include, setInclude] = useState(false);
  const verb = TASK_VERB[task];
  const n = additionalChannels.length;
  const plural = n === 1 ? "" : "s";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onResolve({ proceed: false, include: false });
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Channel Dependencies</DialogTitle>
          <DialogDescription asChild>
            <div>
              There {n === 1 ? "is" : "are"} {n} additional channel{plural} in the dependency chain.
              They will only be {verb.passive} if you include them below.
            </div>
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-sm">
          {additionalChannels.map((ch) => (
            <li key={ch.id} className="truncate px-1 py-0.5" title={ch.name}>
              {ch.name}
            </li>
          ))}
        </ul>

        <FormCheckbox
          label={`${verb.imperative} ${n} additional channel${plural}`}
          checked={include}
          onChange={setInclude}
          density={viewDensity}
        />

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onResolve({ proceed: false, include: false })}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={() => onResolve({ proceed: true, include })}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
