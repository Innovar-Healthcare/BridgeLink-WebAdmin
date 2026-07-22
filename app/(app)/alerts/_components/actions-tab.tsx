import React, { useMemo, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { type AlertForm, type ActionRow, TEMPLATE_VARS, Field } from "./alert-types";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

export function ActionsTab({
  form,
  setForm,
  protocolOptions,
}: {
  form: AlertForm;
  setForm: React.Dispatch<React.SetStateAction<AlertForm>>;
  protocolOptions: Record<string, Record<string, string>>;
}) {
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const { viewDensity } = useCompactMode();

  const protocols = useMemo(() => Object.keys(protocolOptions), [protocolOptions]);

  function addAction() {
    const defaultProtocol = protocols[0] ?? "Email";
    setForm((p) => ({
      ...p,
      actions: [...p.actions, { protocol: defaultProtocol, recipient: "" }],
    }));
  }

  function removeAction(idx: number) {
    setForm((p) => ({ ...p, actions: p.actions.filter((_, i) => i !== idx) }));
  }

  function setAction(idx: number, field: keyof ActionRow, value: string) {
    setForm((p) => {
      const actions = p.actions.map((a, i) =>
        i === idx ? { ...a, [field]: value, ...(field === "protocol" ? { recipient: "" } : {}) } : a
      );
      return { ...p, actions };
    });
  }

  function insertVariable(v: string) {
    const ta = templateRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const prev = form.template;
    const next = prev.slice(0, start) + v + prev.slice(end);
    setForm((p) => ({ ...p, template: next }));
    // Restore cursor after the inserted text
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + v.length, start + v.length);
    });
  }

  function handleTemplateDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const text = e.dataTransfer.getData("text/plain");
    if (!TEMPLATE_VARS.includes(text)) return;
    insertVariable(text);
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Field label="Subject (only used for email messages)">
        <Input
          density={viewDensity}
          type="text"
          value={form.subject}
          onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
          className="border border-border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
          data-lpignore="true"
          autoComplete="off"
        />
      </Field>

      {/* Template + variable panel */}
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Template</label>
          <Textarea
            density={viewDensity}
            ref={templateRef}
            value={form.template}
            onChange={(e) => setForm((p) => ({ ...p, template: e.target.value }))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleTemplateDrop}
            rows={7}
            className="border border-border rounded px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
            placeholder="Velocity template — click or drag variables to insert"
          />
        </div>

        {/* Variable panel */}
        <div className="w-44 flex flex-col gap-1 shrink-0">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Alert Variables</p>
          <div className="border border-border rounded bg-gray-50 dark:bg-gray-800 overflow-y-auto flex-1 max-h-44">
            {TEMPLATE_VARS.map((v) => (
              <button
                key={v}
                type="button"
                draggable
                onClick={() => insertVariable(v)}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", v)}
                className="w-full text-left px-2 py-1 text-xs font-mono text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border-b border-border last:border-0 truncate cursor-grab active:cursor-grabbing"
                title={`Click or drag to insert ${v}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actions table */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Actions</label>
          <button
            type="button"
            onClick={addAction}
            className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        <div className="border border-border rounded overflow-hidden">
          {/* Header */}
          <div
            className="grid text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase bg-gray-100 dark:bg-gray-700 border-b border-border"
            style={{ gridTemplateColumns: "1fr 2fr auto" }}
          >
            <div className="px-2 py-1.5">Protocol</div>
            <div className="px-2 py-1.5">Recipient</div>
            <div className="px-2 py-1.5 w-8" />
          </div>
          {form.actions.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
              No recipients configured — click Add to add one.
            </div>
          ) : (
            form.actions.map((action, idx) => {
              const recipientOptions = protocolOptions[action.protocol] ?? {};
              // Java gates the recipient picker on Protocol.hasOptions() (getRecipientOptions()
              // != null), not on the protocol name — so Channel, User, and any commercial
              // options-bearing protocol all get the id→name combo box. (AlertActionPane.java)
              const hasRecipientOptions = Object.keys(recipientOptions).length > 0;
              return (
                <div
                  key={idx}
                  className="grid items-center border-b border-border last:border-0"
                  style={{ gridTemplateColumns: "1fr 2fr auto" }}
                >
                  {/* Protocol dropdown */}
                  <div className="px-2 py-1.5">
                    <select
                      value={action.protocol}
                      onChange={(e) => setAction(idx, "protocol", e.target.value)}
                      className="border border-border rounded px-1.5 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                    >
                      {protocols.length === 0 && <option value="Email">Email</option>}
                      {protocols.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Recipient — picker for any options-bearing protocol, else free text */}
                  <div className="px-2 py-1.5">
                    {hasRecipientOptions ? (
                      <select
                        value={action.recipient}
                        onChange={(e) => setAction(idx, "recipient", e.target.value)}
                        className="border border-border rounded px-1.5 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                      >
                        <option value="">— Select —</option>
                        {Object.entries(recipientOptions)
                          .sort(([, a], [, b]) =>
                            a.localeCompare(b, undefined, { sensitivity: "base" })
                          )
                          .map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <Input
                        density={viewDensity}
                        type="text"
                        value={action.recipient}
                        onChange={(e) => setAction(idx, "recipient", e.target.value)}
                        className="border border-border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                        placeholder={
                          action.protocol === "Email" ? "email@example.com" : "Recipient"
                        }
                        data-lpignore="true"
                        autoComplete="off"
                      />
                    )}
                  </div>
                  {/* Remove */}
                  <div className="px-2 py-1.5 flex justify-center">
                    <button
                      type="button"
                      onClick={() => removeAction(idx)}
                      className="text-gray-400 dark:text-gray-500 hover:text-red-500 p-0.5 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
