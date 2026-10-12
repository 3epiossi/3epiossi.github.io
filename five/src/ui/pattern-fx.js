/**
 * ✨ 五連特效：連成五時，五顆棋依序發光並跳出提示。
 *
 * 特效畫在棋盤上方獨立的圖層，不受棋盤重繪影響（CPU 落子後畫面會馬上重繪好幾次）。
 */

import { tr } from "../i18n.js";

export class PatternFx {
  /**
   * @param {object} o
   * @param {HTMLElement} o.frame   棋盤外框（定位基準，position: relative）
   * @param {HTMLElement} o.board   棋盤格容器
   */
  constructor({ frame, board }) {
    this.frame = frame;
    this.board = board;
    this.layer = document.createElement("div");
    this.layer.className = "patternLayer";
    this.layer.setAttribute("aria-hidden", "true");
    frame.appendChild(this.layer);
    this.live = document.createElement("div");
    this.live.className = "srOnly";
    this.live.setAttribute("aria-live", "polite");
    frame.appendChild(this.live);
    this.timers = [];
  }

  clear() {
    this.fiveLabel = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.layer.replaceChildren();
  }

  /** 某格相對於棋盤外框的位置 */
  cellRect(r, c) {
    const cell = this.board.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    if (!cell) return null;
    const a = cell.getBoundingClientRect(), f = this.frame.getBoundingClientRect();
    return { left: a.left - f.left, top: a.top - f.top, width: a.width, height: a.height };
  }

  /**
   * 五連獲勝：五顆依序亮起，最後宣告「五連 v！」
   * @param {{ value:number, cells:[number,number][] }} five
   * @param {string} label 五連的字母
   */
  playFive(five, label, reduced = false) {
    this.clear();
    if (!five) return;
    this.fiveLabel = label;
    this.live.textContent = tr("fxFive", { v: label });
    const step = reduced ? 0 : 110;
    five.cells.forEach(([r, c], i) => {
      this.timers.push(setTimeout(() => {
        const rect = this.cellRect(r, c);
        if (!rect) return;
        const g = document.createElement("div");
        g.className = "patternGlow active t-five";
        Object.assign(g.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        this.layer.appendChild(g);
      }, i * step));
    });
    this.timers.push(setTimeout(() => this.toast(tr("fxFive", { v: label }), "five"), 5 * step));
    // 五連是終局：光效留在盤上，直到開新局或跳回歷史局面
  }

  /** 切換語言後，把還留在盤上的「五連！」提示換成新語言 */
  retranslate() {
    if (this.fiveLabel == null) return;
    const t = this.layer.querySelector(".patternToast.t-five");
    if (t) t.textContent = tr("fxFive", { v: this.fiveLabel });
    this.live.textContent = tr("fxFive", { v: this.fiveLabel });
  }

  toast(text, kind) {
    this.layer.querySelector(".patternToast")?.remove();
    const t = document.createElement("div");
    t.className = `patternToast t-${kind}`;
    t.textContent = text;
    this.layer.appendChild(t);
  }
}
