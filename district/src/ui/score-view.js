/**
 * 劃區爭霸 (District) - 選情計分列
 *
 * 一條選舉人票長條（實色＝確定當選，淡色斜紋＝爭奪中暫時領先）＋ 各政黨票數晶片。
 */

import { t, fmtNum } from "../i18n.js";
import { AI_LEVEL_IDS, DEFAULT_AI_LEVEL } from "../core/constants.js";

function fmt(v) {
  return Number.isInteger(v) ? fmtNum(v) : v.toFixed(1);
}

export class ScoreView {
  constructor(container) {
    this.container = container;
    this.openRole = null; // 目前打開「玩家／電腦」小選單的政黨（重畫後維持開著）
    document.addEventListener("click", (e) => {
      if (this.openRole === null || e.target.closest(".rolePop") || e.target.closest(".pcRole")) return;
      this.openRole = null;
      this.container.querySelectorAll(".rolePop").forEach((el) => { el.hidden = true; });
      this.container.querySelectorAll(".pcRole").forEach((el) => el.setAttribute("aria-expanded", "false"));
    });
  }

  /**
   * options.levels：各政黨的電腦強度；options.onLevel(p, level)：使用者改強度時呼叫
   */
  render(engine, playerTypes, { levels = [], onLevel = null, onSeat = null } = {}) {
    const report = engine.getAnalyticsReport();
    const parties = engine.parties;
    const total = report.totalElectoralVotes || 1;
    const isOver = report.isGameOver;
    const stats = report.partyStats;
    const maxEv = Math.max(...stats.map((s) => s.confirmedElectoralVotes));

    const seg = (ev, color, contested, title) => {
      const pct = (ev / total) * 100;
      if (pct <= 0.05) return "";
      return `<div class="stSeg ${contested ? "contested" : ""}" style="width:${pct}%;--c:${color}" title="${t("segTitle", { title, v: fmt(ev), pct: pct.toFixed(1) })}"></div>`;
    };

    const leadSum = stats.reduce((s, p) => s + p.confirmedElectoralVotes + p.leadingUnsecuredVotes, 0);
    const undecided = Math.max(0, total - leadSum);
    let segments = "";
    if (stats.length === 2) {
      // 兩黨：左右拔河，中間是平手未定
      const [a, b] = stats;
      segments += seg(a.confirmedElectoralVotes, a.color, false, t("segConfirmed", { name: a.name }));
      segments += seg(a.leadingUnsecuredVotes, a.color, true, t("segLeading", { name: a.name }));
      segments += seg(undecided, "#64748b", true, t("segTie"));
      segments += seg(b.leadingUnsecuredVotes, b.color, true, t("segLeading", { name: b.name }));
      segments += seg(b.confirmedElectoralVotes, b.color, false, t("segConfirmed", { name: b.name }));
    } else {
      for (const s of stats) {
        segments += seg(s.confirmedElectoralVotes, s.color, false, t("segConfirmed", { name: s.name }));
        segments += seg(s.leadingUnsecuredVotes, s.color, true, t("segLeading", { name: s.name }));
      }
      segments += seg(undecided, "#64748b", true, t("segTie"));
    }

    const marker = stats.length === 2
      ? `<div class="stMajority" title="${t("majority", { n: fmtNum(Math.floor(total / 2) + 1) })}"></div>`
      : "";

    const chips = stats.map((s) => {
      const p = s.partyId;
      const isTurn = !isOver && p === engine.currentPlayer;
      const isWinner = isOver && Math.abs(s.confirmedElectoralVotes - maxEv) < 1e-6;
      const isCpu = playerTypes[p] === "cpu";
      const kind = isCpu ? t("kindCpu") : t("kindHuman");
      const lv = levels[p] ?? DEFAULT_AI_LEVEL;
      // 開著的對局：點「玩家／電腦 n 級」打開小選單，隨時換人或換強度；終局後只顯示文字
      let head;
      if (isOver || !onSeat) {
        const label = isWinner && !isCpu ? t("statusWon") : (isCpu ? `${kind} · ${escapeHtml(t("aiLevelName", { n: lv }))}` : kind);
        head = `<span class="pcKind">${label}</span>`;
      } else {
        const open = this.openRole === p;
        head = `<button type="button" class="pcRole ${isCpu ? "isCpu" : ""}" data-p="${p}" aria-haspopup="true" aria-expanded="${open}" title="${escapeHtml(t("roleTip"))}">${isCpu ? escapeHtml(t("roleCpu", { n: lv })) : escapeHtml(t("roleHuman"))}</button>`;
      }
      const pop = !isOver && onSeat ? `
        <div class="rolePop" data-p="${p}" ${this.openRole === p ? "" : "hidden"}>
          <div class="seatToggle" role="group">
            <button type="button" class="seatBtn ${isCpu ? "" : "active"}" data-p="${p}" data-owner="human">${t("seatHuman")}</button>
            <button type="button" class="seatBtn ${isCpu ? "active" : ""}" data-p="${p}" data-owner="cpu">${t("seatCpu")}</button>
          </div>
          <select class="pcLevel" data-p="${p}" ${isCpu ? "" : "disabled"} aria-label="${escapeHtml(t("cpuLevel"))}" title="${escapeHtml(t("cpuLevel"))}">${AI_LEVEL_IDS.map((l) => `<option value="${l}" ${lv === l ? "selected" : ""}>${escapeHtml(t("aiLevelName", { n: l }))}</option>`).join("")}</select>
        </div>` : "";
      // 選舉人票占比：終局看開票結果，進行中看目前領先的暫時數字（劃區紅利看紀錄的走勢圖，運氣看紀錄的每一步）
      const seat = isOver ? s.seatShare : s.provisionalSeatShare;
      return `
        <div class="partyChip ${isTurn ? "isTurn" : ""} ${isWinner ? "isWinner" : ""}" style="--c:${parties[p].color}">
          <div class="pcHead">
            <span class="pcDot"></span>
            <span class="pcName">${escapeHtml(parties[p].name)}</span>
            ${head}
          </div>
          <div class="pcVotes">${fmt(s.confirmedElectoralVotes)}<small>${t("votesUnit")}</small><span class="pcPct" title="${escapeHtml(t("barSeat"))}">${seat.toFixed(1)}%</span></div>
          ${pop}
        </div>`;
    }).join("");


    // 政黨卡在上、選舉人票長條在下
    this.container.innerHTML = `
      <div class="partyChips" style="--n:${stats.length}">${chips}</div>
      <div class="scoreTrack" role="img" aria-label="${t("trackLabel")}">${segments}${marker}</div>
    `;
    if (onLevel) {
      this.container.querySelectorAll(".pcLevel").forEach((sel) => {
        sel.addEventListener("change", () => onLevel(Number(sel.dataset.p), Number(sel.value)));
      });
    }
    if (onSeat) {
      this.container.querySelectorAll(".pcRole").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const p = Number(btn.dataset.p);
          this.openRole = this.openRole === p ? null : p;
          this.container.querySelectorAll(".rolePop").forEach((el) => { el.hidden = Number(el.dataset.p) !== this.openRole; });
          this.container.querySelectorAll(".pcRole").forEach((el) => el.setAttribute("aria-expanded", String(Number(el.dataset.p) === this.openRole)));
        });
      });
      this.container.querySelectorAll(".seatBtn").forEach((btn) => {
        btn.addEventListener("click", () => onSeat(Number(btn.dataset.p), btn.dataset.owner));
      });
    }
  }
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
