import {type Html, html} from "../../../common/html.ts";
import type {RendererMessage} from "../../../common/typed-ipc.ts";
import type {TabRole} from "../../../common/types.ts";
import preloadCss from "../../css/preload.css?raw";
import {ipcRenderer} from "../typed-ipc-renderer.ts";
import * as ConfigUtil from "../utils/config-ipc.ts";
import * as SystemUtil from "../utils/system-util.ts";
import * as t from "../utils/translation-ipc.ts";

import {generateNodeFromHtml} from "./base.ts";

const shouldSilentWebview = ConfigUtil.getConfigItem("silent", false);

type WebViewProperties = {
  $root: Element;
  index: number;
  tabIndex: number;
  url: string;
  role: TabRole;
  isActive: () => boolean;
  switchLoading: (loading: boolean, url: string) => void;
  onNetworkError: (index: number) => void;
  preload?: string;
  onTitleChange: () => void;
  hasPermission?: (origin: string, permission: string) => boolean;
  unsupportedMessage?: string;
};

export default class WebView {
  static templateHtml(properties: WebViewProperties): Html {
    return html`
      <div class="webview-pane">
        <div
          class="webview-unsupported"
          ${properties.unsupportedMessage === undefined ? html`hidden` : html``}
        >
          <span class="webview-unsupported-message"
            >${properties.unsupportedMessage ?? ""}</span
          >
          <span class="webview-unsupported-dismiss">×</span>
        </div>
        <webview
          data-tab-id="${properties.tabIndex}"
          src="${properties.url}"
          ${properties.preload === undefined
            ? html``
            : html`preload="${properties.preload}"`}
          partition="persist:webviewsession"
          allowpopups
        >
        </webview>
      </div>
    `;
  }

  static async create(properties: WebViewProperties): Promise<WebView> {
    const $pane = generateNodeFromHtml(
      WebView.templateHtml(properties),
    ) as HTMLElement;
    properties.$root.append($pane);

    const $webview: HTMLElement = $pane.querySelector(":scope > webview")!;
    await new Promise<void>((resolve) => {
      $webview.addEventListener(
        "did-attach",
        () => {
          resolve();
        },
        true,
      );
    });

    // Work around https://github.com/electron/electron/issues/26904
    const selector = `webview[data-tab-id="${CSS.escape(
      `${properties.tabIndex}`,
    )}"]`;
    const webContentsId: unknown = await ipcRenderer.invoke(
      "wc-execute-js-get-webcontents-id",
      selector,
    );
    if (typeof webContentsId !== "number") {
      throw new TypeError("Failed to get WebContents ID");
    }

    return new WebView(properties, $pane, $webview, webContentsId);
  }

  badgeCount = 0;
  loading = true;
  private customCss: string | false | null;
  private readonly $webviewsContainer: DOMTokenList;
  private readonly $unsupported: HTMLElement;
  private readonly $unsupportedMessage: HTMLElement;
  private readonly $unsupportedDismiss: HTMLElement;
  private unsupportedDismissed = false;

  private constructor(
    readonly properties: WebViewProperties,
    private readonly $pane: HTMLElement,
    private readonly $webview: HTMLElement,
    readonly webContentsId: number,
  ) {
    this.customCss = ConfigUtil.getConfigItem("customCSS", null);
    this.$webviewsContainer = document.querySelector(
      "#webviews-container",
    )!.classList;
    this.$unsupported = $pane.querySelector(".webview-unsupported")!;
    this.$unsupportedMessage = $pane.querySelector(
      ".webview-unsupported-message",
    )!;
    this.$unsupportedDismiss = $pane.querySelector(
      ".webview-unsupported-dismiss",
    )!;

    this.registerListeners();
  }

  destroy(): void {
    this.$pane.remove();
  }

  async getUrl(): Promise<string> {
    return ipcRenderer.invoke("wc-get-url", this.webContentsId);
  }

  async setAudioMuted(muted: boolean): Promise<void> {
    await ipcRenderer.invoke("wc-set-audio-muted", this.webContentsId, muted);
  }

  showNotificationSettings(): void {
    this.send("show-notification-settings");
    this.focus();
  }

  focus(): void {
    this.$webview.focus();
    // Work around https://github.com/electron/electron/issues/31918
    this.$webview.shadowRoot?.querySelector("iframe")?.focus();
  }

  hide(): void {
    this.$pane.classList.remove("active");
  }

  load(): void {
    this.show();
  }

  async zoomIn(): Promise<void> {
    await ipcRenderer.invoke("wc-zoom-in", this.webContentsId);
  }

  async zoomOut(): Promise<void> {
    await ipcRenderer.invoke("wc-zoom-out", this.webContentsId);
  }

  async zoomActualSize(): Promise<void> {
    await ipcRenderer.invoke("wc-zoom-actual-size", this.webContentsId);
  }

  logOut(): void {
    this.send("logout");
  }

  showKeyboardShortcuts(): void {
    this.send("show-keyboard-shortcuts");
    this.focus();
  }

  async openDevTools(): Promise<void> {
    await ipcRenderer.invoke("wc-open-devtools", this.webContentsId);
  }

  async back(): Promise<void> {
    if (await ipcRenderer.invoke("wc-can-go-back", this.webContentsId)) {
      await ipcRenderer.invoke("wc-go-back", this.webContentsId);
      this.focus();
    }
  }

