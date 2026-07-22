"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChannelEditorCore } from "../_components/channel-editor-core";
import { useCodeTemplatesPrefetch } from "@/lib/hooks/use-cache";

function NewChannelPageInner() {
  useCodeTemplatesPrefetch();
  const searchParams = useSearchParams();
  const groupId = searchParams.get("groupId") ?? undefined;
  return <ChannelEditorCore mode="new" defaultGroupId={groupId} />;
}

export default function NewChannelPage() {
  return (
    <Suspense>
      <NewChannelPageInner />
    </Suspense>
  );
}
