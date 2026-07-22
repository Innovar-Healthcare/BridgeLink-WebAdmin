import { getMessage, auditAccessedPHIMessage } from "@/lib/api-client";
import type { Message, ConnectorMessage } from "@/lib/types";

export interface ConnectorSwitchDeps {
  seqRef: { current: number };
  channels: Map<string, string>;
  isCURESPHILoggingOn: boolean;
  fullMessage: Message | null;
  setFullMessage: (msg: Message | null) => void;
  setContentError: (err: string) => void;
}

/**
 * Audit PHI access for a same-message connector switch (no re-fetch needed).
 * All state writes are seq-guarded so a slow audit from a prior message selection
 * cannot blank a now-current message's content on failure.
 *
 * Callers must increment `seqRef.current` and capture the value BEFORE calling —
 * the same seq should be shared with any immediately following `selectMessageContent`
 * call so both branches of `handleSelectConnector` use one monotonic token.
 */
export async function auditConnectorSwitch(
  msg: Message,
  cm: ConnectorMessage,
  seq: number,
  deps: ConnectorSwitchDeps
): Promise<void> {
  const { seqRef, channels, isCURESPHILoggingOn, fullMessage, setFullMessage, setContentError } =
    deps;
  if (!isCURESPHILoggingOn || !fullMessage) return;
  const channelName = channels.get(msg.channelId) ?? "";
  const fullCm = fullMessage.connectorMessages?.[String(cm.metaDataId)];
  const patientId =
    fullCm?.metaDataMap?.["PATIENT_ID"] != null ? String(fullCm.metaDataMap["PATIENT_ID"]) : "";
  try {
    await auditAccessedPHIMessage({
      patientId,
      channel: `Channel[id=${msg.channelId},name=${channelName}]`,
      messageId: String(msg.messageId),
    });
  } catch (err) {
    if (seqRef.current !== seq) return; // stale — user selected a different message
    setContentError(
      "Could not record required PHI access audit; content hidden. " +
        (err instanceof Error ? err.message : "")
    );
    setFullMessage(null);
  }
}

export interface MessageSelectionDeps {
  seqRef: { current: number };
  channels: Map<string, string>;
  isCURESPHILoggingOn: boolean;
  setFullMessage: (msg: Message | null) => void;
  setContentError: (err: string) => void;
  setContentLoading: (loading: boolean) => void;
}

/**
 * Fetch full message content and record the CURES PHI "Accessed" audit for a newly
 * selected message. All state writes are guarded by `seq` so that slow in-flight
 * fetches triggered by a prior selection are silently discarded when the user has
 * already moved to a different message.
 *
 * Callers must:
 *   1. Increment `seqRef.current` and capture the new value as `seq`.
 *   2. Call `setContentLoading(true)` and clear any prior `contentError` before calling.
 *   3. NOT call `setContentLoading(false)` themselves — this function owns that via finally.
 */
export async function selectMessageContent(
  msg: Message,
  cm: ConnectorMessage,
  seq: number,
  deps: MessageSelectionDeps
): Promise<void> {
  const {
    seqRef,
    channels,
    isCURESPHILoggingOn,
    setFullMessage,
    setContentError,
    setContentLoading,
  } = deps;

  try {
    const full = await getMessage(msg.channelId, msg.messageId);
    if (seqRef.current !== seq) return; // stale — user clicked a different message

    // ── CURES PHI audit: "Accessed PHI" (Java MessageBrowser:1908-1918) ──
    // Audit must succeed before content is shown; failure withholds PHI.
    if (isCURESPHILoggingOn) {
      const channelName = channels.get(msg.channelId) ?? "";
      const fetchedCm = full.connectorMessages?.[String(cm.metaDataId)];
      const patientId =
        fetchedCm?.metaDataMap?.["PATIENT_ID"] != null
          ? String(fetchedCm.metaDataMap["PATIENT_ID"])
          : "";
      try {
        await auditAccessedPHIMessage({
          patientId,
          channel: `Channel[id=${msg.channelId},name=${channelName}]`,
          messageId: String(msg.messageId),
        });
      } catch (auditErr) {
        if (seqRef.current !== seq) return; // stale
        setContentError(
          "Could not record required PHI access audit; content hidden. " +
            (auditErr instanceof Error ? auditErr.message : "")
        );
        return; // do NOT setFullMessage — PHI stays hidden
      }
      if (seqRef.current !== seq) return; // stale after audit
    }

    setFullMessage(full);
  } catch (err) {
    if (seqRef.current !== seq) return; // stale
    setContentError(err instanceof Error ? err.message : "Failed to load message content");
  } finally {
    if (seqRef.current === seq) setContentLoading(false);
  }
}

export interface SelectConnectorDeps {
  seqRef: { current: number };
  /** messageId of the currently-selected message (null if none). */
  selectedMessageId: number | null | undefined;
  channels: Map<string, string>;
  isCURESPHILoggingOn: boolean;
  /** Loaded content for the selected message, or null while still loading. */
  fullMessage: Message | null;
  setSelectedConnectorMetaDataId: (id: number) => void;
  setSelectedMessage: (msg: Message | null) => void;
  setFullMessage: (msg: Message | null) => void;
  setContentError: (err: string) => void;
  setContentLoading: (loading: boolean) => void;
}

/**
 * Orchestrate a connector-row selection. Two paths:
 *
 *  - Different message: bump the selection token, switch the selected message,
 *    and fetch its content via selectMessageContent (seq-guarded).
 *  - Same message (connector switch, no re-fetch): audit PHI access only.
 *
 * The selection token is bumped in the same-message path ONLY when content is
 * already loaded (`isCURESPHILoggingOn && fullMessage`). Bumping it
 * unconditionally would invalidate an in-flight selectMessageContent for this
 * same message — which happens when the user clicks a connector row while the
 * message's content is still loading (fullMessage === null) — stranding the
 * loading spinner. The bump is only needed so that a later different-message
 * selection can invalidate a slow audit Finding 2), and that race
 * only exists once content is loaded.
 */
export async function selectConnector(
  msg: Message,
  cm: ConnectorMessage,
  deps: SelectConnectorDeps
): Promise<void> {
  deps.setSelectedConnectorMetaDataId(cm.metaDataId);

  if (deps.selectedMessageId === msg.messageId) {
    if (deps.isCURESPHILoggingOn && deps.fullMessage) {
      const seq = ++deps.seqRef.current;
      await auditConnectorSwitch(msg, cm, seq, {
        seqRef: deps.seqRef,
        channels: deps.channels,
        isCURESPHILoggingOn: deps.isCURESPHILoggingOn,
        fullMessage: deps.fullMessage,
        setFullMessage: deps.setFullMessage,
        setContentError: deps.setContentError,
      });
    }
    return;
  }

  const seq = ++deps.seqRef.current;
  deps.setSelectedMessage(msg);
  deps.setFullMessage(null);
  deps.setContentError("");
  deps.setContentLoading(true);
  await selectMessageContent(msg, cm, seq, {
    seqRef: deps.seqRef,
    channels: deps.channels,
    isCURESPHILoggingOn: deps.isCURESPHILoggingOn,
    setFullMessage: deps.setFullMessage,
    setContentError: deps.setContentError,
    setContentLoading: deps.setContentLoading,
  });
}
