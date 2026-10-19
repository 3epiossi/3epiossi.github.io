/**
 * 規則學院用的迷你棋盤：只負責畫 8x8 棋盤與棋子、點格子回呼，規則判斷交給 five/src/core。
 */

import { N, BLACK } from "../src/core/constants.js";
import { SUITS, groupOf } from "../src/core/five-rules.js";
import { posToCoord } from "../src/core/rules.js";
import { t } from "./i18n.js";

export const GROUP_COLORS = ["#facc15", "#ef4444", "#38bdf8", "#4ade80"];
export const symbolOf = (group) => SUITS[group];
/** 組別的完整名稱：符號加目前語言的名字（例如「♠ 黑桃」「♠ Spades」） */
export const groupLabel = (group) => `${SUITS[group]} ${t("gname" + group)}`;

export class MiniBoard {
  constructor(container, { onCell } = {}) {
    this.container = container;
    this.onCell = onCell || (() => {});
    this.board = null;
    this.cells = [];
    this._build();
  }

  _build() {
    const wrap = document.createElement("div");
    wrap.className = "mb";
    const corner = document.createElement("span");
    corner.className = "mbLabel";
    wrap.appendChild(corner);
    for (let c = 0; c < N; c++) {
      const l = document.createElement("span");
      l.className = "mbLabel";
      l.textContent = "ABCDEFGH"[c];
      wrap.appendChild(l);
    }
    for (let r = 0; r < N; r++) {
      const l = document.createElement("span");
      l.className = "mbLabel";
      l.textContent = String(r + 1);
      wrap.appendChild(l);
      for (let c = 0; c < N; c++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mbCell";
        btn.dataset.r = r;
        btn.dataset.c = c;
        btn.setAttribute("aria-label", posToCoord(r, c));
        btn.addEventListener("click", () => this.onCell(r, c));
        wrap.appendChild(btn);
        this.cells.push(btn);
      }
    }
    this.container.innerHTML = "";
    this.container.appendChild(wrap);
  }

  cell(r, c) {
    return this.cells[r * N + c];
  }

  /** 畫出棋盤；opts.hints 是可下的格子 [{r, c}]，opts.groupDim 是要淡化的組別集合 */
  render(board, { hints = [], flips = [], last = null, glow = [], focusGroup = null } = {}) {
    this.board = board;
    const hintSet = new Set(hints.map((h) => `${h.r},${h.c}`));
    const flipSet = new Set(flips.map(([r, c]) => `${r},${c}`));
    const glowSet = new Set(glow.map(([r, c]) => `${r},${c}`));
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const el = this.cell(r, c);
        const d = board[r][c];
        const key = `${r},${c}`;
        el.className = "mbCell";
        if (hintSet.has(key)) el.classList.add("hint");
        if (flipSet.has(key)) el.classList.add("flipped");
        if (glowSet.has(key)) el.classList.add("glow");
        if (last && last.r === r && last.c === c) el.classList.add("last");
        if (!d) {
          el.innerHTML = "";
          continue;
        }
        const g = groupOf(d.id);
        const dim = focusGroup !== null && focusGroup !== g;
        el.innerHTML = `<span class="disc ${d.face === BLACK ? "b" : "w"} ${dim ? "dim" : ""} ${focusGroup === g ? "focus" : ""}" style="--g:${GROUP_COLORS[g]}"><i>${symbolOf(g)}</i><u></u></span>`;
      }
    }
  }

  /** 標出虛線圈（威脅缺口）等額外記號 */
  mark(cells, cls) {
    for (const [r, c] of cells) this.cell(r, c).classList.add(cls);
  }
}

/** 組別選擇列：顯示每一組的符號與剩餘數，點選回呼 */
export class GroupPicker {
  constructor(container, { onPick } = {}) {
    this.container = container;
    this.onPick = onPick || (() => {});
    this.selected = 0;
    this.enabled = [true, true, true, true];
    this.counts = [16, 16, 16, 16];
    this.render();
  }

  set({ selected, enabled, counts }) {
    if (selected !== undefined) this.selected = selected;
    if (enabled) this.enabled = enabled;
    if (counts) this.counts = counts;
    this.render();
  }

  render() {
    this.container.innerHTML = [0, 1, 2, 3].map((g) => {
      const off = !this.enabled[g] || this.counts[g] <= 0;
      return `<button type="button" class="gp ${this.selected === g ? "on" : ""}" data-g="${g}" ${off ? "disabled" : ""} style="--g:${GROUP_COLORS[g]}" aria-pressed="${this.selected === g}" title="${groupLabel(g)}">
        <span class="gpSym">${symbolOf(g)}</span><span class="gpCount">${this.counts[g]}</span></button>`;
    }).join("");
    this.container.querySelectorAll(".gp").forEach((btn) => btn.addEventListener("click", () => {
      this.selected = Number(btn.dataset.g);
      this.render();
      this.onPick(this.selected);
    }));
  }
}
