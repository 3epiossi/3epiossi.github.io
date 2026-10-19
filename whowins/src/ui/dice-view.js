/**
 * 骰子面板（棋盤旁）：目前的點數、「骰子展望」六個長條（擲出 1~6 時走最佳步的勝率）、
 * 自選點數（PASS 後的免擲骰回合）與研究模式的指定點數。
 */

import { tr } from "../i18n.js";

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

export class DiceView {
  /**
   * @param {HTMLElement} o.panel #sideDicePanel
   * @param {() => void} o.onRoll 點骰子擲骰
   * @param {(d:number) => void} o.onPick 點某一面（自選或指定點數）
   */
  constructor({ panel, onRoll, onPick }) {
    this.panel = panel;
    this.onRoll = onRoll;
    this.onPick = onPick;
    this.canRoll = false;
    panel.innerHTML = `
      <div class="sideDiceSection">
        <button type="button" class="sideDiceBox" id="sideDiceWidget" aria-live="polite"><div class="sideDiceGrid"></div></button>
        <div id="sideDiceValLabel" class="sideDiceValLabel">—</div>
        <div id="sideDiceLuck" class="sideDiceLuck" hidden></div>
        <div class="diceOutlookTitle" id="diceOutlookTitle"></div>
        <div class="diceFaceRow" id="diceFaceRow"></div>
        <div class="diceHint" id="diceHint"></div>
      </div>`;
    this.box = panel.querySelector("#sideDiceWidget");
    this.grid = panel.querySelector(".sideDiceGrid");
    this.valLabel = panel.querySelector("#sideDiceValLabel");
    this.luckEl = panel.querySelector("#sideDiceLuck");
    this.title = panel.querySelector("#diceOutlookTitle");
    this.row = panel.querySelector("#diceFaceRow");
    this.hint = panel.querySelector("#diceHint");
    this.box.addEventListener("click", () => { if (this.canRoll) this.onRoll?.(); });
    this.row.addEventListener("click", (e) => {
      const b = e.target.closest(".diceFace.pickable");
      if (b) this.onPick?.(Number(b.dataset.die));
    });
  }

  drawPips(value) {
    this.grid.innerHTML = "";
    if (value == null) { this.grid.innerHTML = `<span class="diceQuestionMark">?</span>`; return; }
    const on = new Set(PIPS[value] || []);
    for (let i = 1; i <= 9; i++) {
      const pip = document.createElement("div");
      pip.className = "dicePip" + (on.has(i) ? " active" : "") + (on.has(i) && value === 1 ? " centerRed" : "");
      this.grid.appendChild(pip);
    }
  }

  triggerRollAnimation() {
    this.box.classList.remove("rolling");
    void this.box.offsetWidth;
    this.box.classList.add("rolling");
    setTimeout(() => this.box.classList.remove("rolling"), 450);
  }

  /**
   * @param {object} s
   * @param {number|null} s.value 目前的點數（還沒擲是 null）
   * @param {boolean} s.canRoll 輪到人類且還沒擲：點骰子擲出
   * @param {boolean} s.pickable 可以點某一面指定點數（自選回合、研究模式）
   * @param {string} s.label 骰子下面那行字
   * @param {string} s.hint 最下面的小字
   * @param {{die:number, pct:number|null, dead:boolean}[]|null} s.outlook 骰子展望：每面走最佳步的勝率（輪到的一方角度）；null = 不顯示
   */
  render({ value, canRoll, pickable, label, hint = "", outlook = null, outlookTitle = "", luck = null }) {
    this.canRoll = canRoll;
    this.drawPips(value);
    this.box.disabled = !canRoll;
    this.box.classList.toggle("canRoll", canRoll);
    this.box.title = canRoll ? tr("diceRollTip") : "";
    this.valLabel.textContent = label;
    // 運氣：擲出的點數比六種點數的平均好多少（勝率百分點），直接放在骰子旁，不用點開
    this.luckEl.hidden = luck == null;
    this.luckEl.className = "sideDiceLuck" + (luck > 0.05 ? " pos" : luck < -0.05 ? " neg" : "");
    this.luckEl.textContent = luck == null ? "" : tr("luckLabel") + " " + (luck >= 0 ? "+" : "") + luck.toFixed(1);
    this.luckEl.title = luck == null ? "" : tr("luckTitle");
    this.hint.textContent = hint;
    this.title.textContent = outlook ? outlookTitle : "";
    const faces = outlook || [1, 2, 3, 4, 5, 6].map((d) => ({ die: d, pct: null, dead: false }));
    this.row.hidden = !outlook && !pickable;
    this.row.innerHTML = faces.map((f) => {
      const cls = ["diceFace", f.dead ? "olDead" : "", f.pct != null && f.pct < 35 && !f.dead ? "olLow" : "", f.die === value ? "picked" : "", pickable ? "pickable" : ""].join(" ").replace(/\s+/g, " ").trim();
      const pct = f.dead ? tr("outlookPass") : f.pct == null ? "" : `${f.pct}%`;
      return `<button type="button" class="${cls}" data-die="${f.die}" ${pickable ? "" : "disabled"} aria-label="${tr("outlookAria", { d: f.die, p: pct })}"><span class="olBar" style="--ol:${f.dead || f.pct == null ? 0 : f.pct}%"></span><span class="olNum">${f.die}</span><span class="olPct">${pct}</span></button>`;
    }).join("");
  }
}
