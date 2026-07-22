"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Check, CheckCircle2, AlertTriangle, XCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoDialog } from "@/components/info-dialog";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { getSession } from "@/lib/auth";
import {
  getServerBuildDate,
  getServerId,
  getServerJvm,
  getSystemInfo,
} from "@/lib/api/api-settings";
import {
  LICENSE_NAME,
  LICENSE_TEXT,
  SUPPLEMENTAL_TERMS_NAME,
  SUPPLEMENTAL_TERMS_TEXT,
} from "@/lib/license";
import { evaluateServerCompatibility } from "@/lib/version-compat";
import { Loader2 } from "lucide-react";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AboutInfo {
  version: string;
  buildDate: string;
  serverId: string;
  jvm: string;
}

const FIELD_LABEL = "text-xs font-medium text-muted-foreground uppercase tracking-wide";
const FIELD_VALUE = "text-sm font-mono select-all break-all";

const PRIVACY_POLICY_URL = "https://www.innovarhealthcare.com/privacy";

const ACKNOWLEDGEMENTS = [
  "This product includes software developed by the Apache Software Foundation (http://www.apache.org/).",
  "This product includes all or a portion of the HL7 Vocabulary database, or is derived from the HL7 Vocabulary database, subject to a license from Health Level Seven, Inc.",
  "This product includes a portion of images from http://www.famfamfam.com/lab/icons/silk/.",
  "This product includes a portion of images from https://www.fatcow.com/free-icons.",
  "This product includes software developed by the Indiana University Extreme! Lab (http://www.extreme.indiana.edu/).",
  "This product includes the Flying Saucer XHTML renderer library, licensed under the LGPL version 2.1 (http://www.gnu.org/licenses/lgpl-2.1.html).",
  "This product includes the jTDS JDBC driver, licensed under the LGPL version 2.1 (http://www.gnu.org/licenses/lgpl-2.1.html).",
  "This product includes software developed by the JDOM Project (http://www.jdom.org/).",
  "This product includes software developed by the SAXPath Project (http://www.saxpath.org/).",
  'This product includes the JCIFS SMB client library in Java version 1.3.17, copyright (C) 2002 "Michael B. Allen" <jcifs at samba dot org> and "Eric Glass" <jcifs at samba dot org>, licensed under the LGPL version 2.1 (http://www.gnu.org/licenses/lgpl-2.1.html).',
  "This product includes the Pdf-renderer library (https://java.net/projects/pdf-renderer/), portions copyright Sun Microsystems, Inc., Pirion Systems Pty Ltd, intarsys consulting GmbH and Adobe Systems Incorporated. It is licensed under the LGPL version 2.1 (http://www.gnu.org/licenses/lgpl-2.1.html).",
  "This product includes software developed by xerial.org (Taro L. Saito) (https://github.com/xerial/sqlite-jdbc).",
  "This product includes the SwingLabs SwingX library, copyright (c) 2005-2006 Sun Microsystems, Inc., licensed under the LGPL version 2.1 (http://www.gnu.org/licenses/lgpl-2.1.html).",
  "This product includes libraries from OpenJFX, which is licensed under the GNU General Public License version 2, with the Classpath Exception (http://openjdk.java.net/legal/gplv2+ce.html). The source code for OpenJFX is available at: http://jdk.java.net/openjfx/",
];

function fetchField(fn: () => Promise<string>): Promise<string> {
  return fn().catch(() => "N/A");
}

/**
 * Version-compatibility verdict for the connected Core server vs. this Web Admin
 * build. Green = compatible, amber = untested (Core newer), red =
 * incompatible (Core too old).
 */
