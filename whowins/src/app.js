/**
 * 誰會贏？ 主控制器。架構與五連黑白棋相同：engine（規則與對局樹）→ session（席位控制）→ sync() 推導 → render() 繪製。
 * 局面分析（勝率條、勝率走勢、提示、走法評價、骰子展望、骰運）共用同一份快取在節點上的分析，見 scheduleAnalysis。
 */

import { N, EMPTY, BLACK, WHITE, MOVE_TYPE, DEFAULT_KOMI } from "./core/constants.js";
import { posToCoord, cloneBoard } from "./core/rules.js";
import { GameEngine } from "./core/game-engine.js";
import { parseSeed } from "./core/dice.js";
import { BoardView, markWhyText, MARK_CLASS, MARK_TIP } from "./ui/board-view.js";
import { DiceView } from "./ui/dice-view.js";
import { EvalBar, displayWinProb } from "./ui/eval-bar.js";
import { WinChart } from "./ui/win-chart.js";
import { SkinPanel } from "./ui/skin-panel.js";
import { ModalManager } from "./ui/modal-manager.js";
import { SkinManager } from "./ui/skin-workshop.js";
import { sound } from "./ui/sound.js";
import { Storage } from "./storage/storage.js";
import { initI18n, applyI18n, setLang, tr, tx, pieceify, escapeHtml, clampName } from "./i18n.js";
import { openHelp } from "../../shared/help.js";
import { AiClient } from "./engine/ai-client.js";
import { encodeMove, decodeMove } from "./engine/service.js";
import { LEVELS, MAX_LEVEL, clampLevel, isTimedLevel } from "./engine/levels.js";
import { classifyMove, luckOf, moveAccuracy } from "./engine/move-quality.js";
import { buildRecord, replayRecord } from "./history/record.js";
import { VIEW, CTRL, HUMAN, CPU_SEAT, seatKey, createSession, deriveUiState } from "./core/control-state.js";

const MARK_ORDER = ["!!", "!", "!?", "?!", "?", "??"];

const SAVE_VERSION = 1;

/**
 * 下棋節奏：只管看起來多快，不影響棋力與分析（那是「AI 思考時間」管的）。
 *   roll：輪到 CPU 到骰子擲出來的等待    gap：CPU 從輪到它到落子至少隔這麼久
 *   pick：自選點數時，先亮出點數再落子的停頓    pass：沒有合法走法時，停多久再自動 PASS
 */
const PACES = {
  slow:    { roll: 900, gap: 2600, pick: 1000, pass: 1100 },
  normal:  { roll: 450, gap: 1300, pick: 600,  pass: 800 },
  fast:    { roll: 150, gap: 450,  pick: 200,  pass: 350 },
  instant: { roll: 0,   gap: 0,    pick: 0,    pass: 0 }
};

/** 局面分析的分級：第 1 級（T）勝率條的下限、第 2 級（2T）教練強度，走法評價在這一級確認；你還在想時繼續加深 */
const COACH_LEVEL = 2;
const LEVEL_FACTORS = [1, 2, 3, 5, 8, 13];
const MAX_ANALYSIS_LEVEL = LEVEL_FACTORS.length;
const MAX_JOB_MS = 30000;
const LOW_POWER = typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches || (navigator.hardwareConcurrency || 8) <= 4);
const MAX_LEVEL_LOW_POWER = 4;
const TOUCH = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const piecesOf = (board) => { let n = 0; for (const row of board) for (const v of row) if (v) n++; return n; };
const sqOf = (m) => m.to.r * 8 + m.to.c;

export class WhoWinsApp {
  constructor() {
    this.settings = Storage.getSettings();
    initI18n({ black: this.settings.blackName, white: this.settings.whiteName });
    sound.setEnabled(this.settings.soundEnabled);
    this.skinManager = new SkinManager();
    this.skinPanel = new SkinPanel(this);

    const blackSeat = this.settings.blackRole || HUMAN;
    const whiteSeat = this.settings.whiteRole || CPU_SEAT;
    this.engine = new GameEngine({ komi: this.settings.komi ?? DEFAULT_KOMI });
    this.session = createSession({ black: blackSeat, white: whiteSeat });
    this.ui = deriveUiState({ session: this.session, turn: this.engine.currentTurn, gameOver: false, isAtTip: true });

    this.cpuTimer = null;
    this.cpuRequest = null;
    this.cpuDie = null;
    this.aiClient = new AiClient();
    this.analysisClient = new AiClient({ eager: false });
    this.analysis = new Map();      // 節點 id → { value, perDie, depth, level }（輪到的一方角度的引擎勝率）
    this.analysisJob = null;
    this.analysisGen = 0;
    this.confirmNeed = new Set();   // 走法評價等著確認（要第 2 級分析）的局面
    this.passTimer = null;
    this.hintOn = false;
    this.hoverMove = null;          // 滑鼠所在落點要下的走法（預覽）
    this.hoverAlt = [];             // 滑鼠所在落點有好幾顆棋能吃時，各顆的吃子走法（只畫路徑）
    this.renderCount = 0;
    this.researchSeats = null;

    this.init();
  }

  init() {
    ModalManager.init();
    applyI18n();

    this.boardView = new BoardView({
      boardContainer: document.getElementById("boardContainer"),
      svgOverlay: document.getElementById("movePathSvg"),
      onCellClick: (r, c) => this.handleCellClick(r, c),
      onCellHover: (r, c, isEnter) => this.handleCellHover(r, c, isEnter)
    });
    this.diceView = new DiceView({
      panel: document.getElementById("sideDicePanel"),
      onRoll: () => this.handleRollDice(),
      onPick: (d) => this.handlePickDie(d)
    });
    this.evalBar = new EvalBar(document.getElementById("evalBar"));
    this.winChart = new WinChart({ container: document.getElementById("historyBox"), onPick: (step) => this.goToStep(step) });

    this.engine.subscribe((event, payload) => this.handleEngineEvent(event, payload));

    this.bindDOMEvents();
    this.bindKeyboardShortcuts();
    this.applyTheme(this.settings.theme || "neon");
    this.applyAnimationLevel();

    if (!this.loadGame()) this.newGame();
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;

    if (!Storage.hasSeenOnboarding()) setTimeout(() => this.openTutorialModal(), 500);
    this.checkDeveloperMode();
    this.sync();
  }

  // ===== 新局 =====

  openNewGameModal() {
    const input = document.getElementById("newGameSeed");
    if (input) input.value = "";
    ModalManager.open("newGameModal");
    document.getElementById("newGameOkBtn")?.focus({ preventScroll: true });
  }

  newGame(seed = null) {
    this.engine.komi = this.settings.komi ?? DEFAULT_KOMI;
    this.engine.resetGame({ seed });
  }

  // ===== 設定值 =====

  pace() { return PACES[this.settings.pace] || PACES.normal; }
  isInstant() { return this.settings.pace === "instant"; }
  animMinimal() { return this.settings.animationLevel === "minimal" || this.isInstant(); }
  thinkMs() { return this.settings.thinkMs || 500; }

  applyAnimationLevel() {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && (this.settings.animationLevel || "standard") === "standard";
    document.documentElement.dataset.anim = this.isInstant() || reduce ? "minimal" : (this.settings.animationLevel || "standard");
  }

  // ===== 事件綁定 =====

