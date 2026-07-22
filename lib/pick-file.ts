/**
 * Programmatic file-picker helpers.
 *
 * These open a transient, hidden `<input type="file">` and resolve the selected
 * file's text — handy for context-menu actions (e.g. "Import Connector") where
 * wiring a persistent input ref into the component tree would be overkill.
 */

/**
 * Opens a file picker and resolves the chosen file's text content, or null if
 * the user cancels. `accept` defaults to XML files.
 *
 * Cancellation cannot be detected reliably across browsers, so the input is
 * cleaned up on the next focus after the picker closes; the promise resolves
 * null if no file was chosen by then.
 */
export function pickFileText(accept = ".xml,application/xml"): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(value);
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
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
