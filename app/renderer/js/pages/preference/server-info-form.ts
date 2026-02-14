import {html} from "../../../../common/html.ts";
import type {ServerConfig} from "../../../../common/types.ts";
import {generateNodeFromHtml} from "../../components/base.ts";
import {ipcRenderer} from "../../typed-ipc-renderer.ts";
import * as DomainUtil from "../../utils/domain-util.ts";
import * as Messages from "../../utils/messages.ts";
import * as t from "../../utils/translation-ipc.ts";

type ServerInfoFormProperties = {
  $root: Element;
  server: ServerConfig;
  index: number;
  onChange: () => void;
};

export function initServerInfoForm(properties: ServerInfoFormProperties): void {
  const $serverInfoForm = generateNodeFromHtml(html`
    <div class="settings-card">
      <div class="server-info-left">
        <img
          class="server-info-icon"
          src="${properties.server.icon}"
        />
        <div class="server-info-row">
          <span class="server-info-alias">${properties.server.alias}</span>
          <i class="material-icons open-tab-button">open_in_new</i>
        </div>
      </div>
      <div class="server-info-right">
        <div class="server-info-row server-url">
          <span class="server-url-info" title="${properties.server.url}"
            >${properties.server.url}</span
          >
        </div>
        <div class="server-info-row">
          <div class="action red server-delete-action">
            <span>${t.__("Disconnect")}</span>
          </div>
        </div>
      </div>
    </div>
  `);
  const $serverInfoAlias = $serverInfoForm.querySelector(".server-info-alias")!;
  const $serverIcon = $serverInfoForm.querySelector(".server-info-icon")!;
  const $deleteServerButton = $serverInfoForm.querySelector(
    ".server-delete-action",
  )!;
  const $openServerButton = $serverInfoForm.querySelector(".open-tab-button")!;
  properties.$root.append($serverInfoForm);

  $deleteServerButton.addEventListener("click", async () => {
    const {response} = await ipcRenderer.invoke("show-message-box", {
      type: "warning",
      buttons: [t.__("Yes"), t.__("No")],
      defaultId: 0,
      message: t.__("Are you sure you want to disconnect this organization?"),
    });
    if (response === 0) {
      if (await DomainUtil.removeDomain(properties.index)) {
        ipcRenderer.send("reload-full-app");
      } else {
        const domain = await DomainUtil.getDomain(properties.index);
        const {title, content} = Messages.orgRemovalError(domain.url);
        await ipcRenderer.invoke("show-error-box", title, content);
      }
    }
  });

  $openServerButton.addEventListener("click", () => {
    ipcRenderer.send("forward-message", "switch-server-tab", properties.index);
  });

  $serverInfoAlias.addEventListener("click", () => {
    ipcRenderer.send("forward-message", "switch-server-tab", properties.index);
  });

  $serverIcon.addEventListener("click", () => {
    ipcRenderer.send("forward-message", "switch-server-tab", properties.index);
  });
}
