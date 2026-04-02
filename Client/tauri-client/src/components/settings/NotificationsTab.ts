/**
 * Notifications settings tab — desktop notifications, taskbar flash, sounds.
 */

import { createElement, appendChildren } from "@lib/dom";
import { loadPref, savePref, createToggle } from "./helpers";

export function buildNotificationsTab(signal: AbortSignal): HTMLDivElement {
  const section = createElement("div", { class: "settings-pane active" });

  const toggles: ReadonlyArray<{ key: string; label: string; desc: string; fallback: boolean }> = [
    { key: "desktopNotifications", label: "Уведомления на рабочем столе", desc: "Показывать уведомления о новых сообщениях", fallback: true },
    { key: "flashTaskbar", label: "Мигать в панели задач", desc: "Подсвечивать приложение в панели задач при новых сообщениях", fallback: true },
    { key: "suppressEveryone", label: "Игнорировать @everyone", desc: "Отключить уведомления от @everyone и @here", fallback: false },
    { key: "notificationSounds", label: "Звуки уведомлений", desc: "Воспроизводить звуки для уведомлений", fallback: true },
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

  return section;
}