  async canGoBackButton(): Promise<void> {
    const $backButton = document.querySelector(
      "#actions-container #back-action",
    )!;
    const canGoBack = await ipcRenderer.invoke(
      "wc-can-go-back",
      this.webContentsId,
    );
    $backButton.classList.toggle("disable", !canGoBack);
  }

  async forward(): Promise<void> {
    if (await ipcRenderer.invoke("wc-can-go-forward", this.webContentsId)) {
      await ipcRenderer.invoke("wc-go-forward", this.webContentsId);
    }
  }

  async reload(): Promise<void> {
    this.hide();
    // Shows the loading indicator till the webview is reloaded
    this.$webviewsContainer.remove("loaded");
    this.loading = true;
    this.properties.switchLoading(true, this.properties.url);
    await ipcRenderer.invoke("wc-reload", this.webContentsId);
  }

  async loadUrl(url: string): Promise<void> {
    await ipcRenderer.invoke("wc-load-url", this.webContentsId, url);
  }

  setUnsupportedMessage(unsupportedMessage: string | undefined) {
    this.$unsupported.hidden =
      unsupportedMessage === undefined || this.unsupportedDismissed;
    this.$unsupportedMessage.textContent = unsupportedMessage ?? "";
  }

  send<Channel extends keyof RendererMessage>(
    channel: Channel,
    ...arguments_: Parameters<RendererMessage[Channel]>
  ): void {
    ipcRenderer.send("forward-to", this.webContentsId, channel, ...arguments_);
  }

  private registerListeners(): void {
    if (shouldSilentWebview) {
      void this.setAudioMuted(true);
    }

    // Use webview DOM events instead of webContents events
    this.$webview.addEventListener(
      "page-title-updated",
      (event: Event & {title?: string}) => {
        this.badgeCount = this.getBadgeCount(event.title ?? "");
        this.properties.onTitleChange();
      },
    );

    this.$webview.addEventListener("did-navigate-in-page", () => {
      void this.canGoBackButton();
    });

    this.$webview.addEventListener("did-navigate", () => {
      void this.canGoBackButton();
    });

    this.$webview.addEventListener(
      "page-favicon-updated",
      (event: Event & {favicons?: string[]}) => {
        const favicons = event.favicons ?? [];
        if (
          favicons.length > 0 &&
          favicons[0].indexOf("favicon-pms") > 0
        ) {
          void ipcRenderer.invoke("dock-set-badge", "●");
          if (ConfigUtil.getConfigItem("dockBouncing", true)) {
            void ipcRenderer.invoke("dock-bounce");
          }
        }
      },
    );

    // Context menu is handled in main process via web-contents-created listener

    this.$webview.addEventListener("dom-ready", () => {
      this.loading = false;
      this.properties.switchLoading(false, this.properties.url);
      this.show();
    });

    this.$webview.addEventListener(
      "did-fail-load",
      (event: Event & {errorDescription?: string}) => {
        const errorDescription = event.errorDescription ?? "";
        const hasConnectivityError =
          SystemUtil.connectivityError.includes(errorDescription);
        if (hasConnectivityError) {
          console.error("error", errorDescription);
          if (!this.properties.url.includes("network.html")) {
            this.properties.onNetworkError(this.properties.index);
          }
        }
      },
    );

    this.$webview.addEventListener("did-start-loading", () => {
      this.properties.switchLoading(true, this.properties.url);
    });

    this.$webview.addEventListener("did-stop-loading", () => {
      this.properties.switchLoading(false, this.properties.url);
    });

    this.$unsupportedDismiss.addEventListener("click", () => {
      this.unsupportedDismissed = true;
      this.$unsupported.hidden = true;
    });

    // zoom-changed is not available as a webview DOM event;
    // zoom is handled via menu/keyboard shortcuts through IPC
  }

  private getBadgeCount(title: string): number {
    const messageCountInTitle = /^\((\d+)\)/.exec(title);
    return messageCountInTitle ? Number(messageCountInTitle[1]) : 0;
  }

  private show(): void {
    // Do not show WebView if another tab was selected and this tab should be in background.
    if (!this.properties.isActive()) {
      return;
    }

    // To show or hide the loading indicator in the active tab
    this.$webviewsContainer.toggle("loaded", !this.loading);

    this.$pane.classList.add("active");
    this.focus();
    this.properties.onTitleChange();
    // Injecting preload css in webview to override some css rules
    void ipcRenderer.invoke("wc-insert-css", this.webContentsId, preloadCss);

    // Get customCSS again from config util to avoid warning user again
    const customCss = ConfigUtil.getConfigItem("customCSS", null);
    this.customCss = customCss;
    if (customCss) {
      void (async () => {
        const exists = await ipcRenderer.invoke("custom-css-exists", customCss);
        if (!exists) {
          this.customCss = null;
          ConfigUtil.setConfigItem("customCSS", null);
          await ipcRenderer.invoke(
            "show-error-box",
            t.__("Custom CSS file deleted"),
            t.__("The custom CSS previously set is deleted."),
          );
          return;
        }

        const cssContent = await ipcRenderer.invoke(
          "read-custom-css",
          customCss,
        );
        if (cssContent) {
          await ipcRenderer.invoke(
            "wc-insert-css",
            this.webContentsId,
            cssContent,
          );
        }
      })();
    }
  }
}
