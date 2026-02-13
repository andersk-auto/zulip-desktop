// Renderer-side ConfigUtil replacement using IPC.
// Provides a synchronous API backed by a cache that is populated
// at module load time via sendSync, and writes through to main process.

import type {Config} from "../../../common/config-util.ts";
import {ipcRenderer} from "../typed-ipc-renderer.ts";

// Load full config synchronously at startup
const cache: Record<string, unknown> = ipcRenderer.sendSync("get-all-config");

export function getConfigItem<Key extends keyof Config>(
  key: Key,
  defaultValue: Config[Key],
): Config[Key] {
  return (key in cache ? cache[key] : defaultValue) as Config[Key];
}

export function setConfigItem<Key extends keyof Config>(
  key: Key,
  value: Config[Key],
  override?: boolean,
): void {
  cache[key] = value;
  void ipcRenderer.invoke("set-config-item", key, value, override);
}

export function isConfigItemExists(key: string): boolean {
  return key in cache;
}

export function removeConfigItem(key: string): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete cache[key];
  void ipcRenderer.invoke("remove-config-item", key);
}
