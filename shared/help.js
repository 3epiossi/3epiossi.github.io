/**
 * 規則視窗（三個遊戲共用）：openHelp({ gameId, guide })
 *
 * - 兩個分頁：「規則」（一句話目標 + 4 張帶示意圖的規則卡）與「操作」（快捷鍵）。
 * - 底部固定兩個按鈕：「完整規則學院」與「我懂了」，三個遊戲位置、文字一致。
 * - 語言跟隨 localStorage 的 takuLang，視窗開著時切換語言會即時重畫。
 * - 用原生 <dialog>：自動進入頂層、Esc 關閉、焦點鎖定、不受頁面堆疊環境影響。
 * - guide（選填）：() => HTML 字串，放在「操作」分頁底下的「完整使用說明」摺疊區（五連黑白棋用）。
 */

import { HELP, UI_TEXT } from "./help-content.js";
import { ART } from "./help-art.js";
import { GAMES, TEXT, LANGS } from "./games.js";

const BASE = new URL("../", import.meta.url);

const ICON_ACADEMY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-5 9 5-9 5-9-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 11.5V16c0 1.4 2.2 3 5 3s5-1.6 5-3v-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function currentLang() {
  let lang = "zh";
  try { lang = localStorage.getItem("takuLang") || "zh"; } catch (_) { /* 私密瀏覽 */ }
  return LANGS.includes(lang) ? lang : "zh";
}

let ensured = false;
function ensureStyles() {
  if (ensured) return;
  ensured = true;
  const href = new URL("shared/ui.css", BASE).href;
  if ([...document.styleSheets].some((s) => s.href === href)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

let dialog = null;
let state = null;

function render() {
  const lang = currentLang();
  const ui = UI_TEXT[lang];
  const content = HELP[state.gameId][lang];
  const game = GAMES.find((g) => g.id === state.gameId);
  const name = TEXT[lang].names[state.gameId];
  const academyHref = new URL(game.academy, BASE).href;

  const steps = content.steps.map((s) => `
    <li>
      <div class="uiArt">${ART[s.art] || ""}</div>
      <div class="uiStepText"><b>${esc(s.title)}</b><p>${esc(s.text)}</p></div>
    </li>`).join("");
  const keys = content.keys.map(([k, v]) => `<li><kbd>${esc(k)}</kbd><span>${esc(v)}</span></li>`).join("");
  const guide = state.guide ? `<details class="uiGuide"><summary>${esc(ui.fullGuide)}</summary><div class="uiGuideBody">${state.guide(lang)}</div></details>` : "";

  dialog.innerHTML = `
    <div class="uiDlgHead"><h2 id="uiHelpTitle">${esc(name)} · ${esc(ui.title)}</h2><button type="button" class="uiIconBtn" data-close aria-label="${esc(ui.close)}">${ICON_CLOSE}</button></div>
    <div class="uiTabs" role="tablist">
      <button type="button" role="tab" class="uiTab ${state.tab === "rules" ? "on" : ""}" data-tab="rules" aria-selected="${state.tab === "rules"}">${esc(ui.tabRules)}</button>
      <button type="button" role="tab" class="uiTab ${state.tab === "keys" ? "on" : ""}" data-tab="keys" aria-selected="${state.tab === "keys"}">${esc(ui.tabKeys)}</button>
    </div>
    <div class="uiDlgBody">
      <section class="uiPanel" data-panel="rules" ${state.tab === "rules" ? "" : "hidden"}>
        <p class="uiGoal">${esc(content.goal)}</p>
        <ol class="uiSteps">${steps}</ol>
        ${content.note ? `<p class="uiNote">${esc(content.note)}</p>` : ""}
      </section>
      <section class="uiPanel" data-panel="keys" ${state.tab === "keys" ? "" : "hidden"}>
        <ul class="uiKeys">${keys}</ul>
        ${guide}
      </section>
    </div>
    <div class="uiDlgFoot">
      <a class="uiBtn" href="${academyHref}">${ICON_ACADEMY}<span>${esc(ui.academy)}</span></a>
      <button type="button" class="uiBtn primary" data-close>${esc(ui.start)}</button>
    </div>`;

  dialog.setAttribute("aria-labelledby", "uiHelpTitle");
  dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
  dialog.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    render();
    dialog.querySelector(".uiTab.on")?.focus();
  }));
}

export function openHelp({ gameId, tab = "rules", guide = null, onClose = null } = {}) {
  if (!HELP[gameId]) return;
  ensureStyles();
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "uiDialog";
    document.body.appendChild(dialog);
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => {
      window.removeEventListener("langchange", onLang);
      const cb = state?.onClose;
      cb?.();
    });
  }
  state = { gameId, tab: tab === "keys" ? "keys" : "rules", guide, onClose };
  render();
  window.addEventListener("langchange", onLang);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(".uiDlgBody").scrollTop = 0;
}

function onLang() {
  if (dialog?.open) render();
}

export function closeHelp() {
  if (dialog?.open) dialog.close();
}
