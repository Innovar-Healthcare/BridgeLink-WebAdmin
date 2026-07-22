"use client";

/**
 * Upgrade prompt for a license-locked plugin surface.
 *
 * Shown when a user interacts with an installed-but-unlicensed plugin's UI
 * (nav page or settings tab). Explains that the feature is a licensed add-on
 * and offers two calls to action — a link to the upgrade page and a mailto to
 * sales — plus a dismiss. The copy adapts to the raw license status so an
 * *expired* license reads as "renew" rather than "not purchased".
 *
 * Presentational + controlled: the parent (LockedFeature) owns `open` state.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, ExternalLink } from "lucide-react";
import type { PluginLicenseStatusValue } from "@/lib/plugin-license";

/** Marketing/upgrade destination. */
const UPGRADE_URL = "https://www.innovarhealthcare.com/upgrade";
/** Sales contact for licensing questions. */
const SALES_EMAIL = "sales@innovarhealthcare.com";

interface PluginUpgradeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Display name of the locked feature/plugin (surface label). */
  featureName: string;
  /**
   * Raw license status. "Expired" tailors the copy to renewal; anything else
   * (incl. "Unlicensed" or undefined) reads as not-yet-purchased.
   */
  status?: PluginLicenseStatusValue;
}

export function PluginUpgradeDialog({
  open,
  onClose,
  featureName,
  status,
}: PluginUpgradeDialogProps) {
  const expired = status === "Expired";
  const title = expired ? `Renew ${featureName}` : `Unlock ${featureName}`;
  const lead = expired
    ? `Your license for ${featureName} has expired. Renew it to restore access to this feature.`
    : `${featureName} is a licensed add-on that isn't included in your current plan.`;

  const subject = encodeURIComponent(
    expired ? `Renew license: ${featureName}` : `License inquiry: ${featureName}`
  );
  const mailtoHref = `mailto:${SALES_EMAIL}?subject=${subject}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{lead}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={mailtoHref}>
              <Mail />
              Contact sales
            </a>
          </Button>
          <Button size="sm" asChild>
            <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              {expired ? "Renew license" : "View upgrade options"}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
