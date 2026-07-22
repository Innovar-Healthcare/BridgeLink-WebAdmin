"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { FieldRow } from "@/components/settings/settings-section";
import { PROXY_BASE, getServerUrl, normalizeXStream } from "@/lib/api/api-core";
import { stripJmsXmlToBaseTemplate } from "../../_lib/channel-xml";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { inputCls, selectCls } from "./styles";
import { ConfirmDialog } from "@/components/confirm-dialog";

// ─── Built-in defaults (mirrors JmsTemplateListModel.java:41-54) ──────────────
// These are hardcoded client-side only; the server has no concept of defaults.
// They are read-only: Save As and Delete are blocked for these names.

const PREDEFINED_TEMPLATES: Record<string, Record<string, unknown>> = {
  ActiveMQ: {
    useJndi: false,
    connectionFactoryClass: "org.apache.activemq.ActiveMQConnectionFactory",
    connectionProperties: {
      brokerURL: "failover:(tcp://localhost:61616)?maxReconnectAttempts=0",
      closeTimeout: "15000",
      useCompression: "no",
    },
  },
  "JBoss Messaging / MQ": {
    useJndi: true,
    jndiProviderUrl: "jnp://localhost:1099",
    jndiInitialContextFactory: "org.jnp.interfaces.NamingContextFactory",
    jndiConnectionFactoryName: "java:/ConnectionFactory",
  },
};

const PREDEFINED_NAMES = new Set(Object.keys(PREDEFINED_TEMPLATES));

// ─── Props ────────────────────────────────────────────────────────────────────

