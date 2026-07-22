"use client";

import type { ExtensionRow } from "../_lib/extension-types";
import { InfoDialog } from "@/components/info-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

// ─── Info Modal ───────────────────────────────────────────────────────────────

export function InfoModal({ ext, onClose }: { ext: ExtensionRow; onClose: () => void }) {
  return (
    <InfoDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Extension Information"
      maxWidth="sm:max-w-[480px]"
    >
      <div className="space-y-3 text-sm">
        <InfoRow label="Name" value={ext.name} />
        <InfoRow
          label="Type"
          value={
            ext.kind === "connector"
              ? `Connector (${
                  ext.connectorType === "SOURCE"
                    ? "Source"
                    : ext.connectorType === "DESTINATION"
                      ? "Destination"
                      : (ext.connectorType ?? "")
                })`
              : "Plugin"
          }
        />
        <InfoRow label="Priority" value="Installed" />
        <InfoRow label="Author" value={ext.author} />
        <InfoRow label="Version" value={ext.version} />
        <div className="flex gap-3">
          <span className="w-28 shrink-0 text-right text-gray-500 dark:text-gray-400">URL:</span>
          {ext.url ? (
            <a
              href={ext.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline break-all"
            >
              {ext.url}
            </a>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">—</span>
          )}
        </div>
        {ext.description && (
          <div className="flex gap-3">
            <span className="w-28 shrink-0 text-right text-gray-500 dark:text-gray-400">
              Description:
            </span>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{ext.description}</p>
          </div>
        )}
      </div>
    </InfoDialog>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-right text-gray-500 dark:text-gray-400">{label}:</span>
      <span className="text-gray-800 dark:text-gray-200">{value || "—"}</span>
    </div>
  );
}

// ─── Uninstall Confirm Modal ──────────────────────────────────────────────────

export function UninstallConfirmModal({
  ext,
  onConfirm,
  onCancel,
}: {
  ext: ExtensionRow;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      title="Uninstall Extension"
      description={
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            Uninstalling this extension will remove all plugins and/or connectors in the following
            extension folder:
          </p>
          <p className="font-mono text-xs bg-gray-100 dark:bg-gray-700 rounded px-2 py-1.5 break-all">
            {ext.path || ext.name}
          </p>
          <p className="text-yellow-700 dark:text-yellow-400">
            The server must be restarted for the change to take effect.
          </p>
        </div>
      }
      confirmLabel="Uninstall"
      confirmVariant="destructive"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
