/**
 * Advanced settings tab — developer mode, hardware acceleration, debug tools,
 * and cache management.
 */

import { createElement, appendChildren } from "@lib/dom";
import { invoke } from "@tauri-apps/api/core";
import { appLogDir, join } from "@tauri-apps/api/path";
import { readDir, remove } from "@tauri-apps/plugin-fs";
import { createLogger } from "@lib/logger";
import { clearPendingPersistedLogs } from "@lib/logPersistence";
import { clearAttachmentCaches } from "@components/message-list/attachments";
import { clearEmbedCaches } from "@components/message-list/embeds";
import { clearMediaCaches } from "@components/message-list/media";
import { checkForUpdate, downloadAndInstallUpdate } from "@lib/updater";
import { loadPref, savePref, createToggle } from "./helpers";

const log = createLogger("AdvancedTab");
const IMAGE_CACHE_DELETE_BLOCK_TIMEOUT_MS = 1000;

export interface AdvancedTabOptions {
  readonly updateServerUrl?: string | null;
}

export function buildAdvancedTab(
  signal: AbortSignal,
  options?: AdvancedTabOptions,
): HTMLDivElement {
  const section = createElement("div", { class: "settings-pane active" });

  // ---- Toggles ---------------------------------------------------------------

  const toggles: ReadonlyArray<{ key: string; label: string; desc: string; fallback: boolean }> = [
    {
      key: "developerMode",
      label: "Режим разработчика",
      desc: "Показывать ID сообщений, пользователей и каналов в контекстном меню",
      fallback: false,
    },
    {
      key: "hardwareAcceleration",
      label: "Аппаратное ускорение",
      desc: "Использовать GPU для рендеринга. Требуется перезапуск",
      fallback: true,
    },
  ];

  for (const item of toggles) {
    const row = createElement("div", { class: "setting-row" });
    const info = createElement("div", {});
    const label = createElement("div", { class: "setting-label" }, item.label);
    const desc = createElement("div", { class: "setting-desc" }, item.desc);
    appendChildren(info, label, desc);

    const isOn = loadPref<boolean>(item.key, item.fallback);
    const toggle = createToggle(isOn, {
      signal,
      onChange: (nowOn) => { savePref(item.key, nowOn); },
    });

    appendChildren(row, info, toggle);
    section.appendChild(row);
  }

  // ---- Separator -------------------------------------------------------------

  const sep = createElement("div", { class: "settings-separator" });
  section.appendChild(sep);

  // ---- Debug section ---------------------------------------------------------

  const debugTitle = createElement("div", { class: "settings-section-title" }, "Отладка");
  section.appendChild(debugTitle);

  // DevTools button row
  const devtoolsRow = createElement("div", { class: "setting-row" });
  const devtoolsInfo = createElement("div", {});
  const devtoolsLabel = createElement("div", { class: "setting-label" }, "Открыть DevTools");
  const devtoolsDesc = createElement("div", { class: "setting-desc" }, "Открыть инструменты разработчика");
  appendChildren(devtoolsInfo, devtoolsLabel, devtoolsDesc);

  const devtoolsBtn = createElement("button", { class: "ac-btn" }, "Открыть");
  devtoolsBtn.addEventListener("click", () => {
    void invoke("open_devtools").catch((err: unknown) => {
      log.warn("DevTools not available", { error: err instanceof Error ? err.message : String(err) });
    });
  }, { signal });

  appendChildren(devtoolsRow, devtoolsInfo, devtoolsBtn);
  section.appendChild(devtoolsRow);

  // ---- Storage & Cache section ------------------------------------------------

  const cacheSep = createElement("div", { class: "settings-separator" });
  section.appendChild(cacheSep);

  const cacheTitle = createElement("div", { class: "settings-section-title" }, "Хранилище и кэш");
  section.appendChild(cacheTitle);

  // Clear Image Cache
  section.appendChild(buildCacheRow(
    "Очистить кэш изображений",
    "Удалить кэш изображений и предпросмотров ссылок. Они загрузятся заново при необходимости.",
    "Очистить",
    signal,
    async (btn) => {
      btn.textContent = "Очистка...";
      btn.setAttribute("disabled", "");
      try {
        await clearImageCache();
        btn.textContent = "Готово";
        setTimeout(() => { btn.textContent = "Очистить"; btn.removeAttribute("disabled"); }, 2000);
      } catch (err) {
        log.error("Failed to clear image cache", err);
        btn.textContent = "Ошибка";
        setTimeout(() => { btn.textContent = "Очистить"; btn.removeAttribute("disabled"); }, 2000);
      }
    },
  ));

  // Clear Log Files
  section.appendChild(buildCacheRow(
    "Очистить логи",
    "Удалить сохраненные лог-файлы клиента с диска.",
    "Очистить",
    signal,
    async (btn) => {
      btn.textContent = "Очистка...";
      btn.setAttribute("disabled", "");
      try {
        await clearLogFiles();
        btn.textContent = "Готово";
        setTimeout(() => { btn.textContent = "Очистить"; btn.removeAttribute("disabled"); }, 2000);
      } catch (err) {
        log.error("Failed to clear log files", err);
        btn.textContent = "Ошибка";
        setTimeout(() => { btn.textContent = "Очистить"; btn.removeAttribute("disabled"); }, 2000);
      }
    },
  ));

  // Clear All Cache (nuclear option)
  section.appendChild(buildCacheRow(
    "Очистить всё и перезапустить",
    "Удалить весь кэш (изображения, логи, WebView) и перезапустить приложение. "
      + "Профили серверов и учетные данные сохраняются.",
    "Очистить и перезапустить",
    signal,
    async (btn) => {
      // Two-step confirmation: first click shows warning, second click confirms
      if (btn.dataset.confirmPending !== "true") {
        btn.dataset.confirmPending = "true";
        btn.textContent = "Точно? Нажмите ещё раз";
        btn.classList.add("ac-btn-danger");
        const resetTimer = setTimeout(() => {
          btn.dataset.confirmPending = "";
          btn.textContent = "Очистить и перезапустить";
          btn.classList.remove("ac-btn-danger");
        }, 3000);
        // Store timer ID so it can be cleared if the button is clicked again
        btn.dataset.resetTimer = String(resetTimer);
        return;
      }
      // Second click — clear the pending state and proceed
      const pendingTimer = btn.dataset.resetTimer;
      if (pendingTimer) clearTimeout(Number(pendingTimer));
      btn.dataset.confirmPending = "";
      btn.textContent = "Очистка...";
      btn.setAttribute("disabled", "");
      try {
        await clearImageCache();
        await clearLogFiles();
        clearLocalStoragePreservingUserData();
        sessionStorage.clear();
        log.info("All cache cleared, restarting app");
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch (err) {
        log.error("Failed to clear all cache", err);
        btn.textContent = "Ошибка";
        setTimeout(() => { btn.textContent = "Очистить и перезапустить"; btn.removeAttribute("disabled"); }, 2000);
      }
    },
  ));

  // ---- Client Update section -------------------------------------------------

  const updateSep = createElement("div", { class: "settings-separator" });
  section.appendChild(updateSep);

  const updateTitle = createElement("div", { class: "settings-section-title" }, "Обновление клиента");
  section.appendChild(updateTitle);

  const updateServerUrl = options?.updateServerUrl?.trim() ?? "";
  const hasUpdateServer = updateServerUrl.length > 0;

  const updateRow = createElement("div", { class: "setting-row" });
  const updateInfo = createElement("div", {});
  const updateLabel = createElement("div", { class: "setting-label" }, "Обновить Uzel");
  const updateDesc = createElement(
    "div",
    { class: "setting-desc" },
    hasUpdateServer
      ? "Проверьте новую версию клиента и установите ее без ручной загрузки."
      : "Сначала подключитесь к серверу, чтобы проверять и ставить обновления.",
  );
  appendChildren(updateInfo, updateLabel, updateDesc);

  const updateButtons = createElement("div", { style: "display:flex;gap:8px;align-items:center;" });
  const checkBtn = createElement("button", { class: "ac-btn" }, "Проверить");
  const installBtn = createElement("button", { class: "ac-btn", disabled: "" }, "Обновить");
  appendChildren(updateButtons, checkBtn, installBtn);
  appendChildren(updateRow, updateInfo, updateButtons);
  section.appendChild(updateRow);

  let availableVersion: string | null = null;
  let busy = false;

  function refreshUpdateButtons(): void {
    const disabledByState = !hasUpdateServer || busy;
    checkBtn.disabled = disabledByState;
    installBtn.disabled = !hasUpdateServer || busy || availableVersion === null;
  }

  async function handleCheckUpdates(): Promise<void> {
    if (!hasUpdateServer || busy) return;
    busy = true;
    availableVersion = null;
    updateDesc.textContent = "Проверка обновлений...";
    refreshUpdateButtons();
    try {
      const result = await checkForUpdate(updateServerUrl);
      if (result.available && result.version !== null) {
        availableVersion = result.version;
        updateDesc.textContent = `Доступно обновление v${result.version}.`;
      } else {
        updateDesc.textContent = "У вас уже последняя версия.";
      }
    } catch (err) {
      log.error("Manual update check failed", err);
      updateDesc.textContent = "Не удалось проверить обновления. Попробуйте снова.";
    } finally {
      busy = false;
      refreshUpdateButtons();
    }
  }

  async function handleInstallUpdate(): Promise<void> {
    if (!hasUpdateServer || busy || availableVersion === null) return;
    busy = true;
    updateDesc.textContent = `Устанавливаю v${availableVersion}...`;
    refreshUpdateButtons();
    try {
      await downloadAndInstallUpdate(updateServerUrl);
      updateDesc.textContent = "Обновление установлено. Перезапуск...";
    } catch (err) {
      log.error("Manual update install failed", err);
      updateDesc.textContent = "Не удалось установить обновление. Попробуйте снова.";
      busy = false;
      refreshUpdateButtons();
    }
  }

  checkBtn.addEventListener("click", () => { void handleCheckUpdates(); }, { signal });
  installBtn.addEventListener("click", () => { void handleInstallUpdate(); }, { signal });
  refreshUpdateButtons();

  return section;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCacheRow(
  label: string,
  desc: string,
  btnText: string,
  signal: AbortSignal,
  onClick: (btn: HTMLButtonElement) => void,
): HTMLDivElement {
  const row = createElement("div", { class: "setting-row" });
  const info = createElement("div", {});
  const labelEl = createElement("div", { class: "setting-label" }, label);
  const descEl = createElement("div", { class: "setting-desc" }, desc);
  appendChildren(info, labelEl, descEl);

  const btn = createElement("button", { class: "ac-btn" }, btnText);
  btn.addEventListener("click", () => { onClick(btn); }, { signal });

  appendChildren(row, info, btn);
  return row;
}

/** Delete the IndexedDB image cache database. */
async function clearImageCache(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("owncord-image-cache");
    let settled = false;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;

    function finish(callback: () => void): void {
      if (settled) return;
      settled = true;
      if (blockedTimer !== null) {
        clearTimeout(blockedTimer);
      }
      callback();
    }

    req.onsuccess = () => finish(resolve);
    req.onerror = () => finish(() => reject(req.error));
    req.onblocked = () => {
      if (blockedTimer !== null) return;
      blockedTimer = setTimeout(() => {
        finish(() => reject(new Error("Кэш изображений все еще используется. Закройте активное медиа и повторите попытку.")));
      }, IMAGE_CACHE_DELETE_BLOCK_TIMEOUT_MS);
    };
  });

  clearAttachmentCaches();
  clearEmbedCaches();
  clearMediaCaches();
}

/**
 * Clear localStorage but preserve user-critical data: server profiles,
 * saved credentials, active theme selection, and custom themes.
 */
function clearLocalStoragePreservingUserData(): void {
  const PRESERVE_PREFIXES = [
    "owncord:profiles",
    "owncord:credential:",
    "owncord:theme:active",
    "owncord:theme:custom:",
  ];
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && !PRESERVE_PREFIXES.some((p) => key.startsWith(p))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

/** Delete all JSONL log files from the app log directory. */
async function clearLogFiles(): Promise<void> {
  try {
    await clearPendingPersistedLogs();
    const baseDir = await appLogDir();
    const logDir = await join(baseDir, "client-logs");
    const entries = await readDir(logDir);
    for (const entry of entries) {
      if (entry.name?.endsWith(".jsonl") && !entry.isDirectory) {
        await remove(`${logDir}/${entry.name}`);
      }
    }
  } catch (err) {
    if (isMissingPathError(err)) {
      return;
    }
    throw err;
  }
}

function isMissingPathError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found|no such file|cannot find the path|os error 2|enoent/i.test(message);
}
