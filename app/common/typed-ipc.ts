import type {DndSettings} from "./dnd-util.ts";
import type {MenuProperties, ServerConfig} from "./types.ts";

export type ContextMenuParams = {
  x: number;
  y: number;
  selectionText: string;
  linkURL: string;
  linkText: string;
  srcURL: string;
  mediaType: string;
  isEditable: boolean;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: {canCopy: boolean};
  menuSourceType: string;
  frameId?: number;
};

export type MainMessage = {
  "clear-app-settings": () => void;
  "configure-spell-checker": () => void;
  "fetch-user-agent": () => string;
  "focus-app": () => void;
  "focus-this-webview": () => void;
  "get-all-config": () => Record<string, unknown>;
  "get-enterprise-config": () => {
    hasConfigFile: boolean;
    settings: Record<string, unknown>;
  };
  "get-translation-catalog": () => Record<string, string>;
  "new-clipboard-key": () => {key: Uint8Array; sig: Uint8Array};
  "permission-callback": (permissionCallbackId: number, grant: boolean) => void;
  "quit-app": () => void;
  "realm-icon-changed": (serverURL: string, iconURL: string) => void;
  "realm-name-changed": (serverURL: string, realmName: string) => void;
  "reload-full-app": () => void;
  "save-last-tab": (index: number) => void;
  "switch-server-tab": (index: number) => void;
  "toggle-app": () => void;
  "toggle-badge-option": (newValue: boolean) => void;
  "toggle-menubar": (showMenubar: boolean) => void;
  toggleAutoLauncher: (AutoLaunchValue: boolean) => void;
  "unread-count": (unreadCount: number) => void;
  "update-badge": (messageCount: number) => void;
  "update-menu": (properties: MenuProperties) => void;
  "update-taskbar-icon": (data: string, text: string) => void;
};

