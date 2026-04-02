/**
 * Accessibility settings tab — reduced motion, high contrast, role colors, OS motion sync, large font.
 */

import { createElement, appendChildren } from "@lib/dom";
import { loadPref, savePref, createToggle } from "./helpers";
import { syncOsMotionListener } from "@lib/os-motion";

type ToggleItem = {
  readonly key: string;
  readonly label: string;
  readonly desc: string;
  readonly fallback: boolean;
  readonly sideEffect?: (nowOn: boolean) => void;
};

const TOGGLES: ReadonlyArray<ToggleItem> = [
  {
    key: "reducedMotion",
    label: "Снижение анимации",
    desc: "Отключить анимации и переходы",
    fallback: false,
    sideEffect: (nowOn) => {
      document.documentElement.classList.toggle("reduced-motion", nowOn);
    },
  },
  {
    key: "highContrast",
    label: "Высокая контрастность",
    desc: "Повысить контраст для лучшей читаемости",
    fallback: false,
    sideEffect: (nowOn) => {
      document.documentElement.classList.toggle("high-contrast", nowOn);
    },
  },
  {
    key: "roleColors",
    label: "Цвета ролей",
    desc: "Показывать цветные имена в чате в зависимости от роли",
    fallback: true,
  },
  {
    key: "syncOsMotion",
    label: "Синхронизация с ОС",
    desc: "Автоматически включать снижение анимации по настройкам доступности ОС",
    fallback: false,
    sideEffect: (nowOn) => { syncOsMotionListener(nowOn); },
  },
  {
    key: "largeFont",
    label: "Крупный шрифт",
    desc: "Использовать более крупный текст во всем приложении",
    fallback: false,
    sideEffect: (nowOn) => {
      document.documentElement.classList.toggle("large-font", nowOn);
    },
  },
];

export function buildAccessibilityTab(signal: AbortSignal): HTMLDivElement {
  const section = createElement("div", { class: "settings-pane active" });

  for (const item of TOGGLES) {
    const row = createElement("div", { class: "setting-row" });
    const info = createElement("div", {});
    const label = createElement("div", { class: "setting-label" }, item.label);
    const desc = createElement("div", { class: "setting-desc" }, item.desc);
    appendChildren(info, label, desc);

    const isOn = loadPref<boolean>(item.key, item.fallback);
    const toggle = createToggle(isOn, {
      signal,
      onChange: (nowOn) => {
        savePref(item.key, nowOn);
        if (item.sideEffect !== undefined) {
          item.sideEffect(nowOn);
        }
      },
    });

    appendChildren(row, info, toggle);
    section.appendChild(row);
  }

  return section;
}
