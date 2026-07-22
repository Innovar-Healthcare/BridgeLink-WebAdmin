"use client";

import React, { useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deployChannels,
  redeployAllChannels,
  deleteChannels,
  setChannelsEnabled,
  bulkUpdateChannelGroups,
  getChannelXml,
} from "@/lib/api-client";
import { validateChannelForEnable } from "./enable-validation";
import { loadInstalledPlugins } from "@/lib/installed-plugins";
import { loadPluginLicenses } from "@/lib/plugin-license";
import { loadVersionHistoryEnabled } from "@/lib/version-history";
import type { Channel, ChannelGroup } from "@/lib/types";
import type { ChannelMetadata } from "@/lib/cache-store";
import { useNavigatingRouter } from "@/lib/hooks/use-navigating-router";
import {
  type EnrichedChannel,
  channelsInGroupServerOrder,
  isChannelEnabled,
} from "./channel-helpers";
import { DEFAULT_GROUP_ID } from "./channel-columns";
import { CHANNEL_GROUP_CONFLICT_MESSAGE } from "./use-channel-group-save";
import { type ExportGroupSpec } from "../_dialogs/export-groups-dialog";
import { type ExportChannelSpec } from "../_dialogs/export-channels-dialog";
import { type ChannelRowActions } from "../_components/channel-row";

// ─── Confirm dialog shape (mirrors what the page holds in state) ──────────────

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: "default" | "destructive";
  onConfirm: () => void;
}

// ─── Enable-validation failure report (mirrors Java doEnableChannel reporting) ─

export interface EnableFailure {
  id: string;
  name: string;
  /** Human-readable validation messages from validateChannelForEnable. */
  messages: string[];
}

export interface EnableReportState {
  open: boolean;
  failures: EnableFailure[];
}

// ─── Hook parameters ──────────────────────────────────────────────────────────

export interface ChannelOperationsParams {
  // Data
  channels: Channel[];
  allGroups: ChannelGroup[];
  enrichedById: Map<string, EnrichedChannel>;
  channelMetadata: Record<string, ChannelMetadata>;
  // Selection
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Selection context
  selectedChannelsArr: EnrichedChannel[];
  anySelectedEnabled: boolean;
  anySelectedDisabled: boolean;

  // Op loading
  setOpLoading: React.Dispatch<React.SetStateAction<boolean>>;

  // Confirm dialog
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmDialogState>>;

  // Enable-validation failure report
  setEnableReport: React.Dispatch<React.SetStateAction<EnableReportState>>;