export type MainCall = {
  "get-server-settings": (domain: string) => ServerConfig;
  "is-online": (url: string) => boolean;
  "poll-clipboard": (key: Uint8Array, sig: Uint8Array) => string | undefined;
  "save-server-icon": (iconURL: string) => string | null;

  // Config operations (replaces direct config-util access from renderer)
  "get-config-item": (key: string) => unknown;
  "set-config-item": (
    key: string,
    value: unknown,
    override?: boolean,
  ) => void;
  "is-config-item-exists": (key: string) => boolean;
  "remove-config-item": (key: string) => void;

  // Enterprise operations (replaces direct enterprise-util access)
  "enterprise-has-config-file": () => boolean;
  "enterprise-get-config-item": (key: string, defaultValue: unknown) => unknown;
  "enterprise-config-item-exists": (key: string) => boolean;
  "enterprise-is-preset-org": (url: string) => boolean;

  // Domain operations (replaces direct domain-util fs access)
  "domain-get-domains": () => ServerConfig[];
  "domain-get-domain": (index: number) => ServerConfig;
  "domain-update-domain": (index: number, server: ServerConfig) => void;
  "domain-add-domain": (server: {
    url: string;
    alias: string;
    icon?: string;
  }) => void;
  "domain-remove-domains": () => void;
  "domain-remove-domain": (index: number) => boolean;
  "domain-check-domain": (domain: string, silent?: boolean) => ServerConfig;
  "domain-update-saved-server": (url: string, index: number) => ServerConfig;
  "domain-icon-as-url": (iconPath: string) => string;

  // Dialog operations (replaces @electron/remote dialog access)
  "show-error-box": (title: string, content: string) => void;
  "show-message-box": (options: Electron.MessageBoxOptions) => {
    response: number;
    checkboxChecked: boolean;
  };
  "show-open-dialog": (
    options: Electron.OpenDialogOptions,
  ) => Electron.OpenDialogReturnValue;

  // App info (replaces @electron/remote app access)
  "get-app-version": () => string;
  "get-app-path": (name: string) => string;
  "get-platform": () => string;

  // WebContents operations (replaces remote.webContents access)
  "wc-set-audio-muted": (webContentsId: number, muted: boolean) => void;
  "wc-get-url": (webContentsId: number) => string;
  "wc-zoom-in": (webContentsId: number) => void;
  "wc-zoom-out": (webContentsId: number) => void;
  "wc-zoom-actual-size": (webContentsId: number) => void;
  "wc-go-back": (webContentsId: number) => void;
  "wc-go-forward": (webContentsId: number) => void;
  "wc-can-go-back": (webContentsId: number) => boolean;
  "wc-can-go-forward": (webContentsId: number) => boolean;
  "wc-reload": (webContentsId: number) => void;
  "wc-open-devtools": (webContentsId: number) => void;
  "wc-insert-css": (webContentsId: number, css: string) => void;
  "wc-load-url": (webContentsId: number, url: string) => void;
  "wc-execute-js-get-webcontents-id": (selector: string) => number;

  // Session/proxy operations (replaces @electron/remote session access)
  "set-proxy": (
    config:
      | {mode: "system"}
      | {mode: "direct"}
      | {pacScript: string; proxyRules: string; proxyBypassRules: string},
  ) => void;
  "get-spellchecker-languages": () => string[];

  // Custom CSS file operations
  "read-custom-css": (cssPath: string) => string | null;
  "custom-css-exists": (cssPath: string) => boolean;

  // Factory reset
  "factory-reset": () => void;

  // Context menu (built in main process)
  "show-context-menu": (
    webContentsId: number,
    params: ContextMenuParams,
  ) => void;

  // Sidebar context menu
  "show-sidebar-context-menu": (index: number) => string | undefined;

  // Open browser link (replaces link-util fs access)
  "open-browser": (url: string) => void;

  // DND toggle (replaces dnd-util direct access)
  "dnd-toggle": () => {dnd: boolean; newSettings: Partial<DndSettings>};

  // Tray operations
  "tray-init": (shouldCreate: boolean) => void;
  "tray-destroy": () => void;
  "tray-update": (unreadCount: number) => void;
  "tray-toggle": () => void;

  // Dock operations (macOS)
  "dock-set-badge": (badge: string) => void;
  "dock-bounce": () => void;
};

export type RendererMessage = {
  back: () => void;
  "copy-zulip-url": () => void;
  "enter-fullscreen": () => void;
  focus: () => void;
  "focus-webview-with-id": (webviewId: number) => void;
  forward: () => void;
  "hard-reload": () => void;
  "leave-fullscreen": () => void;
  "log-out": () => void;
  logout: () => void;
  "new-server": () => void;
  "open-about": () => void;
  "open-help": () => void;
  "open-network-settings": () => void;
  "open-org-tab": () => void;
  "open-settings": () => void;
  "permission-request": (
    options: {webContentsId: number | null; origin: string; permission: string},
    rendererCallbackId: number,
  ) => void;
  "play-ding-sound": () => void;
  "reload-current-viewer": () => void;
  "reload-proxy": (showAlert: boolean) => void;
  "reload-viewer": () => void;
  "render-taskbar-icon": (messageCount: number) => void;
  "set-active": () => void;
  "set-idle": () => void;
  "show-keyboard-shortcuts": () => void;
  "show-notification-settings": () => void;
  "switch-server-tab": (index: number) => void;
  "tab-devtools": () => void;
  "toggle-autohide-menubar": (
    autoHideMenubar: boolean,
    updateMenu: boolean,
  ) => void;
  "toggle-dnd": (state: boolean, newSettings: Partial<DndSettings>) => void;
  "toggle-sidebar": (show: boolean) => void;
  "toggle-silent": (state: boolean) => void;
  "toggle-tray": (state: boolean) => void;
  "update-realm-icon": (serverURL: string, iconURL: string) => void;
  "update-realm-name": (serverURL: string, realmName: string) => void;
  "webview-reload": () => void;
  zoomActualSize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};