  bindDOMEvents() {
    const applyName = (side, v) => {
      this.settings[side + "Name"] = v;
      window.takuNames = { ...window.takuNames, [side]: v };
      Storage.saveSettings(this.settings);
      const input = document.getElementById(side === "black" ? "settingBlackName" : "settingWhiteName");
      if (input) input.value = v;
      applyI18n();
      this.sync();
    };
    document.querySelectorAll(".seatGroup .seatLabel").forEach((label) => {
      const side = label.closest(".seatGroup").dataset.side;
      label.style.cursor = "pointer";
      label.title = tr("renameTip");
      label.addEventListener("click", () => {
        const v = window.prompt(tr("renamePrompt"), this.settings[side + "Name"] || "");
        if (v !== null) applyName(side, clampName(v).trim());
      });
    });
    for (const side of ["black", "white"]) {
      const input = document.getElementById(side === "black" ? "settingBlackName" : "settingWhiteName");
      if (!input) continue;
      input.value = this.settings[side + "Name"] || "";
      input.placeholder = tr(side);
      const clampInput = (e) => {
        if (e && e.isComposing) return;
        const clamped = clampName(input.value);
        if (clamped !== input.value) input.value = clamped;
      };
      input.addEventListener("compositionend", () => { clampInput(); input.dispatchEvent(new Event("input")); });
      input.addEventListener("input", (e) => {
        if (e.isComposing) return;
        clampInput(e);
        const v = input.value.trim();
        this.settings[side + "Name"] = v;
        window.takuNames = { ...window.takuNames, [side]: v };
        Storage.saveSettings(this.settings);
        applyI18n();
        this.sync();
      });
    }

    window.addEventListener("langchange", () => {
      for (const side of ["black", "white"]) {
        const input = document.getElementById(side === "black" ? "settingBlackName" : "settingWhiteName");
        if (input) input.placeholder = tr(side);
      }
      document.querySelectorAll(".seatGroup .seatLabel").forEach((l) => { l.title = tr("renameTip"); });
      this.fillLevelSelects();
      this.sync();
      if (document.getElementById("skinModal")?.classList.contains("open")) this.skinPanel.renderSkinWorkshop();
    });

    document.getElementById("rulesBtn")?.addEventListener("click", () => this.openTutorialModal());
    document.getElementById("exportBtn")?.addEventListener("click", () => this.exportRecord());
    document.getElementById("importBtn")?.addEventListener("click", () => this.openImportModal());
    document.getElementById("themeToggleBtn")?.addEventListener("click", () => this.openSkinModal());
    document.getElementById("langSelect")?.addEventListener("change", (e) => setLang(e.target.value));

    // 玩家卡：點「我／CPU 幾級」打開小選單，點外面關掉
    const closeRolePops = (except = null) => {
      document.querySelectorAll(".rolePop").forEach((pop) => {
        if (pop === except) return;
        pop.hidden = true;
        pop.closest(".playerCard")?.querySelector(".pcRole")?.setAttribute("aria-expanded", "false");
      });
    };
    document.querySelectorAll(".pcRole").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pop = btn.closest(".playerCard").querySelector(".rolePop");
        closeRolePops(pop);
        let note = pop.querySelector(".roleNote");
        if (!note) { note = document.createElement("p"); note.className = "roleNote"; pop.prepend(note); }
        note.textContent = btn.dataset.locked ? tr(btn.dataset.locked === "research" ? "roleLockedResearch" : "roleLockedReview") : "";
        note.hidden = !btn.dataset.locked;
        pop.hidden = !pop.hidden;
        btn.setAttribute("aria-expanded", String(!pop.hidden));
      });
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".rolePop")) closeRolePops(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRolePops(); });

    window.addEventListener("pagehide", () => this.saveGame());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.cancelAnalysisJob();
        this.saveGame();
        if (this.session.seats.black === CPU_SEAT && this.session.seats.white === CPU_SEAT && !this.session.paused) this.handlePauseCpu();
      } else this.scheduleAnalysis();
    });

    const soundBtn = document.getElementById("soundToggleBtn");
    soundBtn?.addEventListener("click", () => {
      this.settings.soundEnabled = !this.settings.soundEnabled;
      sound.setEnabled(this.settings.soundEnabled);
      soundBtn.textContent = tr(this.settings.soundEnabled ? "soundOn" : "soundOff");
      Storage.saveSettings(this.settings);
    });

    document.getElementById("restartBtn")?.addEventListener("click", () => this.openNewGameModal());
    document.getElementById("newGameCancelBtn")?.addEventListener("click", () => ModalManager.close("newGameModal"));
    document.getElementById("newGameOkBtn")?.addEventListener("click", () => {
      const seed = parseSeed(document.getElementById("newGameSeed")?.value);
      ModalManager.close("newGameModal");
      this.teardown();
      this.newGame(seed);
      this.sync();
    });
    document.getElementById("newGameSeed")?.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("newGameOkBtn")?.click(); });

    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button.seatBtn");
      if (btn && !btn.disabled) this.setSeat(btn.dataset.side, btn.dataset.owner);
    });

    document.getElementById("hintBtn")?.addEventListener("click", () => this.toggleHint());
    document.getElementById("resumeHereBtn")?.addEventListener("click", () => this.resumeHere());
    document.getElementById("historyFirstBtn")?.addEventListener("click", () => this.goToStep(0));
    document.getElementById("historyPrevBtn")?.addEventListener("click", () => this.goToStep(this.currentStep() - 1));
    document.getElementById("historyNextBtn")?.addEventListener("click", () => this.goToStep(this.currentStep() + 1));
    document.getElementById("historyLatestBtn")?.addEventListener("click", () => this.goToStep(this.engine.tree.getBranchHistory().length - 1));
    document.getElementById("watchBtn")?.addEventListener("click", () => this.handleWatchCpuVsCpu());
    document.getElementById("pauseResumeBtn")?.addEventListener("click", () => {
      if (this.ui.ctrl === CTRL.CPU) this.handlePauseCpu();
      else if (this.ui.ctrl === CTRL.PAUSED) this.handleResumeCpu();
    });

    document.querySelectorAll(".modalCloseBtn, .modalCancelBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modal = btn.closest(".modalBackdrop");
        if (modal) ModalManager.close(modal.id);
      });
    });

    // 匯入棋譜
    document.getElementById("importPickBtn")?.addEventListener("click", () => document.getElementById("importFile")?.click());
    document.getElementById("importFile")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) document.getElementById("importText").value = await file.text();
      e.target.value = "";
    });
    document.getElementById("importOkBtn")?.addEventListener("click", () => this.importFromText(document.getElementById("importText")?.value || ""));

    this.fillLevelSelects();
    this.bindSettingsForm();
  }

  /** 難度選單：1 ~ MAX_LEVEL 級，名稱依語言 */
  fillLevelSelects() {
    for (const id of ["settingBlackLevel", "settingWhiteLevel"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cur = el.value;
      el.innerHTML = LEVELS.map((l) => `<option value="${l.id}">${escapeHtml(tr("levelName", { n: l.id }))}</option>`).join("");
      if (cur) el.value = cur;
    }
    const b = document.getElementById("settingBlackLevel"), w = document.getElementById("settingWhiteLevel");
    if (b) b.value = String(clampLevel(this.settings.blackLevel));
    if (w) w.value = String(clampLevel(this.settings.whiteLevel));
  }

  bindSettingsForm() {
    const bind = (id, apply, initial) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === "checkbox") { el.checked = !!initial; el.addEventListener("change", (e) => apply(e.target.checked)); return; }
      el.value = String(initial);
      el.addEventListener("change", (e) => apply(e.target.value));
    };
    bind("settingBlackLevel", (v) => { this.settings.blackLevel = clampLevel(v); Storage.saveSettings(this.settings); this.render(); }, clampLevel(this.settings.blackLevel));
    bind("settingWhiteLevel", (v) => { this.settings.whiteLevel = clampLevel(v); Storage.saveSettings(this.settings); this.render(); }, clampLevel(this.settings.whiteLevel));
    bind("settingThink", (v) => { this.settings.thinkMs = Number(v) || 500; Storage.saveSettings(this.settings); }, this.thinkMs());
    bind("settingPace", (v) => { this.settings.pace = PACES[v] ? v : "normal"; Storage.saveSettings(this.settings); this.applyAnimationLevel(); }, PACES[this.settings.pace] ? this.settings.pace : "normal");
    bind("settingKomi", (v) => { this.settings.komi = Number(v); Storage.saveSettings(this.settings); }, this.settings.komi ?? DEFAULT_KOMI);
    bind("settingAutoRoll", (v) => { this.settings.autoRoll = !!v; Storage.saveSettings(this.settings); this.sync(); }, this.settings.autoRoll);
  }

  bindKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (ModalManager.activeModals.size > 0) return;
      switch (e.key) {
        case "Escape":
          if (this.engine.selectedCell) { e.preventDefault(); this.engine.selectedCell = null; this.engine.legalMovesForSelected = { spawns: [], captures: [] }; this.render(); }
          break;
        case "ArrowLeft": e.preventDefault(); this.goToStep(this.currentStep() - 1); break;
        case "ArrowRight": e.preventDefault(); this.goToStep(this.currentStep() + 1); break;
        case " ":
          // 空白鍵：輪到你且還沒擲就擲骰；CPU 在下就暫停／繼續
          if (this.canRoll()) { e.preventDefault(); this.handleRollDice(); }
          else if (this.ui.ctrl === CTRL.CPU) { e.preventDefault(); this.handlePauseCpu(); }
          else if (this.ui.ctrl === CTRL.PAUSED) { e.preventDefault(); this.handleResumeCpu(); }
          break;
        case "r": case "R": if (this.canRoll()) { e.preventDefault(); this.handleRollDice(); } break;
        case "h": case "H": e.preventDefault(); this.toggleHint(); break;
        case "1": case "2": case "3": case "4": case "5": case "6":
          if (this.dicePickable()) { e.preventDefault(); this.handlePickDie(Number(e.key)); }
          break;
      }
    });
  }

  applyTheme(themeKey) {
    document.body.className = `theme-${themeKey}`;
    this.settings.theme = themeKey;
    Storage.saveSettings(this.settings);
  }

  // ===== 遊戲事件 =====

  handleEngineEvent(event, payload) {
    if (event === "DICE_ROLLED") {
      if (!this.isInstant()) sound.playDiceRoll();
      this.diceView?.triggerRollAnimation();
    } else if (event === "MOVE_EXECUTED") {
      if (!this.isInstant()) payload.move.type === MOVE_TYPE.CAPTURE ? sound.playCapture() : sound.playSpawn();
    } else if (event === "GAME_OVER") {
      sound.playVictory();
      this.session.assist = null;
      setTimeout(() => this.celebrate(payload), 80);
    } else if (event === "GAME_RESET") {
      this.teardown();
      this.analysisGen++; this.analysis.clear(); this.confirmNeed.clear();
      this.cancelAnalysisJob();
      this.resetSessionToSettings();
    }
    this.sync();
  }

  // ===== 存檔 =====

  saveGame() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const r4 = (x) => Math.round(x * 1e4) / 1e4;
    const analysis = [];
    for (const [id, a] of this.analysis) {
      if (!this.engine.tree.getNode(id)) continue;
      analysis.push([id, a.level, a.depth || 0, r4(a.value),
        a.perDie.map((pd) => pd ? [pd.die, r4(pd.value), pd.move ? pd.move.code : -1, (pd.moves || []).map((m) => [m.move ? m.move.code : -1, r4(m.value)])] : 0)]);
    }
    Storage.saveGame({ format: "who-will-win-save", v: SAVE_VERSION, komi: this.engine.komi, tree: this.engine.tree.toJSON(), analysis });
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveGame(), 400);
  }

  loadGame() {
    const data = Storage.loadGame();
    if (!data || data.format !== "who-will-win-save" || data.v !== SAVE_VERSION) return false;
    try {
      if (data.komi != null) this.engine.komi = data.komi;
      this.engine.restoreTree(data.tree);
    } catch (e) {
      console.warn("存檔讀不回來，開新局", e);
      return false;
    }
    for (const [id, level, depth, value, perDie] of data.analysis || []) {
      if (!this.engine.tree.getNode(id)) continue;
      this.analysis.set(id, {
        level, depth, value,
        perDie: perDie.map((pd) => pd ? { die: pd[0], value: pd[1], move: pd[2] >= 0 ? decodeMove(pd[2]) : null, moves: pd[3].map(([c, v]) => ({ move: c >= 0 ? decodeMove(c) : null, value: v })) } : null)
      });
    }
    return true;
  }

  // ===== 狀態推導與同步中樞 =====

  /** 分支研究：只要正在看分支，就是自己替雙方下（雙方都是人類、不存進設定）；回到主線就換回原本的席位 */
  syncResearchMode() {
    const inBranch = this.engine.tree.activeBranchId !== "main";
    if (inBranch && !this.researchSeats) {
      this.researchSeats = { ...this.session.seats };
      this.session.seats.black = HUMAN; this.session.seats.white = HUMAN;
      this.session.assist = null; this.session.paused = false;
    } else if (!inBranch && this.researchSeats) {
      this.session.seats.black = this.researchSeats.black;
      this.session.seats.white = this.researchSeats.white;
      this.researchSeats = null;
    } else if (inBranch && (this.session.seats.black !== HUMAN || this.session.seats.white !== HUMAN)) {
      this.session.seats.black = HUMAN; this.session.seats.white = HUMAN;
    }
  }

  /** 目前這一手能不能擲骰：輪到人類（或暫停中的 CPU）、最新一步、還沒擲 */
  canRoll() {
    const e = this.engine;
    if (e.gameOver || this.passTimer || e.diceValue != null || e.isFreePickTurn) return false;
    if (this.ui.view === VIEW.LIVE) return this.ui.ctrl === CTRL.HUMAN || this.ui.ctrl === CTRL.PAUSED;
    return false;
  }

  /** 骰子的每一面能不能點：自選點數的回合，或研究模式（歷史與分支）指定點數；正式對局的擲骰不能指定 */
  dicePickable() {
    const e = this.engine;
    if (e.gameOver || this.passTimer) return false;
    if (this.ui.view === VIEW.REVIEW) return true;
    if (this.ui.view !== VIEW.LIVE) return false;
    if (this.ui.ctrl !== CTRL.HUMAN && this.ui.ctrl !== CTRL.PAUSED) return false;
    if (e.isFreePickTurn && e.diceValue == null) return true;
    return !!this.researchSeats; // 分支研究中：隨時可以重指定點數
  }

  sync() {
    this.syncResearchMode();
    if (this.session.paused && !(this.session.seats.black === CPU_SEAT && this.session.seats.white === CPU_SEAT)) {
      this.session.paused = false;
    }
    const tipNode = this.engine.tree.getBranchTipNode();
    const currNode = this.engine.tree.getCurrentNode();
    const isAtTip = Boolean(currNode && tipNode && currNode.id === tipNode.id);
    const derive = (passPending) => deriveUiState({
      session: this.session, turn: this.engine.currentTurn, gameOver: this.engine.gameOver, isAtTip, passPending
    });
    this.ui = derive(Boolean(this.passTimer));

    const e = this.engine;
    // 擲出的點數沒有合法走法：稍等一下讓玩家看清楚，然後自動 PASS（對手免擲骰、自選點數）
    const mustPass = this.ui.view === VIEW.LIVE && !e.gameOver && (e.diceValue != null || e.isFreePickTurn) && e.legalMoves().length === 0;
    if (mustPass && !this.passTimer) {
      if (!this.isInstant()) sound.playPass();
      this.passTimer = setTimeout(() => { this.passTimer = null; this.engine.passTurn(); }, this.pace().pass);
      this.ui = derive(true);
    }

    // 自動擲骰（設定）：輪到人類、最新一步、還沒擲
    if (this.settings.autoRoll && this.ui.view === VIEW.LIVE && this.ui.ctrl === CTRL.HUMAN && this.canRoll() && !this.rollQueued) {
      this.rollQueued = true;
      setTimeout(() => { this.rollQueued = false; if (this.canRoll() && this.ui.ctrl === CTRL.HUMAN) this.handleRollDice(); }, this.isInstant() ? 0 : 350);
    }

    if (this.ui.runCpuTimer && !this.cpuTimer && !this.cpuRequest) this.startCpuTimer();
    else if (!this.ui.runCpuTimer && (this.cpuTimer || this.cpuRequest)) this.stopCpuTimer();

    this.render();
  }

  teardown() {
    this.stopCpuTimer();
    if (this.passTimer) { clearTimeout(this.passTimer); this.passTimer = null; }
    this.hoverMove = null; this.hoverAlt = [];
    this.engine.selectedCell = null;
    this.engine.legalMovesForSelected = { spawns: [], captures: [] };
  }

  // ===== 玩家操作 =====

  /** 輪到人類、CPU 暫停時接手，或在歷史某一步（下了就開分支） */
  canHumanAct() {
    if (this.engine.gameOver || this.passTimer) return false;
    if (this.ui.view === VIEW.REVIEW) return true;
    if (this.ui.view !== VIEW.LIVE) return false;
    return this.ui.ctrl === CTRL.HUMAN || this.ui.ctrl === CTRL.PAUSED;
  }

  handleRollDice() {
    if (!this.canRoll()) return;
    this.engine.rollDice();
  }

  /** 點骰子的某一面：自選點數的回合直接用那個點數；研究模式指定這一手的點數（歷史上點數不同就開分支） */
  handlePickDie(d) {
    if (!this.dicePickable()) return;
    this.hoverMove = null; this.hoverAlt = [];
    if (this.ui.view === VIEW.LIVE) this.takeOverIfPaused();
    if (this.engine.isAtTip() && this.engine.isFreePickTurn && !this.researchSeats) this.engine.rollDice(d);
    else this.engine.chooseDie(d);
    this.sync();
  }

  handleCellClick(r, c) {
    if (!this.canHumanAct()) return;
    const e = this.engine;
    if (e.diceValue == null && !e.isFreePickTurn) return; // 還沒擲骰
    const turn = e.currentTurn;
    if (e.board[r][c] === turn) {
      const sel = e.selectedCell;
      if (sel && sel.r === r && sel.c === c) { e.selectedCell = null; e.legalMovesForSelected = { spawns: [], captures: [] }; this.hoverMove = null; this.hoverAlt = []; this.render(); return; }
      e.selectPiece(r, c);
      this.hoverMove = null; this.hoverAlt = [];
      this.sync();
      return;
    }
    const move = this.moveAt(r, c);
    if (!move) {
      if (e.selectedCell) { e.selectedCell = null; e.legalMovesForSelected = { spawns: [], captures: [] }; this.render(); }
      return;
    }
    if (this.ui.view === VIEW.LIVE) this.takeOverIfPaused();
    this.executeMove(move);
  }

  /** 點 (r, c) 要下的走法：選了棋子就從它的走法找；沒選就從所有走法找（生子的結果相同，取第一個；吃子有好幾顆能吃就要先選棋子） */
  moveAt(r, c) {
    const e = this.engine;
    const sel = e.selectedCell;
    const pool = sel
      ? [...e.legalMovesForSelected.spawns, ...e.legalMovesForSelected.captures].map((m) => ({ ...m, usedDiceVal: m.usedDiceVal || e.diceValue }))
      : e.legalMoves();
    const at = pool.filter((m) => m.toR === r && m.toC === c);
    if (!at.length) return null;
    if (sel) return at[0];
    const caps = at.filter((m) => m.type === MOVE_TYPE.CAPTURE);
    if (caps.length > 1) return null; // 好幾顆棋都能吃：先點要用的那一顆
    return caps[0] || at[0];
  }

  /** (r, c) 有好幾顆自己的棋都能吃（沒選棋子時點不下去）：回傳這些吃子走法，給懸停時畫出每一條路徑 */
  ambiguousCaptures(r, c) {
    const e = this.engine;
    if (e.selectedCell) return [];
    const caps = e.legalMoves().filter((m) => m.type === MOVE_TYPE.CAPTURE && m.toR === r && m.toC === c);
    return caps.length > 1 ? caps.map((m) => ({ ...m, usedDiceVal: m.usedDiceVal || e.diceValue })) : [];
  }

  handleCellHover(r, c, isEnter) {
    if (!this.canHumanAct() || (this.engine.diceValue == null && !this.engine.isFreePickTurn)) return;
    if (!isEnter) {
      if ((this.hoverMove && this.hoverMove.toR === r && this.hoverMove.toC === c) || this.hoverAlt.length) { this.hoverMove = null; this.hoverAlt = []; this.render(); }
      return;
    }
    const mine = this.engine.board[r][c] === this.engine.currentTurn;
    const m = mine ? null : this.moveAt(r, c);
    const alts = mine || m ? [] : this.ambiguousCaptures(r, c);
    const sameAlts = alts.length === this.hoverAlt.length && alts.every((a, i) => a.fromR === this.hoverAlt[i].fromR && a.fromC === this.hoverAlt[i].fromC);
    if (m && !(this.hoverMove && this.hoverMove.toR === r && this.hoverMove.toC === c)) { this.hoverMove = m; this.hoverAlt = []; this.render(); }
    else if (!m && alts.length && !sameAlts) { this.hoverMove = null; this.hoverAlt = alts; this.render(); }
    else if (!m && !alts.length && (this.hoverMove || this.hoverAlt.length)) { this.hoverMove = null; this.hoverAlt = []; this.render(); }
  }

  takeOverIfPaused() {
    if (this.ui.ctrl !== CTRL.PAUSED) return;
    const side = seatKey(this.engine.currentTurn);
    this.session.assist = null;
    if (this.session.seats[side] !== HUMAN) this.setSeat(side, HUMAN);
    else { this.session.paused = false; this.sync(); }
  }

  /** 下一步（actor：誰下的，記在節點上，匯出棋譜用）。在歷史某一步下會開分支（見 GameEngine.executeMove） */
  executeMove(move, actor = "human") {
    this.stopCpuTimer();
    this.hoverMove = null; this.hoverAlt = [];
    const e = this.engine;
    const player = e.currentTurn;
    // 回顧歷史時下的這一步跟紀錄裡的下一手一模一樣 → 等同按「下一手」，不開分支
    const step = this.currentStep();
    const nextNode = e.tree.getBranchHistory()[step + 1];
    const nm = nextNode?.move;
    const toR = move.toR ?? move.to.r, toC = move.toC ?? move.to.c, die = move.usedDiceVal || e.diceValue;
    if (nm && nm.type === move.type && nm.toR === toR && nm.toC === toC && (nm.type !== MOVE_TYPE.CAPTURE || (nm.fromR === (move.fromR ?? move.from.r) && nm.fromC === (move.fromC ?? move.from.c))) && nextNode.dice === die) {
      this.goToStep(step + 1);
      return true;
    }
    const ok = e.executeMove(move);
    if (ok) {
      const node = e.tree.getCurrentNode();
      node.actor = actor;
      if (actor === "cpu") node.cpuLevel = clampLevel(player === BLACK ? this.settings.blackLevel : this.settings.whiteLevel);
    }
    if (ok && this.session.assist && this.session.assist.color === player) {
      this.session.assist.left -= 1;
      if (this.session.assist.left <= 0) this.session.assist = null;
    }
    if (ok) this.sync();
    return ok;
  }

  // ===== CPU =====

  startCpuTimer() {
    this.stopCpuTimer();
    if (!this.ui.runCpuTimer) return;
    this.cpuTurnStart = Date.now();
    this.cpuTimer = setTimeout(() => { this.cpuTimer = null; this.performCpuTurn(); }, 0);
  }

  /** 找出與 CPU 選的走法（from／to／cap／die）對應的規則走法 */
  findRulesMove(dm) {
    const e = this.engine;
    const all = e.legalMoves();
    const m = all.find((x) => x.usedDiceVal === dm.die && x.toR === dm.to.r && x.toC === dm.to.c &&
      (dm.cap ? x.type === MOVE_TYPE.CAPTURE && x.fromR === dm.from.r && x.fromC === dm.from.c : x.type === MOVE_TYPE.SPAWN));
    return m || null;
  }

  performCpuTurn() {
    const e = this.engine;
    if (e.gameOver || this.ui.ctrl !== CTRL.CPU) return;
    const turn = e.currentTurn, nodeId = e.tree.currentNodeId;
    const free = e.isFreePickTurn;
    const req = {};
    this.cpuRequest = req;
    const level = clampLevel(turn === BLACK ? this.settings.blackLevel : this.settings.whiteLevel);
    const pace = this.pace();
    const timed = isTimedLevel(level);
    const started = this.cpuTurnStart ?? Date.now();
    const stale = () => this.cpuRequest !== req || e.tree.currentNodeId !== nodeId || this.ui.ctrl !== CTRL.CPU;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

    (async () => {
      // 1. 擲骰（自選點數的回合沒有這一步）
      if (!free && e.diceValue == null) {
        await wait(pace.roll);
        if (stale()) return;
        e.rollDice(); // 沒有合法走法時，sync 會排 PASS
        if (stale()) return;
        if (e.legalMoves().length === 0) { this.cpuRequest = null; return; }
      }
      // 2. 搜尋。按時間搜的等級搜尋時，局面分析先停（兩條 worker 搶資源會讓 CPU 的搜尋量變少）
      if (timed) { this.cpuSearching = req; this.cancelAnalysisJob(); }
      const res = await this.aiClient.play({
        board: cloneBoard(e.board), turn, die: free ? null : e.diceValue, level,
        opts: { free, komi: e.komi, timeMs: this.thinkMs() }
      });
      if (timed && this.cpuSearching === req) { this.cpuSearching = null; this.scheduleAnalysis(); }
      if (stale()) return;
      const dm = res?.move;
      const move = dm ? this.findRulesMove(dm) : null;
      if (!move) { this.cpuRequest = null; this.sync(); return; }
      // 3. 自選點數：先亮出點數，停一下再落子；一般回合等節奏的間隔
      if (free) { e.rollDice(move.usedDiceVal); if (stale()) return; await wait(pace.pick); }
      else await wait(pace.gap - (Date.now() - started));
      if (stale()) return;
      this.cpuRequest = null;
      this.executeMove(move, "cpu");
    })().catch((err) => {
      console.error("CPU move error:", err);
      if (this.cpuSearching === req) this.cpuSearching = null;
      if (this.cpuRequest === req) { this.cpuRequest = null; this.sync(); }
    });
  }

  stopCpuTimer() {
    if (this.cpuTimer) { clearTimeout(this.cpuTimer); this.cpuTimer = null; }
    this.cpuRequest = null;
  }

  // ===== 席位與控制者切換 =====

  handlePauseCpu() { this.session.paused = true; this.stopCpuTimer(); this.sync(); }
  handleResumeCpu() { this.session.paused = false; this.sync(); }

  persistSeats() {
    if (this.researchSeats) return;
    this.settings.blackRole = this.session.seats.black;
    this.settings.whiteRole = this.session.seats.white;
    Storage.saveSettings(this.settings);
  }

  resetSessionToSettings() {
    this.researchSeats = null;
    this.session = createSession({ black: this.settings.blackRole || HUMAN, white: this.settings.whiteRole || CPU_SEAT });
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;
  }

  setSeat(side, owner) {
    if (side !== "black" && side !== "white") return;
    if (owner !== HUMAN && owner !== CPU_SEAT) return;
    if (this.session.seats[side] === owner) return;
    this.session.seats[side] = owner;
    this.persistSeats();
    if (owner === CPU_SEAT) { this.session.paused = true; this.session.assist = null; }
    else if (side === seatKey(this.engine.currentTurn)) { this.session.assist = null; this.session.paused = false; }
    this.teardown();
    this.sync();
  }

  handleWatchCpuVsCpu() {
    this.session.seats.black = CPU_SEAT; this.session.seats.white = CPU_SEAT;
    this.session.assist = null; this.session.paused = false;
    this.persistSeats();
    this.teardown();
    this.sync();
  }

  // ===== 提示 =====

  toggleHint() {
    this.hintOn = !this.hintOn;
    this.hoverMove = null; this.hoverAlt = [];
    this.render();
  }

  /**
   * 提示：每個合法落點標出走下去的勝率（輪到的一方角度，校準過）。和勝率條、走法評價是同一份分析：
   * 第 1 級先顯示淡色數字，第 2 級（教練強度）起正式，你還在想時繼續加深、數字跟著更新。
   * 擲出的點數已定就只看那個點數；自選點數的回合看所有點數（同一格取最高）。
   */
  hintData() {
    const e = this.engine;
    if (!this.hintOn || !this.canHumanAct() || e.gameOver) return null;
    const a = this.analysis.get(e.tree.currentNodeId);
    if (!a) return null;
    const pieces = piecesOf(e.board);
    const die = e.diceValue;
    const labels = new Map();
    const dice = die != null ? [die] : [1, 2, 3, 4, 5, 6];
    for (const d of dice) {
      const pd = a.perDie[d - 1];
      for (const m of pd?.moves || []) {
        if (!m.move) continue;
        const sq = sqOf(m.move), pct = Math.round(100 * displayWinProb(m.value, pieces));
        if (!labels.has(sq) || labels.get(sq).pct < pct) labels.set(sq, { pct });
      }
    }
    let top = -1;
    for (const v of labels.values()) if (v.pct > top) top = v.pct;
    for (const v of labels.values()) v.best = v.pct === top;
    return { labels, level: a.level };
  }

  // ===== 歷史回放 =====

  currentStep() { return this.engine.tree.getCurrentNode()?.stepIdx ?? 0; }

  async resumeHere() {
    const curr = this.engine.tree.getCurrentNode();
    if (!curr || curr.gameOver) return;
    const ok = await ModalManager.confirm({
      title: tr("resumeTitle"), message: tr("resumeMsg", { n: curr.stepIdx }),
      confirmText: tr("resumeOk"), cancelText: tr("confirmCancel"), danger: true
    });
    if (!ok) return;
    this.teardown();
    if (!this.engine.makeCurrentLatest()) return;
    this.syncResearchMode();
    if (this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT) this.session.paused = true;
    this.sync();
  }

  goToStep(step) {
    const line = this.engine.tree.getBranchHistory();
    if (step < 0 || step >= line.length || step === this.currentStep()) return;
    this.analysisSettleUntil = performance.now() + (LOW_POWER ? 350 : 200);
    this.teardown();
    if (step === line.length - 1 && this.session.seats[seatKey(line[step].turn)] === CPU_SEAT) this.session.paused = true;
    this.engine.goToStep(step);
    this.sync();
  }

  /** 折線圖的資料：主線、分支（從分岔點起）、每一手黑方的勝率、評價、骰運與棋力損失 */
  chartData() {
    const tree = this.engine.tree;
    const point = (node) => ({
      step: node.stepIdx, black: this.blackPctOf(node), mark: node.mark?.sym || null,
      why: node.mark?.sym ? markWhyText(node.mark) : "", log: node.logText,
      luck: node.luck != null ? node.luck * 100 : null, loss: node.loss != null ? node.loss * 100 : null
    });
    const main = tree.getBranchHistory("main").map(point);
    const line = tree.getBranchHistory();
    const branchInfo = tree.activeBranchId !== "main" ? tree.branches.get(tree.activeBranchId) : null;
    const branch = branchInfo ? { fork: branchInfo.forkStepIdx, points: line.slice(branchInfo.forkStepIdx).map(point) } : null;
    return { main, branch, current: this.currentStep(), lastStep: line.length - 1 };
  }

  /** 某個局面的黑方勝率（%）：終局看結果，否則用分析結果（校準後） */
  blackPctOf(node) {
    if (node.gameOver) {
      const w = node.settlementData?.winner;
      return w === BLACK ? 100 : w === WHITE ? 0 : 50;
    }
    const a = this.analysis.get(node.id);
    if (!a) return null;
    const p = displayWinProb(a.value, piecesOf(node.board));
    return 100 * (node.turn === BLACK ? p : 1 - p);
  }

  // ===== 局面分析 =====

  levelMs(level) { return this.thinkMs() * LEVEL_FACTORS[Math.min(level, LEVEL_FACTORS.length) - 1]; }
  coachMs() { return this.levelMs(COACH_LEVEL); }
  userThinking() { return this.canHumanAct() && !this.engine.gameOver; }
  analyzable(node) { return node && !node.gameOver; }

  /**
   * 排下一件分析工作（一次只算一件），依優先順序：
   *   1. 目前局面第 1 級（勝率條、骰子展望）  2. 這條線上還沒分析的局面（勝率走勢、骰運、走法評價）
   *   3. 等著確認走法評價的局面到第 2 級      4. 你還在想時，目前局面加深（提示的數字更準）
   * CPU 按時間搜尋時不排（見 performCpuTurn）。
   */
  scheduleAnalysis() {
    const tree = this.engine.tree;
    const curr = tree.getCurrentNode();
    if (!curr || document.hidden) return;
    const job = this.analysisJob;
    const onLine = (id) => tree.getBranchHistory().some((n) => n.id === id) || tree.getBranchHistory("main").some((n) => n.id === id);
    if (job && job.nodeId !== curr.id && !this.confirmNeed.has(job.nodeId) && !(job.level === 1 && onLine(job.nodeId))) this.cancelAnalysisJob();
    this.updateMark(curr);
    if (this.analysisJob || this.cpuSearching) return;
    const wait = (this.analysisSettleUntil ?? 0) - performance.now();
    if (wait > 0) {
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.scheduleAnalysis(), wait + 5);
      return;
    }
    const levelOf = (n) => this.analysis.get(n.id)?.level ?? 0;
    const pick = () => {
      const cur = this.analyzable(curr) ? curr : null;
      if (cur && levelOf(cur) < 1) return [cur, 1];
      const todo = [...tree.getBranchHistory(), ...tree.getBranchHistory("main")].find((n) => this.analyzable(n) && !this.analysis.has(n.id));
      if (todo) return [todo, 1];
      const cpuBusy = this.ui.isCpuVsCpu && this.ui.runCpuTimer;
      for (const id of cpuBusy ? [] : [...this.confirmNeed].reverse()) {
        const n = tree.getNode(id);
        if (!this.analyzable(n) || levelOf(n) >= COACH_LEVEL) { this.confirmNeed.delete(id); continue; }
        return [n, COACH_LEVEL];
      }
      const thinking = this.userThinking();
      if (cur && levelOf(cur) < COACH_LEVEL && thinking) return [cur, COACH_LEVEL];
      const maxLevel = LOW_POWER ? MAX_LEVEL_LOW_POWER : MAX_ANALYSIS_LEVEL;
      if (cur && thinking && levelOf(cur) < maxLevel && this.levelMs(levelOf(cur) + 1) <= MAX_JOB_MS) return [cur, levelOf(cur) + 1];
      return null;
    };
    const next = pick();
    if (next) this.runAnalysis(next[0], next[1]);
  }

  runAnalysis(node, level) {
    const token = {};
    const gen = this.analysisGen;
    const promise = this.analysisClient.analyze({
      board: cloneBoard(node.board), turn: node.turn,
      opts: { free: node.isFreePickTurn, komi: this.engine.komi, timeMs: this.levelMs(level), maxDepth: 12, allMoves: true }
    });
    this.analysisJob = { nodeId: node.id, level, token, promise };
    promise.then((res) => {
      if (gen !== this.analysisGen || this.analysisJob?.token !== token) return;
      this.analysisJob = null;
      if (res) this.storeAnalysis(node, res, level);
      else this.analysis.set(node.id, { value: 0.5, perDie: [], depth: 0, level: MAX_ANALYSIS_LEVEL });
      this.render();
    });
  }

  cancelAnalysisJob() {
    if (!this.analysisJob) return;
    this.analysisJob = null;
    this.analysisClient.cancel();
  }

  storeAnalysis(node, res, level) {
    const old = this.analysis.get(node.id);
    if (old && old.level >= level) return;
    this.analysis.set(node.id, { value: res.value, perDie: res.perDie, depth: res.depth, level });
    if (level >= COACH_LEVEL) this.confirmNeed.delete(node.id);
    this.refreshMarksAround(node);
  }

  refreshMarksAround(node) {
    const tree = this.engine.tree;
    const curr = tree.getCurrentNode();
    if (curr) this.updateMark(curr);
    this.updateMark(node);
    for (const childId of node.children) {
      const c = tree.getNode(childId);
      if (c) this.updateMark(c);
    }
  }

  /** 走法的編碼（對局樹節點上的走法 → 引擎的整數走法） */
  codeOf(node) {
    const m = node.move;
    if (!m) return -1;
    const toR = m.toR ?? m.to.r, toC = m.toC ?? m.to.c, fromR = m.fromR ?? m.from.r, fromC = m.fromC ?? m.from.c;
    return encodeMove({ cap: m.type === MOVE_TYPE.CAPTURE, from: { r: fromR, c: fromC }, to: { r: toR, c: toC }, die: node.dice });
  }

  /**
   * 這一步的評價與骰運（定義見 engine/move-quality.js）。用到兩個局面的分析：
   *   上一個局面（這一手的選擇：同一個點數下每個走法的勝率）、下完的局面（對手六個點數各自的最佳勝率，判斷封鎖手）。
   * 分析陸續到齊、或加深了就重新算；上一個局面的分析還不到第 2 級時，要標任何記號都先等它確認。
   */
  updateMark(node) {
    if (!node.parentId) return;
    const tree = this.engine.tree;
    const parent = tree.getNode(node.parentId);
    const a = parent && this.analysis.get(parent.id);
    if (!a || !a.perDie.length) return;
    const nx = node.gameOver ? null : this.analysis.get(node.id) || null;
    const inputs = `${a.level}|${nx?.level ?? 0}`;
    if (node.markInputs === inputs) return;
    const pieces = piecesOf(parent.board);
    const toProb = (p) => displayWinProb(p, pieces);
    const before = toProb(a.value);
    const die = node.dice;
    const free = parent.isFreePickTurn;
    // PASS：沒有走法，只有骰運
    if (!node.move) {
      const pd = a.perDie[die - 1];
      node.mark = null; node.markInputs = inputs;
      node.luck = pd ? toProb(pd.value) - before : null; node.loss = 0;
      return;
    }
    const code = this.codeOf(node);
    const dice = free ? [1, 2, 3, 4, 5, 6] : [die];
    const moves = [];
    for (const d of dice) for (const m of a.perDie[d - 1]?.moves || []) if (m.move) moves.push({ key: m.move.code, sq: sqOf(m.move), p: m.value });
    if (!moves.some((m) => m.key === code)) return;
    const nextBest = nx?.perDie?.length ? nx.perDie.map((pd) => (pd ? toProb(pd.value) : null)) : null;
    const res = classifyMove({ moves, played: code, before, nextBest, toProb, coord: (sq) => posToCoord(sq >> 3, sq & 7) });
    if (res?.sym && a.level < COACH_LEVEL) { this.confirmNeed.add(parent.id); return; }
    node.mark = res?.sym ? res : null;
    node.markInputs = inputs;
    if (res) {
      // 自選點數（PASS 後的免擲骰）沒有骰運：點數是自己挑的，損失以所有點數的最佳步比
      const lk = free ? { luck: 0, loss: Math.max(0, res.best - res.played) } : luckOf({ before, best: res.best, played: res.played });
      node.luck = lk.luck; node.loss = lk.loss;
    }
  }

  // ===== 棋譜匯出與匯入 =====

  /**
   * 匯出目前這條線的棋譜（JSON 檔）：種子、貼目、每一手的點數與走法、下之前的局面、評價、骰運與棋力損失、黑方勝率。
   * 匯入時用種子、點數與走法重建整局（見 importFromText）。
   */
  exportRecord() {
    const record = buildRecord(this.engine, {
      seats: { black: this.ui.seats.black, white: this.ui.seats.white },
      levels: { black: clampLevel(this.settings.blackLevel), white: clampLevel(this.settings.whiteLevel) },
      thinkMs: this.thinkMs(), coachMs: this.coachMs(),
      pctOf: (n) => this.blackPctOf(n), markText: (m) => markWhyText(m)
    });
    const pad = (n) => String(n).padStart(2, "0"), d = new Date();
    const name = `who-will-win-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
    this.saveRecordFile(name, JSON.stringify(record, null, 1));
    return record;
  }

  async saveRecordFile(name, text) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name, startIn: "downloads", id: "who-will-win-records",
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
        });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        return "saved";
      } catch (e) {
        if (e?.name === "AbortError") return "cancel";
      }
    }
    const file = typeof File === "function" ? new File([text], name, { type: "application/json" }) : null;
    if (TOUCH && file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return "shared"; }
      catch (e) { if (e?.name === "AbortError") return "cancel"; }
    }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded";
  }

  openImportModal() {
    const msgEl = document.getElementById("importMsg");
    if (msgEl) msgEl.textContent = "";
    ModalManager.open("importModal");
  }

  /** 貼上或選檔案的棋譜 → 重建整局（種子、貼目、每一手的點數與走法）；失敗時不動目前的對局 */
  importFromText(text) {
    const msgEl = document.getElementById("importMsg");
    const fail = (m) => { if (msgEl) { msgEl.textContent = m; msgEl.style.color = "#fca5a5"; } return false; };
    let rec;
    try { rec = JSON.parse(text); } catch (e) { return fail(tr("importBadJson")); }
    const res = this.applyRecord(rec);
    if (res.error) return fail(res.error);
    ModalManager.close("importModal");
    return true;
  }

  /** 重放棋譜（見 history/record.js），成功才換掉目前的對局。回傳 { error } 或 { ok } */
  applyRecord(rec) {
    const res = replayRecord(rec);
    if (res.error) return { error: tr(res.error.key, res.error.params) };
    this.teardown();
    this.analysisGen++; this.analysis.clear(); this.confirmNeed.clear(); this.cancelAnalysisJob();
    this.engine.komi = res.engine.komi;
    this.engine.restoreTree(res.engine.tree.toJSON());
    this.syncResearchMode();
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;
    this.sync();
    return { ok: true };
  }

  // ===== 規則視窗、設定視窗 =====

  openTutorialModal(tab = "rules") {
    openHelp({ gameId: "whowins", tab });
    Storage.setOnboardingSeen();
  }

  openSkinModal() {
    ModalManager.open("skinModal");
    const sb = document.getElementById("soundToggleBtn");
    if (sb) sb.textContent = tr(this.settings.soundEnabled ? "soundOn" : "soundOff");
    this.skinPanel.bindSkinEventsOnce();
    this.skinPanel.renderSkinWorkshop();
  }

  // ===== 終局表現與總結 =====

  celebrate(data) {
    if (!data || data.winner === EMPTY || this.animMinimal()) return;
    const side = data.winner === BLACK ? "black" : "white";
    const card = document.querySelector(`.seatGroup[data-side="${side}"]`);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "confettiLayer";
    layer.style.left = `${rect.left + rect.width / 2}px`;
    layer.style.top = `${rect.top + rect.height / 2}px`;
    const icons = ["★", "✦", "◆", "●"];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement("span");
      p.className = "confettiPiece";
      const ang = Math.random() * Math.PI * 2, dist = 70 + Math.random() * 190;
      p.textContent = icons[i % icons.length];
      p.style.color = ["#facc15", "#38bdf8", "#f472b6", "#4ade80"][i % 4];
      p.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(ang) * dist - 40}px`);
      p.style.setProperty("--rot", `${Math.round(Math.random() * 720 - 360)}deg`);
      p.style.animationDelay = `${Math.random() * 0.25}s`;
      p.style.fontSize = `${14 + Math.random() * 14}px`;
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2600);
  }

  /**
   * 終局總結：雙方的準確度（單步棋力損失換算後的平均）、骰運（每一手的骰運加總，勝率百分點）；
   * 每個 ?? 與 !! 可以一鍵跳過去。分析還沒算完的手不算，顯示進度。
   */
  summaryData() {
    const tree = this.engine.tree;
    const line = tree.getBranchHistory();
    const last = line[line.length - 1];
    if (!last.gameOver) return null;
    const stats = { black: { luck: 0, loss: 0, n: 0, acc: 0 }, white: { luck: 0, loss: 0, n: 0, acc: 0 } };
    const marks = { black: {}, white: {} };
    let analyzed = 0, total = 0;
    for (let i = 1; i < line.length; i++) {
      const node = line[i], prev = line[i - 1];
      total++;
      if (node.luck == null) continue;
      analyzed++;
      const s = stats[prev.turn === BLACK ? "black" : "white"];
      if (node.mark?.sym) { const m = marks[prev.turn === BLACK ? "black" : "white"]; m[node.mark.sym] = (m[node.mark.sym] || 0) + 1; }
      s.luck += node.luck * 100; s.loss += node.loss * 100; s.n++; s.acc += moveAccuracy(node.loss * 100);
    }
    return { stats, marks, analyzed, total, settlement: last.settlementData };
  }

  renderSummary() {
    const box = document.getElementById("summaryBox");
    if (!box) return;
    const d = this.summaryData();
    if (!d) { box.hidden = true; return; }
    box.hidden = false;
    const s = d.settlement;
    const win = s.winner === BLACK ? tr("black") : s.winner === WHITE ? tr("white") : tr("scoreTie");
    const fmt = (x, digits = 1) => (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits);
    const row = (key, sd) => {
      const st = d.stats[sd];
      const acc = st.n ? fmt(st.acc / st.n, 1) : "-";
      const luck = st.n ? `${st.luck >= 0 ? "+" : ""}${fmt(st.luck, 1)}` : "-";
      const mk = MARK_ORDER.filter((sym) => d.marks[sd][sym]).map((sym) => `<span class="mvMark ${MARK_CLASS[sym]}" title="${escapeHtml(tr(MARK_TIP[sym]))}">${escapeHtml(sym)} ${d.marks[sd][sym]}</span>`).join("") || "-";
      return `<tr><td>${escapeHtml(tr(key))}</td><td>${acc}</td><td class="${st.luck >= 0 ? "pos" : "neg"}">${luck}</td><td class="summaryMarks">${mk}</td></tr>`;
    };
    box.innerHTML = `
      <div class="summaryHead">${escapeHtml(tr("summaryTitle"))}</div>
      <div>${escapeHtml(tr("summaryResult", { winner: win, b: s.bTotal, w: s.wFinal, m: s.margin }))}</div>
      <table class="summaryTable">
        <tr><th></th><th>${escapeHtml(tr("summaryAcc"))}</th><th>${escapeHtml(tr("summaryLuck"))}</th><th>${escapeHtml(tr("summaryMarks"))}</th></tr>
        ${row("black", "black")}${row("white", "white")}
      </table>
      <div class="summaryNote">${escapeHtml(d.analyzed < d.total ? tr("summaryProgress", { a: d.analyzed, t: d.total }) : tr("summaryNote"))}</div>`;
  }

  checkDeveloperMode() {
    const hud = document.getElementById("developerHud");
    if (hud) hud.style.display = new URL(window.location.href).searchParams.get("debug") === "1" ? "grid" : "none";
  }

  // ===== 渲染 =====

  /** 目前輪到的玩家的名稱 */
  turnName() { return tr(this.engine.currentTurn === BLACK ? "sideBlack" : "sideWhite"); }

  renderBoard() {
    const e = this.engine;
    const state = e.getState();
    const showLegal = this.canHumanAct() && (e.diceValue != null || e.isFreePickTurn);
    const hint = this.hintData();
    // 選了棋子：只畫它的落點；沒選：畫所有落點（開著提示時每個落點標勝率）
    let legalMoves = { spawns: [], captures: [] };
    if (showLegal) {
      if (e.selectedCell) legalMoves = state.legalMovesForSelected;
      else {
        const all = e.legalMoves();
        legalMoves = { spawns: all.filter((m) => m.type === MOVE_TYPE.SPAWN), captures: all.filter((m) => m.type === MOVE_TYPE.CAPTURE) };
      }
    }
    const piecesWithMoves = new Set();
    if (showLegal && !e.selectedCell) for (const m of e.legalMoves()) piecesWithMoves.add(`${m.fromR},${m.fromC}`);
    this.boardView.render({
      board: state.board,
      currentTurn: state.currentTurn,
      selectedCell: showLegal ? state.selectedCell : null,
      legalMoves,
      lastMove: state.lastMove,
      endgameFilledCells: state.endgameFilledCells,
      hintLabels: showLegal && hint ? hint.labels : new Map(),
      lastMark: e.tree.getCurrentNode()?.mark || null,
      previewGhostMove: showLegal ? this.hoverMove : null,
      previewPaths: showLegal && !this.hoverMove ? this.hoverAlt : [],
      piecesWithMoves
    });
  }

  /** 骰子面板：點數、自選點數與研究模式的指定點數（骰子展望的資料還在分析裡，只是不顯示） */
  renderDice() {
    const e = this.engine, ui = this.ui;
    const turn = this.turnName();
    const pickable = this.dicePickable();
    const rolled = e.diceValue;
    let label;
    if (e.gameOver) label = tr("diceDone");
    else if (this.passTimer) label = tr("diceNoMove", { d: rolled });
    else if (e.isFreePickTurn && rolled == null) label = tr("diceFreePick");
    else if (rolled != null) label = tr("diceRolled", { d: rolled });
    else if (this.canRoll()) label = tr("diceClickRoll");
    else label = tr("diceWaiting");
    let hint = "";
    if (!e.gameOver && pickable) hint = e.isFreePickTurn && rolled == null ? tr("diceHintFree") : tr("diceHintResearch");
    this.diceView.render({
      value: rolled, canRoll: this.canRoll(), pickable, label, hint, outlook: null
    });
  }

  renderEvalBar() {
    const node = this.engine.tree.getCurrentNode();
    if (!node) return;
    const pct = this.blackPctOf(node);
    if (pct == null) { this.evalBar.render({ blackProb: this.lastBlackProb ?? 0.5, pending: true }); return; }
    this.lastBlackProb = pct / 100;
    this.evalBar.render({ blackProb: this.lastBlackProb });
  }

  renderPlaybackButtons() {
    const step = this.currentStep(), last = this.engine.tree.getBranchHistory().length - 1;
    const set = (id, on) => { const el = document.getElementById(id); if (el) el.disabled = !on; };
    set("historyFirstBtn", step > 0);
    set("historyPrevBtn", step > 0);
    set("historyNextBtn", step < last);
    set("historyLatestBtn", step < last);
  }

  statusLine() {
    const e = this.engine, ui = this.ui;
    const turn = this.turnName();
    const d = e.diceValue;
    if (ui.view === VIEW.REVIEW) return tr("stReview", { n: this.currentStep() });
    if (ui.view === VIEW.ENDED) return tr("stEnded", { reason: e.settlementData ? tx(e.settlementData.reason) : "" });
    if (this.passTimer) return tr("stPassing", { turn, d });
    if (ui.ctrl === CTRL.PAUSED) return tr(ui.isCpuVsCpu ? "stPaused" : "stPausedOne", { turn });
    if (ui.ctrl === CTRL.CPU) {
      const actor = ui.isCpuVsCpu ? tr("stCpuVsCpu") : tr("stCpu");
      return d == null ? tr(e.isFreePickTurn ? "stCpuFree" : "stCpuRolling", { actor, turn }) : tr("stCpuThinking", { actor, turn, d });
    }
    if (this.researchSeats) {
      const fork = e.tree.branches.get(e.tree.activeBranchId)?.forkStepIdx ?? 0;
      return tr("stResearch", { n: fork, turn, step: d == null ? tr(e.isFreePickTurn ? "stStepFree" : "stStepRoll") : tr("stStepMove", { d }) });
    }
    if (e.isFreePickTurn && d == null) return tr("stHumanFree", { turn });
    if (d == null) return tr("stHumanRoll", { turn });
    return tr(this.hintOn ? "stHumanMoveHint" : "stHumanMove", { turn, d });
  }

  render() {
    this.renderCount++;
    this.scheduleSave();
    const e = this.engine, ui = this.ui;
    const state = e.getState();
    const isCpuTurn = ui.ctrl === CTRL.CPU, isPaused = ui.ctrl === CTRL.PAUSED;
    const isReview = ui.view === VIEW.REVIEW, isEnded = ui.view === VIEW.ENDED;

    const banner = document.getElementById("statusBanner");
    if (banner) banner.className = `statusBanner ${isReview ? "review" : (isEnded ? "ended" : ui.ctrl)}`;
    const statusText = document.getElementById("statusText");
    if (statusText) statusText.innerHTML = pieceify(escapeHtml(this.statusLine()));

    const boardFrame = document.getElementById("boardFrame");
    if (boardFrame) {
      boardFrame.classList.toggle("board-review", isReview);
      boardFrame.classList.toggle("board-cpu", isCpuTurn);
      boardFrame.classList.toggle("board-paused", isPaused);
    }

    // 比分：黑方棋數、白方棋數（加貼目）；終局後用結算
    const sc = e.scores();
    const settle = state.gameOver ? state.settlementData : null;
    document.getElementById("scoreBlackNum").textContent = settle ? settle.bTotal : sc.black;
    document.getElementById("scoreWhiteNum").textContent = settle ? settle.wFinal : (sc.white + e.komi).toFixed(1).replace(/\.0$/, "");
    const komiTag = document.getElementById("komiTag");
    if (komiTag) komiTag.textContent = e.komi ? tr("komiTag", { k: e.komi }) : "";
    document.querySelectorAll(".seatGroup").forEach((g) => {
      const mine = g.dataset.side === "black" ? BLACK : WHITE;
      g.classList.toggle("winner", !!settle && settle.winner === mine);
      g.classList.toggle("loser", !!settle && settle.winner !== EMPTY && settle.winner !== mine);
      g.classList.toggle("drawn", !!settle && settle.winner === EMPTY);
    });

    const hint = this.hintData();
    const hintLevel = this.hintOn && hint ? String(Math.min(hint.level || 1, 3)) : "";
    if (document.documentElement.dataset.hintLevel !== hintLevel) document.documentElement.dataset.hintLevel = hintLevel;
    this.renderBoard();
    this.renderDice();

    this.scheduleAnalysis();
    this.renderEvalBar();
    this.winChart.render(this.chartData());
    this.renderPlaybackButtons();
    this.renderSummary();

    // 席位列
    const seatCurrentKey = seatKey(state.currentTurn);
    const seatsEditable = ui.view === VIEW.LIVE;
    document.querySelectorAll("#seatBar .seatGroup").forEach((g) => g.classList.toggle("isTurn", g.dataset.side === seatCurrentKey));
    document.querySelectorAll(".seatBtn").forEach((btn) => {
      btn.classList.toggle("active", ui.seats[btn.dataset.side] === btn.dataset.owner);
      btn.disabled = !seatsEditable || !!this.researchSeats;
    });
    for (const side of ["black", "white"]) {
      const sel = document.getElementById(side === "black" ? "settingBlackLevel" : "settingWhiteLevel");
      if (sel) sel.disabled = ui.seats[side] !== CPU_SEAT || !seatsEditable || !!this.researchSeats;
    }
    document.querySelectorAll(".pcRole").forEach((btn) => {
      const side = btn.dataset.side;
      const level = clampLevel(side === "black" ? this.settings.blackLevel : this.settings.whiteLevel);
      btn.textContent = this.researchSeats ? tr("roleResearch") : ui.seats[side] === CPU_SEAT ? tr("roleCpu", { n: level }) : tr("roleHuman");
      btn.classList.toggle("isCpu", !this.researchSeats && ui.seats[side] === CPU_SEAT);
      btn.dataset.locked = this.researchSeats ? "research" : !seatsEditable ? "review" : "";
      btn.classList.toggle("locked", !!btn.dataset.locked);
    });

    // 動作列
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? "inline-flex" : "none"; };
    const live = ui.view === VIEW.LIVE;
    const hintBtn = document.getElementById("hintBtn");
    if (hintBtn) {
      hintBtn.style.display = !isEnded ? "inline-flex" : "none";
      hintBtn.classList.toggle("active", this.hintOn);
      hintBtn.setAttribute("aria-pressed", String(this.hintOn));
      const narrow = window.matchMedia?.("(max-width: 600px)").matches;
      hintBtn.textContent = tr(this.hintOn && !narrow ? "btnHintOn" : "btnHint");
    }
    const research = !!this.researchSeats;
    show("watchBtn", live && !ui.isCpuVsCpu && !research);
    show("resumeHereBtn", (isReview || research) && !state.gameOver);
    const pauseBtn = document.getElementById("pauseResumeBtn");
    if (pauseBtn) {
      if (isCpuTurn) {
        pauseBtn.style.display = ui.isCpuVsCpu ? "inline-flex" : "none";
        pauseBtn.textContent = tr("pause"); pauseBtn.title = tr("pauseTip"); pauseBtn.className = "actBtn";
      } else if (isPaused) {
        pauseBtn.style.display = "inline-flex";
        pauseBtn.textContent = tr("resume"); pauseBtn.title = tr("resumeCpuTip"); pauseBtn.className = "actBtn primary";
      } else pauseBtn.style.display = "none";
    }

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText("hudRenders", this.renderCount);
    setText("hudTurn", state.currentTurn === BLACK ? "BLACK" : "WHITE");
    setText("hudDice", state.diceValue ?? "null");
    setText("hudSeed", e.seed);
    setText("hudNodes", e.tree.nodes.size);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    window.__app = new WhoWinsApp();
    window.WhoWins = { app: window.__app, getEngine: () => window.__app.engine, getState: () => window.__app.engine.getState(), reset: () => window.__app.newGame() };
  });
}