  // Export group dialog
  setExportGroupSpecs: React.Dispatch<React.SetStateAction<ExportGroupSpec[]>>;
  setExportGroupsOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Export channel dialog (single)
  setExportChannelId: React.Dispatch<React.SetStateAction<string>>;
  setExportChannelName: React.Dispatch<React.SetStateAction<string>>;
  setExportOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Export channels dialog (multi)
  setExportChannelsSpecs: React.Dispatch<React.SetStateAction<ExportChannelSpec[]>>;
  setExportChannelsOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Clone dialog
  setCloneSourceId: React.Dispatch<React.SetStateAction<string>>;
  setCloneSourceName: React.Dispatch<React.SetStateAction<string>>;
  setCloneOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Assign group dialog
  setAssignGroupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAssignGroupIds: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Edit group dialog
  setEditingGroup: React.Dispatch<React.SetStateAction<ChannelGroup | null>>;
  setEditGroupOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Refresh callbacks
  refresh: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface ChannelOperations {
  executeDeploy: (ids: string[]) => Promise<void>;
  handleDeploy: () => void;
  handleDeployAll: () => void;
  handleEnable: () => Promise<void>;
  handleDisable: () => Promise<void>;
  handleDelete: () => void;
  handleExport: () => void;
  handleClone: () => void;
  openExport: (id: string) => void;
  openClone: (id: string) => void;
  openEditGroup: (group: ChannelGroup) => void;
  openDeleteGroup: (group: ChannelGroup) => void;
  openExportGroup: (group: ChannelGroup) => void;
  handleExportGroups: () => void;
  channelRowActions: ChannelRowActions;
  handleEditGroupFromPanel: (groupId?: string) => void;
  handleExportGroupFromPanel: (groupId?: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChannelOperations(params: ChannelOperationsParams): ChannelOperations {
  const {
    channels,
    allGroups,
    enrichedById,
    channelMetadata,
    selectedIds,
    setSelectedIds,
    selectedChannelsArr,
    anySelectedEnabled,
    anySelectedDisabled,
    setOpLoading,
    setConfirmDialog,
    setEnableReport,
    setExportGroupSpecs,
    setExportGroupsOpen,
    setExportChannelId,
    setExportChannelName,
    setExportOpen,
    setExportChannelsSpecs,
    setExportChannelsOpen,
    setCloneSourceId,
    setCloneSourceName,
    setCloneOpen,
    setAssignGroupOpen,
    setAssignGroupIds,
    setEditingGroup,
    setEditGroupOpen,
    refresh,
    refreshDashboard,
  } = params;

  const { push } = useNavigatingRouter();
  const router = useRouter();

  // ── Dialog helpers ──

  function openExport(id: string) {
    const ch = channels.find((c) => c.id === id);
    setExportChannelId(id);
    setExportChannelName(ch?.name ?? id);
    setExportOpen(true);
  }

  function openClone(id: string) {
    const ch = channels.find((c) => c.id === id);
    setCloneSourceId(id);
    setCloneSourceName(ch?.name ?? id);
    setCloneOpen(true);
  }

  function openEditGroup(group: ChannelGroup) {
    setEditingGroup(group);
    setEditGroupOpen(true);
  }

  function openDeleteGroup(group: ChannelGroup) {
    const channelCount = group.channels?.length ?? 0;
    const channelNote =
      channelCount > 0
        ? ` ${channelCount} channel${channelCount !== 1 ? "s" : ""} will be moved to [Default Group].`
        : "";
    // Server rejects requests that include the Default Group in the update set,
    // so filter it out along with the group being deleted.
    const remainingGroups = allGroups.filter((g) => g.id !== group.id && g.id !== DEFAULT_GROUP_ID);

    // Attempt the delete; on an out-of-sync rejection (override=false → server returns
    // false), prompt to overwrite and retry with override=true. Mirrors Java attemptUpdate.
    const runDelete = async (override: boolean) => {
      setOpLoading(true);
      try {
        const applied = await bulkUpdateChannelGroups(remainingGroups, [group.id], override);
        if (!applied) {
          setConfirmDialog({
            open: true,
            title: "Overwrite Changes?",
            description: CHANNEL_GROUP_CONFLICT_MESSAGE,
            confirmLabel: "Overwrite",
            confirmVariant: "default",
            onConfirm: () => void runDelete(true),
          });
          return;
        }
        await refresh();
        toast.success(`Deleted group "${group.name}"`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setOpLoading(false);
      }
    };

    setConfirmDialog({
      open: true,
      title: "Delete Group",
      description: `Delete group "${group.name}"?${channelNote} This cannot be undone.`,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onConfirm: () => void runDelete(false),
    });
  }

  // ── Channel operations ──

  async function executeDeploy(ids: string[]) {
    if (ids.length === 0) return;
    setOpLoading(true);
    void deployChannels(ids)
      .then(() => Promise.all([refresh(), refreshDashboard()]))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setOpLoading(false));
    router.push("/dashboard");
  }

  function handleDeploy() {
    if (selectedIds.size === 0) return;
    const enabledIds = selectedChannelsArr
      .filter((ch) => isChannelEnabled(ch, channelMetadata))
      .map((ch) => ch.id);
    // Mixed selection: warn that disabled channels will be skipped
    if (anySelectedEnabled && anySelectedDisabled) {
      setConfirmDialog({
        open: true,
        title: "Deploy Selected Channels",
        description: `Disabled channels will not be deployed. Only ${enabledIds.length} enabled channel${enabledIds.length !== 1 ? "s" : ""} will be deployed. Continue?`,
        confirmLabel: "Deploy",
        confirmVariant: "default",
        onConfirm: () => executeDeploy(enabledIds),
      });
    } else {
      // All selected are enabled — deploy immediately
      void executeDeploy([...selectedIds]);
    }
  }

  function handleDeployAll() {
    setConfirmDialog({
      open: true,
      title: "Redeploy All Channels",
      // Mirrors Java ChannelPanel.java:836.
      description: "Are you sure you want to redeploy all channels?",
      confirmLabel: "Redeploy All",
      confirmVariant: "default",
      onConfirm: () => {
        // Fire-and-forget: navigate immediately like the Java client does.
        // The dashboard refreshes on mount and will pick up the deploying state.
        void redeployAllChannels()
          .then(() => Promise.all([refresh(), refreshDashboard()]))
          .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
        router.push("/dashboard");
      },
    });
  }

  async function handleDisable() {
    if (selectedIds.size === 0) return;
    setOpLoading(true);
    try {
      await setChannelsEnabled([...selectedIds], false);
      await refresh();
      toast.success(`Disabled ${selectedIds.size} channel${selectedIds.size !== 1 ? "s" : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpLoading(false);
    }
  }

  /**
   * Enable channels with the Java client's pre-enable validation.
   * Mirrors `ChannelPanel.doEnableChannel`: each channel is validated first;
   * only the valid subset is enabled, and failures are reported in a dialog.
   * Each channel's XML is fetched (GET /channels/{id}) because the list cache
   * holds normalized models, not the XML the validators require.
   */
  async function runEnableWithValidation(ids: string[]) {
    if (ids.length === 0) return;
    setOpLoading(true);
    try {
      // Warm every snapshot surfaceGateEnabledSnapshot can read — enablement,
      // license, and the Version History feature flag (its pluginName is
      // special-cased in the gate) — so validateChannelForEnable's per-plugin
      // gate reads accurate values item 2). This action can fire from
      // the Channels/Dashboard list where the editor never opened, so the caches
      // may be cold; all loaders are no-ops once resolved.
      await Promise.all([
        loadInstalledPlugins(),
        loadPluginLicenses(),
        loadVersionHistoryEnabled(),
      ]);

      const nameOf = (id: string) => channels.find((c) => c.id === id)?.name ?? id;

      const results = await Promise.all(
        ids.map(async (id): Promise<{ id: string; messages: string[] }> => {
          try {
            const xml = await getChannelXml(id);
            return { id, messages: validateChannelForEnable(xml) };
          } catch {
            // Could not fetch/parse the channel — never silently enable it.
            return { id, messages: ["Channel could not be read for validation."] };
          }
        })
      );

      const validIds = results.filter((r) => r.messages.length === 0).map((r) => r.id);
      const failures: EnableFailure[] = results
        .filter((r) => r.messages.length > 0)
        .map((r) => ({ id: r.id, name: nameOf(r.id), messages: r.messages }));

      if (validIds.length > 0) {
        // Scope the enable call's own try/catch so a server failure here doesn't
        // swallow the validation report for the invalid channels below.
        try {
          await setChannelsEnabled(validIds, true);
          await refresh();
          toast.success(`Enabled ${validIds.length} channel${validIds.length !== 1 ? "s" : ""}`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      }

      if (failures.length > 0) {
        setEnableReport({ open: true, failures });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpLoading(false);
    }
  }

  async function handleEnable() {
    await runEnableWithValidation([...selectedIds]);
  }

  function handleDelete() {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    setConfirmDialog({
      open: true,
      title: "Delete Channels",
      // Mirrors Java ChannelPanel.java:2213 — includes the undeploy note.
      description: `Delete ${n} channel${n !== 1 ? "s" : ""}? This cannot be undone. Any selected deployed channel(s) will first be undeployed.`,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onConfirm: async () => {
        setOpLoading(true);
        try {
          await deleteChannels([...selectedIds]);
          setSelectedIds(new Set());
          await refresh();
          toast.success(`Deleted ${n} channel${n !== 1 ? "s" : ""}`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        } finally {
          setOpLoading(false);
        }
      },
    });
  }

  function handleExport() {
    if (selectedIds.size === 0) return;
    if (selectedIds.size === 1) {
      const [id] = [...selectedIds];
      openExport(id);
    } else {
      const specs: ExportChannelSpec[] = [...selectedIds].map((id) => {
        const ch = channels.find((c) => c.id === id);
        return { id, name: ch?.name ?? id };
      });
      setExportChannelsSpecs(specs);
      setExportChannelsOpen(true);
    }
  }

  function handleClone() {
    if (selectedIds.size !== 1) return;
    const [id] = [...selectedIds];
    openClone(id);
  }

  /** Open the export-groups dialog for a specific single group.
   *  Channels are ordered by server storage order, matching the Java UI. */
  function openExportGroup(group: ChannelGroup) {
    const groupChans = channelsInGroupServerOrder(group, enrichedById);
    setExportGroupSpecs([{ group, channels: groupChans }]);
    setExportGroupsOpen(true);
  }

  /** Export all groups — one file per group, each with all channels embedded.
   *  Channels within each group are in server storage order, matching the Java UI. */
  function handleExportGroups() {
    const specs: ExportGroupSpec[] = allGroups
      .filter((g) => {
        // Always include named groups; skip empty Default Group
        return g.id !== DEFAULT_GROUP_ID || channelsInGroupServerOrder(g, enrichedById).length > 0;
      })
      .map((g) => ({ group: g, channels: channelsInGroupServerOrder(g, enrichedById) }));
    setExportGroupSpecs(specs);
    setExportGroupsOpen(true);
  }

  // ── Single-channel actions (context menu) ──

  //: channelRowActions must keep a STABLE identity so the memoized
  // ChannelRow rows skip re-rendering on selection changes and manual refreshes.
  // The methods read the latest selection / channel list / sibling handlers from
  // a ref synced after each render, so behavior is unchanged while the object
  // reference never changes. Only the (already-stable) state setters are listed
  // as useMemo deps.
  const rowActionDeps = {
    selectedIds,
    channels,
    handleDeploy,
    handleEnable,
    runEnableWithValidation,
    handleDisable,
    handleDelete,
    openExport,
    openClone,
    refresh,
    refreshDashboard,
    push,
  };
  const rowActionDepsRef = useRef(rowActionDeps);
  useEffect(() => {
    rowActionDepsRef.current = rowActionDeps;
  });

  const channelRowActions = useMemo<ChannelRowActions>(
    () => ({
      onDeploy: async (id: string) => {
        const d = rowActionDepsRef.current;
        if (d.selectedIds.size > 1 && d.selectedIds.has(id)) {
          d.handleDeploy();
          return;
        }
        setOpLoading(true);
        try {
          await deployChannels([id]);
          await Promise.all([d.refresh(), d.refreshDashboard()]);
          toast.success("Deployed channel");
          d.push("/dashboard");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        } finally {
          setOpLoading(false);
        }
      },
      onEnable: async (id: string) => {
        const d = rowActionDepsRef.current;
        // Route both the multi-selection and single-channel paths through the
        // validated enable so misconfigured channels are never enabled.
        if (d.selectedIds.size > 1 && d.selectedIds.has(id)) {
          await d.handleEnable();
          return;
        }
        await d.runEnableWithValidation([id]);
      },
      onDisable: async (id: string) => {
        const d = rowActionDepsRef.current;
        if (d.selectedIds.size > 1 && d.selectedIds.has(id)) {
          await d.handleDisable();
          return;
        }
        setOpLoading(true);
        try {
          await setChannelsEnabled([id], false);
          await d.refresh();
          toast.success("Channel disabled");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        } finally {
          setOpLoading(false);
        }
      },
      onViewMessages: (id: string) => {
        rowActionDepsRef.current.push(`/messages?channelId=${id}`);
      },
      onExport: (id: string) => {
        const d = rowActionDepsRef.current;
        // If the right-clicked channel is part of a multi-selection, export all selected
        if (d.selectedIds.size > 1 && d.selectedIds.has(id)) {
          const specs: ExportChannelSpec[] = [...d.selectedIds].map((sid) => {
            const ch = d.channels.find((c) => c.id === sid);
            return { id: sid, name: ch?.name ?? sid };
          });
          setExportChannelsSpecs(specs);
          setExportChannelsOpen(true);
        } else {
          d.openExport(id);
        }
      },
      onClone: (id: string) => {
        rowActionDepsRef.current.openClone(id);
      },
      onEdit: (id: string) => {
        rowActionDepsRef.current.push(`/channels/${id}/edit`);
      },
      onAssignGroup: (id: string) => {
        const d = rowActionDepsRef.current;
        // If the right-clicked channel is already in the selection, use the full selection.
        // Otherwise assign just the right-clicked channel.
        const effective =
          d.selectedIds.size > 0 && d.selectedIds.has(id) ? d.selectedIds : new Set([id]);
        setAssignGroupIds(effective);
        setAssignGroupOpen(true);
      },
      onDelete: (id: string) => {
        const d = rowActionDepsRef.current;
        if (d.selectedIds.size > 1 && d.selectedIds.has(id)) {
          d.handleDelete();
          return;
        }
        const ch = d.channels.find((c) => c.id === id);
        const name = ch?.name ?? id;
        setConfirmDialog({
          open: true,
          title: "Delete Channel",
          description: `Delete channel "${name}"? This cannot be undone.`,
          confirmLabel: "Delete",
          confirmVariant: "destructive",
          onConfirm: async () => {
            setOpLoading(true);
            try {
              await deleteChannels([id]);
              setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
              await rowActionDepsRef.current.refresh();
              toast.success(`Deleted "${name}"`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            } finally {
              setOpLoading(false);
            }
          },
        });
      },
    }),
    [
      setOpLoading,
      setExportChannelsSpecs,
      setExportChannelsOpen,
      setAssignGroupIds,
      setAssignGroupOpen,
      setConfirmDialog,
      setSelectedIds,
    ]
  );

  // ── Derived action panel helpers ──

  // Java parity (ChannelPanel.doEditGroupDetails, :1050-1077): edit acts only on an explicitly
  // selected group row. When no group is selected we resolve from the channel selection, but only
  // if it maps to exactly one non-default group — otherwise no-op. Never fall back to an arbitrary
  // group.
  function handleEditGroupFromPanel(groupId?: string) {
    let group = groupId ? allGroups.find((g) => g.id === groupId) : undefined;
    if (!group && !groupId) {
      const withSelection = allGroups.filter(
        (g) => g.id !== DEFAULT_GROUP_ID && (g.channels ?? []).some((c) => selectedIds.has(c.id))
      );
      if (withSelection.length === 1) group = withSelection[0];
    }
    if (group) openEditGroup(group);
  }

  // Java parity (ChannelPanel.doExportGroup, :1975-2001): export acts on the explicitly selected
  // group row(s). When no group is selected we export the non-default groups that contain selected
  // channels; with nothing relevant selected we no-op rather than exporting an arbitrary group.
  function handleExportGroupFromPanel(groupId?: string) {
    let toExport: ChannelGroup[];
    if (groupId) {
      const selected = allGroups.find((g) => g.id === groupId);
      toExport = selected ? [selected] : [];
    } else {
      toExport = allGroups.filter(
        (g) => g.id !== DEFAULT_GROUP_ID && (g.channels ?? []).some((c) => selectedIds.has(c.id))
      );
    }
    if (toExport.length === 0) return;
    const specs: ExportGroupSpec[] = toExport.map((g) => ({
      group: g,
      channels: channelsInGroupServerOrder(g, enrichedById),
    }));
    setExportGroupSpecs(specs);
    setExportGroupsOpen(true);
  }

  // ── Group-level row actions (inline in the JSX but need allGroupChannelMap) ──
  // These are returned so the page can inline them if needed, but the primary
  // group row callbacks (onDeployAll, onEnableAll, onDisableAll) are kept in
  // the page JSX since they close over allGroupChannelMap directly.

  return {
    executeDeploy,
    handleDeploy,
    handleDeployAll,
    handleEnable,
    handleDisable,
    handleDelete,
    handleExport,
    handleClone,
    openExport,
    openClone,
    openEditGroup,
    openDeleteGroup,
    openExportGroup,
    handleExportGroups,
    channelRowActions,
    handleEditGroupFromPanel,
    handleExportGroupFromPanel,
  };
}
