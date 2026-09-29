"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChannelEditorCore } from "../../_components/channel-editor-core";
import { useCodeTemplatesPrefetch } from "@/lib/hooks/use-cache";
import { parseIndexPath, parseLineParam } from "../../_lib/ft-deep-link";

function ChannelEditPageInner() {
  useCodeTemplatesPrefetch();
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") as
    | "summary"
    | "source"
    | "destination"
    | "scripts"
    | undefined;
  const dest = searchParams.get("dest");
  const destIndex = dest != null ? parseInt(dest, 10) : undefined;
  // `sub` is validated rather than cast, because the segmenter also emits
  // `sub=properties` for a connector-properties hit. That value has no
  // filter/transformer overlay to open — the connector tab IS the properties
  // view — so it is dropped here deliberately, instead of being asserted into a
  // union it does not belong to and quietly rejected two layers down.
  const subRaw = searchParams.get("sub");
  const sub =
    subRaw === "filter" || subRaw === "transformer" || subRaw === "responseTransformer"
      ? subRaw
      : undefined;
  const script = searchParams.get("script") ?? undefined;
  // Config Search deep link to one filter rule / transformer step.
  // Both parse to undefined on anything malformed: a bad link must degrade to
  // "no preselection", never to the wrong step.
  const ftPath = parseIndexPath(searchParams.get("path")) ?? undefined;
  const ftLine = parseLineParam(searchParams.get("line"));

  return (
    <ChannelEditorCore
      mode="edit"
      channelId={id}
      initialTab={tab ?? undefined}
      initialDestIndex={destIndex}
      initialSub={sub}
      initialScript={script}
      initialFtPath={ftPath}
      initialFtLine={ftLine}
    />
  );
}

export default function ChannelEditPage() {
  return (
    <Suspense>
      <ChannelEditPageInner />
    </Suspense>
  );
}
