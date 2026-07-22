"use client";

/**
 * Shared hook for plugin settings tabs.
 *
 * Handles the common pattern: load properties → edit form → save properties,
 * with loading/saving states, dirty checking, error/success messages, and validation.
 *
 * Used by: MessageTrendsSettingsTab, VersionHistorySettingsTab, DataPrunerSettingsTab
 */

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getPluginProperties, setPluginProperties } from "@/lib/api-client";

export interface UsePluginSettingsOptions<T> {
  pluginName: string;
  fromRecord: (record: Record<string, string>) => T;
  toRecord: (form: T) => Record<string, string>;
  validate?: (form: T) => string | null;
  /** When true, extra keys not produced by toRecord() are preserved across saves.
   *  Used by Version History to preserve channel-{id} commit tracking keys. */
  preserveExtraKeys?: boolean;
}

export function usePluginSettings<T>({
  pluginName,
  fromRecord,
  toRecord,
  validate,
  preserveExtraKeys = false,
}: UsePluginSettingsOptions<T>) {
  const [props, setProps] = useState<T | null>(null);
  const [original, setOriginal] = useState("");
  const [extraKeys, setExtraKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable refs so load/save callbacks don't re-create when these functions change.
  // Written in a deps-less effect (not during render) to satisfy react-hooks/refs;
  // declared before the load effect below so the refs are current when load() runs.
  const fromRecordRef = useRef(fromRecord);
  const toRecordRef = useRef(toRecord);
  const validateRef = useRef(validate);
  useEffect(() => {
    fromRecordRef.current = fromRecord;
    toRecordRef.current = toRecord;
    validateRef.current = validate;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await getPluginProperties(pluginName);
      const parsed = fromRecordRef.current(record);

      if (preserveExtraKeys) {
        const knownKeys = new Set(Object.keys(toRecordRef.current(parsed)));
        setExtraKeys(Object.fromEntries(Object.entries(record).filter(([k]) => !knownKeys.has(k))));
      }

      setProps(parsed);
      setOriginal(JSON.stringify(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to load ${pluginName} settings`);
    } finally {
      setLoading(false);
    }
  }, [pluginName, preserveExtraKeys]);

  // Kicked off as a transition so load()'s synchronous setLoading(true)/setError(null)
  // aren't a synchronous setState in an effect (react-hooks/set-state-in-effect).
  // The async setState calls after the await run normally.
  useEffect(() => {
    startTransition(() => {
      load();
    });
  }, [load]);

  const dirty = useMemo(
    () => props !== null && JSON.stringify(props) !== original,
    [props, original]
  );

  /** Update a single field. */
  const set = useCallback(<K extends keyof T>(key: K, val: T[K]) => {
    setProps((prev) => (prev ? { ...prev, [key]: val } : prev));
  }, []);

  /** Update multiple fields at once. */
  const patch = useCallback((partial: Partial<T>) => {
    setProps((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  /**
   * Validate and save the settings, throwing on validation failure or API error.
   * Does NOT show a toast — the Settings navigation guard calls this so a failed
   * save aborts navigation (mirrors built-in tabs' pure doSave and Java's
   * confirmLeave, where doSave()==false keeps you on the panel). Use save() for
   * the toolbar button when you want a success/failure toast.
   */
  const saveOrThrow = useCallback(async (): Promise<void> => {
    if (!props) return;
    const validationError = validateRef.current?.(props) ?? null;
    if (validationError) {
      setError(validationError);
      throw new Error(validationError);
    }
    setSaving(true);
    setError(null);
    try {
      const record = preserveExtraKeys
        ? { ...extraKeys, ...toRecordRef.current(props) }
        : toRecordRef.current(props);
      await setPluginProperties(pluginName, record);
      setOriginal(JSON.stringify(props));
    } catch (e) {
      const message = e instanceof Error ? e.message : `Failed to save ${pluginName} settings`;
      setError(message);
      throw e instanceof Error ? e : new Error(message);
    } finally {
      setSaving(false);
    }
  }, [props, pluginName, preserveExtraKeys, extraKeys]);

  /** Validate, save, and return true on success. Shows a toast either way. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!props) return false;
    try {
      await saveOrThrow();
      toast.success("Settings saved");
      return true;
    } catch {
      // saveOrThrow already populated `error`; swallow for the boolean API.
      return false;
    }
  }, [props, saveOrThrow]);

  return {
    props,
    setProps,
    loading,
    saving,
    error,
    setError,
    dirty,
    set,
    patch,
    load,
    save,
    saveOrThrow,
  };
}
