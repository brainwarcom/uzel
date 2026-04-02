/**
 * VideoGrid component — renders remote video streams in a responsive CSS grid.
 * Replaces the chat area when cameras are active.
 */

import { createElement, appendChildren } from "@lib/dom";
import { createIcon } from "@lib/icons";
import { disableScreenshare, muteScreenshareAudio, setUserVolume } from "@lib/livekitSession";
import type { MountableComponent } from "@lib/safe-render";

export interface TileConfig {
  /** True if this is the local user's own tile (no audio controls) */
  readonly isSelf: boolean;
  /** The real userId for audio control (differs from tile ID for screenshare tiles) */
  readonly audioUserId: number;
  /** True if this tile represents a screenshare (vs camera) */
  readonly isScreenshare: boolean;
}

export interface VideoGridComponent extends MountableComponent {
  addStream(userId: number, username: string, stream: MediaStream, config?: TileConfig): void;
  addPlaceholder(userId: number, username: string): void;
  removeStream(userId: number): void;
  removePlaceholder(userId: number): void;
  hasStreams(): boolean;
  setFocusedTile(tileId: number): void;
  getFocusedTileId(): number | null;
}

/** Create a fresh volume icon element. */
function volumeIcon(): SVGSVGElement { return createIcon("volume-2", 16); }
/** Create a fresh volume-x (muted) icon element. */
function volumeXIcon(): SVGSVGElement { return createIcon("volume-x", 16); }
/** Replace a button's icon child with a new one. */
function setButtonIcon(btn: HTMLButtonElement, icon: SVGSVGElement): void {
  while (btn.firstChild) btn.removeChild(btn.firstChild);
  btn.appendChild(icon);
}

// ---------------------------------------------------------------------------
// Layout calculator — Discord-style tile sizing
// ---------------------------------------------------------------------------

export interface GridLayout {
  readonly cols: number;
  readonly rows: number;
  readonly tileW: number;
  readonly tileH: number;
}

const GRID_GAP = 4;
const GRID_PAD = 8;
const ASPECT = 16 / 9;

/**
 * Compute optimal tile arrangement that maximises tile area while fitting
 * all tiles inside the container.  Tries every possible column count and
 * picks the one whose tiles are largest.
 */
export function computeGridLayout(
  containerW: number,
  containerH: number,
  tileCount: number,
): GridLayout {
  if (tileCount <= 0) return { cols: 1, rows: 1, tileW: 0, tileH: 0 };

  let best: GridLayout = { cols: 1, rows: tileCount, tileW: 0, tileH: 0 };

  for (let cols = 1; cols <= tileCount; cols++) {
    const rows = Math.ceil(tileCount / cols);
    const availW = containerW - GRID_PAD * 2 - GRID_GAP * (cols - 1);
    const availH = containerH - GRID_PAD * 2 - GRID_GAP * (rows - 1);
    if (availW <= 0 || availH <= 0) continue;

    let tileW = availW / cols;
    let tileH = tileW / ASPECT;

    // Shrink if total row height exceeds available height
    if (tileH * rows > availH) {
      tileH = availH / rows;
      tileW = tileH * ASPECT;
    }

    // Floor width first, then derive height to preserve exact 16:9
    const floorW = Math.floor(tileW);
    const floorH = Math.floor(floorW / ASPECT);

    if (floorW * floorH > best.tileW * best.tileH) {
      best = { cols, rows, tileW: floorW, tileH: floorH };
    }
  }

  return best;
}

