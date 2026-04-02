/**
 * Text & Images settings tab — link previews, embeds, inline media, GIF/emoji animation, spoilers.
 */

import { createElement, appendChildren } from "@lib/dom";
import { loadPref, savePref, createToggle } from "./helpers";

export function buildTextImagesTab(signal: AbortSignal): HTMLDivElement {
  const section = createElement("div", { class: "settings-pane active" });

  const toggles: ReadonlyArray<{ key: string; label: string; desc: string; fallback: boolean }> = [
    {
      key: "showLinkPreviews",
      label: "Предпросмотр ссылок",
      desc: "Показывать предпросмотр сайтов для ссылок в чате",
      fallback: true,
    },
    {
      key: "showEmbeds",
      label: "Показывать встраивания",
      desc: "Отображать rich-встраивания в сообщениях",
      fallback: true,
    },
    {
      key: "inlineMedia",
      label: "Встроенный просмотр вложений",
      desc: "Автоматически показывать изображения, видео и GIF прямо в чате",
      fallback: true,
    },
    {
      key: "animateGifs",
      label: "Анимировать GIF",
      desc: "Автоматически проигрывать GIF. Если отключено, GIF показываются как статичные изображения",
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

  return section;
}
