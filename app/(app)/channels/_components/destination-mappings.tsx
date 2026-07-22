"use client";

/**
 * DestinationMappings — right-side panel in the Destination tab.
 *
 * Each item carries TWO expressions derived from BridgeLink's
 * VariableListHandler.java:
 *
 *   templateInsert  — Velocity expression inserted into text fields / SQL editors
 *                     (MIME type "text/plain")
 *   jsInsert        — JavaScript / Rhino expression inserted into Monaco JS editors
 *                     (MIME type "text/x-mirth-js")
 *
 * Monaco editors register a custom DOM-level drop handler (registerMirthDropHandler)
 * that prefers "text/x-mirth-js" and inserts via editor.executeEdits() to bypass
 * Monaco's snippet processing (which would escape $ and { and append $0).
 *
 * Regular text inputs and textareas receive the "text/plain" (Velocity) expression
 * via the browser's native drag-and-drop text insertion.
 *
 * The copy button (appears on hover) always copies the template expression.
 */

import { useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import type { DestinationConnectorState } from "../_lib/channel-xml";
import { parseTransformerFromXml } from "../_lib/filter-transformer-xml";
import { extractVariablesFromElements } from "../_lib/variable-extraction";
import {
  formatVelocityVarRef,
  formatJsVarRef,
  formatVelocityResponseMapRef,
  formatJsResponseMapRef,
} from "@/lib/velocity-format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MappingItem {
  label: string;
  /** Velocity expression — "text/plain" MIME, used in text fields / SQL. */
  templateInsert: string;
  /** JavaScript/Rhino expression — "text/x-mirth-js" MIME, used in Monaco JS editors.
   *  Empty string means "fall back to templateInsert even in JS editors." */
  jsInsert: string;
}

// ─── Mapping tables (from VariableListHandler.java) ──────────────────────────

const MESSAGE_MAPPINGS: MappingItem[] = [
  {
    label: "Raw Data",
    templateInsert: "${message.rawData}",
    jsInsert: "connectorMessage.getRawData()",
  },
  {
    label: "Transformed Data",
    templateInsert: "${message.transformedData}",
    jsInsert: "connectorMessage.getTransformedData()",
  },
  {
    label: "Encoded Data",
    templateInsert: "${message.encodedData}",
    jsInsert: "connectorMessage.getEncodedData()",
  },
  {
    label: "Message Source",
    templateInsert: "${message_source}",
    jsInsert: "$('message_source')",
  },
  {
    label: "Message Type",
    templateInsert: "${message_type}",
    jsInsert: "$('message_type')",
  },
  {
    label: "Message Version",
    templateInsert: "${mirth_version}",
    jsInsert: "$('mirth_version')",
  },
  {
    label: "Message Hash",
    templateInsert: "${HASH}",
    jsInsert: "HashUtil.generate(connectorMessage.getEncodedData())",
  },
];

const CHANNEL_MAPPINGS: MappingItem[] = [
  {
    label: "Channel ID",
    templateInsert: "${message.channelId}",
    jsInsert: "channelId",
  },
  {
    label: "Channel Name",
    templateInsert: "${message.channelName}",
    jsInsert: "channelName",
  },
  {
    label: "Message ID",
    templateInsert: "${message.messageId}",
    jsInsert: "connectorMessage.getMessageId()",
  },
];

const GLOBAL_MAPPINGS: MappingItem[] = [
  {
    label: "Date",
    templateInsert: "${DATE}",
    jsInsert: "var date = DateUtil.getDate('pattern','date');",
  },
  {
    label: "Formatted Date",
    templateInsert: "${date.get('yyyy-M-d H.m.s')}",
    jsInsert: "var dateString = DateUtil.getCurrentDate('yyyy-M-d H.m.s');",
  },
  {
    label: "Timestamp",
    templateInsert: "${SYSTIME}",
    jsInsert: "var dateString = DateUtil.getCurrentDate('yyyyMMddHHmmss');",
  },
  {
    label: "Unique ID",
    templateInsert: "${UUID}",
    jsInsert: "var uuid = UUIDGenerator.getUUID();",
  },
  {
    label: "Original File Name",
    templateInsert: "${originalFilename}",
    jsInsert: "$('originalFilename')",
  },
  {
    label: "Count",
    templateInsert: "${COUNT}",
    jsInsert: "", // Velocity-only; JS editors fall back to template expression
  },
];

