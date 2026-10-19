/**
 * 語言選單 <lang-select>：三個遊戲標題列最右邊同一個控制項（中文、English、日本語）。
 * 切換時呼叫 shared/i18n.js 的 setLang（五連黑白棋與誰會贏會順便翻譯整頁），其他頁面靠 langchange 事件重畫。
 */

import { getLang, setLang, LANGS } from "./i18n.js";

const LABELS = { zh: "中文", en: "English", ja: "日本語" };

class LangSelect extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<select class="langSelect uiLangSelect" aria-label="Language">${LANGS.map((l) => `<option value="${l}">${LABELS[l]}</option>`).join("")}</select>`;
    this._select = this.querySelector("select");
    this._select.value = getLang();
    this._select.addEventListener("change", () => setLang(this._select.value));
    this._sync = () => { this._select.value = getLang(); };
    window.addEventListener("langchange", this._sync);
  }

  disconnectedCallback() {
    window.removeEventListener("langchange", this._sync);
  }
}

if (!customElements.get("lang-select")) customElements.define("lang-select", LangSelect);
