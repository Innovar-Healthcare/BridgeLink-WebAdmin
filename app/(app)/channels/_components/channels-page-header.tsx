"use client";
import React from "react";
import { format } from "date-fns";
import { PageHeader } from "@/components/page-header";

interface ChannelsPageHeaderProps {
  refreshedAt: Date | null;
  mounted: boolean;
}

export function ChannelsPageHeader({ refreshedAt, mounted }: ChannelsPageHeaderProps) {
  return (
    <PageHeader
      title="Channels"
      actions={
        refreshedAt && mounted ? (
          <span
            className="text-xs text-gray-400 dark:text-gray-500 tabular-nums"
            suppressHydrationWarning
          >
            {format(refreshedAt, "h:mm:ss a")}
          </span>
        ) : undefined
      }
    />
  );
}
