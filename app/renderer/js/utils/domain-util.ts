// All filesystem operations are now handled via IPC to the main process.

import type {ServerConfig} from "../../../common/types.ts";
import {ipcRenderer} from "../typed-ipc-renderer.ts";

// For historical reasons, we store this string in domain.json to denote a
// missing icon; it does not change with the actual icon location.
export const defaultIconSentinel = "../renderer/img/icon.png";

export async function getDomains(): Promise<ServerConfig[]> {
  return ipcRenderer.invoke("domain-get-domains");
}

export async function getDomain(index: number): Promise<ServerConfig> {
  return ipcRenderer.invoke("domain-get-domain", index);
}

export async function updateDomain(
  index: number,
  server: ServerConfig,
): Promise<void> {
  await ipcRenderer.invoke("domain-update-domain", index, server);
}

export async function addDomain(server: {
  url: string;
  alias: string;
  icon?: string;
}): Promise<void> {
  await ipcRenderer.invoke("domain-add-domain", server);
}

export async function removeDomains(): Promise<void> {
  await ipcRenderer.invoke("domain-remove-domains");
}

export async function removeDomain(index: number): Promise<boolean> {
  return ipcRenderer.invoke("domain-remove-domain", index);
}

export async function checkDomain(
  domain: string,
  silent = false,
): Promise<ServerConfig> {
  return ipcRenderer.invoke("domain-check-domain", domain, silent);
}

export async function updateSavedServer(
  url: string,
  index: number,
): Promise<ServerConfig> {
  return ipcRenderer.invoke("domain-update-saved-server", url, index);
}

export async function iconAsUrl(iconPath: string): Promise<string> {
  return ipcRenderer.invoke("domain-icon-as-url", iconPath);
}

export function formatUrl(domain: string): string {
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain;
  }

  if (domain.startsWith("localhost:")) {
    return `http://${domain}`;
  }

  return `https://${domain}`;
}

export function getUnsupportedMessage(
  server: ServerConfig,
): string | undefined {
  if (server.zulipFeatureLevel < 65 /* Zulip Server 4.0 */) {
    const realm = new URL(server.url).hostname;
    // Note: translation is handled synchronously here since message format is simple
    return `${realm} runs an outdated Zulip Server version ${server.zulipVersion}. It may not fully work in this app.`;
  }

  return undefined;
}
