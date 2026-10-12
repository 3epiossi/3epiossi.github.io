/**
 * 🎴 五連黑白棋 - 選組別面板（沿用舊名 PoolView）：4 組棋，每組標出還剩幾顆（雙方共用）。
 * 輪到人類時點一組選擇要下的那組；能直接連成五的組別標 ★。用完的組別留一個淡淡的空位（按鍵 1～4 永遠對應同一組）。
 */

import { tr, escapeHtml } from "../i18n.js";
import { discHtmlFive } from "./board-view.js";
import { discLabel, groupOf, GROUPS, GROUP_SIZE, letterOf } from "../core/five-rules.js";

export class PoolView {
  /**
   * @param {object} o
   * @param {HTMLElement} o.widget   #handWidget
   * @param {HTMLElement} o.valLabel #sideDiceValLabel（選中的組別）
   * @param {HTMLElement} o.bagLabel #handBagLabel（總共還剩幾顆）
   * @param {(id:number) => void} o.onSelect 點選某一組（傳那一組的代表棋）
   */
  constructor({ widget, valLabel, bagLabel, onSelect }) {
    this.widget = widget;
    this.valLabel = valLabel;
    this.bagLabel = bagLabel;
    this.widget?.addEventListener("click", (e) => {
      const btn = e.target.closest(".poolDisc");
      if (btn && !btn.disabled && btn.dataset.id) onSelect?.(Number(btn.dataset.id));
    });
  }

  /**
   * @param {object} s
   * @param {number[]} s.pool 每一組的代表棋（還有剩的組別才有）
   * @param {number[]} s.counts 每一組還剩幾顆（依組別）
   * @param {number|null} s.selected 選中的棋（那一組）
   * @param {number} s.face 輪到的顏色（棋畫成這個顏色）
   * @param {boolean} s.gameOver
   * @param {boolean} s.canSelect 現在能不能點選（人類的回合）
   * @param {Set<number>} s.fiveIds 能直接連成五的組別（代表棋）
   * @param {number|null} s.cpuPick CPU 選好、準備要下的棋（落子前先亮出來）
   * @param {Map<number,number>} s.discPcts 提示模式下滑鼠所在格子：每一組下在那格的勝率（%）
   * @param {"locked"|"auto"|"none"|null} s.hintSel 選中的組別是使用者固定選的（locked）、每格自動選最好的（auto），還是自己選但還沒選（none）
   */
  render({ pool, counts = [], selected, face, gameOver, canSelect, fiveIds = new Set(), cpuPick = null, discPcts = new Map(), hintSel = null }) {
    if (this.widget) {
      const byGroup = new Map(pool.map(id => [groupOf(id), id]));
      this.widget.classList.toggle("locked", !canSelect);
      this.widget.innerHTML = Array.from({ length: GROUPS }, (_, g) => {
        const id = byGroup.get(g);
        const left = counts[g] ?? 0;
        const countHtml = `<span class="poolCount">×${left}</span>`;
        if (id == null) {
          // 這一組用完了
          return `<button type="button" class="poolDisc used" disabled aria-label="${escapeHtml(tr("poolGroupUsed", { disc: letterOf(g + 1) }))}">
              ${discHtmlFive(g * GROUP_SIZE, face, "spent")}${countHtml}</button>`;
        }
        const sel = canSelect && id === selected;
        const label = discLabel(id);
        // 提示模式：固定選了這組 → 發光；每格自動用最高的那組 → 淡淡的框
        const hintCls = sel && hintSel === "locked" ? " hintLocked" : sel && hintSel === "auto" ? " hintAuto" : "";
        return `<button type="button" class="poolDisc${sel ? " selected" : ""}${hintCls}${id === cpuPick ? " cpuPick" : ""}" data-id="${id}" ${canSelect ? "" : "disabled"}
            aria-pressed="${sel}" aria-label="${escapeHtml(tr(fiveIds.has(id) ? "poolDiscFive" : "poolDisc", { disc: label, n: left }))}">
            ${discHtmlFive(id, face)}${countHtml}${fiveIds.has(id) && !discPcts.size ? `<span class="poolFive">★5</span>` : ""}${discPcts.has(id) ? `<span class="poolPct">${discPcts.get(id)}%</span>` : ""}
          </button>`;
      }).join("");
    }
    if (this.valLabel) {
      if (gameOver) this.valLabel.textContent = tr("handEnded");
      else if (selected == null && hintSel === "none" && cpuPick == null) this.valLabel.textContent = tr("poolPickPrompt");
      else if (selected == null && hintSel !== "auto" && cpuPick == null) this.valLabel.textContent = tr("handNone");
      else if (cpuPick != null) this.valLabel.textContent = tr("poolCpuPick", { disc: discLabel(cpuPick) });
      else if (canSelect) this.valLabel.textContent = tr("poolSelected", { disc: discLabel(selected) });
      else this.valLabel.textContent = tr("poolWaiting");
    }
    if (this.bagLabel) this.bagLabel.textContent = tr("handBag", { n: counts.reduce((a, b) => a + b, 0) });
  }
}
