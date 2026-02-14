import {clipboard, shell} from "electron/common";
import {
  BrowserWindow,
  Menu,
  type IpcMainEvent,
  type WebContents,
  app,
  dialog,
  powerMonitor,
  session,
  webContents,
} from "electron/main";
import {Buffer} from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import windowStateKeeper from "electron-window-state";

import * as ConfigUtil from "../common/config-util.ts";
import * as DNDUtil from "../common/dnd-util.ts";
import * as EnterpriseUtil from "../common/enterprise-util.ts";
import {Html, html} from "../common/html.ts";
import * as LinkUtil from "../common/link-util.ts";
import {bundlePath, bundleUrl, publicPath} from "../common/paths.ts";
import * as t from "../common/translation-util.ts";
import type {ContextMenuParams, RendererMessage} from "../common/typed-ipc.ts";
import type {MenuProperties, ServerConfig} from "../common/types.ts";

import {appUpdater, shouldQuitForUpdate} from "./autoupdater.ts";
import * as BadgeSettings from "./badge-settings.ts";
import {showContextMenu} from "./context-menu.ts";
import * as DomainUtil from "./domain-util.ts";
import handleExternalLink from "./handle-external-link.ts";
import * as AppMenu from "./menu.ts";
import {_getServerSettings, _isOnline, _saveServerIcon} from "./request.ts";
import {sentryInit} from "./sentry.ts";
import {setAutoLaunch} from "./startup.ts";
import * as TrayUtil from "./tray.ts";
import {ipcMain, send} from "./typed-ipc-main.ts";

import "gatemaker/electron-setup.js"; // eslint-disable-line import-x/no-unassigned-import

// eslint-disable-next-line @typescript-eslint/naming-convention
const {GDK_BACKEND} = process.env;

// Initialize sentry for main process
sentryInit();

let mainWindowState: windowStateKeeper.State;

// Prevent window being garbage collected
let mainWindow: BrowserWindow;
let badgeCount: number;

let isQuitting = false;

// Load this file in main window
const mainUrl = new URL("app/renderer/main.html", bundleUrl).href;

const permissionCallbacks = new Map<number, (grant: boolean) => void>();
let nextPermissionCallbackId = 0;

const appIcon = path.join(publicPath, "resources/Icon");

const iconPath = (): string =>
  appIcon + (process.platform === "win32" ? ".ico" : ".png");

// Toggle the app window
const toggleApp = (): void => {
  if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
    mainWindow.show();
  } else {
    mainWindow.hide();
  }
};

function createMainWindow(): BrowserWindow {
  // Load the previous state with fallback to defaults
  mainWindowState = windowStateKeeper({
    defaultWidth: 1100,
    defaultHeight: 720,
    path: `${app.getPath("userData")}/config`,
  });

  const win = new BrowserWindow({
    // This settings needs to be saved in config
    title: "Zulip",
    icon: iconPath(),
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 500,
    minHeight: 400,
    webPreferences: {
      preload: path.join(bundlePath, "../preload/renderer.cjs"),
      sandbox: true,
      webviewTag: true,
    },
    show: false,
  });

  win.on("focus", () => {
    send(win.webContents, "focus");
  });

  (async () => win.loadURL(mainUrl))();

  // Keep the app running in background on close event
  win.on("close", (event) => {
    if (ConfigUtil.getConfigItem("quitOnClose", false)) {
      app.quit();
    }

    if (!isQuitting && !shouldQuitForUpdate()) {
      event.preventDefault();

      if (process.platform === "darwin") {
        if (win.isFullScreen()) {
          win.setFullScreen(false);
          win.once("leave-full-screen", () => {
            app.hide();
          });
        } else {
          app.hide();
        }
      } else {
        win.hide();
      }
    }
  });

  win.setTitle("Zulip");

  win.on("enter-full-screen", () => {
    send(win.webContents, "enter-fullscreen");
  });

  win.on("leave-full-screen", () => {
    send(win.webContents, "leave-fullscreen");
  });

  //  To destroy tray icon when navigate to a new URL
  win.webContents.on("will-navigate", (event) => {
    if (event) {
      TrayUtil.destroyTray();
    }
  });

  // Let us register listeners on the window, so we can update the state
  // automatically (the listeners will be removed when the window is closed)
  // and restore the maximized or full screen state
  mainWindowState.manage(win);

  return win;
}

