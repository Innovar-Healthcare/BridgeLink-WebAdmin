"use client";

/**
 * Extensions page — mirrors Java's ExtensionManagerPanel.java
 *
 * Business logic:
 *  - Load all connectors via GET /extensions/connectors/ → Record<string, ConnectorMetaData>
 *  - Load all plugins  via GET /extensions/plugins/     → Record<string, PluginMetaData>
 *  - For each extension, fetch enabled status via GET /extensions/{name}/enabled in parallel
 *  - Display two tables: "Installed Connectors" and "Installed Plugins"
 *    Columns: Status (colored bullet + Enabled/Disabled), Name, Author, Version, Description
 *    Each table supports sortable columns, resizable columns, and reorderable columns (via ColumnPicker)
 *  - Selecting a row shows enable/disable button in the toolbar
 *  - Enable/Disable: POST /extensions/{name}/_setEnabled (body: raw JSON boolean)
 *    → after toggling, show "Restart Required" yellow banner (server needs restart for changes)
 *  - Double-clicking a row (or clicking "Info" button) opens an info modal:
 *    Name, Type (Connector/Plugin), Priority (always "Installed"), Author, Version, URL (link), Description
 *  - "Install Extension from File System" section at bottom:
 *    - File input (.zip only), Browse button, Install button
 *    - POST /extensions/_install (multipart file upload)
 *    - On success, show "restart required" banner
 *  - Refresh button reloads all extension data
 */

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { toast } from "sonner";
import {
  getConnectorMetaData,
  getPluginMetaData,
  isExtensionEnabled,
  setExtensionEnabled,
  installExtension,
  uninstallExtension,
} from "@/lib/api-client";
import {
  connectorMetaToRow,
  pluginMetaToRow,
  type ExtensionKind,
  type ExtensionRow,
} from "./_lib/extension-types";
import { ExtensionTable } from "./_components/extension-table";
import { InfoModal, UninstallConfirmModal } from "./_components/extension-modals";
import { ExtensionsActionPanel } from "./_components/extensions-action-panel";
import { WebContributions } from "./_components/web-contributions";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { usePermissions } from "@/lib/hooks/use-permissions";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExtensionsPage() {
  const { viewDensity } = useCompactMode();
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const { isViewOnly } = usePermissions();
  const extensionsViewOnly = isViewOnly("Extensions");
  const [connectors, setConnectors] = useState<ExtensionRow[]>([]);
  const [plugins, setPlugins] = useState<ExtensionRow[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<ExtensionKind | null>(null);

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  const [infoTarget, setInfoTarget] = useState<ExtensionRow | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<ExtensionRow | null>(null);

  // Install panel
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [installFile, setInstallFile] = useState<File | null>(null);
  const [installing, setInstalling] = useState(false);

  // Find selected row
  const allRows = [...connectors, ...plugins];
  const selectedRow =
    allRows.find((r) => r.name === selectedName && r.kind === selectedKind) ?? null;

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connMap, plugMap] = await Promise.all([getConnectorMetaData(), getPluginMetaData()]);

      const connNames = Object.keys(connMap ?? {});
      const plugNames = Object.keys(plugMap ?? {});

      const [connEnabled, plugEnabled] = await Promise.all([
        Promise.all(connNames.map((name) => isExtensionEnabled(name).catch(() => false))),
        Promise.all(plugNames.map((name) => isExtensionEnabled(name).catch(() => false))),
      ]);

      const connRows: ExtensionRow[] = connNames.map((name, i) =>
        connectorMetaToRow(name, (connMap ?? {})[name], connEnabled[i])
      );

      const plugRows: ExtensionRow[] = plugNames.map((name, i) =>
        pluginMetaToRow(name, (plugMap ?? {})[name], plugEnabled[i])
      );

      setConnectors(connRows);
      setPlugins(plugRows);

      // Keep selection valid after refresh
      setSelectedName((prev) => {
        if (!prev) return null;
        const stillExists = [...connRows, ...plugRows].some((r) => r.name === prev);
        return stillExists ? prev : null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  // ── Enable / Disable ──────────────────────────────────────────────────────

  async function handleToggleEnabled(row?: ExtensionRow) {
    const target = row ?? selectedRow;
    if (!target) return;
    const newEnabled = !target.enabled;
    setActionLoading(true);
    setError(null);
    try {
      await setExtensionEnabled(target.name, newEnabled);
      setRestartRequired(true);
      toast.success(
        `"${target.name}" has been ${newEnabled ? "enabled" : "disabled"}. Restart the server to apply changes.`
      );
      // Optimistically update the row
      const update = (rows: ExtensionRow[]) =>
        rows.map((r) => (r.name === target.name ? { ...r, enabled: newEnabled } : r));
      setConnectors(update);
      setPlugins(update);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }

  // ── Install ───────────────────────────────────────────────────────────────

  async function handleInstall() {
    if (!installFile) return;
    setInstalling(true);
    setError(null);
    try {
      await installExtension(installFile);
      setRestartRequired(true);
      setInstallFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success(
        `Extension "${installFile.name}" installed successfully. Restart the server to apply changes.`
      );
      // Java (ExtensionManagerPanel) only sets the restart banner here; the new extension
      // is not visible until a manual Refresh or server restart. Use the toolbar Refresh.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  function handleSelect(name: string | null, kind: ExtensionKind) {
    if (name === selectedName && kind === selectedKind) {
      setSelectedName(null);
      setSelectedKind(null);
    } else {
      setSelectedName(name);
      setSelectedKind(kind);
    }
  }

  // ── Uninstall ─────────────────────────────────────────────────────────────

  async function handleUninstall(row: ExtensionRow) {
    setUninstallTarget(null);
    setActionLoading(true);
    setError(null);
    try {
      await uninstallExtension(row.path);
      setRestartRequired(true);
      toast.success(
        `"${row.name}" has been queued for uninstallation. Restart the server to complete removal.`
      );
      // Deselect if this was the selected row
      if (row.name === selectedName) {
        setSelectedName(null);
        setSelectedKind(null);
      }
      // Java (Frame.doUninstallExtension) only sets the restart banner; the row stays visible
      // (pending restart) and the tables are not re-fetched. Use the toolbar Refresh to reload.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const actionPanelProps = {
    selectedRow,
    loading,
    actionLoading,
    viewOnly: extensionsViewOnly,
    onRefresh: load,
    onToggleEnabled: () => handleToggleEnabled(),
    onInfo: () => selectedRow && setInfoTarget(selectedRow),
    onUninstall: () => selectedRow && setUninstallTarget(selectedRow),
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Extensions" />

      {/* Toolbar + Content */}
      <div
        className={`flex flex-1 min-h-0 ${toolbarPos === "top" || toolbarPos === "bottom" ? "flex-col" : "flex-row"}`}
      >
        {(toolbarPos === "left" || toolbarPos === "top") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <ExtensionsActionPanel position={toolbarPos} {...actionPanelProps} />
          </DockableToolbar>
        )}

        <div
          className={`flex-1 flex flex-col overflow-hidden ${pagePadding(viewDensity)} gap-4 min-h-0`}
        >
          {/* ── Restart Required Banner ── */}
          {restartRequired && (
            <div className="flex items-center gap-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded px-4 py-2.5 text-sm text-yellow-800 dark:text-yellow-400 shrink-0">
              <span className="text-yellow-600 dark:text-yellow-500 text-base">⚠</span>
              <span className="font-medium">Restart Required</span>
              <span className="text-yellow-700 dark:text-yellow-400">
                — Extension changes will take effect after the server is restarted.
              </span>
            </div>
          )}

          {/* ── Error banner ── */}
          <ApiErrorAlert error={error} />

          {/* ── Tables (each takes half the remaining height) ── */}
          <div className="flex-1 flex flex-col gap-5 overflow-hidden min-h-0">
            <ExtensionTable
              title="Installed Connectors"
              rows={connectors}
              storageKey="bl-ext-connectors-cols-v2"
              selectedName={selectedKind === "connector" ? selectedName : null}
              onSelect={(name) => handleSelect(name, "connector")}
              onDoubleClick={(row) => setInfoTarget(row)}
              onContextInfo={(row) => setInfoTarget(row)}
              onContextToggleEnabled={(row) => handleToggleEnabled(row)}
              onContextUninstall={(row) => setUninstallTarget(row)}
              viewOnly={extensionsViewOnly}
              loading={loading}
            />

            <ExtensionTable
              title="Installed Plugins"
              rows={plugins}
              storageKey="bl-ext-plugins-cols-v2"
              selectedName={selectedKind === "plugin" ? selectedName : null}
              onSelect={(name) => handleSelect(name, "plugin")}
              onDoubleClick={(row) => setInfoTarget(row)}
              onContextInfo={(row) => setInfoTarget(row)}
              onContextToggleEnabled={(row) => handleToggleEnabled(row)}
              onContextUninstall={(row) => setUninstallTarget(row)}
              viewOnly={extensionsViewOnly}
              loading={loading}
            />

            {/* ── Web contributions from runtime plugin manifests ── */}
            <WebContributions />

            {/* ── Install Extension from File System ── */}
            <section className="shrink-0 border border-border rounded-lg p-4 bg-white dark:bg-gray-900">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Install Extension from File System
              </h2>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={installFile?.name ?? ""}
                  placeholder="Select a ZIP file…"
                  className="border border-border rounded px-2 py-1.5 text-sm flex-1 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none cursor-default"
                  onClick={() => fileInputRef.current?.click()}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  Browse…
                </button>
                <button
                  onClick={handleInstall}
                  disabled={!installFile || installing || extensionsViewOnly}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {installing ? "Installing…" : "Install"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => setInstallFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Select a BridgeLink extension ZIP file to install. The server must be restarted for
                the extension to take effect.
              </p>
            </section>
          </div>
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <ExtensionsActionPanel position={toolbarPos} {...actionPanelProps} />
          </DockableToolbar>
        )}
      </div>

      {/* ── Info Modal ── */}
      {infoTarget && <InfoModal ext={infoTarget} onClose={() => setInfoTarget(null)} />}

      {/* ── Uninstall Confirm Modal ── */}
      {uninstallTarget && (
        <UninstallConfirmModal
          ext={uninstallTarget}
          onConfirm={() => handleUninstall(uninstallTarget)}
          onCancel={() => setUninstallTarget(null)}
        />
      )}
    </div>
  );
}