const UTILITY_MAPPINGS: MappingItem[] = [
  {
    label: "XML Entity Encoder",
    templateInsert: "${XmlUtil.encode()}",
    jsInsert: "var encodedMessage = XmlUtil.encode('message');",
  },
  {
    label: "XML Pretty Printer",
    templateInsert: "${XmlUtil.prettyPrint()}",
    jsInsert: "var prettyPrintedMessage = XmlUtil.prettyPrint('message');",
  },
  {
    label: "Escape JSON String",
    templateInsert: "${JsonUtil.escape()}",
    jsInsert: "var escapedJSONString = JsonUtil.escape('message');",
  },
  {
    label: "JSON Pretty Printer",
    templateInsert: "${JsonUtil.prettyPrint()}",
    jsInsert: "var prettyPrintedMessage = JsonUtil.prettyPrint('message');",
  },
  {
    label: "CDATA Tag",
    templateInsert: "<![CDATA[]]>",
    jsInsert: "", // Same in both contexts
  },
  {
    label: "DICOM Message Raw Data",
    templateInsert: "${DICOMMESSAGE}",
    jsInsert: "var rawData = DICOMUtil.getDICOMRawData(connectorMessage);",
  },
];

// ─── Single mapping row ───────────────────────────────────────────────────────

function MappingRow({ item }: { item: MappingItem }) {
  const [copied, setCopied] = useState(false);

  function handleDragStart(e: React.DragEvent) {
    // Always set the Velocity expression as text/plain (standard drop target)
    e.dataTransfer.setData("text/plain", item.templateInsert);
    // Also set the JS expression for Monaco editors that intercept this MIME type
    if (item.jsInsert) {
      e.dataTransfer.setData("text/x-mirth-js", item.jsInsert);
    }
    e.dataTransfer.effectAllowed = "copy";
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    // Copy the template expression — works in any field
    navigator.clipboard
      .writeText(item.templateInsert)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <li
      draggable
      onDragStart={handleDragStart}
      title={item.templateInsert}
      className="group flex items-center gap-1 px-2 py-[3px] rounded select-none
        cursor-grab active:cursor-grabbing transition-colors
        hover:bg-blue-50 dark:hover:bg-blue-900/20"
    >
      <span
        className="flex-1 text-xs truncate transition-colors
        text-gray-600 dark:text-gray-300
        group-hover:text-blue-700 dark:group-hover:text-blue-300"
      >
        {item.label}
      </span>
      <button
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy template expression"}
        className={`shrink-0 p-0.5 rounded transition-all
          opacity-0 group-hover:opacity-100
          ${
            copied
              ? "text-green-500 opacity-100"
              : "text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
          }`}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </li>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <li className="px-2 pt-2 pb-0.5">
      <span
        className="text-[9px] font-semibold uppercase tracking-wider
        text-gray-400 dark:text-gray-500"
      >
        {label}
      </span>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DestinationMappingsProps {
  destinations: DestinationConnectorState[];
  selectedIndex: number;
  /** Raw XML of the source connector's transformer — used to extract mapper variables. */
  sourceTransformerXml?: string | null;
}

export function DestinationMappings({
  destinations,
  selectedIndex,
  sourceTransformerXml,
}: DestinationMappingsProps) {
  // Compute chain numbers from waitForPrevious (same algorithm as destination-tab.tsx)
  const chainOf = useMemo(() => {
    const chains: number[] = [];
    let counter = 0;
    for (let i = 0; i < destinations.length; i++) {
      if (i === 0 || !destinations[i].waitForPrevious) counter++;
      chains.push(counter);
    }
    return chains;
  }, [destinations]);
  const selectedChain = chainOf[selectedIndex];

  // Extract mapper variables from source transformer and previous destinations in same chain
  const variableMappings: MappingItem[] = useMemo(() => {
    const vars = new Set<string>();

    // 1. Source connector transformer variables (always in scope for all destinations).
    //    Global scope only — mirrors Java ChannelSetup.getMultipleDestinationStepVariables,
    //    which collects source vars with includeLocalVars=false so connector-local
    //    (connectorMap / $co) keys don't leak across connectors.
    if (sourceTransformerXml) {
      try {
        const { elements } = parseTransformerFromXml(sourceTransformerXml);
        for (const v of extractVariablesFromElements(elements, false)) vars.add(v);
      } catch {
        // Ignore parse errors — source transformer may be empty/invalid
      }
    }

    // 2. Current and previous destinations' variables (same chain), mirroring Java:
    //    - current destination: regular transformer, local + global scope
    //    - prior destinations: regular transformer AND response transformer, global only
    //    The current destination's own response transformer is intentionally excluded —
    //    it runs after the message is sent, so its vars aren't in scope here.
    for (let i = 0; i < destinations.length; i++) {
      if (chainOf[i] !== selectedChain || i > selectedIndex) continue;
      const isCurrent = i === selectedIndex;

      if (destinations[i].transformerXml) {
        try {
          const { elements } = parseTransformerFromXml(destinations[i].transformerXml!);
          for (const v of extractVariablesFromElements(elements, isCurrent)) vars.add(v);
        } catch {
          // Ignore parse errors
        }
      }

      if (!isCurrent && destinations[i].responseTransformerXml) {
        try {
          const { elements } = parseTransformerFromXml(destinations[i].responseTransformerXml!);
          for (const v of extractVariablesFromElements(elements, false)) vars.add(v);
        } catch {
          // Ignore parse errors
        }
      }
    }

    return Array.from(vars).map((name) => ({
      label: name,
      templateInsert: formatVelocityVarRef(name),
      jsInsert: formatJsVarRef(name),
    }));
  }, [sourceTransformerXml, destinations, selectedIndex, chainOf, selectedChain]);

  // Response-map references for previous destinations in the same chain only
  const destMappings: MappingItem[] = destinations
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => chainOf[i] === selectedChain && i < selectedIndex)
    .map(({ d, i }) => {
      const name = d.name || `Destination ${i + 1}`;
      return {
        label: name,
        templateInsert: formatVelocityResponseMapRef(name),
        jsInsert: formatJsResponseMapRef(name),
      };
    });

  return (
    <div
      className="w-44 shrink-0 border-l border-border
      bg-gray-50/50 dark:bg-gray-800/30 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-2 py-1.5 shrink-0 border-b border-border">
        <p
          className="text-[10px] font-semibold uppercase tracking-wide
          text-gray-500 dark:text-gray-400"
        >
          Destination Mappings
        </p>
        <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">
          Drag into field · click to copy
        </p>
      </div>

      {/* Scrollable list */}
      <ul className="flex-1 overflow-y-auto py-1 px-0.5">
        <SectionLabel label="Message" />
        {MESSAGE_MAPPINGS.map((item) => (
          <MappingRow key={item.label} item={item} />
        ))}

        <SectionLabel label="Channel" />
        {CHANNEL_MAPPINGS.map((item) => (
          <MappingRow key={item.label} item={item} />
        ))}

        <SectionLabel label="Global" />
        {GLOBAL_MAPPINGS.map((item) => (
          <MappingRow key={item.label} item={item} />
        ))}

        <SectionLabel label="Utilities" />
        {UTILITY_MAPPINGS.map((item) => (
          <MappingRow key={item.label} item={item} />
        ))}

        {destMappings.length > 0 && (
          <>
            <SectionLabel label="Destinations" />
            {destMappings.map((item, i) => (
              <MappingRow key={i} item={item} />
            ))}
          </>
        )}

        {variableMappings.length > 0 && (
          <>
            <SectionLabel label="Variables" />
            {variableMappings.map((item) => (
              <MappingRow key={item.label} item={item} />
            ))}
          </>
        )}
      </ul>
    </div>
  );
}
