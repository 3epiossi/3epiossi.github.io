/**
 * 遊戲切換器 <game-switcher current="five|district|whowins">
 *
 * 三個遊戲（五連黑白棋、劃區爭霸、誰會贏？）共用的標頭元件：
 * - 觸發鈕顯示「目前遊戲」的名稱，直接放在各頁標題的位置，點開列出所有遊戲與各自的規則學院。
 * - 語言跟隨 localStorage 的 takuLang（五連黑白棋與誰會贏共用），並監聽 langchange 事件。
 * - 鍵盤：Enter／空白開關，方向鍵在選項間移動，Esc 關閉並把焦點還給觸發鈕。
 * - 手機（寬度 560px 以下）改成從底部升起的面板。
 * - 樣式放在 shadow DOM，不受各頁面 CSS 影響；文字顏色繼承標頭，面板顏色可用 --gs-bg／--gs-fg 覆寫。
 */

import { GAMES, TEXT, LANGS } from "./games.js";

const BASE = new URL("../", import.meta.url);
// Popover API：進入瀏覽器的頂層，不會被標頭上層的堆疊環境（transform、backdrop-filter 等）蓋住
const HAS_POPOVER = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

const ICONS = {
  five: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><g fill="currentColor"><circle cx="5.2" cy="12" r="1.7"/><circle cx="8.6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="15.4" cy="12" r="1.7"/><circle cx="18.8" cy="12" r="1.7"/></g></svg>`,
  district: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 9.5h8.5V21M11.5 9.5H21" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="butt"/></svg>`,
  whowins: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><g fill="currentColor"><circle cx="8.3" cy="8.3" r="1.6"/><circle cx="15.7" cy="8.3" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="8.3" cy="15.7" r="1.6"/><circle cx="15.7" cy="15.7" r="1.6"/></g></svg>`,
  chevron: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function currentLang() {
  let lang = "zh";
  try { lang = localStorage.getItem("takuLang") || "zh"; } catch (_) { /* 私密瀏覽 */ }
  return LANGS.includes(lang) ? lang : "zh";
}

const STYLE = `
:host { display: inline-block; font: inherit; color: inherit; line-height: 1.2; vertical-align: middle; max-width: 100%; min-width: 0; }
* { box-sizing: border-box; }
svg { width: 1.25em; height: 1.25em; flex: none; }
button, a { font: inherit; color: inherit; }
.trigger {
  max-width: 100%;
  display: inline-flex; align-items: center; gap: 0.5em;
  padding: 0.28em 0.65em 0.28em 0.55em;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
  background: color-mix(in srgb, currentColor 7%, transparent);
  cursor: pointer; font-weight: inherit; letter-spacing: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.trigger:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
.trigger:focus-visible, .item:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }
.trigger .chev { width: 1em; height: 1em; opacity: 0.7; transition: transform 0.18s; }
.trigger[aria-expanded="true"] .chev { transform: rotate(180deg); }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }

