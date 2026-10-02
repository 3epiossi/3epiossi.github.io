/**
 * 💡 骰子黑白棋 (Dice Othello) - 提示分析與候選步排行榜元件 (Hint Analysis & Candidate Moves View)
 */

import { posToCoord } from "../core/rules.js";
import { MOVE_TYPE } from "../core/constants.js";
import { tr } from "../i18n.js";

export class CoachView {
  constructor({ container, onPreviewMove, onApplyMove }) {
    this.container = container;
    this.onPreviewMove = onPreviewMove;
    this.onApplyMove = onApplyMove;
    this.candidates = [];
  }

  render(candidates = [], isThinking = false, emptyMessage = null) {
    if (!this.container) return;
    this.candidates = candidates;

    if (isThinking) {
      this.container.innerHTML = `
        <div class="coachThinking">
          <div class="spinner"></div>
          <div><b>${tr("coachThinking")}</b><br><span style="font-size:12px; color:#94a3b8;">${tr("coachThinkingSub")}</span></div>
        </div>
      `;
      return;
    }

    if (!candidates || candidates.length === 0) {
      const msg = emptyMessage || tr("coachEmptyDefault");
      this.container.innerHTML = `
        <div class="coachEmpty">
          <span style="font-size:24px;">💡</span>
          <div>${msg}</div>
        </div>
      `;
      return;
    }

    const top = candidates[0];
    const topFrom = posToCoord(top.move.fromR != null ? top.move.fromR : top.move.from.r, top.move.fromC != null ? top.move.fromC : top.move.from.c);
    const topTo = posToCoord(top.move.toR != null ? top.move.toR : top.move.to.r, top.move.toC != null ? top.move.toC : top.move.to.c);
    const topIsCap = top.move.type === MOVE_TYPE.CAPTURE;
    const topDiceHint = top.move.usedDiceVal != null ? ` ${tr('stepsParen', { n: top.move.usedDiceVal })}` : '';

    let html = `
      <div class="coachHeader">
        <div class="coachTitle">${tr("coachTitle")}</div>
        <span class="coachBadge">${tr("coachTop")}</span>
      </div>

      <div class="coachBestMoveCard">
        <div class="coachBestMoveRow">
          <div class="coachMoveCoords">
            <span class="crown">👑</span>
            <span class="moveText">${topFrom} ➔ ${topTo}${topDiceHint}</span>
            <span class="typeBadge ${topIsCap ? 'capture' : 'spawn'}">${topIsCap ? tr('tCapture') : tr('tSpawn')}</span>
          </div>
          <button class="btn primary small applyBtn" data-idx="0">${tr("applyThis")}</button>
        </div>

        <div class="coachExplanation">
          <div class="explanationSummary">${top.explanation.summary}</div>
          <div class="explanationPros">
            ${top.explanation.pros.map(p => `<div class="proItem">✓ ${p}</div>`).join('')}
          </div>
          ${top.explanation.cons.length > 0 ? `
            <div class="explanationCons">
              ${top.explanation.cons.map(c => `<div class="conItem">⚠️ ${c}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    if (candidates.length > 1) {
      html += `
        <div class="coachOthersTitle">${tr("coachOthers")}</div>
        <div class="coachCandidateList">
      `;

      for (let i = 1; i < candidates.length; i++) {
        const cand = candidates[i];
        const cFrom = posToCoord(cand.move.fromR != null ? cand.move.fromR : cand.move.from.r, cand.move.fromC != null ? cand.move.fromC : cand.move.from.c);
        const cTo = posToCoord(cand.move.toR != null ? cand.move.toR : cand.move.to.r, cand.move.toC != null ? cand.move.toC : cand.move.to.c);
        const cIsCap = cand.move.type === MOVE_TYPE.CAPTURE;
        const cDiceHint = cand.move.usedDiceVal != null ? ` ${tr('stepsParen', { n: cand.move.usedDiceVal })}` : '';

        html += `
          <div class="candidateItem" data-idx="${i}">
            <div class="candidateLeft">
              <span class="candRank">${cand.rankBadge}</span>
              <span class="candMove">${cFrom} ➔ ${cTo}${cDiceHint}</span>
              <span class="candType ${cIsCap ? 'cap' : 'sp'}">${cIsCap ? '⚔️' : '🌱'}</span>
            </div>
            <div class="candidateRight">
              <button class="btn previewBtn small" data-idx="${i}">${tr("preview")}</button>
              <button class="btn primary small applyBtn" data-idx="${i}">${tr("apply")}</button>
            </div>
          </div>
        `;
      }

      html += `</div>`;
    }

    this.container.innerHTML = html;

    // 綁定按鈕事件
    const applyBtns = this.container.querySelectorAll(".applyBtn");
    applyBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        if (this.candidates[idx] && this.onApplyMove) {
          this.onApplyMove(this.candidates[idx].move);
        }
      });
    });

    const previewBtns = this.container.querySelectorAll(".previewBtn");
    previewBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        if (this.candidates[idx] && this.onPreviewMove) {
          this.onPreviewMove(this.candidates[idx].move);
        }
      });
    });

    const candItems = this.container.querySelectorAll(".candidateItem, .coachBestMoveCard");
    candItems.forEach(item => {
      item.addEventListener("pointerenter", () => {
        const idx = Number(item.dataset.idx || 0);
        if (this.candidates[idx] && this.onPreviewMove) {
          this.onPreviewMove(this.candidates[idx].move);
        }
      });
      item.addEventListener("pointerleave", () => {
        if (this.onPreviewMove) {
          this.onPreviewMove(null);
        }
      });
    });
  }
}
