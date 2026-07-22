import type * as MonacoType from "monaco-editor";
import { pluginRegistry } from "@/lib/plugin-registry";
import type { SurfaceGate } from "@/lib/plugin-gating";

/**
 * Mount plugin-contributed Monaco actions onto an editor instance, filtered by
 * server-enablement AND license gating,.
 *
 * A plugin action is added only when `isEnabled(action)` is true — the action's
 * stamped `pluginName` (server extension installed AND enabled) and
 * `licensedPluginId` (licensed) both gate it, so an action whose extension is
 * absent/disabled or whose plugin is unlicensed never enters the editor's
 * context menu. Callers invoke this from Monaco's onMount AND re-invoke it when
 * the enablement/license snapshot changes (JavaScriptPanel does this in an
 * effect), so an editor mounted while a cache was still loading picks up
 * newly-enabled actions once the fetch resolves. Actions are only ever added —
 * disabling/de-licensing mid-session leaves already-added actions on mounted
 * editors until they remount.
 *
 * Double-registration is guarded via `editor.getAction()` — React 18 StrictMode
 * double-invokes onMount in development and model reuse can re-trigger it.
 */
export function mountPluginMonacoActions(
  editor: MonacoType.editor.IStandaloneCodeEditor,
  monaco: typeof MonacoType,
  isEnabled: (gate: SurfaceGate) => boolean
): void {
  for (const action of pluginRegistry.monacoEditorActions) {
    if (!isEnabled(action)) continue;
    // getAction() returns null when the action has not been registered yet.
    if (editor.getAction(action.id)) continue;
    editor.addAction({
      id: action.id,
      label: action.label,
      keybindings: action.keybindings,
      contextMenuGroupId: action.contextMenuGroupId,
      contextMenuOrder: action.contextMenuOrder,
      run: (ed) => action.run(ed as MonacoType.editor.IStandaloneCodeEditor, monaco),
    });
  }
}
