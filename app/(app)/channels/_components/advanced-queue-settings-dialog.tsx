"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { DestinationQueueSettings } from "../_lib/channel-xml";
import { RadioGroup } from "../_connectors/shared/radio-group";
import { CommittedNumberInput } from "../_connectors/shared/committed-number-input";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

// NOTE #57): Java's DestinationSettingsPanel exposes a ConnectorPropertiesPlugin extension
// point in this dialog for queue-related plugin UI. The WebUI has no such extension point yet; no
// shipping plugin uses it. Existing <pluginProperties> in <destinationConnectorProperties> still
// round-trip intact — the queue writer (writeDestQueueSettings in channel-xml.ts) is non-destructive
// and only rewrites the known scalar fields, leaving unknown children (incl. pluginProperties) alone.

// ─── Types ─────────────────────────────────────────────────────────────────────

export type QueueMode = "never" | "onFailure" | "always";

// Per-field help text. Ported verbatim from Java DestinationSettingsPanel's
// Advanced Queue Settings dialog (HTML/<br/> flattened to plain strings).
const TIP = {
  retryCount:
    "The maximum number of times the connector will attempt to send the message before queueing or erroring.",
  retryInterval:
    "The amount of time that should elapse between retry attempts to send messages. This interval applies to both the queue and initial retry attempts.",
  regenerateTemplate:
    "Regenerate the template and other connector properties by replacing variables each time the connector attempts to send the message from the queue. If this is disabled, the original variable replacements will be used for each attempt.",
  includeFilterTransformer:
    "If enabled, the filter and transformer will be re-executed before every queue send attempt. This is only available when the Regenerate Template setting is enabled.",
  rotate:
    "If enabled, when any message fails to be sent from the queue, the connector will place the message at the end of the queue and attempt to send the next message. This will prevent a single message from holding up the entire queue. If the order of messages processed is important, this should be disabled.",
  threadCount:
    "The number of threads that will read from the queue and dispatch messages simultaneously. Message order is NOT guaranteed if this value is greater than one, unless an assignment variable is used below.",
  threadAssignmentVariable:
    "When using multiple queue threads, this map variable determines how to assign messages to specific threads. If rotation is disabled, messages with the same thread assignment value will always be processed in order.",
  queueBufferSize:
    "The buffer size for the destination queue. Up to this many connector messages may be held in memory at once when queuing.",
} as const;

interface AdvancedQueueSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: DestinationQueueSettings;
  queueMode: QueueMode;
  /** Called with only the advanced fields when the user clicks Save. */
  onSave: (updated: Partial<DestinationQueueSettings>) => void;
}

// ─── Advanced-queue summary line ────────────────────────────────────────────────

/**
 * Builds the " / "-joined summary shown next to the "Advanced..." button on the
 * Destination tab. Mirrors Java `DestinationSettingsPanel.updateAdvancedSettingsLabel()`:
 * the segment list is queue-mode-conditional, and retries are only listed when the
 * queue is off or in "On Failure" mode (sendFirst). Interval uses the raw millis value
 * (no thousands separators) to match the Java label exactly.
 */
export function formatAdvancedQueueSummary(q: DestinationQueueSettings): string {
  const list: string[] = [];
  const retries = `${q.retryCount} Retr${q.retryCount === 1 ? "y" : "ies"}`;
  const interval = `Interval ${q.retryIntervalMillis} ms`;

  if (!q.queueEnabled) {
    list.push(retries);
    if (q.retryCount > 0) list.push(interval);
  } else {
    if (q.regenerateTemplate) list.push("Regenerate");
    if (q.rotate) list.push("Rotate");
    if (q.includeFilterTransformer) list.push("Including Transformer");
    if (q.sendFirst) list.push(retries);
    list.push(interval);
    if (q.threadCount > 1) {
      list.push(`${q.threadCount} Threads`);
      if (q.threadAssignmentVariable.trim() !== "") {
        list.push(`Group By ${q.threadAssignmentVariable}`);
      }
    }
  }

  return list.join(" / ");
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-h-[32px]">
      <span className="text-sm text-gray-600 dark:text-gray-400 text-right w-[220px] shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-2 flex-1">{children}</div>
    </div>
  );
}

// ─── AdvancedQueueSettingsDialog ──────────────────────────────────────────────