export interface JmsConnectionTemplatesPanelProps {
  currentXml: string;
  onLoadTemplate: (props: Record<string, unknown>) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function JmsConnectionTemplatesPanel({
  currentXml,
  onLoadTemplate,
}: JmsConnectionTemplatesPanelProps) {
  const { viewDensity } = useCompactMode();

  const [userTemplates, setUserTemplates] = useState<Record<string, Record<string, unknown>>>({});
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [selectedTmpl, setSelectedTmpl] = useState<string>(Object.keys(PREDEFINED_TEMPLATES)[0]);
  const [saveName, setSaveName] = useState("");
  const [templateMsg, setTemplateMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Pending template name awaiting overwrite confirmation (null = no prompt open).
  const [confirmOverwrite, setConfirmOverwrite] = useState<string | null>(null);

  // Predefined entries first, then user-saved entries (matching Java refreshTemplates behavior)
  const mergedTemplates: Record<string, Record<string, unknown>> = {
    ...PREDEFINED_TEMPLATES,
    ...userTemplates,
  };
  const templateNames = Object.keys(mergedTemplates);
  const isPredefined = PREDEFINED_NAMES.has(selectedTmpl);

  const fetchTemplates = useCallback(async () => {
    setTemplateMsg(null);
    const serverUrl = getServerUrl();
    try {
      const res = await fetch(`${PROXY_BASE}/connectors/jms/templates`, {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const normalized = normalizeXStream(json) as Record<string, Record<string, unknown>>;
      // Strip any server-returned entries that match predefined names (cannot be overwritten)
      const safe: Record<string, Record<string, unknown>> = {};
      for (const [k, v] of Object.entries(normalized ?? {})) {
        if (!PREDEFINED_NAMES.has(k)) safe[k] = v;
      }
      setUserTemplates(safe);
      setTemplatesLoaded(true);
    } catch (e) {
      setTemplateMsg({
        text: `Failed to load templates: ${e instanceof Error ? e.message : String(e)}`,
        error: true,
      });
      // Still mark loaded so built-in defaults are shown even if server fetch fails
      setTemplatesLoaded(true);
    }
  }, []);

  // Auto-load the templates list when the panel mounts, matching Java
  // JmsConnectorPanel.setProperties → refreshTemplates() (JmsConnectorPanel.java:120).
  //
  useEffect(() => {
    startTransition(() => {
      void fetchTemplates();
    });
  }, [fetchTemplates]);

  function handleLoadTemplate() {
    setConfirmLoad(true);
  }

  function doLoadTemplate() {
    const rawProps = mergedTemplates[selectedTmpl];
    if (!rawProps) return;
    onLoadTemplate(rawProps);
    setTemplateMsg({ text: `Loaded template "${selectedTmpl}"`, error: false });
    setConfirmLoad(false);
  }

  function handleSaveTemplate() {
    const name = saveName.trim();
    if (!name) return;
    if (PREDEFINED_NAMES.has(name)) {
      setTemplateMsg({
        text: `"${name}" is a built-in template and cannot be overwritten.`,
        error: true,
      });
      return;
    }
    // Confirm before overwriting an existing user template, matching Java
    // JmsConnectorPanel (JmsConnectorPanel.java:673-675).
    if (Object.prototype.hasOwnProperty.call(userTemplates, name)) {
      setConfirmOverwrite(name);
      return;
    }
    void doSaveTemplate(name);
  }

  async function doSaveTemplate(name: string) {
    setConfirmOverwrite(null);
    const serverUrl = getServerUrl();
    try {
      const res = await fetch(
        `${PROXY_BASE}/connectors/jms/templates/${encodeURIComponent(name)}`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/xml",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
            ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
          },
          // Mirror Java: persist a clean base JmsConnectorProperties (connection fields
          // only), never the receiver/dispatcher subclass blob.
          body: stripJmsXmlToBaseTemplate(currentXml),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTemplateMsg({ text: `Saved template "${name}"`, error: false });
      setSaveName("");
      setTemplatesLoaded(false);
      await fetchTemplates();
      setSelectedTmpl(name);
    } catch (e) {
      setTemplateMsg({
        text: `Failed to save: ${e instanceof Error ? e.message : String(e)}`,
        error: true,
      });
    }
  }

  function handleDeleteTemplate() {
    if (!selectedTmpl || isPredefined) return;
    setConfirmDelete(true);
  }

  async function doDeleteTemplate() {
    setConfirmDelete(false);
    if (!selectedTmpl || isPredefined) return;
    const serverUrl = getServerUrl();
    try {
      const res = await fetch(
        `${PROXY_BASE}/connectors/jms/templates/${encodeURIComponent(selectedTmpl)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
          },
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const deletedName = selectedTmpl;
      setSelectedTmpl(Object.keys(PREDEFINED_TEMPLATES)[0]);
      setTemplatesLoaded(false);
      setTemplateMsg({ text: `Deleted template "${deletedName}"`, error: false });
      await fetchTemplates();
    } catch (e) {
      setTemplateMsg({
        text: `Failed to delete: ${e instanceof Error ? e.message : String(e)}`,
        error: true,
      });
    }
  }

  return (
    <>
      {confirmLoad && (
        <ConfirmDialog
          title="Load Template"
          description="Are you sure you want to overwrite current connection settings with the selected template?"
          confirmLabel="Load"
          confirmVariant="default"
          onConfirm={doLoadTemplate}
          onCancel={() => setConfirmLoad(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Template"
          description={`Are you sure you want to delete template "${selectedTmpl}"?`}
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={doDeleteTemplate}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {confirmOverwrite !== null && (
        <ConfirmDialog
          title="Overwrite Template"
          description={`Are you sure you want to overwrite the existing template named "${confirmOverwrite}"?`}
          confirmLabel="Overwrite"
          confirmVariant="destructive"
          onConfirm={() => void doSaveTemplate(confirmOverwrite)}
          onCancel={() => setConfirmOverwrite(null)}
        />
      )}
      <FieldRow label="Connection Templates:" className="!items-start pt-1">
        <div className="flex-1 space-y-2">
          {!templatesLoaded ? (
            // Templates auto-load on mount (Java parity); show a brief loading state until
            // the first fetch resolves. On failure fetchTemplates still flips templatesLoaded
            // so the built-in defaults + controls render below.
            <p className="text-xs text-gray-500 dark:text-gray-400">Loading templates…</p>
          ) : (
            <>
              {/* Select + Load + Delete */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  value={selectedTmpl}
                  onChange={(e) => setSelectedTmpl(e.target.value)}
                  className={`${selectCls(viewDensity)} flex-1 min-w-0`}
                >
                  {templateNames.map((n) => (
                    <option key={n} value={n}>
                      {PREDEFINED_NAMES.has(n) ? `${n} (built-in)` : n}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleLoadTemplate}
                  disabled={!selectedTmpl}
                  className="px-2.5 py-1 text-xs rounded border border-border
                  text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Load
                </button>
                <button
                  onClick={handleDeleteTemplate}
                  disabled={!selectedTmpl || isPredefined}
                  className="px-2.5 py-1 text-xs rounded border border-red-300 dark:border-red-700
                  text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Delete
                </button>
              </div>

              {/* Save as new template */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="New template name…"
                  className={`${inputCls(viewDensity)} flex-1`}
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={!saveName.trim()}
                  className="px-2.5 py-1 text-xs rounded border border-blue-400 dark:border-blue-600
                  text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Save As
                </button>
              </div>
            </>
          )}

          {/* Status message */}
          {templateMsg && (
            <p
              className={`text-xs ${templateMsg.error ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
            >
              {templateMsg.text}
            </p>
          )}
        </div>
      </FieldRow>
    </>
  );
}
