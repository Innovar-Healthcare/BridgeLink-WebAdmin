import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ColDef, ColStateMap } from "@/lib/hooks/use-column-config";
import {
  LOCAL_STORAGE_HIDDEN_META_COLS_KEY,
  getStoredHiddenMetaCols,
  META_COL_PREFIX,
  type MsgCol,
  type HiddenMetaColsByChannel,
} from "./message-columns";

/**
 * Layers per-channel custom-metadata-column visibility on top of useColumnConfig's global
 * colState, mirroring Java's customHiddenColumnMap (`Map<channelId, Set<columnName>>`,
 * MessageBrowser.java:363-376) — hiding a metadata column on one channel must not hide the
 * identically-named column on another. Static column width/order/visibility is left on
 * useColumnConfig's single global key (matches Java: its fixed columns aren't per-channel
 * either); only metadata-column hide/show is channel-scoped, via this small override instead of
 * touching useColumnConfig itself (shared by ~20 other pages).
 */
export function useChannelColumnVisibility(
  colState: ColStateMap<MsgCol>,
  orderedCols: ColDef<MsgCol>[],
  setVisible: (key: MsgCol, visible: boolean) => void,
  selectedChannelId: string,
  resetToDefaults: () => void
) {
  const [hiddenMetaColsByChannel, setHiddenMetaColsByChannel] =
    useState<HiddenMetaColsByChannel>(getStoredHiddenMetaCols);
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      // Skip the write triggered by the lazy-initializer's own value on mount.
      hydrated.current = true;
      return;
    }
    try {
      localStorage.setItem(
        LOCAL_STORAGE_HIDDEN_META_COLS_KEY,
        JSON.stringify(hiddenMetaColsByChannel)
      );
    } catch {
      /* ignore quota */
    }
  }, [hiddenMetaColsByChannel]);

  const channelColState = useMemo(() => {
    const hidden = selectedChannelId ? hiddenMetaColsByChannel[selectedChannelId] : undefined;
    if (!hidden?.length) return colState;
    const next = { ...colState };
    for (const key of hidden) {
      if (next[key]) next[key] = { ...next[key], visible: false };
    }
    return next;
  }, [colState, hiddenMetaColsByChannel, selectedChannelId]);

  const channelVisibleCols = useMemo(
    () => orderedCols.filter((c) => channelColState[c.key]?.visible !== false),
    [orderedCols, channelColState]
  );

  const setChannelVisible = useCallback(
    (key: MsgCol, visible: boolean) => {
      if (key.startsWith(META_COL_PREFIX) && selectedChannelId) {
        if (visible) {
          // Also clear any legacy globally-hidden state for this key (from before this
          // per-channel override existed, or from a stale localStorage entry) — otherwise a
          // meta column hidden under the old global scheme could never be re-shown, since the
          // per-channel map has nothing to remove and channelColState still inherits
          // colState[key].visible === false from useColumnConfig's persisted state.
          setVisible(key, true);
        }
        setHiddenMetaColsByChannel((prev) => {
          const cur = new Set(prev[selectedChannelId] ?? []);
          if (visible) cur.delete(key);
          else cur.add(key);
          const next = { ...prev };
          if (cur.size) next[selectedChannelId] = Array.from(cur);
          else delete next[selectedChannelId];
          return next;
        });
        return;
      }
      setVisible(key, visible);
    },
    [selectedChannelId, setVisible]
  );

  // "Reset columns" must also drop every per-channel metadata hide — otherwise a column hidden
  // on this channel would stay hidden right after the user asked for the defaults back.
  const resetChannelDefaults = useCallback(() => {
    resetToDefaults();
    setHiddenMetaColsByChannel({});
  }, [resetToDefaults]);

  return {
    colState: channelColState,
    visibleCols: channelVisibleCols,
    setVisible: setChannelVisible,
    resetToDefaults: resetChannelDefaults,
  };
}
