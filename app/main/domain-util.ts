import fs from "node:fs";
import path from "node:path";

import * as Sentry from "@sentry/electron/main";
import {JsonDB} from "node-json-db";
import {DataError} from "node-json-db/dist/lib/Errors.js";
import {z} from "zod";

import * as EnterpriseUtil from "../common/enterprise-util.ts";
import Logger from "../common/logger-util.ts";
import * as Messages from "../common/messages.ts";
import * as t from "../common/translation-util.ts";
import type {ServerConfig} from "../common/types.ts";

const logger = new Logger({
  file: "domain-util.log",
});

// For historical reasons, we store this string in domain.json to denote a
// missing icon; it does not change with the actual icon location.
export const defaultIconSentinel = "../renderer/img/icon.png";

const serverConfigSchema = z.object({
  url: z.url(),
  alias: z.string(),
  icon: z.string(),
  zulipVersion: z.string().default("unknown"),
  zulipFeatureLevel: z.number().default(0),
});

let database!: JsonDB;
let domainJsonPath!: string;
let defaultIconDataUrl: string | undefined;

export function init(userDataPath: string, iconDataUrl: string): void {
  defaultIconDataUrl = iconDataUrl;
  domainJsonPath = path.join(userDataPath, "config/domain.json");
  reloadDatabase();

  // Migrate from old schema
  try {
    const oldDomain = database.getObject<unknown>("/domain");
    if (typeof oldDomain === "string") {
      const server = {
        alias: "Zulip",
        url: oldDomain,
        icon: defaultIconSentinel,
      };
      serverConfigSchema.parse(server);
      database.push("/domains[]", server, true);
      database.delete("/domain");
      reloadDatabase();
    }
  } catch (error: unknown) {
    if (!(error instanceof DataError)) throw error;
  }
}

export function getDomains(): ServerConfig[] {
  reloadDatabase();
  try {
    return serverConfigSchema
      .array()
      .parse(database.getObject<unknown>("/domains"));
  } catch (error: unknown) {
    if (!(error instanceof DataError)) throw error;
    return [];
  }
}

export function getDomain(index: number): ServerConfig {
  reloadDatabase();
  return serverConfigSchema.parse(
    database.getObject<unknown>(`/domains[${index}]`),
  );
}

export function updateDomain(index: number, server: ServerConfig): void {
  reloadDatabase();
  serverConfigSchema.parse(server);
  database.push(`/domains[${index}]`, server, true);
}

export function addDomain(server: {
  url: string;
  alias: string;
  icon?: string;
}): void {
  if (!server.icon) {
    server.icon = defaultIconSentinel;
  }

  serverConfigSchema.parse(server);
  database.push("/domains[]", server, true);
  reloadDatabase();
}

export function removeDomains(): void {
  database.delete("/domains");
  reloadDatabase();
}

export function removeDomain(index: number): boolean {
  if (EnterpriseUtil.isPresetOrg(getDomain(index).url)) {
    return false;
  }

  database.delete(`/domains[${index}]`);
  reloadDatabase();
  return true;
}

export function duplicateDomain(domain: string): boolean {
  domain = formatUrl(domain);
  return getDomains().some((server) => server.url === domain);
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
    return t.__(
      "{{{server}}} runs an outdated Zulip Server version {{{version}}}. It may not fully work in this app.",
      {server: realm, version: server.zulipVersion},
    );
  }

  return undefined;
}

export function iconAsUrl(iconPath: string): string {
  if (iconPath === defaultIconSentinel) return defaultIconDataUrl ?? "";

  try {
    return `data:application/octet-stream;base64,${fs.readFileSync(
      iconPath,
      "base64",
    )}`;
  } catch {
    return defaultIconDataUrl ?? "";
  }
}

function reloadDatabase(): void {
  try {
    const file = fs.readFileSync(domainJsonPath, "utf8");
    JSON.parse(file);
  } catch (error: unknown) {
    if (fs.existsSync(domainJsonPath)) {
      fs.unlinkSync(domainJsonPath);
      logger.error("Error while JSON parsing domain.json: ");
      logger.error(error);
      Sentry.captureException(error);
    }
  }

  database = new JsonDB(domainJsonPath, true, true);
}
