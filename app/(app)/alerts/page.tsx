"use client";

/**
 * Alerts page — mirrors Java's DefaultAlertPanel.java + DefaultAlertEditPanel.java
 *
 * List table: GET /alerts/statuses
 *   Columns: Status | Name | Id | Alerted
 *
 * Edit dialog mirrors Java's 3-panel layout:
 *   Tab 1 "Trigger"  — error event type checkboxes + regex field
 *   Tab 2 "Channels" — per-channel/connector enable-disable tree
 *   Tab 3 "Actions"  — subject, Velocity template, variable panel, protocol/recipient rows
 */

import React, { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";

import {
  deleteAlert,
  disableAlert,
  enableAlert,
  getAlertInfo,
  getAlertInfoById,
  getAlertStatuses,
  getAlertXml,
  getChannelIdsAndNames,
  updateAlert,
} from "@/lib/api-client";
import { useChannels } from "@/lib/hooks/use-cache";
import { getCache } from "@/lib/cache-store";
import { downloadFile } from "@/lib/download";
import type { AlertConnectors, AlertInfo, AlertStatus } from "@/lib/types";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { generateUUID } from "@/lib/utils";
import { useSortable } from "@/lib/hooks/use-sortable";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { useMounted } from "@/lib/hooks/use-mounted";
import { ColumnPicker } from "@/components/column-picker";
import { PageHeader } from "@/components/page-header";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { usePermissions } from "@/lib/hooks/use-permissions";

import {
  type AlertForm,
  type ChannelNode,
  buildAlertChannels,
  alertChannelsToXStream,
} from "./_components/alert-types";
import { AlertDialog } from "./_components/alert-dialog";
import { AlertsActionPanel } from "./_components/alerts-action-panel";
import { ExportAlertsDialog } from "./_dialogs/export-alerts-dialog";
import { ImportAlertDialog } from "./_dialogs/import-alert-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

// ─── Column definitions ───────────────────────────────────────────────────────

type AlertCol = "status" | "name" | "id" | "alerted";

const ALERT_COLS: ColDef<AlertCol>[] = [
  {
    key: "status",
    label: "Status",
    defaultWidth: 80,
    minWidth: 60,
    defaultVisible: true,
    canHide: false,
    align: "center",
  },
  {
    key: "name",
    label: "Name",
    defaultWidth: 300,
    minWidth: 150,
    defaultVisible: true,
    canHide: false,
  },
  { key: "id", label: "Id", defaultWidth: 280, minWidth: 215, defaultVisible: true, canHide: true },
  {
    key: "alerted",
    label: "Alerted",
    defaultWidth: 80,
    minWidth: 60,
    defaultVisible: true,
    canHide: true,
    align: "center",
  },
];

// ─── Status indicator ─────────────────────────────────────────────────────────

function StatusBullet({ enabled }: { enabled: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full border ${
          enabled ? "bg-blue-500 border-blue-600" : "bg-gray-400 border-gray-500"
        }`}
      />
      <span
        className={`text-xs ${enabled ? "text-blue-700 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"}`}
      >
        {enabled ? "Enabled" : "Disabled"}
      </span>
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const mounted = useMounted();
  const { viewDensity: globalDensity } = useCompactMode();
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const { isViewOnly } = usePermissions();
  const alertsViewOnly = isViewOnly("Alerts");
  const [alerts, setAlerts] = useState<AlertStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  // Selection + dialog
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"new" | "edit" | null>(null);
  const [alertInfo, setAlertInfo] = useState<AlertInfo | null>(null);
  const [channelNodes, setChannelNodes] = useState<ChannelNode[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDeleteAlert, setPendingDeleteAlert] = useState(false);

  // Hydrate the channel cache so openNew/openEdit can build ChannelNode[] with
  // real destination connector names (mirrors Java's PlatformUI cached channel statuses).
  useChannels();

  const colConfig = useColumnConfig(ALERT_COLS, "alerts-cols-v1");
  const { orderedCols, colState, setVisible, moveCol, resetToDefaults } = colConfig;

  const sortState = useSortable<AlertCol>("name");
  const { sort, sorted } = sortState;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAlertStatuses();
      setAlerts(data);
      setRefreshedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      refresh();
    });
  }, [refresh]);

  const selectedAlert = alerts.find((a) => a.id === selectedAlertId) ?? null;

  // ── Toolbar actions ──

  /**
   * Build ChannelNode[] from the in-memory channel cache. Mirrors Java's
   * AlertChannelPane.addChannels(): each channel gets a Source (metaDataId 0)
   * pseudo-connector followed by every destination connector sorted by metaDataId.
   * Falls back to partialChannels-derived connectors when the cache hasn't loaded
   * yet — preserves connector visibility for users who open the alert editor before
   * the channel cache hydrates (legacy reconstruction behavior).
   */
  function buildChannelNodes(
    channelMap: Map<string, string>,
    partialFallback?: Record<string, AlertConnectors>
  ): ChannelNode[] {
    const cached = getCache().channelMap;
    const nodes: ChannelNode[] = [...channelMap.entries()].map(([id, name]) => {
      const channel = cached.get(id);
      const connectors: { metaDataId: number | null; name: string }[] = [];
      if (channel) {
        connectors.push({ metaDataId: 0, name: "Source" });
        const dests = [...(channel.destinationConnectors ?? [])].sort(
          (a, b) => a.metaDataId - b.metaDataId
        );
        for (const d of dests) {
          connectors.push({ metaDataId: d.metaDataId, name: d.name });
        }
      } else if (partialFallback?.[id]) {
        const mc = partialFallback[id];
        const numeric = [...new Set([...mc.enabledConnectors, ...mc.disabledConnectors])]
          .filter((m): m is number => m !== null)
          .sort((a, b) => a - b);
        for (const mid of numeric) {
          connectors.push({
            metaDataId: mid,
            name: mid === 0 ? "Source" : `Destination ${mid}`,
          });
        }
      }
      // Trailing per-channel "[New Destinations]" pseudo-connector (metaDataId null) —
      // mirrors Java AlertChannelPane; lets an alert cover destinations added later.
      // Only when we know at least the source (i.e. not a fully-unknown channel).
      if (connectors.length > 0) {
        connectors.push({ metaDataId: null, name: "[New Destinations]" });
      }
      return { id, name, connectors };
    });
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return nodes;
  }

  async function openNew() {
    setInfoLoading(true);
    setError(null);
    try {
      const [info, channelMap] = await Promise.all([getAlertInfo(), getChannelIdsAndNames()]);
      setAlertInfo(info);
      setChannelNodes(buildChannelNodes(channelMap));
      setDialogMode("new");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInfoLoading(false);
    }
  }

  async function openEdit(alertId: string) {
    setInfoLoading(true);
    setError(null);
    try {
      const [info, channelMap] = await Promise.all([
        getAlertInfoById(alertId),
        getChannelIdsAndNames(),
      ]);
      const partialFallback = info.model?.trigger.alertChannels?.partialChannels ?? undefined;
      setAlertInfo(info);
      setChannelNodes(buildChannelNodes(channelMap, partialFallback));
      setDialogMode("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInfoLoading(false);
    }
  }

  async function handleToggleEnable(enable: boolean) {
    if (!selectedAlertId) return;
    try {
      if (enable) await enableAlert(selectedAlertId);
      else await disableAlert(selectedAlertId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleDelete() {
    if (!selectedAlertId) return;
    if (!alerts.find((a) => a.id === selectedAlertId)) return;
    setPendingDeleteAlert(true);
  }

  async function executeDeleteAlert() {
    if (!selectedAlertId) return;
    try {
      await deleteAlert(selectedAlertId);
      setSelectedAlertId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleExportSelected() {
    if (!selectedAlertId) return;
    const alert = alerts.find((a) => a.id === selectedAlertId);
    if (!alert) return;
    try {
      const xml = await getAlertXml(selectedAlertId);
      const safeName = alert.name.replace(/[/\\:*?"<>|]/g, "_");
      downloadFile(xml, `${safeName}.xml`, { mimeType: "application/xml" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDialogSubmit(form: AlertForm) {
    // Build XStream-serialized body — the server requires XStream format, not plain JSON:
    //   - errorEventTypes: {"errorEventType": "SINGLE"} or {"errorEventType": [...]}
    //     (key = ErrorEventType's @XStreamAlias("errorEventType"), no "set" wrapper)
    //   - enabledChannels/disabledChannels: {"string": "id"} or {"string": [...]} or null
    //     (key = "string" for Set<String>, no "set" wrapper)
    //   - actionGroups: {"alertActionGroup": {...}} XStream list-of-one-item wrapper
    //   - actions inside group: {"alertAction": {...}} or {"alertAction": [...]} wrapper
    const alertChannels = buildAlertChannels(form, channelNodes);
    const types = [...form.errorEventTypes];
    // ErrorEventType has @XStreamAlias("errorEventType") → key is "errorEventType" (no "set" wrapper).
    const toXStreamEnumSet = (items: string[]) =>
      items.length === 0 ? null : { errorEventType: items.length === 1 ? items[0] : items };

    const actions = form.actions;
    const actionGroupBody = {
      "@version": "4.6.1",
      subject: form.subject || null,
      template: form.template || null,
      actions:
        actions.length === 0 ? null : { alertAction: actions.length === 1 ? actions[0] : actions },
    };

    const existingId = dialogMode === "edit" ? alertInfo?.model?.id : undefined;
    // The server's AlertModel constructor generates a UUID, but XStream deserialization bypasses
    // the constructor — so if we omit id (or send null), the server gets id=null and NPEs.
    // Always send a UUID: use the existing one on edit, generate a new one on create.
    const alertId = existingId ?? generateUUID();

    const alertModelBody = {
      "@version": "4.6.1",
      id: alertId,
      name: form.name.trim(),
      enabled: form.enabled,
      trigger: {
        "@class": "defaultTrigger",
        "@version": "4.6.1",
        alertChannels: alertChannelsToXStream(alertChannels),
        errorEventTypes: toXStreamEnumSet(types),
        // Java captures the regex verbatim (no trim) — preserve intentional whitespace; only a
        // truly-empty string collapses to null (match-all), matching Java's empty-string default.
        regex: form.regex || null,
      },
      actionGroups: { alertActionGroup: actionGroupBody },
      properties: null,
    };

    const body = JSON.stringify({ alertModel: alertModelBody });

    // Java's DefaultAlertEditPanel always calls updateAlert() (PUT /alerts/{id}, op updateAlert)
    // for both new and existing alerts — the server's createAlert/updateAlert run the identical
    // controller method, so PUT keeps the audit op consistent with the Java client.
    await updateAlert(alertId, body);
    setDialogMode(null);
    await refresh();
  }

  // ── Sort ──

  const sortedAlerts = useMemo(() => {
    if (!sort.key) return alerts;
    const key = sort.key;
    return sorted(alerts, (a) => {
      switch (key) {
        case "status":
          return a.enabled ? 1 : 0;
        case "name":
          return a.name ?? "";
        case "id":
          return a.id ?? "";
        case "alerted":
          return a.alertedCount ?? 0;
        default:
          return "";
      }
    });
  }, [alerts, sort, sorted]);

  // ── Render ──

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Alerts"
        subtitle={
          mounted && refreshedAt
            ? `${alerts.length} alert${alerts.length !== 1 ? "s" : ""} · Updated ${format(refreshedAt, "HH:mm:ss")}`
            : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""}`
        }
        actions={
          <div className="flex items-center gap-2">
            <ColumnPicker
              cols={orderedCols}
              colState={colState}
              onToggle={(key) => setVisible(key, !(colState[key]?.visible ?? true))}
              onReset={resetToDefaults}
              onMove={moveCol}
            />
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      <ApiErrorAlert error={error} />

      {/* Toolbar + Table */}
      <div
        className={`flex flex-1 min-h-0 ${toolbarPos === "top" || toolbarPos === "bottom" ? "flex-col" : "flex-row"}`}
      >
        {(toolbarPos === "left" || toolbarPos === "top") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <AlertsActionPanel
              position={toolbarPos}
              selectedAlertId={selectedAlertId}
              selectedAlert={selectedAlert}
              infoLoading={infoLoading}
              viewOnly={alertsViewOnly}
              onNewAlert={openNew}
              onEditAlert={() => selectedAlertId && openEdit(selectedAlertId)}
              onEnable={() => handleToggleEnable(true)}
              onDisable={() => handleToggleEnable(false)}
              onDelete={handleDelete}
              onExportSelected={handleExportSelected}
              onImport={() => setImportOpen(true)}
              onExportAll={() => setExportOpen(true)}
            />
          </DockableToolbar>
        )}

        <div className={`flex-1 overflow-auto ${pagePadding(globalDensity)}`}>
          <DataTable<AlertStatus, AlertCol>
            variant="sortable"
            cols={ALERT_COLS}
            rows={sortedAlerts}
            colConfig={colConfig}
            sortState={sortState}
            rowKey={(a) => a.id}
            selectedRowId={selectedAlertId}
            onRowClick={(a) => setSelectedAlertId(a.id)}
            onRowDoubleClick={(a) => openEdit(a.id)}
            loading={loading}
            empty="No alerts found."
            cellAlign={{ status: "center", alerted: "center" }}
            cellMono={{ id: true }}
            renderCell={(alert, col) => {
              if (col === "status") return <StatusBullet enabled={alert.enabled} />;
              if (col === "name") return alert.name;
              if (col === "id") return alert.id;
              return alert.enabled && alert.alertedCount != null ? alert.alertedCount : "—";
            }}
            rowWrapper={(alert, rendered) => (
              <ContextMenu key={alert.id}>
                <ContextMenuTrigger asChild>{rendered}</ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      setSelectedAlertId(alert.id);
                      openEdit(alert.id);
                    }}
                  >
                    Edit Alert
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={alert.enabled}
                    onSelect={() => {
                      setSelectedAlertId(alert.id);
                      void enableAlert(alert.id)
                        .then(refresh)
                        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                    }}
                  >
                    Enable
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!alert.enabled}
                    onSelect={() => {
                      setSelectedAlertId(alert.id);
                      void disableAlert(alert.id)
                        .then(refresh)
                        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                    }}
                  >
                    Disable
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-red-600 focus:text-red-600"
                    onSelect={() => {
                      setSelectedAlertId(alert.id);
                      setPendingDeleteAlert(true);
                    }}
                  >
                    Delete Alert
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => {
                      setSelectedAlertId(alert.id);
                      void (async () => {
                        try {
                          const xml = await getAlertXml(alert.id);
                          const safeName = alert.name.replace(/[/\\:*?"<>|]/g, "_");
                          downloadFile(xml, `${safeName}.xml`, { mimeType: "application/xml" });
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      })();
                    }}
                  >
                    Export Alert
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          />
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <AlertsActionPanel
              position={toolbarPos}
              selectedAlertId={selectedAlertId}
              selectedAlert={selectedAlert}
              infoLoading={infoLoading}
              viewOnly={alertsViewOnly}
              onNewAlert={openNew}
              onEditAlert={() => selectedAlertId && openEdit(selectedAlertId)}
              onEnable={() => handleToggleEnable(true)}
              onDisable={() => handleToggleEnable(false)}
              onDelete={handleDelete}
              onExportSelected={handleExportSelected}
              onImport={() => setImportOpen(true)}
              onExportAll={() => setExportOpen(true)}
            />
          </DockableToolbar>
        )}
      </div>

      {/* Dialog */}
      {dialogMode !== null && alertInfo !== null && (
        <AlertDialog
          mode={dialogMode}
          alertInfo={alertInfo}
          channelNodes={channelNodes}
          onSubmit={handleDialogSubmit}
          onClose={() => setDialogMode(null)}
        />
      )}

      {pendingDeleteAlert && selectedAlert && (
        <ConfirmDialog
          title="Delete Alert"
          description={`Delete alert "${selectedAlert.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setPendingDeleteAlert(false);
            void executeDeleteAlert();
          }}
          onCancel={() => setPendingDeleteAlert(false)}
        />
      )}

      <ExportAlertsDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      <ImportAlertDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
        existingAlerts={alerts}
      />
    </div>
  );
}
