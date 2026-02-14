import {clipboard} from "electron/common";
import {BrowserWindow, Menu, webContents} from "electron/main";
import process from "node:process";

import type {MenuItemConstructorOptions} from "electron/main";

import * as t from "../common/translation-util.ts";
import type {ContextMenuParams} from "../common/typed-ipc.ts";

export function showContextMenu(
  webContentsId: number,
  params: ContextMenuParams,
): void {
  const contents = webContents.fromId(webContentsId);
  if (!contents) return;

  const isText = params.selectionText !== "";
  const isLink = params.linkURL !== "";
  const linkUrl = isLink ? new URL(params.linkURL) : undefined;

  const makeSuggestion = (suggestion: string) => ({
    label: suggestion,
    visible: true,
    async click() {
      await contents.insertText(suggestion);
    },
  });

  let menuTemplate: MenuItemConstructorOptions[] = [
    {
      label: t.__("Add to Dictionary"),
      visible:
        params.isEditable && isText && params.misspelledWord.length > 0,
      click(_item) {
        contents.session.addWordToSpellCheckerDictionary(
          params.misspelledWord,
        );
      },
    },
    {
      type: "separator",
      visible:
        params.isEditable && isText && params.misspelledWord.length > 0,
    },
    {
      label: `${t.__("Look Up")} "${params.selectionText}"`,
      visible: process.platform === "darwin" && isText,
      click(_item) {
        contents.showDefinitionForSelection();
      },
    },
    {
      type: "separator",
      visible: process.platform === "darwin" && isText,
    },
    {
      label: t.__("Cut"),
      visible: isText,
      enabled: params.isEditable,
      accelerator: "CommandOrControl+X",
      click(_item) {
        contents.cut();
      },
    },
    {
      label: t.__("Copy"),
      accelerator: "CommandOrControl+C",
      enabled: params.editFlags.canCopy,
      click(_item) {
        contents.copy();
      },
    },
    {
      label: t.__("Paste"),
      accelerator: "CommandOrControl+V",
      enabled: params.isEditable,
      click() {
        contents.paste();
      },
    },
    {
      type: "separator",
    },
    {
      label:
        linkUrl?.protocol === "mailto:"
          ? t.__("Copy Email Address")
          : t.__("Copy Link"),
      visible: isLink,
      click(_item) {
        clipboard.write({
          bookmark: params.linkText,
          text:
            linkUrl?.protocol === "mailto:"
              ? linkUrl.pathname
              : params.linkURL,
        });
      },
    },
    {
      label: t.__("Copy Image"),
      visible: params.mediaType === "image",
      click(_item) {
        contents.copyImageAt(params.x, params.y);
      },
    },
    {
      label: t.__("Copy Image URL"),
      visible: params.mediaType === "image",
      click(_item) {
        clipboard.write({
          bookmark: params.srcURL,
          text: params.srcURL,
        });
      },
    },
  ];

  if (params.misspelledWord) {
    if (params.dictionarySuggestions.length > 0) {
      const suggestions: MenuItemConstructorOptions[] =
        params.dictionarySuggestions.map((suggestion: string) =>
          makeSuggestion(suggestion),
        );
      menuTemplate = [...suggestions, ...menuTemplate];
    } else {
      menuTemplate.unshift({
        label: t.__("No Suggestion Found"),
        enabled: false,
      });
    }
  }

  const filteredMenuTemplate = menuTemplate.filter(
    (menuItem) => menuItem.visible ?? true,
  );
  const menu = Menu.buildFromTemplate(filteredMenuTemplate);
  menu.popup({
    window: BrowserWindow.fromWebContents(contents) ?? undefined,
    x: params.x,
    y: params.y,
  });
}
