// Renderer-side translation utility using IPC.
// Loads the translation catalog synchronously at module init via sendSync,
// then provides __() for simple string lookups with Mustache-style substitution.

import {ipcRenderer} from "../typed-ipc-renderer.ts";

const catalog: Record<string, string> = ipcRenderer.sendSync(
  "get-translation-catalog",
);

/**
 * Translate a key, optionally substituting {{{key}}} placeholders.
 */
export function __(
  key: string,
  substitutions?: Record<string, string>,
): string {
  let result = catalog[key] ?? key;
  if (substitutions) {
    for (const [k, v] of Object.entries(substitutions)) {
      result = result.replaceAll(`{{{${k}}}}`, v);
    }
  }

  return result;
}
