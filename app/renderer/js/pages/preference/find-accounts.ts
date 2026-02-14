import {html} from "../../../../common/html.ts";
import {generateNodeFromHtml} from "../../components/base.ts";
import {ipcRenderer} from "../../typed-ipc-renderer.ts";
import * as t from "../../utils/translation-ipc.ts";

type FindAccountsProperties = {
  $root: Element;
};

async function findAccounts(url: string): Promise<void> {
  if (!url) {
    return;
  }

  if (!url.startsWith("http")) {
    url = "https://" + url;
  }

  await ipcRenderer.invoke(
    "open-browser",
    new URL("/accounts/find", url).href,
  );
}

export function initFindAccounts(properties: FindAccountsProperties): void {
  const $findAccounts = generateNodeFromHtml(html`
    <div class="settings-card certificate-card">
      <div class="certificate-input">
        <div>${t.__("Organization URL")}</div>
        <input class="setting-input-value" value="zulipchat.com" />
      </div>
      <div class="certificate-input">
        <button class="green w-150" id="find-accounts-button">
          ${t.__("Find accounts")}
        </button>
      </div>
    </div>
  `);
  properties.$root.append($findAccounts);
  const $findAccountsButton = $findAccounts.querySelector(
    "#find-accounts-button",
  )!;
  const $serverUrlField: HTMLInputElement = $findAccounts.querySelector(
    "input.setting-input-value",
  )!;

  $findAccountsButton.addEventListener("click", async () => {
    await findAccounts($serverUrlField.value);
  });

  $serverUrlField.addEventListener("click", () => {
    if ($serverUrlField.value === "zulipchat.com") {
      $serverUrlField.setSelectionRange(0, 0);
    }
  });

  $serverUrlField.addEventListener("keypress", async (event) => {
    if (event.key === "Enter") {
      await findAccounts($serverUrlField.value);
    }
  });

  $serverUrlField.addEventListener("input", () => {
    $serverUrlField.classList.toggle(
      "invalid-input-value",
      $serverUrlField.value === "",
    );
  });
}