export function createVideoGrid(): VideoGridComponent {
  let root: HTMLDivElement | null = null;
  const cells = new Map<number, { el: HTMLDivElement; config?: TileConfig; kind: "stream" | "placeholder" }>();
  let focusedTileId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeRafId = 0;

  /** Apply JS-calculated tile sizes to all grid-mode cells. */
  function applyGridSizes(): void {
    if (root === null || focusedTileId !== null || cells.size === 0) return;

    const { width: cw, height: ch } = root.getBoundingClientRect();
    if (cw === 0 || ch === 0) return;

    const layout = computeGridLayout(cw, ch, cells.size);

    for (const entry of cells.values()) {
      entry.el.style.width = `${layout.tileW}px`;
      entry.el.style.height = `${layout.tileH}px`;
    }
  }

  /** Schedule a layout recalculation on the next animation frame. */
  function scheduleResize(): void {
    if (resizeRafId !== 0) cancelAnimationFrame(resizeRafId);
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      applyGridSizes();
    });
  }

  function rebuildFocusLayout(): void {
    if (root === null) return;

    // Clear root children (we'll re-append in focus layout order)
    while (root.firstChild) root.removeChild(root.firstChild);

    if (focusedTileId === null || cells.size === 0) {
      // No focus — use regular flex-wrap layout
      root.classList.remove("focus-mode");
      for (const entry of cells.values()) {
        entry.el.classList.remove("focused", "thumb");
        root.appendChild(entry.el);
      }
      applyGridSizes();
      return;
    }

    root.classList.add("focus-mode");

    // Clear inline sizes on cells (focus mode uses CSS flex sizing)
    for (const entry of cells.values()) {
      entry.el.style.width = "";
      entry.el.style.height = "";
    }

    // Main area
    const mainArea = createElement("div", { class: "video-focus-main" });
    // Strip area
    const stripArea = createElement("div", { class: "video-focus-strip" });

    const focusedEntry = cells.get(focusedTileId);
    if (focusedEntry !== undefined) {
      focusedEntry.el.classList.add("focused");
      focusedEntry.el.classList.remove("thumb");
      mainArea.appendChild(focusedEntry.el);
    }

    for (const [id, entry] of cells) {
      if (id === focusedTileId) continue;
      entry.el.classList.remove("focused");
      entry.el.classList.add("thumb");
      stripArea.appendChild(entry.el);
    }

    root.appendChild(mainArea);
    // Only show strip if there are thumbnails
    if (stripArea.childElementCount > 0) {
      root.appendChild(stripArea);
    }
  }

  function setFocusedTile(tileId: number): void {
    focusedTileId = tileId;
    rebuildFocusLayout();
  }

  function getFocusedTileIdFn(): number | null {
    return focusedTileId;
  }

  function updateLayout(): void {
    if (root === null) return;
    if (focusedTileId !== null) {
      rebuildFocusLayout();
      return;
    }
    applyGridSizes();
  }

  function addStream(userId: number, username: string, stream: MediaStream, config?: TileConfig): void {
    if (root === null) return;

    // If a cell already exists for this user, update it in place
    const existing = cells.get(userId);
    if (existing !== undefined) {
      if (existing.kind === "placeholder") {
        existing.el.remove();
        cells.delete(userId);
      } else {
      const video = existing.el.querySelector("video");
      if (video !== null) {
        // Only replace srcObject if the underlying tracks changed
        const oldTracks = (video.srcObject as MediaStream | null)?.getTracks() ?? [];
        const newTracks = stream.getTracks();
        const tracksMatch =
          oldTracks.length === newTracks.length &&
          oldTracks.every((t, i) => t.id === newTracks[i]?.id);
        if (!tracksMatch) {
          video.srcObject = stream;
        }
      }
      // Update username label in case it changed
      const label = existing.el.querySelector(".video-username");
      if (label !== null) {
        label.textContent = username;
      }
      return;
      }
    }

    const video = createElement("video", {
      autoplay: "",
      playsinline: "",
    });
    video.muted = true;
    video.srcObject = stream;

    const label = createElement("div", { class: "video-username" }, username);

    const cell = createElement("div", {
      class: "video-cell",
      "data-user-id": String(userId),
    });
    appendChildren(cell, video, label);

    cell.addEventListener("click", (e) => {
      // Don't switch focus if clicking tile controls.
      if ((e.target as Element).closest(".video-tile-overlay")) return;
      if (focusedTileId !== null && focusedTileId !== userId) {
        focusedTileId = userId;
        rebuildFocusLayout();
      }
    });

    if (config !== undefined) {
      const overlay = createElement("div", { class: "video-tile-overlay" });
      let hasOverlayControls = false;

      // Screenshare controls: fullscreen for everyone + stop share for self.
      if (config.isScreenshare) {
        hasOverlayControls = true;
        const fullscreenBtn = createElement("button", {
          class: "tile-action-btn",
          "aria-label": "Открыть на весь экран",
          title: "Открыть на весь экран",
        });
        fullscreenBtn.appendChild(createIcon("external-link", 16));
        fullscreenBtn.addEventListener("click", async () => {
          try {
            if (document.fullscreenElement === cell) {
              await document.exitFullscreen();
              return;
            }
            await cell.requestFullscreen();
          } catch {
            // ignore fullscreen errors (user denied or unsupported)
          }
        });
        overlay.appendChild(fullscreenBtn);

        if (config.isSelf) {
          const stopShareBtn = createElement("button", {
            class: "tile-action-btn tile-action-btn-danger",
            "aria-label": "Остановить демонстрацию",
            title: "Остановить демонстрацию",
          });
          stopShareBtn.appendChild(createIcon("monitor-off", 16));
          stopShareBtn.addEventListener("click", () => {
            void disableScreenshare();
          });
          overlay.appendChild(stopShareBtn);
        }
      }

      // Audio controls for remote tiles (including remote screenshare tiles).
      if (!config.isSelf) {
        let muted = false;
        let currentVolume = 100;
        hasOverlayControls = true;

        // Volume slider
        const volumeSlider = createElement("input", {
          type: "range",
          min: "0",
          max: "200",
          value: "100",
          class: "tile-volume-slider",
          "aria-label": "Громкость",
        });

        volumeSlider.addEventListener("input", () => {
          currentVolume = Number(volumeSlider.value);
          const wasMuted = muted;
          muted = currentVolume === 0;
          if (config.isScreenshare) {
            muteScreenshareAudio(config.audioUserId, muted);
          } else {
            setUserVolume(config.audioUserId, currentVolume);
          }
          setButtonIcon(muteBtn, muted ? volumeXIcon() : volumeIcon());
          muteBtn.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
          if (muted !== wasMuted) {
            overlay.classList.toggle("muted", muted);
          }
        });

        // Mute button
        const muteBtn = createElement("button", {
          class: "tile-mute-btn",
          "aria-label": "Выключить звук",
          title: "Выключить звук",
        });
        muteBtn.appendChild(volumeIcon());

        muteBtn.addEventListener("click", () => {
          muted = !muted;
          if (muted) {
            if (config.isScreenshare) {
              muteScreenshareAudio(config.audioUserId, true);
            } else {
              setUserVolume(config.audioUserId, 0);
            }
            volumeSlider.value = "0";
          } else {
            if (currentVolume === 0) currentVolume = 100;
            if (config.isScreenshare) {
              muteScreenshareAudio(config.audioUserId, false);
            } else {
              setUserVolume(config.audioUserId, currentVolume);
            }
            volumeSlider.value = String(currentVolume);
          }
          setButtonIcon(muteBtn, muted ? volumeXIcon() : volumeIcon());
          muteBtn.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
          overlay.classList.toggle("muted", muted);
        });

        overlay.appendChild(volumeSlider);
        overlay.appendChild(muteBtn);
      }

      if (hasOverlayControls) {
        cell.appendChild(overlay);
      }
    }

    cells.set(userId, { el: cell, config, kind: "stream" });
    root.appendChild(cell);
    if (focusedTileId !== null) {
      rebuildFocusLayout();
    } else {
      updateLayout();
    }
  }

  function addPlaceholder(userId: number, username: string): void {
    if (root === null) return;

    const existing = cells.get(userId);
    if (existing !== undefined) {
      if (existing.kind === "stream") return;
      const label = existing.el.querySelector(".video-username");
      if (label !== null) label.textContent = username;
      const avatar = existing.el.querySelector(".video-placeholder-avatar");
      if (avatar !== null) avatar.textContent = username.charAt(0).toUpperCase() || "?";
      return;
    }

    const cell = createElement("div", {
      class: "video-cell video-cell-placeholder",
      "data-user-id": String(userId),
    });

    const placeholder = createElement("div", { class: "video-placeholder" });
    const avatar = createElement("div", { class: "video-placeholder-avatar" },
      username.charAt(0).toUpperCase() || "?");
    const label = createElement("div", { class: "video-username" }, username);
    appendChildren(placeholder, avatar);
    appendChildren(cell, placeholder, label);

    cell.addEventListener("click", () => {
      if (focusedTileId !== null && focusedTileId !== userId) {
        focusedTileId = userId;
        rebuildFocusLayout();
      }
    });

    cells.set(userId, { el: cell, kind: "placeholder" });
    root.appendChild(cell);
    if (focusedTileId !== null) {
      rebuildFocusLayout();
    } else {
      updateLayout();
    }
  }

  function removeStream(userId: number): void {
    const entry = cells.get(userId);
    if (entry === undefined) return;
    if (entry.kind !== "stream") return;

    const video = entry.el.querySelector("video");
    if (video !== null) video.srcObject = null;

    entry.el.remove();
    cells.delete(userId);

    // If focused tile was removed, focus the first remaining tile or clear
    const wasFocusMode = focusedTileId !== null;
    if (focusedTileId === userId) {
      const firstKey = cells.keys().next().value;
      focusedTileId = firstKey ?? null;
    }

    if (focusedTileId !== null || wasFocusMode) {
      rebuildFocusLayout();
    } else {
      updateLayout();
    }
  }

  function removePlaceholder(userId: number): void {
    const entry = cells.get(userId);
    if (entry === undefined) return;
    if (entry.kind !== "placeholder") return;
    entry.el.remove();
    cells.delete(userId);
    if (focusedTileId === userId) {
      const firstKey = cells.keys().next().value;
      focusedTileId = firstKey ?? null;
    }
    if (focusedTileId !== null) {
      rebuildFocusLayout();
    } else {
      updateLayout();
    }
  }

  function hasStreams(): boolean {
    return cells.size > 0;
  }

  function mount(container: Element): void {
    root = createElement("div", {
      class: "video-grid",
      "data-testid": "video-grid",
    });
    container.appendChild(root);

    // Observe container size changes to recalculate tile layout
    resizeObserver = new ResizeObserver(() => { scheduleResize(); });
    resizeObserver.observe(root);
  }

  function destroy(): void {
    if (resizeRafId !== 0) cancelAnimationFrame(resizeRafId);
    resizeRafId = 0;

    if (resizeObserver !== null) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    for (const [, entry] of cells) {
      const video = entry.el.querySelector("video");
      if (video !== null) video.srcObject = null;
    }
    cells.clear();
    focusedTileId = null;

    if (root !== null) {
      root.remove();
      root = null;
    }
  }

  return {
    mount,
    destroy,
    addStream,
    addPlaceholder,
    removeStream,
    removePlaceholder,
    hasStreams,
    setFocusedTile,
    getFocusedTileId: getFocusedTileIdFn,
  };
}