(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  await app.whenReady();

  if (process.env.GDK_BACKEND !== GDK_BACKEND) {
    console.warn(
      "Reverting GDK_BACKEND to work around https://github.com/electron/electron/issues/28436",
    );
    if (GDK_BACKEND === undefined) {
      delete process.env.GDK_BACKEND;
    } else {
      process.env.GDK_BACKEND = GDK_BACKEND;
    }
  }

  // Used for notifications on Windows
  app.setAppUserModelId("org.zulip.zulip-electron");

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.show();
    }
  });

  // Initialize domain-util with the default icon data URL
  const defaultIconPath = path.join(publicPath, "img/icon.png");
  let defaultIconDataUrl = "";
  try {
    defaultIconDataUrl = `data:image/png;base64,${fs.readFileSync(defaultIconPath, "base64")}`;
  } catch {
    // Icon file not found; leave as empty string
  }

  DomainUtil.init(app.getPath("userData"), defaultIconDataUrl);

  ipcMain.on(
    "permission-callback",
    (event, permissionCallbackId: number, grant: boolean) => {
      permissionCallbacks.get(permissionCallbackId)?.(grant);
      permissionCallbacks.delete(permissionCallbackId);
    },
  );

  // This event is only available on macOS. Triggers when you click on the dock icon.
  app.on("activate", () => {
    mainWindow.show();
  });

  app.on("web-contents-created", (_event, contents: WebContents) => {
    contents.setWindowOpenHandler((details) => {
      handleExternalLink(contents, details, page);
      return {action: "deny"};
    });
  });

  const ses = session.fromPartition("persist:webviewsession");
  ses.setUserAgent(`ZulipElectron/${app.getVersion()} ${ses.getUserAgent()}`);

  function configureSpellChecker() {
    const enable = ConfigUtil.getConfigItem("enableSpellchecker", true);
    if (enable && process.platform !== "darwin") {
      ses.setSpellCheckerLanguages(
        ConfigUtil.getConfigItem("spellcheckerLanguages", null) ?? [],
      );
    }

    ses.setSpellCheckerEnabled(enable);
  }

  configureSpellChecker();
  ipcMain.on("configure-spell-checker", configureSpellChecker);

  const clipboardSigKey = crypto.randomBytes(32);

  ipcMain.on("new-clipboard-key", (event) => {
    const key = crypto.randomBytes(32);
    const hmac = crypto.createHmac("sha256", clipboardSigKey);
    hmac.update(key);
    event.returnValue = {key, sig: hmac.digest()};
  });

  ipcMain.handle("poll-clipboard", (event, key, sig) => {
    // Check that the key was generated here.
    const hmac = crypto.createHmac("sha256", clipboardSigKey);
    hmac.update(key);
    if (!crypto.timingSafeEqual(sig, hmac.digest())) return;

    try {
      // Check that the data on the clipboard was encrypted to the key.
      const data = Buffer.from(clipboard.readText(), "hex");
      const iv = data.subarray(0, 12);
      const ciphertext = data.subarray(12, -16);
      const authTag = data.subarray(-16);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      decipher.setAuthTag(authTag);
      return (
        decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8")
      );
    } catch {
      // If the parsing or decryption failed in any way,
      // the correct token hasn't been copied yet; try
      // again next time.
      return undefined;
    }
  });

  // Config IPC handlers
  ipcMain.handle(
    "get-config-item",
    (_event, key: string) =>
      ConfigUtil.getConfigItem(key as keyof ConfigUtil.Config, undefined as never),
  );

  ipcMain.handle(
    "set-config-item",
    (_event, key: string, value: unknown, override?: boolean) => {
      ConfigUtil.setConfigItem(
        key as keyof ConfigUtil.Config,
        value as never,
        override,
      );
    },
  );

  ipcMain.handle(
    "is-config-item-exists",
    (_event, key: string) => ConfigUtil.isConfigItemExists(key),
  );

  ipcMain.handle("remove-config-item", (_event, key: string) => {
    ConfigUtil.removeConfigItem(key);
  });

  // Enterprise IPC handlers
  ipcMain.handle(
    "enterprise-has-config-file",
    () => EnterpriseUtil.hasConfigFile(),
  );

  ipcMain.handle(
    "enterprise-get-config-item",
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    (_event, key: string, defaultValue: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      EnterpriseUtil.getConfigItem(key as any, defaultValue as any),
  );

  ipcMain.handle(
    "enterprise-config-item-exists",
    (_event, key: string) =>
      EnterpriseUtil.configItemExists(
        key as Parameters<typeof EnterpriseUtil.configItemExists>[0],
      ),
  );

  ipcMain.handle(
    "enterprise-is-preset-org",
    (_event, url: string) => EnterpriseUtil.isPresetOrg(url),
  );

  // Domain IPC handlers (icon fields are resolved to data URLs for the renderer)
  ipcMain.handle("domain-get-domains", () =>
    DomainUtil.getDomains().map((d) => ({
      ...d,
      icon: DomainUtil.iconAsUrl(d.icon),
    })),
  );

  ipcMain.handle("domain-get-domain", (_event, index: number) => {
    const d = DomainUtil.getDomain(index);
    return {...d, icon: DomainUtil.iconAsUrl(d.icon)};
  });

  ipcMain.handle(
    "domain-update-domain",
    (_event, index: number, server: ServerConfig) => {
      DomainUtil.updateDomain(index, server);
    },
  );

  ipcMain.handle(
    "domain-add-domain",
    async (_event, server: {url: string; alias: string; icon?: string}) => {
      if (server.icon) {
        const localIconUrl = await _saveServerIcon(server.icon, ses);
        server.icon = localIconUrl ?? DomainUtil.defaultIconSentinel;
      }

      DomainUtil.addDomain(server);
    },
  );

  ipcMain.handle("domain-remove-domains", () => {
    DomainUtil.removeDomains();
  });

  ipcMain.handle(
    "domain-remove-domain",
    (_event, index: number) => DomainUtil.removeDomain(index),
  );

  ipcMain.handle(
    "domain-check-domain",
    async (_event, domain: string, silent?: boolean) => {
      if (!silent && DomainUtil.duplicateDomain(domain)) {
        throw new Error("This server has been added.");
      }

      const formattedDomain = DomainUtil.formatUrl(domain);
      return _getServerSettings(formattedDomain, ses);
    },
  );

  ipcMain.handle(
    "domain-update-saved-server",
    async (_event, url: string, index: number) => {
      const serverConfig = DomainUtil.getDomain(index);
      const oldIcon = serverConfig.icon;
      try {
        // Check domain silently
        const formattedDomain = DomainUtil.formatUrl(url);
        const newServerConfig = await _getServerSettings(formattedDomain, ses);
        const localIconUrl =
          (await _saveServerIcon(newServerConfig.icon, ses)) ??
          DomainUtil.defaultIconSentinel;
        if (!oldIcon || localIconUrl !== DomainUtil.defaultIconSentinel) {
          newServerConfig.icon = localIconUrl;
          DomainUtil.updateDomain(index, newServerConfig);
        }

        // Return with resolved icon data URL for renderer display
        return {
          ...newServerConfig,
          icon: DomainUtil.iconAsUrl(newServerConfig.icon),
        };
      } catch {
        return {...serverConfig, icon: DomainUtil.iconAsUrl(serverConfig.icon)};
      }
    },
  );

  ipcMain.handle(
    "domain-icon-as-url",
    (_event, iconPath: string) => DomainUtil.iconAsUrl(iconPath),
  );

  // Dialog IPC handlers
  ipcMain.handle(
    "show-error-box",
    (_event, title: string, content: string) => {
      dialog.showErrorBox(title, content);
    },
  );

  ipcMain.handle(
    "show-message-box",
    async (_event, options: Electron.MessageBoxOptions) =>
      dialog.showMessageBox(options),
  );

  ipcMain.handle(
    "show-open-dialog",
    async (_event, options: Electron.OpenDialogOptions) =>
      dialog.showOpenDialog(options),
  );

  // Clipboard operations
  ipcMain.handle("clipboard-write-text", (_event, text: string) => {
    clipboard.writeText(text);
  });

  // App info IPC handlers
  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle(
    "get-app-path",
    (_event, name: string) =>
      app.getPath(name as Parameters<typeof app.getPath>[0]),
  );

  ipcMain.handle("get-platform", () => process.platform);

  // WebContents IPC handlers
  ipcMain.handle(
    "wc-set-audio-muted",
    (_event, webContentsId: number, muted: boolean) => {
      webContents.fromId(webContentsId)?.setAudioMuted(muted);
    },
  );

  ipcMain.handle(
    "wc-get-url",
    (_event, webContentsId: number) =>
      webContents.fromId(webContentsId)?.getURL() ?? "",
  );

  ipcMain.handle("wc-zoom-in", (_event, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (wc) wc.zoomLevel += 0.5;
  });

  ipcMain.handle("wc-zoom-out", (_event, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (wc) wc.zoomLevel -= 0.5;
  });

  ipcMain.handle("wc-zoom-actual-size", (_event, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (wc) wc.zoomLevel = 0;
  });

  ipcMain.handle("wc-go-back", (_event, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (wc?.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
    }
  });

  ipcMain.handle("wc-go-forward", (_event, webContentsId: number) => {
    const wc = webContents.fromId(webContentsId);
    if (wc?.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
    }
  });

  ipcMain.handle(
    "wc-can-go-back",
    (_event, webContentsId: number) =>
      webContents.fromId(webContentsId)?.navigationHistory.canGoBack() ?? false,
  );

  ipcMain.handle(
    "wc-can-go-forward",
    (_event, webContentsId: number) =>
      webContents.fromId(webContentsId)?.navigationHistory.canGoForward() ??
      false,
  );

  ipcMain.handle("wc-reload", (_event, webContentsId: number) => {
    webContents.fromId(webContentsId)?.reload();
  });

  ipcMain.handle("wc-open-devtools", (_event, webContentsId: number) => {
    webContents.fromId(webContentsId)?.openDevTools();
  });

  ipcMain.handle(
    "wc-insert-css",
    async (_event, webContentsId: number, css: string) => {
      await webContents.fromId(webContentsId)?.insertCSS(css);
    },
  );

  ipcMain.handle(
    "wc-load-url",
    async (_event, webContentsId: number, url: string) => {
      await webContents.fromId(webContentsId)?.loadURL(url);
    },
  );

  // Session/proxy IPC handlers
  ipcMain.handle("set-proxy", async (_event, config) => {
    await ses.setProxy(config);
  });

  ipcMain.handle(
    "get-spellchecker-languages",
    () => ses.availableSpellCheckerLanguages,
  );

  // Custom CSS IPC handlers
  ipcMain.handle("read-custom-css", (_event, cssPath: string) => {
    try {
      return fs.readFileSync(cssPath, "utf8");
    } catch {
      return null;
    }
  });

  ipcMain.handle("custom-css-exists", (_event, cssPath: string) => {
    try {
      return fs.existsSync(cssPath);
    } catch {
      return false;
    }
  });

  // Factory reset
  ipcMain.handle("factory-reset", async () => {
    const getAppPath = path.join(app.getPath("appData"), app.name);
    await fs.promises.rm(getAppPath, {recursive: true, force: true});
  });

  // Context menu IPC handler
  ipcMain.handle(
    "show-context-menu",
    (_event, webContentsId: number, params: ContextMenuParams) => {
      showContextMenu(webContentsId, params);
    },
  );

  // Sidebar context menu
  ipcMain.handle("show-sidebar-context-menu", (_event, index: number) => {
    // Returns a promise that resolves to the action chosen
    return new Promise<string | undefined>((resolve) => {
      const template = [
        {
          label: t.__("Disconnect organization"),
          click() {
            resolve("disconnect");
          },
        },
        {
          label: t.__("Notification settings"),
          click() {
            resolve("notification-settings");
          },
        },
        {
          label: t.__("Copy Zulip URL"),
          click() {
            resolve("copy-url");
          },
        },
      ];
      const contextMenu = Menu.buildFromTemplate(template);
      contextMenu.popup({
        window: mainWindow,
        callback() {
          resolve(undefined);
        },
      });
    });
  });

  // Open browser link
  ipcMain.handle("open-browser", async (_event, urlString: string) => {
    const url = new URL(urlString);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) {
      await shell.openExternal(url.href);
    } else {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "zulip-redirect-"),
      );
      const file = path.join(directory, "redirect.html");
      fs.writeFileSync(
        file,
        html`
          <!doctype html>
          <html>
            <head>
              <meta charset="UTF-8" />
              <meta http-equiv="Refresh" content="0; url=${url.href}" />
              <title>${t.__("Redirecting")}</title>
              <style>
                html {
                  font-family: menu, "Helvetica Neue", sans-serif;
                }
              </style>
            </head>
            <body>
              <p>
                ${new Html({
                  html: t.__("Opening {{{link}}}…", {
                    link: html`<a href="${url.href}">${url.href}</a>`.html,
                  }),
                })}
              </p>
            </body>
          </html>
        `.html,
      );
      await shell.openPath(file);
      setTimeout(() => {
        fs.unlinkSync(file);
        fs.rmdirSync(directory);
      }, 15_000);
    }
  });

  // Tray IPC handlers
  ipcMain.handle("tray-init", (_event, shouldCreate: boolean) => {
    TrayUtil.initTray(shouldCreate);
  });

  ipcMain.handle("tray-destroy", () => {
    TrayUtil.destroyTray();
  });

  ipcMain.handle("tray-update", (_event, unreadCount: number) => {
    TrayUtil.updateTray(unreadCount);
  });

  ipcMain.handle("tray-toggle", () => {
    TrayUtil.toggleTray();
  });

  // Sync IPC: get all config at once for renderer cache
  ipcMain.on("get-all-config", (event) => {
    const settingsJsonPath = path.join(
      app.getPath("userData"),
      "/config/settings.json",
    );
    try {
      const file = fs.readFileSync(settingsJsonPath, "utf8");
      event.returnValue = JSON.parse(file) as Record<string, unknown>;
    } catch {
      event.returnValue = {};
    }
  });

  // Sync IPC: get enterprise config for renderer cache
  ipcMain.on("get-enterprise-config", (event) => {
    const hasConfig = EnterpriseUtil.hasConfigFile();
    const settings: Record<string, unknown> = {};
    if (hasConfig) {
      const keys = [
        "presetOrganizations",
        "autoUpdate",
        "autoHideMenubar",
        "trayIcon",
        "useManualProxy",
        "useSystemProxy",
        "showSidebar",
        "badgeOption",
        "startAtLogin",
        "startMinimized",
        "enableSpellchecker",
        "showNotification",
        "betaUpdate",
        "errorReporting",
        "customCSS",
        "silent",
        "dnd",
        "quitOnClose",
        "promptDownload",
        "flashTaskbarOnMessage",
        "dockBouncing",
        "spellcheckerLanguages",
      ] as const;
      for (const key of keys) {
        if (
          EnterpriseUtil.configItemExists(
            key as Parameters<typeof EnterpriseUtil.configItemExists>[0],
          )
        ) {
          settings[key] = EnterpriseUtil.getConfigItem(
            key as Parameters<typeof EnterpriseUtil.getConfigItem>[0],
            undefined as never,
          );
        }
      }
    }

    event.returnValue = {hasConfigFile: hasConfig, settings};
  });

  // Sync IPC: get translation catalog for renderer
  ipcMain.on("get-translation-catalog", (event) => {
    const locale = ConfigUtil.getConfigItem("appLanguage", "en") ?? "en";
    const translationPath = path.join(
      publicPath,
      "translations",
      `${locale}.json`,
    );
    try {
      event.returnValue = JSON.parse(
        fs.readFileSync(translationPath, "utf8"),
      ) as Record<string, string>;
    } catch {
      event.returnValue = {};
    }
  });

  // DND toggle
  ipcMain.handle("dnd-toggle", () => DNDUtil.toggle());

  // Execute JS to get webContentsId for webview
  ipcMain.handle(
    "wc-execute-js-get-webcontents-id",
    async (_event, selector: string) =>
      mainWindow.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(selector)})?.getWebContentsId()`,
      ) as Promise<number>,
  );

  // Dock operations (macOS)
  ipcMain.handle("dock-set-badge", (_event, badge: string) => {
    if (app.dock !== undefined) {
      app.dock.setBadge(badge);
    }
  });

  ipcMain.handle("dock-bounce", () => {
    if (app.dock !== undefined) {
      app.dock.bounce();
    }
  });

  AppMenu.setMenu({
    tabs: [],
  });
  mainWindow = createMainWindow();

  // Auto-hide menu bar on Windows + Linux
  if (process.platform !== "darwin") {
    const shouldHideMenu = ConfigUtil.getConfigItem("autoHideMenubar", false);
    mainWindow.autoHideMenuBar = shouldHideMenu;
    mainWindow.setMenuBarVisibility(!shouldHideMenu);
  }

  const page = mainWindow.webContents;

  // Set up context-menu listener for webview contents
  app.on("web-contents-created", (_event, contents: WebContents) => {
    contents.on("context-menu", (_event, params) => {
      // Forward context menu events for webview contents to our handler
      if (contents.id !== page.id) {
        showContextMenu(contents.id, {
          x: params.x,
          y: params.y,
          selectionText: params.selectionText,
          linkURL: params.linkURL,
          linkText: params.linkText,
          srcURL: params.srcURL,
          mediaType: params.mediaType,
          isEditable: params.isEditable,
          misspelledWord: params.misspelledWord,
          dictionarySuggestions: params.dictionarySuggestions,
          editFlags: {canCopy: params.editFlags.canCopy},
          menuSourceType: params.menuSourceType,
        });
      }
    });
  });

  page.on("dom-ready", () => {
    if (ConfigUtil.getConfigItem("startMinimized", false)) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  ipcMain.on("fetch-user-agent", (event) => {
    event.returnValue = session
      .fromPartition("persist:webviewsession")
      .getUserAgent();
  });

  ipcMain.handle("get-server-settings", async (event, domain: string) =>
    _getServerSettings(domain, ses),
  );

  ipcMain.handle("save-server-icon", async (event, url: string) =>
    _saveServerIcon(url, ses),
  );

  ipcMain.handle("is-online", async (event, url: string) =>
    _isOnline(url, ses),
  );

  page.once("did-frame-finish-load", async () => {
    // Initiate auto-updates on MacOS and Windows
    if (ConfigUtil.getConfigItem("autoUpdate", true)) {
      await appUpdater();
    }
  });

  app.on(
    "certificate-error",
    (
      event,
      webContents,
      urlString,
      error,
      certificate,
      callback,
      isMainFrame,
      // eslint-disable-next-line max-params
    ) => {
      if (isMainFrame) {
        const url = new URL(urlString);
        dialog.showErrorBox(
          t.__("Certificate error"),
          t.__(
            "The server presented an invalid certificate for {{{origin}}}:\n\n{{{error}}}",
            {origin: url.origin, error},
          ),
        );
      }
    },
  );

  ses.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const {origin} = new URL(details.requestingUrl);
      const permissionCallbackId = nextPermissionCallbackId++;
      permissionCallbacks.set(permissionCallbackId, callback);
      send(
        page,
        "permission-request",
        {
          webContentsId:
            webContents.id === mainWindow.webContents.id
              ? null
              : webContents.id,
          origin,
          permission,
        },
        permissionCallbackId,
      );
    },
  );

  ipcMain.on("focus-app", () => {
    mainWindow.show();
  });

  ipcMain.on("quit-app", () => {
    app.quit();
  });

  // Reload full app not just webview, useful in debugging
  ipcMain.on("reload-full-app", () => {
    mainWindow.reload();
    TrayUtil.destroyTray();
  });

  ipcMain.on("clear-app-settings", () => {
    mainWindowState.unmanage();
    app.relaunch();
    app.exit();
  });

  ipcMain.on("toggle-app", () => {
    toggleApp();
  });

  ipcMain.on("toggle-badge-option", () => {
    BadgeSettings.updateBadge(badgeCount, mainWindow);
  });

  ipcMain.on("toggle-menubar", (_event, showMenubar: boolean) => {
    mainWindow.autoHideMenuBar = showMenubar;
    mainWindow.setMenuBarVisibility(!showMenubar);
    send(page, "toggle-autohide-menubar", showMenubar, true);
  });

  ipcMain.on("update-badge", (_event, messageCount: number) => {
    badgeCount = messageCount;
    BadgeSettings.updateBadge(badgeCount, mainWindow);
    TrayUtil.updateTray(messageCount);
  });

  ipcMain.on("update-taskbar-icon", (_event, data: string, text: string) => {
    BadgeSettings.updateTaskbarIcon(data, text, mainWindow);
  });

  ipcMain.on(
    "forward-message",
    <Channel extends keyof RendererMessage>(
      _event: IpcMainEvent,
      listener: Channel,
      ...parameters: Parameters<RendererMessage[Channel]>
    ) => {
      send(page, listener, ...parameters);
    },
  );

  ipcMain.on(
    "forward-to",
    <Channel extends keyof RendererMessage>(
      _event: IpcMainEvent,
      webContentsId: number,
      listener: Channel,
      ...parameters: Parameters<RendererMessage[Channel]>
    ) => {
      const contents = webContents.fromId(webContentsId);
      if (contents !== undefined) {
        send(contents, listener, ...parameters);
      }
    },
  );

  ipcMain.on("update-menu", (_event, properties: MenuProperties) => {
    AppMenu.setMenu(properties);
    if (properties.activeTabIndex !== undefined) {
      const activeTab = properties.tabs[properties.activeTabIndex];
      mainWindow.setTitle(`Zulip - ${activeTab.label}`);
    }
  });

  ipcMain.on("toggleAutoLauncher", async (_event, AutoLaunchValue: boolean) => {
    await setAutoLaunch(AutoLaunchValue);
  });

  ipcMain.on(
    "realm-name-changed",
    (_event, serverURL: string, realmName: string) => {
      // Update domain in main-process storage
      const domains = DomainUtil.getDomains();
      for (const [index, domain] of domains.entries()) {
        if (domain.url === serverURL) {
          domain.alias = realmName;
          DomainUtil.updateDomain(index, domain);
        }
      }

      send(page, "update-realm-name", serverURL, realmName);
    },
  );

  ipcMain.on(
    "realm-icon-changed",
    async (_event, serverURL: string, iconURL: string) => {
      // Save icon and update domain in main process
      const localIconPath = await _saveServerIcon(iconURL, ses);
      const domains = DomainUtil.getDomains();
      for (const [index, domain] of domains.entries()) {
        if (domain.url === serverURL) {
          domain.icon = localIconPath ?? domain.icon;
          DomainUtil.updateDomain(index, domain);
          send(
            page,
            "update-realm-icon",
            serverURL,
            DomainUtil.iconAsUrl(domain.icon),
          );
        }
      }
    },
  );

  ipcMain.on("save-last-tab", (_event, index: number) => {
    ConfigUtil.setConfigItem("lastActiveTab", index);
  });

  ipcMain.on("focus-this-webview", (event) => {
    send(page, "focus-webview-with-id", event.sender.id);
    mainWindow.show();
  });

  // Update user idle status for each realm after every 15s
  const idleCheckInterval = 15 * 1000; // 15 seconds
  setInterval(() => {
    // Set user idle if no activity in 1 second (idleThresholdSeconds)
    const idleThresholdSeconds = 1; // 1 second
    const idleState = powerMonitor.getSystemIdleState(idleThresholdSeconds);
    if (idleState === "active") {
      send(page, "set-active");
    } else {
      send(page, "set-idle");
    }
  }, idleCheckInterval);
})();

app.on("before-quit", () => {
  isQuitting = true;
});

// Send crash reports
process.on("uncaughtException", (error) => {
  console.error(error);
  console.error(error.stack);
});
