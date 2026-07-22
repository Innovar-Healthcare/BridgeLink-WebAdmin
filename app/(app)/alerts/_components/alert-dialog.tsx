import React, { useRef, useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { AlertInfo } from "@/lib/types";
import { type AlertForm, type ChannelNode, emptyForm, modelToForm, Field } from "./alert-types";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { TriggerTab } from "./trigger-tab";
import { ChannelsTab } from "./channels-tab";
import { ActionsTab } from "./actions-tab";
import { Input } from "@/components/ui/input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

export function AlertDialog({
  mode,
  alertInfo,
  channelNodes,
  onSubmit,
  onClose,
}: {
  mode: "new" | "edit";
  alertInfo: AlertInfo;
  channelNodes: ChannelNode[];
  onSubmit: (form: AlertForm) => Promise<void>;
  onClose: () => void;
}) {
  const { viewDensity } = useCompactMode();
  const existingModel = alertInfo.model;
  const allChannelIds = channelNodes.map((n) => n.id);

  const [form, setForm] = useState<AlertForm>(() =>
    mode === "edit" && existingModel
      ? modelToForm(existingModel, channelNodes)
      : emptyForm(allChannelIds)
  );
  const [activeTab, setActiveTab] = useState<"trigger" | "channels" | "actions">("trigger");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function validate(): string | null {
    if (!form.name.trim()) return "Alert name is required.";
    if (form.errorEventTypes.size === 0) return "At least one error event type must be selected.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(v) => {
        if (!v && !saving) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <DialogTitle className="text-base font-semibold text-gray-800 dark:text-gray-200">
            {mode === "new" ? "New Alert" : "Edit Alert"}
          </DialogTitle>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Name + enabled */}
        <div className="flex items-center gap-4 px-5 pt-4 pb-2 shrink-0">
          <div className="flex-1">
            <Field label="Alert Name" required>
              <Input
                ref={nameRef}
                density={viewDensity}
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="border border-border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                data-lpignore="true"
                autoComplete="off"
                disabled={saving}
              />
            </Field>
          </div>
          <FormCheckbox
            label="Enabled"
            checked={form.enabled}
            onChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
            disabled={saving}
            className="shrink-0 mt-4"
          />
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "trigger" | "channels" | "actions")}
        >
          <TabsList>
            <TabsTrigger value="trigger">Trigger</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Tab content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          {activeTab === "trigger" && <TriggerTab form={form} setForm={setForm} />}
          {activeTab === "channels" && (
            <ChannelsTab form={form} setForm={setForm} channelNodes={channelNodes} />
          )}
          {activeTab === "actions" && (
            <ActionsTab form={form} setForm={setForm} protocolOptions={alertInfo.protocolOptions} />
          )}

          {/* Error banner */}
          {error && (
            <div className="mx-4 mb-2 px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded whitespace-pre-wrap">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border bg-gray-50 dark:bg-gray-700/50 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-1.5 text-sm border border-border rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? "Saving…" : mode === "new" ? "Create Alert" : "Save Changes"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
