"use client";

import { useEffect, useRef } from "react";
import { FileText } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import { Textarea } from "@/components/ui/textarea";
import { pluginSlots } from "@/lib/plugin-slots";
import { useSlotEnabled } from "@/lib/plugin-gating";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

interface ChannelDescriptionFieldProps {
  value: string;
  onChange: (description: string) => void;
  viewDensity: ViewDensity;
  /** Channel display name — passed to the AI action for prompt context. */
  channelName?: string;
  /** Live channel XML — the AI action's context source; the orb is hidden without it. */
  channelXml?: string | null;
}

/**
 * The "Channel Description" section of the Summary & Settings tab: an
 * auto-resizing free-text field plus, when a plugin fills the
 * `channel-summary.description.actions` slot, a floating AI orb that generates
 * or improves the description from the channel's own configuration.
 * Extracted from summary-tab.tsx to keep that file under the max-lines cap.
 */
export function ChannelDescriptionField({
  value,
  onChange,
  viewDensity,
  channelName,
  channelXml,
}: ChannelDescriptionFieldProps) {
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Plugin-filled AI action for the Channel Description field.
  // Member-expression read + separate boolean gate — required by the React
  // Compiler static-components rule (same idiom as message-template-editor.tsx).
  const DescriptionActions = pluginSlots["channel-summary.description.actions"];
  const descriptionActionsEnabled = useSlotEnabled("channel-summary.description.actions");

  function autoResizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  // Auto-resize when content changes externally (e.g. initial load).
  useEffect(() => {
    if (descRef.current) autoResizeTextarea(descRef.current);
  }, [value]);

  return (
    <SettingsSection
      title="Channel Description"
      icon={FileText}
      defaultExpanded={false}
      storageKey="bl-summary-description"
      onExpand={() => {
        requestAnimationFrame(() => {
          if (descRef.current) autoResizeTextarea(descRef.current);
        });
      }}
    >
      <div className="relative">
        <Textarea
          density={viewDensity}
          enableTabKey
          ref={descRef}
          rows={4}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            autoResizeTextarea(e.target);
          }}
          placeholder="Optional channel description…"
          className="w-full px-3 py-2 text-sm rounded border border-border
          bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
          placeholder:text-gray-400 dark:placeholder:text-gray-500
          focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30
          resize-y min-h-[6rem] max-h-[20rem]"
        />
        {DescriptionActions && descriptionActionsEnabled && channelXml && (
          <DescriptionActions
            value={value}
            setValue={onChange}
            channelName={channelName}
            channelXml={channelXml}
          />
        )}
      </div>
    </SettingsSection>
  );
}