.layer { position: fixed; inset: 0; z-index: 2147483000; display: none; }
.layer.open { display: block; }
.layer[popover] { width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; color: inherit; }
.layer[popover]:not(.open) { display: none; }
.backdrop { position: absolute; inset: 0; background: rgba(2, 6, 16, 0); }
.menu {
  position: absolute; width: min(340px, calc(100vw - 24px));
  padding: 8px;
  border-radius: 16px;
  background: var(--gs-bg, #111a2e); color: var(--gs-fg, #e8edf6);
  border: 1px solid rgba(148, 163, 184, 0.28);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
  font-size: 15px; font-weight: 500; letter-spacing: 0;
  animation: pop 0.14s ease-out;
}
@keyframes pop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.menuTitle { padding: 6px 10px 8px; font-size: 12px; color: #8b97ad; letter-spacing: 0.04em; }
.row { display: flex; align-items: stretch; gap: 4px; border-radius: 12px; }
.row + .row { margin-top: 2px; }
.row.current { background: rgba(125, 211, 252, 0.1); }
.item {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px;
  padding: 10px; border-radius: 12px; text-decoration: none; color: inherit;
}
.item:hover { background: rgba(148, 163, 184, 0.14); }
.item .ico { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; background: rgba(148, 163, 184, 0.12); flex: none; }
.item .ico svg { width: 22px; height: 22px; }
.row.current .ico { background: rgba(125, 211, 252, 0.2); color: #7dd3fc; }
.text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.title { font-weight: 700; display: flex; align-items: center; gap: 8px; }
.badge { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: rgba(125, 211, 252, 0.18); color: #7dd3fc; }
.tag { font-size: 12.5px; color: #98a4ba; line-height: 1.35; }

@media (max-width: 560px) {
  .backdrop { background: rgba(2, 6, 16, 0.55); }
  .menu { left: 8px !important; right: 8px; top: auto !important; bottom: 8px; width: auto; animation: rise 0.2s ease-out; padding-bottom: 12px; }
  @keyframes rise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  .item { padding: 12px 10px; }
}
@media (prefers-reduced-motion: reduce) { .menu { animation: none; } .trigger .chev { transition: none; } }
`;

class GameSwitcher extends HTMLElement {
  static get observedAttributes() { return ["current"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onLang = () => this._render();
    this._onKey = (e) => this._handleKey(e);
    this._onResize = () => { if (this._isOpen()) this._place(); };
  }

  connectedCallback() {
    this._render();
    window.addEventListener("langchange", this._onLang);
    window.addEventListener("storage", this._onLang);
    window.addEventListener("resize", this._onResize);
  }

  disconnectedCallback() {
    window.removeEventListener("langchange", this._onLang);
    window.removeEventListener("storage", this._onLang);
    window.removeEventListener("resize", this._onResize);
    document.removeEventListener("keydown", this._onKey, true);
  }

  attributeChangedCallback() {
    if (this.isConnected) this._render();
  }

  get currentId() {
    return this.getAttribute("current") || "";
  }

  _isOpen() {
    return Boolean(this.shadowRoot.querySelector(".layer.open"));
  }

  _render() {
    const lang = currentLang();
    const t = TEXT[lang];
    const wasOpen = this._isOpen();
    const cur = GAMES.find((g) => g.id === this.currentId);

    const rows = GAMES.map((g) => {
      const isCur = g.id === this.currentId;
      const href = new URL(g.path, BASE).href;
      return `
        <div class="row ${isCur ? "current" : ""}">
          <a class="item" href="${href}" ${isCur ? 'aria-current="page"' : ""} data-nav>
            <span class="ico">${ICONS[g.id]}</span>
            <span class="text">
              <span class="title">${t.names[g.id]}${isCur ? `<span class="badge">${t.current}</span>` : ""}</span>
              <span class="tag">${t.taglines[g.id]}</span>
            </span>
          </a>
        </div>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <button class="trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="menu">
        ${cur ? ICONS[cur.id] : ""}<span class="name">${cur ? t.names[cur.id] : t.menuTitle}</span><span class="chev">${ICONS.chevron}</span>
      </button>
      <div class="layer" ${HAS_POPOVER ? 'popover="manual"' : ""}>
        <div class="backdrop"></div>
        <div class="menu" id="menu" role="group" aria-label="${t.menuTitle}">
          <div class="menuTitle">${t.menuTitle}</div>
          ${rows}
        </div>
      </div>`;

    const trigger = this.shadowRoot.querySelector(".trigger");
    trigger.addEventListener("click", () => (this._isOpen() ? this.close() : this.open()));
    this.shadowRoot.querySelector(".backdrop").addEventListener("click", () => this.close());
    if (wasOpen) this.open();
  }

  open() {
    const layer = this.shadowRoot.querySelector(".layer");
    layer.classList.add("open");
    if (HAS_POPOVER && !layer.matches(":popover-open")) layer.showPopover();
    this.shadowRoot.querySelector(".trigger").setAttribute("aria-expanded", "true");
    this._place();
    document.addEventListener("keydown", this._onKey, true);
    const cur = this.shadowRoot.querySelector(".row.current .item") || this.shadowRoot.querySelector(".item");
    cur?.focus();
  }

  close({ restoreFocus = true } = {}) {
    const layer = this.shadowRoot.querySelector(".layer");
    layer?.classList.remove("open");
    if (HAS_POPOVER && layer?.matches(":popover-open")) layer.hidePopover();
    const trigger = this.shadowRoot.querySelector(".trigger");
    trigger?.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", this._onKey, true);
    if (restoreFocus) trigger?.focus();
  }

  /** 手機以外：選單貼著觸發鈕下緣，超出右邊就往左收 */
  _place() {
    const menu = this.shadowRoot.querySelector(".menu");
    if (window.matchMedia("(max-width: 560px)").matches) {
      menu.style.left = "";
      menu.style.top = "";
      return;
    }
    const rect = this.shadowRoot.querySelector(".trigger").getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    menu.style.top = `${Math.round(rect.bottom + 8)}px`;
    menu.style.left = `${Math.round(Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)))}px`;
  }

  _handleKey(e) {
    if (!this._isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key === "Tab") {
      // 焦點留在選單裡循環
      const links = [...this.shadowRoot.querySelectorAll("a[data-nav]")];
      const active = this.shadowRoot.activeElement;
      const i = links.indexOf(active);
      if (e.shiftKey && i <= 0) { e.preventDefault(); links.at(-1).focus(); }
      else if (!e.shiftKey && i === links.length - 1) { e.preventDefault(); links[0].focus(); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...this.shadowRoot.querySelectorAll(".item")];
      const active = this.shadowRoot.activeElement;
      let i = items.indexOf(active);
      if (i < 0) i = items.findIndex((el) => el.parentElement.contains(active));
      i = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i].focus();
    }
  }
}

if (!customElements.get("game-switcher")) customElements.define("game-switcher", GameSwitcher);
