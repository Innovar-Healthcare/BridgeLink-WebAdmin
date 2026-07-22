import React from "react";
import { type AlertForm, ERROR_EVENT_TYPES, Field } from "./alert-types";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

export function TriggerTab({
  form,
  setForm,
}: {
  form: AlertForm;
  setForm: React.Dispatch<React.SetStateAction<AlertForm>>;
}) {
  const { viewDensity } = useCompactMode();
  const hasAny = form.errorEventTypes.has("ANY");

  function toggleType(key: string) {
    setForm((prev) => {
      const next = new Set(prev.errorEventTypes);
      if (key === "ANY") {
        // Java masks the other checkboxes while ANY is on but PRESERVES their values — so a
        // Java-authored {ANY, FILTER_ERROR} round-trips intact and the selections reappear when
        // ANY is cleared. Do not clear() the rest.
        if (next.has("ANY")) next.delete("ANY");
        else next.add("ANY");
      } else {
        // The non-ANY checkboxes are disabled while ANY is active, so this branch only runs when
        // ANY is off; deleting ANY here is defensive (kept for parity with that masked state).
        if (next.has("ANY")) next.delete("ANY");
        if (next.has(key)) next.delete(key);
        else next.add(key);
      }
      return { ...prev, errorEventTypes: next };
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          Errors (select all that apply)
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {ERROR_EVENT_TYPES.map(({ key, label }) => {
            const checked = form.errorEventTypes.has(key);
            const disabled = key !== "ANY" && hasAny;
            return (
              <FormCheckbox
                key={key}
                label={label}
                checked={checked}
                disabled={disabled}
                onChange={() => toggleType(key)}
              />
            );
          })}
        </div>
      </div>

      <Field label="Regex (optional)">
        <Textarea
          density={viewDensity}
          rows={3}
          value={form.regex}
          onChange={(e) => setForm((p) => ({ ...p, regex: e.target.value }))}
          className="border border-border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 font-mono"
          placeholder="Leave blank to match all messages"
          data-lpignore="true"
          autoComplete="off"
        />
      </Field>
    </div>
  );
}