export function AdvancedQueueSettingsDialog({
  open,
  onOpenChange,
  settings,
  queueMode,
  onSave,
}: AdvancedQueueSettingsDialogProps) {
  const { viewDensity } = useCompactMode();
  const inputCls = `${densityHeight(viewDensity)} px-3 text-sm rounded border border-border
  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
  focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30
  disabled:opacity-40 disabled:cursor-not-allowed`;
  // Local working copy — reset whenever the dialog opens
  const [local, setLocal] = useState<DestinationQueueSettings>(settings);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setLocal(settings);
  }, [open, settings]);

  function set<K extends keyof DestinationQueueSettings>(key: K, val: DestinationQueueSettings[K]) {
    setLocal((prev) => ({ ...prev, [key]: val }));
  }

  function handleSave() {
    onSave({
      retryCount: local.retryCount,
      retryIntervalMillis: local.retryIntervalMillis,
      regenerateTemplate: local.regenerateTemplate,
      includeFilterTransformer: local.includeFilterTransformer,
      rotate: local.rotate,
      threadCount: local.threadCount,
      threadAssignmentVariable: local.threadAssignmentVariable,
      queueBufferSize: local.queueBufferSize,
    });
    onOpenChange(false);
  }

  // Derived enable states
  const queueEnabled = queueMode !== "never";
  // Retry Count: enabled unless queuing is "Always" (queue on + !sendFirst).
  // Mirrors Java retryCountField.setEnabled(!queueEnabled || sendFirst).
  const retryCountEnabled = queueMode !== "always";
  // Retry interval: always enabled if queue is on; if queue is off, only enabled when retryCount > 0
  const intervalEnabled = queueEnabled || local.retryCount > 0;
  const includeFilterEnabled = queueEnabled && local.regenerateTemplate;
  const threadVarEnabled = queueEnabled && local.threadCount > 1;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Advanced Queue Settings"
      description="Configure retry behavior, queue threads, and buffer size for this destination."
      onSubmit={handleSave}
      submitLabel="OK"
      maxWidth="max-w-lg"
    >
      <div className="space-y-2">
        {/* Retry Count — disabled when queuing is "Always" (matches Java) */}
        <Row label="Retry Count:">
          <HoverTooltip content={TIP.retryCount}>
            <CommittedNumberInput
              min={0}
              value={local.retryCount}
              onCommit={(n) => set("retryCount", n)}
              disabled={!retryCountEnabled}
              className={`${inputCls} w-24`}
            />
          </HoverTooltip>
        </Row>

        {/* Retry Interval */}
        <Row label="Retry Interval (ms):">
          <HoverTooltip content={TIP.retryInterval}>
            <CommittedNumberInput
              min={1}
              value={local.retryIntervalMillis}
              onCommit={(n) => set("retryIntervalMillis", n)}
              disabled={!intervalEnabled}
              className={`${inputCls} w-32`}
            />
          </HoverTooltip>
        </Row>

        {/* Regenerate Template */}
        <Row label="Regenerate Template:">
          <RadioGroup
            name="adv-regenerate"
            value={local.regenerateTemplate ? "yes" : "no"}
            onChange={(v) => set("regenerateTemplate", v === "yes")}
            disabled={!queueEnabled}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title={TIP.regenerateTemplate}
          />
        </Row>

        {/* Include Filter/Transformer */}
        <Row label="Include Filter/Transformer:">
          <RadioGroup
            name="adv-include-ft"
            value={local.includeFilterTransformer ? "yes" : "no"}
            onChange={(v) => set("includeFilterTransformer", v === "yes")}
            disabled={!includeFilterEnabled}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title={TIP.includeFilterTransformer}
          />
        </Row>

        {/* Rotate Queue */}
        <Row label="Rotate Queue:">
          <RadioGroup
            name="adv-rotate"
            value={local.rotate ? "yes" : "no"}
            onChange={(v) => set("rotate", v === "yes")}
            disabled={!queueEnabled}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title={TIP.rotate}
          />
        </Row>

        {/* Queue Threads */}
        <Row label="Queue Threads:">
          <HoverTooltip content={TIP.threadCount}>
            <CommittedNumberInput
              min={1}
              value={local.threadCount}
              onCommit={(n) => set("threadCount", n)}
              disabled={!queueEnabled}
              className={`${inputCls} w-24`}
            />
          </HoverTooltip>
        </Row>

        {/* Thread Assignment Variable */}
        <Row label="Thread Assignment Variable:">
          <HoverTooltip content={TIP.threadAssignmentVariable}>
            <input
              type="text"
              value={local.threadAssignmentVariable}
              onChange={(e) => set("threadAssignmentVariable", e.target.value)}
              disabled={!threadVarEnabled}
              className={`${inputCls} w-56`}
              placeholder="e.g. ${message.patientId}"
            />
          </HoverTooltip>
        </Row>

        {/* Queue Buffer Size */}
        <Row label="Queue Buffer Size:">
          <HoverTooltip content={TIP.queueBufferSize}>
            <CommittedNumberInput
              min={1}
              value={local.queueBufferSize}
              onCommit={(n) => set("queueBufferSize", n)}
              disabled={!queueEnabled}
              className={`${inputCls} w-24`}
            />
          </HoverTooltip>
        </Row>
      </div>
    </FormDialog>
  );
}
