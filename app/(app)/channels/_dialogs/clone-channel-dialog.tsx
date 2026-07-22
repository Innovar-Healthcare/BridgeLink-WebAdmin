"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/form-dialog";
import { generateUUID } from "@/lib/utils";
import { getChannelXml, createChannelFromXml } from "@/lib/api-client";
import { getChannelTags } from "@/lib/api/api-channels";
import { setChannelTags } from "@/lib/api/api-settings";
import { addChannelToSourceTags } from "@/lib/channel-tag-utils";

export function CloneChannelDialog({
  open,
  onClose,
  onCloned,
  sourceName,
  sourceId,
  existingNames,
}: {
  open: boolean;
  onClose: () => void;
  onCloned: () => void;
  sourceName: string;
  sourceId: string;
  existingNames: Set<string>;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form state each time the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an effect,
  // which avoids the cascading-render warning from react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      // Seed with the source name as-is (matches Java clone flow — no "Copy of "
      // prefix). This starts as a duplicate, so the user is forced to rename.
      setName(sourceName);
      setError(null);
    }
  }

  // Focus/select the name input when the dialog opens. Ref access stays in an
  // effect (not the render-time reset above) per react-hooks/refs.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = name.trim();
  const isDuplicate = trimmed.length > 0 && existingNames.has(trimmed.toLowerCase());

  async function handleClone() {
    if (!trimmed || isDuplicate) return;
    setLoading(true);
    setError(null);
    try {
      const xml = await getChannelXml(sourceId);
      const newId = generateUUID();
      const patched = xml
        .replace(/<id>[^<]+<\/id>/, `<id>${newId}</id>`)
        .replace(/<name>[^<]+<\/name>/, `<name>${trimmed}</name>`);
      await createChannelFromXml(patched);
      //: copy the source channel's tag memberships onto the clone, mirroring
      // the Java clone flow (adds the new id to every tag that referenced the source).
      // Best-effort: the channel is already created, so a tag-write failure (e.g. the
      // user lacks the TAGS_MANAGE permission) must not make a successful clone look
      // failed — warn and proceed.
      try {
        const tags = await getChannelTags();
        const updated = addChannelToSourceTags(tags, sourceId, newId);
        if (updated.some((t, i) => t !== tags[i])) await setChannelTags(updated);
      } catch {
        toast.warning("Channel cloned, but its tags could not be copied.");
      }
      onCloned();
      onClose();
    } catch (e) {
      // Parse clean message out of server XML error if possible
      const raw = e instanceof Error ? e.message : String(e);
      const match = raw.match(/<detailMessage>([^<]+)<\/detailMessage>/);
      setError(match ? match[1] : raw);
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Clone Channel"
      onSubmit={handleClone}
      submitLabel="Clone"
      submitDisabled={!trimmed || isDuplicate}
      saving={loading}
      error={error}
      // Wide enough to display a full 40-character channel name plus the
      // length counter without clipping follow-up).
      maxWidth="sm:max-w-lg"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Cloning <span className="font-medium text-gray-700 dark:text-gray-300">{sourceName}</span>
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
            New Channel Name <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              maxLength={40}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Enter channel name"
              className={`flex-1 border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 dark:text-gray-200 ${
                isDuplicate
                  ? "border-red-400 focus:ring-red-400"
                  : "border-border focus:ring-blue-400"
              }`}
              disabled={loading}
            />
            {name.length > 30 && (
              <span
                className={`text-xs tabular-nums shrink-0 ${
                  name.length >= 40
                    ? "text-red-500 dark:text-red-400"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                {name.length}/40
              </span>
            )}
          </div>
        </div>
        {isDuplicate && (
          <p className="text-xs text-red-600 dark:text-red-400">
            A channel named &quot;{trimmed}&quot; already exists.
          </p>
        )}
      </div>
    </FormDialog>
  );
}