function CompatibilityIndicator({ serverVersion }: { serverVersion: string }) {
  const compat = evaluateServerCompatibility(serverVersion);
  if (compat.level === "block") {
    return (
      <div className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
        <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Incompatible — server is older than this Web Admin build supports</span>
      </div>
    );
  }
  if (compat.level === "warn-newer") {
    return (
      <div className="flex items-start gap-1.5 text-sm text-orange-600 dark:text-orange-400">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Untested — server is newer than this Web Admin build</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
      <CheckCircle2 className="w-4 h-4 shrink-0" />
      <span>Compatible</span>
    </div>
  );
}

function CopyIdButton({ value }: { value: string }) {
  const [didCopy, setDidCopy] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy Server ID"
      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setDidCopy(true);
          setTimeout(() => setDidCopy(false), 2000);
        });
      }}
    >
      {didCopy ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setInfo(null);
    setCopied(false);

    const session = getSession();

    const jvmPromise = getSystemInfo()
      .then((info) => info.jvmVersion)
      .catch(() => fetchField(getServerJvm));

    Promise.all([fetchField(getServerBuildDate), fetchField(getServerId), jvmPromise])
      .then(([buildDate, serverId, jvm]) => {
        if (cancelled) return;
        setInfo({
          version: session?.serverVersion ?? "N/A",
          buildDate,
          serverId,
          jvm,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load server info");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleCopy = useCallback(() => {
    if (!info) return;
    const webBuild = `v${process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"} (${process.env.NEXT_PUBLIC_GIT_SHA ?? "dev"})`;
    const text = [
      `BridgeLink Server ${info.version}`,
      `Built on ${info.buildDate}`,
      `Server ID: ${info.serverId}`,
      `JVM: ${info.jvm}`,
      `Web Admin Build: ${webBuild}`,
      "",
      `License: ${LICENSE_NAME}`,
      LICENSE_TEXT,
      "",
      `${SUPPLEMENTAL_TERMS_NAME}:`,
      SUPPLEMENTAL_TERMS_TEXT,
      "",
      `Privacy Policy: ${PRIVACY_POLICY_URL}`,
      "",
      "Acknowledgements:",
      ...ACKNOWLEDGEMENTS,
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [info]);

  return (
    <InfoDialog
      open={open}
      onOpenChange={onOpenChange}
      title="About BridgeLink"
      maxWidth="sm:max-w-2xl"
      footerLeft={
        info && (
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <Check className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <Copy className="w-3.5 h-3.5 mr-1.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        )
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      <ApiErrorAlert error={error} className="" />

      {info && (
        <div className="space-y-4">
          <div>
            <div className={FIELD_LABEL}>Server Version</div>
            <div className={FIELD_VALUE}>{info.version}</div>
          </div>
          <div>
            <div className={FIELD_LABEL}>Built On</div>
            <div className={FIELD_VALUE}>{info.buildDate}</div>
          </div>
          <div>
            <div className={FIELD_LABEL}>Server ID</div>
            <div className="flex items-center gap-1.5">
              <div className={FIELD_VALUE}>{info.serverId}</div>
              <CopyIdButton value={info.serverId} />
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>JVM</div>
            <div className={FIELD_VALUE}>{info.jvm}</div>
          </div>
          <div>
            <div className={FIELD_LABEL}>Web Admin Build</div>
            <div className={FIELD_VALUE}>
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"} (
              {process.env.NEXT_PUBLIC_GIT_SHA ?? "dev"})
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>Compatibility</div>
            <CompatibilityIndicator serverVersion={info.version} />
          </div>
          <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
            <p>BridgeLink is licensed under the {LICENSE_NAME}.</p>
            <p>Copyright Innovar Healthcare. All rights reserved.</p>
            <p>
              <a
                href={PRIVACY_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                Privacy Policy
                <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
          <div className="pt-2">
            <div className={FIELD_LABEL}>License</div>
            <pre className="mt-1 max-h-48 overflow-y-auto rounded border bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words font-sans leading-relaxed">
              {LICENSE_TEXT}
            </pre>
          </div>
          <div className="pt-2">
            <div className={FIELD_LABEL}>{SUPPLEMENTAL_TERMS_NAME}</div>
            <pre className="mt-1 max-h-48 overflow-y-auto rounded border bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words font-sans leading-relaxed">
              {SUPPLEMENTAL_TERMS_TEXT}
            </pre>
          </div>
          <div className="pt-2">
            <div className={FIELD_LABEL}>Acknowledgements</div>
            <div className="mt-1 max-h-48 overflow-y-auto rounded border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
              <p>
                The following is a list of acknowledgements for third-party software that is
                included with BridgeLink:
              </p>
              {ACKNOWLEDGEMENTS.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </InfoDialog>
  );
}
