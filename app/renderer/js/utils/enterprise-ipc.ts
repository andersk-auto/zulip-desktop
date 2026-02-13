// Renderer-side EnterpriseUtil replacement using IPC.
// Provides a synchronous API backed by a cache that is populated
// at module load time via sendSync.

import {ipcRenderer} from "../typed-ipc-renderer.ts";

const {hasConfigFile: _hasConfigFile, settings}: {
  hasConfigFile: boolean;
  settings: Record<string, unknown>;
} = ipcRenderer.sendSync("get-enterprise-config");

export function hasConfigFile(): boolean {
  return _hasConfigFile;
}

export function getConfigItem<T>(key: string, defaultValue: T): T {
  if (!_hasConfigFile) {
    return defaultValue;
  }

  const value = settings[key];
  return (value === undefined ? defaultValue : value) as T;
}

export function configItemExists(key: string): boolean {
  if (!_hasConfigFile) {
    return false;
  }

  return settings[key] !== undefined;
}

export function isPresetOrg(url: string): boolean {
  if (!_hasConfigFile || !configItemExists("presetOrganizations")) {
    return false;
  }

  const presetOrgs = settings.presetOrganizations;
  if (!Array.isArray(presetOrgs)) {
    return false;
  }

  return presetOrgs.some((org: string) => url.includes(org));
}
