"use client";

/**
 * Right-pane preview for one declared data type.
 *
 * Renders the real production `RuntimeDataTypeSectionImpl` directly (the stable
 * render body behind the loader factory): the data-type grammar has NO action
 * buttons, so there is no props-widening concern (unlike connector panels /
 * sections), and rendering the Impl is zero-drift. We render the Impl, not the
 * factory result, because calling the factory during render would mint a new
 * component type each render (react-hooks/static-components).
 *
 * Which property groups render is HOST-derived from (side × transformerType)
 * — the Java DataTypePropertiesTableModel gating the real component implements —
 * so this preview exposes both as pickers. `propsXml` starts null per side and
 * self-seeds from the compiled engine defaults (exactly like the real host);
 * Restore Defaults sends the active side back to null. The Defaults XML the
 * author supplies (editable on the left pane) feeds `compileDataType`, so the
 * two stay in lockstep.
 */

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RuntimeDataTypeSectionImpl } from "@/components/schema-form/runtime-data-type-section";
import { compileDataType } from "@/lib/runtime-plugins/compile-data-type";
import type { DataTypeContribution } from "@/lib/runtime-plugins/manifest-types";
import { LiveXmlDisclosure } from "./live-xml-disclosure";

type Side = "inbound" | "outbound";
type TransformerType = "source" | "destination" | "response";

export function DataTypePreview({
  dataType,
  attribution,
  defaultsXml,
  isDark,
}: {
  dataType: DataTypeContribution;
  attribution: string;
  defaultsXml: string;
  isDark?: boolean;
}) {
  const compiled = useMemo(() => compileDataType(dataType, defaultsXml), [dataType, defaultsXml]);

  const [side, setSide] = useState<Side>("inbound");
  const [transformerType, setTransformerType] = useState<TransformerType>("source");
  // null per side ⇒ the section self-seeds from the compiled engine defaults.
  const [propsXml, setPropsXml] = useState<Record<Side, string | null>>({
    inbound: null,
    outbound: null,
  });

  // A change to the author-supplied Defaults XML recompiles defaults, so the
  // per-side working copies reset to re-seed. Render-phase reset (React's
  // "adjust state when a prop changes" idiom) rather than an effect, so the
  // edit is reflected in the same commit.
  const [prevDefaultsXml, setPrevDefaultsXml] = useState(defaultsXml);
  if (defaultsXml !== prevDefaultsXml) {
    setPrevDefaultsXml(defaultsXml);
    setPropsXml({ inbound: null, outbound: null });
  }

  // The XML echoed below is the active side's effective document — the stored
  // working copy, or (while null) the compiled engine defaults the section
  // self-seeds from. Lets the author watch the group-nested writes round-trip.
  const activeSideXml =
    propsXml[side] ??
    compiled.defaultPropertiesXml(
      side === "inbound" ? "inboundProperties" : "outboundProperties",
      ""
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Side</Label>
          <Select value={side} onValueChange={(v) => setSide(v as Side)}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Transformer context</Label>
          <Select
            value={transformerType}
            onValueChange={(v) => setTransformerType(v as TransformerType)}
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="source">Source</SelectItem>
              <SelectItem value="destination">Destination</SelectItem>
              <SelectItem value="response">Response</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPropsXml((prev) => ({ ...prev, [side]: null }))}
        >
          <RotateCcw className="size-3.5" /> Restore defaults
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Property groups shown are derived from the side and transformer context, mirroring the real
        Set Data Types dialog.
      </p>
      <div className="flex h-[28rem] min-h-0 flex-col rounded-md border border-border">
        <RuntimeDataTypeSectionImpl
          dataType={dataType}
          entry={{ name: attribution }}
          compiled={compiled}
          propsXml={propsXml[side]}
          side={side}
          transformerType={transformerType}
          onChange={(newXml) => setPropsXml((prev) => ({ ...prev, [side]: newXml }))}
          isDark={isDark}
        />
      </div>
      <LiveXmlDisclosure
        xml={activeSideXml}
        path={`webadmin-preview-datatype-${dataType.name}-${side}.xml`}
        label={`Live ${side} properties XML — updates as you edit the form`}
      />
    </div>
  );
}
