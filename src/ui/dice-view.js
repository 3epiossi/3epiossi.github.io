/**
 * 🎲 骰子黑白棋 (Dice Othello) - 骰子視覺與控制元件 (Dice View)
 */

import { tr } from "../i18n.js";

export class DiceView {
  constructor({ container, sideWidget, onRollClick, onSelectDiceVal }) {
    this.container = container;
    this.sideWidget = sideWidget;
    this.onRollClick = onRollClick;
    this.onSelectDiceVal = onSelectDiceVal;

    this.currentVal = null;
    this.isFreePick = false;
    this.canRoll = false;

    this.init();
  }

  init() {
    if (this.container) {
      this.container.addEventListener("click", (e) => {
        const rollBtn = e.target.closest("#rollDiceBtn");
        if (rollBtn && this.canRoll && this.onRollClick) {
          this.onRollClick();
          return;
        }

        const quickValBtn = e.target.closest(".quickDiceBtn");
        if (quickValBtn && this.isFreePick && this.onSelectDiceVal) {
          const val = Number(quickValBtn.dataset.val);
          this.onSelectDiceVal(val);
        }
      });
    }

    if (this.sideWidget) {
      this.sideWidget.addEventListener("click", (e) => {
        const rollBtn = e.target.closest("#sideRollDiceBtn");
        if (rollBtn && this.canRoll && this.onRollClick) {
          this.onRollClick();
        }
      });
    }
  }

  drawPips(value, gridEl) {
    if (!gridEl) return;
    gridEl.innerHTML = "";
    if (value == null) {
      gridEl.innerHTML = `<span class="diceQuestionMark">?</span>`;
      return;
    }

    const pipMap = {
      1: [5],
      2: [1, 9],
      3: [1, 5, 9],
      4: [1, 3, 7, 9],
      5: [1, 3, 5, 7, 9],
      6: [1, 3, 4, 6, 7, 9]
    };

    const activePips = new Set(pipMap[value] || []);
    for (let i = 1; i <= 9; i++) {
      const pip = document.createElement("div");
      pip.className = "dicePip";
      if (activePips.has(i)) {
        pip.classList.add("active");
        if (value === 1) pip.classList.add("centerRed");
      }
      gridEl.appendChild(pip);
    }
  }

  triggerRollAnimation() {
    const mainBox = this.container ? this.container.querySelector("#diceVisual") : null;
    const sideBox = this.sideWidget ? this.sideWidget.querySelector(".sideDiceBox") : null;
    [mainBox, sideBox].forEach((box) => {
      if (box) {
        box.classList.remove("rolling");
        void box.offsetWidth;
        box.classList.add("rolling");
        setTimeout(() => box.classList.remove("rolling"), 450);
      }
    });
  }

  render({ diceValue, isFreePickTurn, canControl, gameOver, currentTurn, isCpu = false, isReview = false }) {
    this.currentVal = diceValue;
    this.isFreePick = isFreePickTurn;
    this.canRoll = canControl && !gameOver && !isReview;

    // 1. 渲染主面板骰子區
    if (this.container) {
      let statusHtml = "";
      if (gameOver) {
        statusHtml = `<span class="diceStatusText">${tr("diceDone")}</span>`;
      } else if (isReview) {
        statusHtml = diceValue != null
          ? `<span class="diceStatusText" style="color: #f59e0b; font-weight: 600;">${tr("diceHistory", { d: diceValue })}</span>`
          : `<span class="diceStatusText" style="color: #f59e0b; font-weight: 600;">${tr("diceHistoryView")}</span>`;
      } else if (isFreePickTurn) {
        statusHtml = `
          <div class="freePickBanner">
            <span class="freePickBadge">${tr("freeBadge")}</span>
            <span class="freePickDesc">${tr("freeDesc")}</span>
            <div class="quickDiceGroup">
              ${[1, 2, 3, 4, 5, 6].map(d => `
                <button class="quickDiceBtn ${diceValue === d ? 'active' : ''}" data-val="${d}">
                  ${d}
                </button>
              `).join('')}
            </div>
          </div>
        `;
      } else if (diceValue != null) {
        if (isCpu) {
          statusHtml = `<span class="diceStatusText locked" style="color: #c084fc; font-weight: 700;">${tr("diceCpuRolled", { d: diceValue })}</span>`;
        } else {
          statusHtml = `<span class="diceStatusText locked">${tr("diceLocked", { d: diceValue })}</span>`;
        }
      } else if (!canControl) {
        statusHtml = `<span class="diceStatusText thinking">${tr("diceCpuThinking")}</span>`;
      } else {
        statusHtml = `<span class="diceStatusText prompt">${tr("dicePrompt")}</span>`;
      }

      this.container.innerHTML = `
        <div class="diceRow">
          <div class="diceBox" id="diceVisual">
            <div class="diceGrid" id="diceGridMain"></div>
          </div>
          <div class="diceControls">
            <div class="diceStatusWrap">${statusHtml}</div>
            ${this.canRoll ? `<div class="diceBtnWrap"><button id="rollDiceBtn" class="btn primary">${tr("rollBtn")}</button></div>` : ''}
          </div>
        </div>
      `;

      const gridMain = this.container.querySelector("#diceGridMain");
      this.drawPips(diceValue, gridMain);
    }

    // 2. 渲染側邊快捷骰子 Widget
    if (this.sideWidget) {
      const gridSide = this.sideWidget.querySelector(".sideDiceGrid");
      this.drawPips(diceValue, gridSide);

      const sideRollBtn = this.sideWidget.querySelector("#sideRollDiceBtn");
      if (sideRollBtn) {
        sideRollBtn.disabled = !this.canRoll;
      }

      const sideValLabel = this.sideWidget.querySelector(".sideDiceValLabel");
      if (sideValLabel) {
        sideValLabel.textContent = diceValue != null ? tr("steps", { n: diceValue }) : tr("unrolled");
      }
    }
  }
}
