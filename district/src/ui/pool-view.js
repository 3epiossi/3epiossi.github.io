/**
 * 劃區爭霸 (District) - 側欄：回合行動卡 + 戰況分頁
 *
 * 回合行動卡集中本回合所有操作：抽到的牆塊、放棄、悔棋、提示、自動對戰、快轉。
 * 終局時同一位置換成開票結果卡。下方分頁：選區、分析、紀錄。
 */

import { ICONS } from "./icons.js";
import { escapeHtml } from "./score-view.js";
import { t, fmtNum, shapeName } from "../i18n.js";
import { shareOfNode } from "../ai/luck.js";

function isCoarsePointer() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

function fmt(v) {
  return Number.isInteger(v) ? fmtNum(v) : v.toFixed(1);
}

/** 牆塊縮圖（回合行動卡與規則學院共用） */
export function shapeSvg(shape, color) {
    const unit = 22;
    const pad = 12;
    let maxR = 0;
    let maxC = 0;
    for (const e of shape.edges) {
      maxR = Math.max(maxR, e.type === "V" ? e.r + 1 : e.r);
      maxC = Math.max(maxC, e.type === "H" ? e.c + 1 : e.c);
    }
    const cols = Math.max(2, maxC);
    const rows = Math.max(2, maxR);
    const w = cols * unit + pad * 2;
    const h = rows * unit + pad * 2;
    const ox = pad + ((cols - maxC) * unit) / 2;
    const oy = pad + ((rows - maxR) * unit) / 2;

    let grid = "";
    for (let r = 0; r <= rows; r++) grid += `M${pad} ${pad + r * unit}H${w - pad}`;
    for (let c = 0; c <= cols; c++) grid += `M${pad + c * unit} ${pad}V${h - pad}`;

    const deg = new Map();
    const key = (r, c) => `${r},${c}`;
    for (const e of shape.edges) {
      const v2 = e.type === "H" ? [e.r, e.c + 1] : [e.r + 1, e.c];
      deg.set(key(e.r, e.c), (deg.get(key(e.r, e.c)) || 0) + 1);
      deg.set(key(...v2), (deg.get(key(...v2)) || 0) + 1);
    }
    let walls = "";
    for (const e of shape.edges) {
      const v2 = e.type === "H" ? [e.r, e.c + 1] : [e.r + 1, e.c];
      let x1 = ox + e.c * unit;
      let y1 = oy + e.r * unit;
      let x2 = ox + v2[1] * unit;
      let y2 = oy + v2[0] * unit;
      if (e.type === "H") {
        if (deg.get(key(e.r, e.c)) === 1) x1 += 3;
        if (deg.get(key(...v2)) === 1) x2 -= 3;
      } else {
        if (deg.get(key(e.r, e.c)) === 1) y1 += 3;
        if (deg.get(key(...v2)) === 1) y2 -= 3;
      }
      walls += `M${x1} ${y1}L${x2} ${y2}`;
    }
    const joints = shape.midpoints.map(([mr, mc]) => `<rect x="${ox + mc * unit - 3.5}" y="${oy + mr * unit - 3.5}" width="7" height="7" fill="${color}"/>`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="shapeSvg"><path d="${grid}" stroke="rgba(148,163,184,0.18)" stroke-width="1.5" fill="none"/><path d="${walls}" stroke="${color}" stroke-width="7" fill="none"/>${joints}</svg>`;
}

export class PoolView {
  constructor(container, options = {}) {
    this.container = container;
    this.onSelectPiece = options.onSelectPiece || (() => {});
    this.onPass = options.onPass || (() => {});
    this.onUndo = options.onUndo || (() => {});
    this.onNext = options.onNext || (() => {});
    this.onGoToStep = options.onGoToStep || (() => {});
    this.onToggleHint = options.onToggleHint || (() => {});
    this.onHighlightRegion = options.onHighlightRegion || (() => {});
    this.onHighlightWall = options.onHighlightWall || (() => {});
    this.onNewGame = options.onNewGame || (() => {});
    this.onToggleAuto = options.onToggleAuto || (() => {});
    this.onTogglePause = options.onTogglePause || (() => {});
    this.onRestart = options.onRestart || (() => {});

    this.engine = null;
    this.playerTypes = [];
    this.isPaused = false;
    this.allCpu = false;
    this.isCompareMode = false;
    this.hintMove = null;
    this.selectedIndex = 0;

    this.actionEl = document.createElement("div");
    this.actionEl.className = "actionSlot";
    this.tabsEl = document.createElement("div");
    this.tabsEl.className = "card infoCard";
    this.container.innerHTML = "";
    this.container.appendChild(this.actionEl);
    this.container.appendChild(this.tabsEl);
  }

  get parties() {
    return this.engine ? this.engine.parties : [];
  }

  setEngine(engine) {
    this.engine = engine;
    this.selectedIndex = 0;
    this.hintMove = null;
    this.isCompareMode = false;
    this.render();
  }

  setPlayerTypes(types) {
    this.playerTypes = types;
  }

  setCompareMode(isCompare) {
    this.isCompareMode = Boolean(isCompare);
    this.render();
  }

  setHintMove(hintMove) {
    this.hintMove = hintMove;
    this.render();
  }

  render() {
    if (!this.engine) return;
    const report = this.engine.getAnalyticsReport();
    if (this.engine.isGameOver) {
      this._renderResult(report);
    } else {
      this._renderTurn();
    }
    this._renderInfo(report);
  }

  // ===========================================================================
  // 回合行動卡
  // ===========================================================================

  _renderTurn() {
    const e = this.engine;
    const party = this.parties[e.currentPlayer];
    const review = !e.isAtTip();
    const inBranch = e.inBranch;
    const cpuSeat = this.playerTypes[e.currentPlayer] === "cpu";
    // 電腦暫停中、或正在看歷史局面，都視同輪到玩家：可以直接選牌、下棋（暫停中一下就換成自己下；歷史局面下了就開分支）
    const isCpu = cpuSeat && !this.isPaused && !review;
    const hand = e.candidatePool;
    if (this.selectedIndex === null || this.selectedIndex >= hand.length) this.selectedIndex = 0;
    const piece = hand[this.selectedIndex] || null;
    if (piece) this.onSelectPiece(this.selectedIndex, piece.shape);

    // 說明文字固定兩行高：狀態換來換去時，下面的按鈕不會被推上推下
    const suggestPass = this.hintMove?.action === "pass";
    const help = review
      ? t("helpReview", { n: e.currentStep })
      : inBranch
        ? t("helpBranch", { n: this._forkStep() })
        : suggestPass
          ? t("hintPass")
          : isCpu
            ? (this.allCpu ? t("helpWatch") : t("helpThinking"))
            : this.isPaused
              ? t(this.allCpu ? "helpPausedAll" : "helpPaused")
              : (piece ? (isCoarsePointer() ? t("helpTouch") : t("helpMouse")) : t("helpBagEmpty"));

    // 再放棄幾次就開票：放在標題列右邊的小標籤，不另外佔一行
    const passesLeft = e.passLimit - e.consecutivePasses;
    const passPill = e.consecutivePasses > 0 ? `<span class="turnPill" title="${t("turnWarn", { n: passesLeft })}">${t("turnWarnShort", { n: passesLeft })}</span>` : "";

    // 第三顆按鈕（同五連黑白棋）：暫停中是「繼續」；全是電腦在下是「暫停」；其他時候是「電腦對下」。看歷史局面時電腦不動，這顆停用
    let pauseBtn;
    if (review || inBranch) {
      pauseBtn = `<button type="button" class="toolBtn" data-act="auto" disabled title="${t("autoTitle")}">${ICONS.play}<span>${t("auto")}</span></button>`;
    } else if (this.isPaused) {
      pauseBtn = `<button type="button" class="toolBtn on" data-act="pause" title="${t("resumeTitle")}">${ICONS.play}<span>${t("resume")}</span></button>`;
    } else if (this.allCpu) {
      pauseBtn = `<button type="button" class="toolBtn" data-act="pause" title="${t("pauseTitle")}">${ICONS.pause}<span>${t("pause")}</span></button>`;
    } else {
      pauseBtn = `<button type="button" class="toolBtn" data-act="auto" title="${t("autoTitle")}">${ICONS.play}<span>${t("auto")}</span></button>`;
    }

    this.actionEl.innerHTML = `
      <div class="card turnCard ${review ? "isReview" : ""} ${inBranch ? "isBranch" : ""}" style="--c:${party.color}">
        <div class="turnTop">
          <span class="turnDot"></span>
          <strong class="turnName">${escapeHtml(party.name)}</strong>
          <span class="turnKind">${cpuSeat ? t("kindCpu") : t("kindHuman")}</span>
          ${passPill}
          <span class="turnMeta" title="${t("bagTitle")}">${t("bagLabel", { n: e.wallBag.length })}</span>
        </div>
        <div class="turnBody">
          <div class="handRow ${hand.length > 1 ? "multi" : ""}">
            ${hand.length ? hand.map((p, i) => `<button type="button" class="piecePreview ${i === this.selectedIndex ? "on" : ""}" data-piece="${i}" ${isCpu || hand.length < 2 ? "tabindex=\"-1\"" : ""} title="${shapeName(p.shape.id)}">${this._shapeSvg(p.shape, party.color)}</button>`).join("") : `<div class="piecePreview"></div>`}
          </div>
          <div class="turnText">
            <div class="pieceName">${piece ? shapeName(piece.shape.id) : t("noWall")}${hand.length > 1 ? `<span class="handHint">${t("fromPool", { n: hand.length })}</span>` : ""}</div>
            <div class="turnHelp ${review || inBranch ? "isReview" : ""}">${help}</div>
          </div>
        </div>
        <div class="mainActions">
          <button type="button" class="btn ${suggestPass ? "suggest" : ""}" data-act="pass" ${isCpu ? "disabled" : ""} title="${t("passTitle")}">${ICONS.pass}<span>${t("passBtn")}</span></button>
        </div>
        <div class="toolRow">
          <button type="button" class="toolBtn" data-act="undo" ${e.canUndo() ? "" : "disabled"} title="${t("prevTitle")}">${ICONS.back}<span>${t("prevStep")}</span></button>
          <button type="button" class="toolBtn" data-act="next" ${review ? "" : "disabled"} title="${t("nextTitle")}">${ICONS.forward}<span>${t("nextStep")}</span></button>
          <button type="button" class="toolBtn ${this.hintMove ? "on" : ""}" data-act="hint" ${isCpu ? "disabled" : ""} title="${t("hintTitle")}">${ICONS.hint}<span>${t("hint")}</span></button>
          ${pauseBtn}
          <button type="button" class="toolBtn" data-act="restart" title="${t("newGameTitle")}">${ICONS.refresh}<span>${t("newGameBtn")}</span></button>
        </div>
      </div>
    `;
    this._bindActions();
    this.actionEl.querySelectorAll("[data-piece]").forEach((btn) => btn.addEventListener("click", () => {
      if (isCpu) return;
      this.selectPiece(Number(btn.dataset.piece));
    }));
  }

  selectPiece(index) {
    if (!this.engine || index < 0 || index >= this.engine.candidatePool.length) return;
    this.selectedIndex = index;
    this.render();
  }

  _renderResult(report) {
    const stats = report.partyStats;
    const maxEv = Math.max(...stats.map((s) => s.confirmedElectoralVotes));
    const winners = stats.filter((s) => Math.abs(s.confirmedElectoralVotes - maxEv) < 1e-6);
    const solo = winners.length === 1 ? winners[0] : null;
    const color = solo ? solo.color : "#fbbf24";
    const title = solo ? t("resultWin", { name: escapeHtml(solo.name) }) : t("resultTie", { names: winners.map((w) => escapeHtml(w.name)).join(t("joiner")) });

    let note = t("noteDistricts", { n: report.numDistricts });
    if (solo) {
      const gap = solo.seatVoteGapPct;
      const topVote = Math.max(...stats.map((s) => s.voteShare));
      if (solo.voteShare < topVote - 1e-9) {
        note = t("noteBehind", { pct: solo.voteShare.toFixed(1) });
      } else {
        note = t("noteBonus", { v: solo.voteShare.toFixed(1), s: solo.seatShare.toFixed(1), g: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}` });
      }
    }

    const eg = report.efficiencyGap;
    const egLine = eg !== null ? `<div class="resEg" title="${t("egTitle")}">${t("egLabel", { v: `<strong>${eg.toFixed(1)}</strong>`, note: eg >= 8 ? t("egNote") : "" })}</div>` : "";

    this.actionEl.innerHTML = `
      <div class="card resultCard" style="--c:${color}">
        <div class="resultKicker">${t("resultKicker")}</div>
        <div class="resultTitle">${title}</div>
        <div class="resultNote">${note}</div>
        ${egLine}
        <div class="toolRow">
          <button type="button" class="toolBtn" data-act="undo" ${this.engine.canUndo() ? "" : "disabled"} title="${t("prevTitle")}">${ICONS.back}<span>${t("prevStep")}</span></button>
          <button type="button" class="toolBtn" data-act="next" ${this.engine.isAtTip() ? "disabled" : ""} title="${t("nextTitle")}">${ICONS.forward}<span>${t("nextStep")}</span></button>
          <button type="button" class="toolBtn" disabled title="${t("hintTitle")}">${ICONS.hint}<span>${t("hint")}</span></button>
          <button type="button" class="toolBtn" disabled title="${t("autoTitle")}">${ICONS.play}<span>${t("auto")}</span></button>
          <button type="button" class="toolBtn" data-act="restart" title="${t("newGameTitle")}">${ICONS.refresh}<span>${t("newGameBtn")}</span></button>
        </div>
      </div>
    `;
    this._bindActions();
  }

  _bindActions() {
    const handlers = {
      pass: () => this.onPass(this.selectedIndex ?? 0),
      undo: () => this.onUndo(),
      next: () => this.onNext(),
      hint: () => this.onToggleHint(),
      auto: () => this.onToggleAuto(),
      pause: () => this.onTogglePause(),
      restart: () => this.onRestart(),
      newGame: () => this.onNewGame(),
    };
    this.actionEl.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => handlers[btn.dataset.act]?.());
    });
  }

  // ===========================================================================
  // 戰況分頁
  // ===========================================================================

  // ===========================================================================
  // 戰況卡：紀錄（走勢圖 + 前一手／這一手／下一手）與各黨拿下的選區，同一張卡不用切分頁
  // ===========================================================================

  _renderInfo(report) {
    this._hideChipTip();
    this.tabsEl.innerHTML = `
      <section class="infoSec">${this._historyHtml()}</section>
      <section class="infoSec">${this._districtsHtml(report)}</section>
    `;
    const e = this.engine;
    const last = e.lineNodes().length - 1;
    this.tabsEl.querySelectorAll(".histRow[data-step]").forEach((row) => {
      const stepNo = Number(row.dataset.step);
      row.addEventListener("click", () => this.onGoToStep(stepNo));
      if (row.dataset.wall) {
        const id = Number(row.dataset.wall);
        row.addEventListener("mouseenter", () => this.onHighlightWall(id));
        row.addEventListener("mouseleave", () => this.onHighlightWall(null));
      }
    });
    const svg = this.tabsEl.querySelector(".trendChart");
    if (svg) svg.addEventListener("click", (ev) => {
      const rect = svg.getBoundingClientRect();
      const W = Number(svg.dataset.w), l = Number(svg.dataset.padl), r = Number(svg.dataset.padr);
      const sx = ((ev.clientX - rect.left) / rect.width) * W;
      const st = Math.round(((sx - l) / (W - l - r)) * this._chartXMax);
      if (st >= 0 && st <= last) this.onGoToStep(st);
    });
    this.tabsEl.querySelectorAll(".dChip").forEach((chip) => {
      const id = Number(chip.dataset.id);
      chip.addEventListener("mouseenter", () => { this.onHighlightRegion(id); this._showChipTip(chip, report, id); });
      chip.addEventListener("mouseleave", () => { this.onHighlightRegion(null); this._hideChipTip(); });
    });
  }

  /** 選區編號上的浮動說明：這個選區的票數、狀態、每黨支持票與差距 */
  _showChipTip(chip, report, id) {
    const d = report.districts.find((x) => x.id === id);
    if (!d) return;
    if (!this.chipTip) {
      this.chipTip = document.createElement("div");
      this.chipTip.className = "chipTip";
      document.body.appendChild(this.chipTip);
    }
    const total = Math.max(1, d.support.reduce((a, b) => a + b, 0));
    const status = d.isVoid ? t("tipSplit") : d.isSecured ? t("tipSecured") : d.marginPct <= 8 ? t("tipSwing") : t("tipLead");
    const order = d.support.map((v, p) => p).sort((a, b) => d.support[b] - d.support[a]);
    const rows = order.map((p) => {
      const party = this.parties[p];
      const v = d.support[p];
      return `<div class="ctRow ${d.winners.includes(p) && !d.isVoid ? "win" : ""}" style="--c:${party.color}"><span class="ctName">${escapeHtml(party.name)}</span><span class="ctBar"><i style="width:${(v / total) * 100}%"></i></span><b>${((v / total) * 100).toFixed(1)}%</b><span class="ctVal">${fmtNum(v)}</span></div>`;
    }).join("");
    const margin = d.isVoid || d.isTie ? "" : `<div class="ctMeta">${t("tipMargin", { m: fmtNum(Math.round(d.margin)), p: d.marginPct.toFixed(1) })}</div>`;
    this.chipTip.innerHTML = `<div class="ctHead"><strong>${t("tipDistrict", { n: d.displayId })}</strong><span class="ctStatus">${status}</span></div>
      <div class="ctMeta">${t("tipSize", { v: fmtNum(d.electoralVotes), c: d.cellCount })}</div>${rows}${margin}`;
    this.chipTip.style.display = "block";
    const r = chip.getBoundingClientRect(), tr = this.chipTip.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2));
    const above = r.top - tr.height - 8 >= 8;
    this.chipTip.style.left = `${left}px`;
    this.chipTip.style.top = `${above ? r.top - tr.height - 8 : r.bottom + 8}px`;
  }

  _hideChipTip() {
    if (this.chipTip) this.chipTip.style.display = "none";
  }

  /** 紀錄：只列前一手、這一手、下一手（固定三列，不會跳動）；完整走勢看上面的圖，點圖跳到任一手 */
  _historyHtml() {
    const e = this.engine;
    const line = e.lineNodes();
    const step = e.currentStep, last = line.length - 1;
    const fork = e.inBranch ? this._forkStep() : -1;
    const head = `<div class="secHead"><span class="secTitle">${t("secHistory")}</span><span class="histWhere ${e.inBranch ? "branch" : ""}">${e.inBranch ? t("branchFrom", { n: fork }) : t("branchMain")}</span><span class="histStep">${step} / ${last}</span><span class="histKeys">${t("histKeys")}</span></div>`;
    const row = (i) => {
      if (i < 0 || i > last) return `<div class="histRow empty"></div>`;
      const cls = i === step ? "now" : i > step ? "future" : "past";
      if (i === 0) return `<div class="histRow start ${cls}" data-step="0"><span class="histTurn">0</span><span class="histWhat">${t("histStart")}</span></div>`;
      const node = line[i], h = node.entry;
      const party = this.parties[h.player];
      const what = h.action === "place"
        ? t("histPlace", { shape: h.piece?.shape ? shapeName(h.piece.shape.id) : t("histWall") })
        : t("histDiscard", { shape: h.discarded?.shape ? shapeName(h.discarded.shape.id) : "" });
      const lk = node.luck;
      const luckCell = lk == null ? "<span></span>" : `<span class="histLuck ${lk > 0.05 ? "pos" : lk < -0.05 ? "neg" : ""}" title="${t("luckTitle")}">${t("luckLabel")} ${lk >= 0 ? "+" : ""}${lk.toFixed(1)}</span>`;
      return `<div class="histRow ${h.action} ${cls}" data-step="${i}" data-wall="${h.action === "place" ? h.wallId : ""}" style="--c:${party.color}"><span class="histTurn">${i}</span><span class="histParty">${escapeHtml(party.name)}</span><span class="histWhat">${what}</span>${luckCell}</div>`;
    };
    return `${head}${this._chartHtml()}<div class="histList">${row(step - 1)}${row(step)}${row(step + 1)}</div>`;
  }

  /** 選區：每黨一列，列出拿下的選區編號。實心＝確定、空心＝暫時領先、虛線＝平分（每個平分的黨都列） */
  _districtsHtml(report) {
    const n = this.parties.length;
    const won = Array.from({ length: n }, () => []);
    for (const d of [...report.districts].sort((a, b) => a.displayId - b.displayId)) {
      if (d.isVoid) {
        for (let p = 0; p < n; p++) won[p].push({ d, kind: "split" });
      } else if (d.winners.length > 1) {
        for (const p of d.winners) won[p].push({ d, kind: "split" });
      } else if (d.winners.length === 1) {
        won[d.winners[0]].push({ d, kind: d.isSecured ? "secured" : "lead" });
      }
    }
    const rows = this.parties.map((party, p) => {
      // 平分的選區也算進來：幾個黨平分就各得 1/幾 區（跟計分卡一樣，例如 8.3 區）
      const share = won[p].reduce((sum, { d, kind }) => sum + (kind === "split" ? 1 / (d.isVoid ? n : d.winners.length) : 1), 0);
      const chips = won[p].map(({ d, kind }) => `<span class="dChip ${kind}" data-id="${d.id}">${d.displayId}</span>`).join("");
      return `<div class="distParty" style="--c:${party.color}">
        <div class="dpHead"><span class="dpDot"></span><span class="dpName">${escapeHtml(party.name)}</span><span class="dpCount">${t("dpCount", { n: Number.isInteger(share) ? share : share.toFixed(1) })}</span></div>
        <div class="dChips">${chips || `<span class="dpNone">${t("dpNone")}</span>`}</div>
      </div>`;
    }).join("");
    return `<div class="secHead"><span class="secTitle">${t("secDistricts")}</span><span class="histStep">${t("dpTotal", { n: report.numDistricts })}</span></div>
      <div class="distParties">${rows}</div>
      <div class="dLegend"><span><i class="secured"></i>${t("legSecured")}</span><span><i class="lead"></i>${t("legLead")}</span><span><i class="split"></i>${t("legSplit")}</span></div>`;
  }

  /** 目前正在看的分支從第幾手起（主線回傳 0） */
  _forkStep() {
    const b = this.engine.tree.branches.get(this.engine.tree.activeBranchId);
    return b ? b.forkStepIdx : 0;
  }

  /** 各黨到目前這一步為止的牌運加總（占總選舉人票的百分點） */
  _luckByParty() {
    const n = this.parties.length;
    const sum = Array(n).fill(0), cnt = Array(n).fill(0);
    let pending = false;
    const line = this.engine.lineNodes();
    for (let i = 1; i <= this.engine.currentStep && i < line.length; i++) {
      const node = line[i];
      if (node.luck === undefined) { pending = true; continue; }
      if (node.luck === null) continue;
      sum[node.entry.player] += node.luck;
      cnt[node.entry.player]++;
    }
    return { sum, n: cnt, pending };
  }

  /** 戰況走勢圖：每黨的預期選舉人票占比隨手數變化；在分支上時，主線變暗、分支從分岔點接出去 */
  _chartHtml() {
    const e = this.engine;
    const W = 300, H = 120, pad = { l: 24, r: 6, t: 6, b: 14 };
    const line = e.lineNodes();
    const last = line.length - 1;
    const xMax = Math.max(20, Math.ceil(last / 10) * 10);
    const X = (st) => pad.l + (W - pad.l - pad.r) * (st / xMax);
    const Y = (pct) => pad.t + (H - pad.t - pad.b) * (1 - pct / 100);
    const fork = e.inBranch ? this._forkStep() : 0;
    const pathOf = (nodes, p) => nodes.map((n, i) => `${i ? "L" : "M"}${X(n.stepIdx).toFixed(1)},${Y(shareOfNode(e, n)[p]).toFixed(1)}`).join(" ");
    let svg = `<rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" class="chBg"/>`;
    for (const g of [0, 50, 100]) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(g)}" y2="${Y(g)}" class="chGrid"/><text x="${pad.l - 4}" y="${Y(g) + 3}" class="chLab" text-anchor="end">${g}</text>`;
    if (e.inBranch) {
      const main = e.tree.getBranchHistory("main");
      this.parties.forEach((party, p) => { svg += `<path d="${pathOf(main, p)}" stroke="${party.color}" class="chLine dim"/>`; });
      this.parties.forEach((party, p) => { svg += `<path d="${pathOf(line.slice(fork), p)}" stroke="${party.color}" class="chLine"/>`; });
      svg += `<line x1="${X(fork)}" x2="${X(fork)}" y1="${pad.t}" y2="${H - pad.b}" class="chFork"/>`;
    } else {
      this.parties.forEach((party, p) => { svg += `<path d="${pathOf(line, p)}" stroke="${party.color}" class="chLine"/>`; });
    }
    if (last === 0) this.parties.forEach((party, p) => { svg += `<circle cx="${X(0).toFixed(1)}" cy="${Y(shareOfNode(e, line[0])[p]).toFixed(1)}" r="3" fill="${party.color}"/>`; });
    svg += `<line x1="${X(e.currentStep)}" x2="${X(e.currentStep)}" y1="${pad.t}" y2="${H - pad.b}" class="chNow ${e.inBranch ? "branch" : ""}"/>`;
    svg += `<text x="${pad.l}" y="${H - 2}" class="chLab">0</text><text x="${W - pad.r}" y="${H - 2}" class="chLab" text-anchor="end">${xMax}</text>`;
    this._chartXMax = xMax;
    return `<div class="chartWrap"><svg class="trendChart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-w="${W}" data-padl="${pad.l}" data-padr="${pad.r}">${svg}</svg></div>`;
  }

  // ===========================================================================
  // 牆塊縮圖
  // ===========================================================================

  _shapeSvg(shape, color) {
    return shapeSvg(shape, color);
  }
}

