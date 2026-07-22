"use client";
import React from "react";
import { format } from "date-fns";
import { PageHeader } from "@/components/page-header";

interface DashboardPageHeaderProps {
  lastRefresh: Date | null;
  mounted: boolean;
}

export function DashboardPageHeader({ lastRefresh, mounted }: DashboardPageHeaderProps) {
  return (
    <PageHeader
      title="Dashboard"
      actions={
        lastRefresh && mounted ? (
          <span
            className="text-xs text-gray-400 dark:text-gray-500 tabular-nums"
            suppressHydrationWarning
          >
            {format(lastRefresh, "h:mm:ss a")}
          </span>
        ) : undefined
      }
    />
  );
}
