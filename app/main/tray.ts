import path from "node:path";
import process from "node:process";

import {nativeImage} from "electron/common";
import {BrowserWindow, Menu, Tray} from "electron/main";

import * as ConfigUtil from "../common/config-util.ts";
import {publicPath} from "../common/paths.ts";
import * as t from "../common/translation-util.ts";

import {send} from "./typed-ipc-main.ts";

let tray: Tray | null = null;
const appIcon = path.join(publicPath, "resources/tray/tray");

const iconPath = (): string => {
  if (process.platform === "linux") {
    return appIcon + "linux.png";
  }

  return (
    appIcon + (process.platform === "win32" ? "win.ico" : "macOSTemplate.png")
  );
};

const winUnreadTrayIconPath = (): string => appIcon + "unread.ico";

let unread = 0;

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

function createTray(): void {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: t.__("Zulip"),
      click() {
        getMainWindow()?.show();
      },
    },
    {
      label: t.__("Settings"),
      click() {
        const win = getMainWindow();
        if (win) {
          win.show();
          send(win.webContents, "open-settings");
        }
      },
    },
    {
      type: "separator",
    },
    {
      label: t.__("Quit"),
      click() {
        const {app} = require("electron/main") as typeof import("electron/main");
        app.quit();
      },
    },
  ]);
  tray = new Tray(iconPath());
  tray.setContextMenu(contextMenu);
  if (process.platform === "linux" || process.platform === "win32") {
    tray.on("click", () => {
      const win = getMainWindow();
      if (win) {
        if (!win.isVisible() || win.isMinimized()) {
          win.show();
        } else {
          win.hide();
        }
      }
    });
  }
}

export function initTray(shouldCreate: boolean): void {
  if (shouldCreate) {
    createTray();
  }
}

export function destroyTray(): void {
  if (!tray) {
    return;
  }

  tray.destroy();
  if (tray.isDestroyed()) {
    tray = null;
  }
}

export function updateTray(unreadCount: number): void {
  if (!tray) {
    return;
  }

  unread = unreadCount;

  if (process.platform === "linux" || process.platform === "win32") {
    if (unreadCount === 0) {
      tray.setImage(iconPath());
      tray.setToolTip(t.__("No unread messages"));
    } else {
      if (process.platform === "win32") {
        tray.setImage(nativeImage.createFromPath(winUnreadTrayIconPath()));
      } else {
        tray.setImage(iconPath());
      }

      tray.setToolTip(
        t.__mf(
          "{number, plural, one {# unread message} other {# unread messages}}",
          {number: `${unreadCount}`},
        ),
      );
    }
  }
}

export function toggleTray(): void {
  if (tray) {
    tray.destroy();
    if (tray.isDestroyed()) {
      tray = null;
    }

    ConfigUtil.setConfigItem("trayIcon", false);
  } else {
    createTray();
    if (process.platform === "linux" || process.platform === "win32") {
      updateTray(unread);
    }

    ConfigUtil.setConfigItem("trayIcon", true);
  }

  // Notify renderer about the tray state change
  const win = getMainWindow();
  if (win) {
    send(win.webContents, "toggle-tray", tray !== null);
  }
}
