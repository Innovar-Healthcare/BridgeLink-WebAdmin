/**
 * Programmatic file-picker helpers.
 *
 * These open a transient, hidden `<input type="file">` and resolve the selected
 * file's text — handy for context-menu actions (e.g. "Import Connector") where
 * wiring a persistent input ref into the component tree would be overkill.
 */

import { checkFileSize, FileTooLargeError, MAX_IMPORT_BYTES } from "@/lib/file-size-guard";

/**
 * Opens a file picker and resolves the chosen file's text content, or null if
 * the user cancels. `accept` defaults to XML files.
 *
 * Cancellation cannot be detected reliably across browsers, so the input is
 * cleaned up on the next focus after the picker closes; the promise resolves
 * null if no file was chosen by then.
 *
 * A file over `maxBytes` **rejects** with `FileTooLargeError` rather than resolving
 * null: null already means "cancelled", and collapsing the two would make
 * an oversize pick look like the operator changed their mind — the action would
 * silently do nothing. Callers must catch and surface the message.
 */
export function pickFileText(
  accept = ".xml,application/xml",
  maxBytes: number = MAX_IMPORT_BYTES
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
    };
    const finish = (value: string | null) => {
      if (settled) return;
      cleanup();
      resolve(value);
    };
    const fail = (err: Error) => {
      if (settled) return;
      cleanup();
      reject(err);
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      const tooLarge = checkFileSize(file, maxBytes);
      if (tooLarge) {
        fail(new FileTooLargeError(tooLarge));
        return;
      }
      file
        .text()
        .then((text) => finish(text))
        .catch(() => finish(null));
    });

    // Fallback for cancellation: when the window regains focus and no file was
    // selected, resolve null. Deferred a tick so the change event wins the race.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(null);
      }, 300);
    };
    window.addEventListener("focus", onFocus);

    input.click();
  });
}

/** Convenience wrapper that picks an XML file and resolves its text (or null). */
export function pickXmlFileText(): Promise<string | null> {
  return pickFileText(".xml,application/xml");
}
