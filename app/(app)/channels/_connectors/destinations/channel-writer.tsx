"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, GitBranch } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  SettingsSection,
  FieldRow,
  FullWidthField,
  SummaryChip,
} from "@/components/settings/settings-section";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseChannelWriterPropsFromXml,
  updateChannelWriterPropsInXml,
  type ChannelWriterProps,
} from "../../_lib/channel-xml";
import { getChannelIdsAndNames } from "@/lib/api/api-channels";
import { inputCls, selectCls } from "../shared/styles";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["Channel Writer"]!;

/**
 * Name for a new map-variable row: the first unused `Variable N` (N from 1..len+1),
 * compared case-insensitively. Mirrors Java ChannelWriter.newButtonActionPerformed, so names
 * don't duplicate after intermediate rows are deleted.
 */
export function nextMapVariableName(existing: string[]): string {
  const taken = new Set(existing.map((v) => v.toLowerCase()));
  for (let n = 1; n <= existing.length + 1; n++) {
    const candidate = `Variable ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Unreachable: the range 1..len+1 always contains an unused index for a set of size len.
  return `Variable ${existing.length + 1}`;
}

// ─── Bottom section ───────────────────────────────────────────────────────────

function ChannelWriterBottomSection({ propertiesXml, onChange }: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const propsXml = propertiesXml ?? DEFAULT_XML;
  const [local, setLocal] = useState<ChannelWriterProps>(() =>
    parseChannelWriterPropsFromXml(propsXml)
  );

  // Channel ID/name map from server
  const [channelMap, setChannelMap] = useState<Map<string, string>>(new Map());
  const [channelMapLoaded, setChannelMapLoaded] = useState(false);

  // Re-parse when propertiesXml changes externally (e.g. connector type switch)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(parseChannelWriterPropsFromXml(propertiesXml ?? DEFAULT_XML));
  }, [propertiesXml]);

  // Load channel list on mount
  useEffect(() => {
    getChannelIdsAndNames()
      .then((map) => {
        setChannelMap(map);
        setChannelMapLoaded(true);
      })
      .catch(() => setChannelMapLoaded(true));
  }, []);

  function commit(updated: ChannelWriterProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateChannelWriterPropsInXml(propsXml, updated) });
  }

  function handleChannelIdText(value: string) {
    commit({ ...local, channelId: value });
  }

  function handleChannelIdDropdown(value: string) {
    // "none" or actual UUID
    commit({ ...local, channelId: value === "__none__" ? "none" : value });
  }

  function handleTemplate(value: string) {
    commit({ ...local, channelTemplate: value });
  }

  function addMapVariable() {
    commit({
      ...local,
      mapVariables: [...local.mapVariables, nextMapVariableName(local.mapVariables)],
    });
  }

  function removeMapVariable(i: number) {
    commit({ ...local, mapVariables: local.mapVariables.filter((_, idx) => idx !== i) });
  }

  function updateMapVariable(i: number, value: string) {
    commit({ ...local, mapVariables: local.mapVariables.map((v, idx) => (idx === i ? value : v)) });
  }

  // Build dropdown options
  const dropdownValue = (() => {
    const id = local.channelId;
    if (!id || id === "none") return "__none__";
    if (channelMap.has(id)) return id;
    if (id.includes("$")) return "__map_var__";
    return "__not_found__";
  })();

  const channelDisplayName = (() => {
    const id = local.channelId;
    if (!id || id === "none") return "None";
    return channelMap.get(id) ?? id;
  })();

  return (
    <SettingsSection
      title="Channel Writer Settings"
      icon={GitBranch}
      defaultExpanded={true}
      storageKey="bl-channel-writer-main"
      summary={<SummaryChip label="Channel" value={channelDisplayName} />}
    >
      {/* Channel ID */}
      <FieldRow label="Channel Id:">
        <HoverTooltip content="The destination channel's unique global id.">
          <input
            type="text"
            value={local.channelId === "none" ? "" : local.channelId}
            onChange={(e) => handleChannelIdText(e.target.value || "none")}
            placeholder="Channel UUID or map variable"
            className={`${inputCls(viewDensity)} w-80`}
          />
        </HoverTooltip>
        <HoverTooltip content="Select the channel to which messages accepted by this destination's filter should be written, or none to not write the message at all.">
          <select
            value={dropdownValue}
            onChange={(e) => handleChannelIdDropdown(e.target.value)}
            className={`${selectCls(viewDensity)} flex-1 min-w-0`}
          >
            <option value="__none__">&lt;None&gt;</option>
            {channelMapLoaded
              ? Array.from(channelMap.entries())
                  // Case-sensitive natural order (mirrors Java setProperties' Collections.sort);
                  // "<None>" is rendered as a separate first option, not part of this sort.
                  .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))
              : null}
            {dropdownValue === "__map_var__" && (
              <option value="__map_var__">&lt;Map Variable&gt;</option>
            )}
            {dropdownValue === "__not_found__" && (
              <option value="__not_found__">&lt;Channel Not Found&gt;</option>
            )}
          </select>
        </HoverTooltip>
      </FieldRow>

      {/* Template */}
      <FullWidthField label="Template:">
        <HoverTooltip content='A Velocity enabled template for the actual message to be written to the channel. In many cases, the default value of "${message.encodedData}" is sufficient.'>
          <Textarea
            density={viewDensity}
            enableTabKey
            value={local.channelTemplate}
            onChange={(e) => handleTemplate(e.target.value)}
            rows={5}
            className="w-full px-3 py-2 text-sm rounded border border-border
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono resize-y
              focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
          />
        </HoverTooltip>
      </FullWidthField>

      {/* Map Variables table */}
      <FieldRow label="Message Metadata:" className="!items-start pt-1">
        <div className="flex flex-col gap-1 flex-1">
          {local.mapVariables.length > 0 && (
            <div className="flex flex-col gap-1">
              {local.mapVariables.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <HoverTooltip content='Map variable name (without the "${}" syntax)'>
                    <input
                      type="text"
                      value={v}
                      onChange={(e) => updateMapVariable(i, e.target.value)}
                      className={`${inputCls(viewDensity)} flex-1`}
                      placeholder="variableName"
                    />
                  </HoverTooltip>
                  <HoverTooltip content="Remove variable">
                    <button
                      onClick={() => removeMapVariable(i)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400
                        hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </HoverTooltip>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={addMapVariable}
            className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded
              border border-dashed border-border
              text-gray-500 dark:text-gray-400
              hover:border-blue-400 dark:hover:border-blue-500
              hover:text-blue-600 dark:hover:text-blue-400
              hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
          {local.mapVariables.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              The following map variables will be included in the source map of the destination
              channel&apos;s message. When adding rows, only use the map key itself, without the
              &quot;${"{}"}&quot; syntax.
            </p>
          )}
        </div>
      </FieldRow>
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const ChannelWriterConnector: DestinationConnectorDefinition = {
  BottomSection: ChannelWriterBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
};
