"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChannelEditorCore } from "../../_components/channel-editor-core";
import { useCodeTemplatesPrefetch } from "@/lib/hooks/use-cache";

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
  const sub = searchParams.get("sub") as
    | "filter"
    | "transformer"
    | "responseTransformer"
    | undefined;
  const script = searchParams.get("script") ?? undefined;

  return (
    <ChannelEditorCore
      mode="edit"
      channelId={id}
      initialTab={tab ?? undefined}
      initialDestIndex={destIndex}
      initialSub={sub ?? undefined}
      initialScript={script}
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
