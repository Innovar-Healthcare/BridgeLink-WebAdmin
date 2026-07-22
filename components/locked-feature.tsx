"use client";

/**
 * Landing shown in place of a license-locked plugin settings tab —
 * the installed-but-unlicensed state. Rendered by the Settings page's plugin
 * tabs when a tab's `licensedPluginId` is not entitled.
 *
 * GA slice: a self-contained, manifest-driven teaser (icon + feature name +
 * blurb + upgrade CTA). It deliberately does NOT mount the real plugin
 * component, so no unlicensed API calls fire (no 401/403). A post-GA phase will
 * replace this with the real UI dimmed behind an inert overlay — see
 * PLAN-PluginLicenseGating-BusinessLogic.md "Phase 2 (post-GA)".
 */

import { useState } from "react";
import { Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PluginUpgradeDialog } from "@/components/plugin-upgrade-dialog";
import { usePluginLicenseStatus } from "@/lib/plugin-license";

interface LockedFeatureProps {
  /** License Manager `pluginId` of the locked surface (drives the status copy). */
  licensedPluginId: string;
  /** Display name of the locked feature (surface label). */
  featureName: string;
  /** Optional feature icon (e.g. the sidebar nav icon); defaults to a lock. */
  icon?: LucideIcon;
}

export function LockedFeature({ licensedPluginId, featureName, icon }: LockedFeatureProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const status = usePluginLicenseStatus(licensedPluginId);
  const Icon = icon ?? Lock;
  const expired = status === "Expired";

  const blurb = expired
    ? `Your license for ${featureName} has expired. Renew it to restore access.`
    : `${featureName} is a licensed add-on. Upgrade your plan to enable it.`;

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-8 w-8" />
          <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-background text-muted-foreground ring-2 ring-background">
            <Lock className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{featureName}</h2>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {expired ? "License expired" : "Licensed feature"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{blurb}</p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          {expired ? "Renew license" : "Unlock this feature"}
        </Button>
      </div>
      <PluginUpgradeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        featureName={featureName}
        status={status}
      />
    </div>
  );
}
