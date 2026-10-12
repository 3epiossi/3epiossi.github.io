/**
 * 🚀 五連黑白棋 (Five-in-a-Row Othello) - 應用程式主入口與控制器 (Application Controller)
 * 架構與原專案一致：engine（規則）→ session（席位控制）→ sync() 推導 → render() 繪製。
 */

import { BLACK, WHITE, EMPTY, MOVE_TYPE } from "./core/constants.js";
import { applyMoveToBoard, posToCoord } from "./core/rules.js";
import { GameEngine, poolOf } from "./core/game-engine.js";
import { randomXot } from "./core/xot-openings.js";
import { BoardView, discHtmlFive, markWhyText } from "./ui/board-view.js";
import { EvalBar, displayWinProb } from "./ui/eval-bar.js";
import { classifyMove } from "./ai/move-quality.js";
import { PoolView } from "./ui/hand-view.js";
import { WinChart } from "./ui/win-chart.js";
import { Storage } from "./storage/storage.js";
import { initI18n, applyI18n, setLang, curLang, tr, tx, pieceify, escapeHtml, clampName } from "./i18n.js";
import { moveFromSquare } from "./ai/ai-service.js";
import { clampLevel, MAX_LEVEL as MAX_CPU_LEVEL } from "./ai/levels.js";
import { findFive, findThreatGroups, withGapOwners, letterOf, discLabel, numberMask, groupOf, GROUP_SIZE, setSymbolSet, getSymbolSet, parseCustomSymbols } from "./core/five-rules.js";
import { PatternFx } from "./ui/pattern-fx.js";
import { helpGuideHtml } from "./help-content.js";
import { stoneSound as sound } from "./ui/stone-sound.js";
import { resolveTextColor, textPaletteFor, normalizeFace } from "./ui/text-colors.js";
import { AiClient } from "./ai/ai-client.js";

// 與原專案共用的通用模組（唯讀引用，不修改）
import { ModalManager } from "../../src/ui/modal-manager.js";
import {
  SkinManager,
  DEFAULT_BLACK_PRESETS,
  DEFAULT_WHITE_PRESETS,
  getPieceBackgroundCss
} from "../../src/ui/skin-workshop.js";
import {
  VIEW,
  CTRL,
  HUMAN,
  CPU_SEAT,
  seatKey,
  createSession,
  deriveUiState
} from "../../src/core/control-state.js";

/** 存檔格式：1 = 舊規則（抽棋、每顆兩個字），2 = 4 組自選。版本不同的存檔不讀，開新局 */
const SAVE_VERSION = 2;

/** 選棋：在顯示著候選的那一格按住這麼久（毫秒），就下目前顯示的那顆（見 BoardView 的長按） */
const LONG_PRESS_MS = 500;

/**
 * 下棋節奏（設定「下棋節奏」）：只管看起來多快，不影響棋力與分析（那是「AI 思考時間」管的，見 levelMs）。
 *   gap：CPU 從輪到它到落子（含亮棋）至少隔這麼久；最高級另外至少要「AI 思考時間 + 亮棋」
 *   pick：CPU 選好棋後，先在池子亮出那顆棋多久才落子（算在 gap 裡面）
 *   pass：沒有合法位置時，停多久再自動 PASS
 * 極速：全部是 0，也關掉動畫與落子音效（產生棋譜、快轉用）。
 */
const PACES = {
  slow:    { gap: 2500, pick: 1000, pass: 1000 },
  normal:  { gap: 1200, pick: 600,  pass: 700 },
  fast:    { gap: 400,  pick: 200,  pass: 300 },
  instant: { gap: 0,    pick: 0,    pass: 0 }
};

/** 局面分析的分級（時間見 levelMs）：第 2 級是 AI 教練的強度；你還在想時最多加深到 MAX_LEVEL 級、單次不超過 MAX_JOB_MS */
const COACH_LEVEL = 2;
const LEVEL_FACTORS = [1, 2, 3, 5, 8, 13]; // 各級的時間是 T 的幾倍（斐波那契數）
const MAX_LEVEL = LEVEL_FACTORS.length;
const MAX_JOB_MS = 30000;

/**
 * 手機（觸控為主）或 4 核以下的裝置：你還在想的時候，局面分析最多加深到第 4 級（5T），不一路加到第 6 級（13T）。
 * 低階手機一直滿載會發燙、耗電，畫面也會跟著卡；第 4 級已經比 AI 教練（第 2 級）深兩級，提示的數字夠準了。
 */
const LOW_POWER = typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches || (navigator.hardwareConcurrency || 8) <= 4);
const MAX_LEVEL_LOW_POWER = 4;
/** 觸控裝置（長按下棋時震動一下） */
const TOUCH = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

export class WeightedOthelloApp {
  constructor() {
    this.settings = Storage.getSettings();
    initI18n({ black: this.settings.blackName, white: this.settings.whiteName });
    sound.setEnabled(this.settings.soundEnabled);
    this.skinManager = new SkinManager();
    // 這裡的棋面只用寶石預設色：外觀設定和另一個遊戲共用，以前存的自訂色／圖片只在這裡改用預設色，不覆寫存檔
    const cfg = this.skinManager.config;
    this.skinManager.config = { ...cfg, black: normalizeFace(cfg.black, true), white: normalizeFace(cfg.white, false) };
    this.skinManager.applyToDOM();
    this.applySymbolSet(this.settings.symbolSet);
    this.applyTextColors();

    const blackSeat = this.settings.blackRole || HUMAN;
    const whiteSeat = this.settings.whiteRole || CPU_SEAT;

    this.engine = new GameEngine({
      blackPlayerType: blackSeat,
      whitePlayerType: whiteSeat,
    });

    this.session = createSession({ black: blackSeat, white: whiteSeat });
    this.ui = deriveUiState({ session: this.session, turn: this.engine.currentTurn, gameOver: false, isAtTip: true });

    this.cpuTimer = null;
    this.cpuRequest = null;   // v6 在 Worker 思考中的請求（局面改變時作廢）
    this.aiClient = new AiClient();
    // 局面分析（勝率條、勝率走勢、提示、走法標記共用）：一條 Worker，一次算一件事，見 scheduleAnalysis
    this.analysisClient = new AiClient();
    this.ponderClient = null;           // 預先計算專用（CPU 選好棋、還沒落子時，先替下一個局面算）；用到才開，見 ponderWorker
    this.ponder = null;                 // { board, player, pool, promise }
    this.ponderJob = null;              // 預先計算的結果正在補算新的那顆棋的節點 id
    this.analysis = new Map();      // 節點 id → { scores, best, level }（下棋者角度的勝率尺度分數；level 見 levelMs）
    this.analysisJob = null;        // 正在算的 { nodeId, level, token }
    this.analysisGen = 0;           // 開新局時加一，作廢還在路上的舊結果
    this.confirmNeed = new Set();   // 走法標記等著確認（要第 2 級分析）的局面
    this.evalBar = new EvalBar(document.getElementById("evalBar"));
    this.passTimer = null;
    // 提示模式：開著時，棋盤上每個合法格子標出四顆棋裡最高的勝率（使用者角度、校準過的勝率）
    this.hintOn = false;
    this.hint = null;      // { nodeId, pct: Map("disc:sq" → %), best: Map(sq → {disc, pct}) }
    this.hoverSq = null;   // 提示模式下滑鼠所在的合法格子
    this.lockedDisc = null;  // 使用者從池子點選、要下的棋（null = 還沒選：點格子會跳出選棋框）
    this.tapPick = null;     // 選棋中：{ sq, idx }——點一下換下一顆候選、長按下這顆，見 tapCell
    this.renderCount = 0;

    this.init();
  }

  init() {
    ModalManager.init();
    applyI18n();

    this.boardView = new BoardView({
      boardContainer: document.getElementById("boardContainer"),
      onCellClick: (r, c) => this.handleCellClick(r, c),
      // 長按只在「這一格正顯示著候選」時有意義：回傳要按多久（毫秒），null = 不是長按的對象
      onCellPress: (r, c) => (this.canHumanAct() && this.tapPick?.sq === r * 8 + c ? LONG_PRESS_MS : null),
      onCellHold: (r, c) => this.confirmTapPick(r * 8 + c),
      onCellHover: (r, c, isEnter, pointerType) => this.handleCellHover(r, c, isEnter, pointerType)
    });

    this.poolView = new PoolView({
      widget: document.getElementById("handWidget"),
      valLabel: document.getElementById("sideDiceValLabel"),
      bagLabel: document.getElementById("handBagLabel"),
      onSelect: (id) => this.handleSelectDisc(id)
    });

    this.patternFx = new PatternFx({
      frame: document.getElementById("boardFrame"),
      board: document.getElementById("boardContainer")
    });

    this.winChart = new WinChart({
      container: document.getElementById("historyBox"),
      onPick: (step) => this.goToStep(step)
    });

    this.engine.subscribe((event, payload) => this.handleEngineEvent(event, payload));

    this.bindDOMEvents();
    this.bindKeyboardShortcuts();
    this.applyTheme(this.settings.theme || "neon");
    this.applyAnimationLevel();

    // 上次沒下完的對局（重新整理頁面）：接著下；沒有或讀不回來就開新局
    if (!this.loadGame()) this.newGame();
    // 開場若輪到 CPU，先停在暫停狀態，別讓使用者一進來就被 CPU 搶著下
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;

    if (!Storage.hasSeenOnboarding()) {
      setTimeout(() => this.openTutorialModal(), 500);
    }
    this.checkDeveloperMode();
    this.sync();
  }

  /** 新局的確認視窗：選開局（預設是上次選的） */
  openNewGameModal() {
    this.renderOpeningPick(this.settings.opening === "xot" ? "xot" : "standard");
    ModalManager.open("newGameModal");
    document.getElementById("newGameOkBtn")?.focus({ preventScroll: true });
  }

  renderOpeningPick(opening) {
    this.openingPick = opening === "xot" ? "xot" : "standard";
    document.querySelectorAll("#newGameModal .openingChip").forEach((chip) => {
      const on = chip.dataset.opening === this.openingPick;
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-checked", String(on));
    });
    const note = document.getElementById("openingPickNote");
    if (note) note.textContent = tr(this.openingPick === "xot" ? "openingNote" : "openingStdNote");
  }

  /** 開新局：上次選的是 XOT 就從 XOT 開局隨機挑一個（前幾手已經下好，見 core/xot-openings.js） */
  newGame() {
    this.engine.resetGame(this.settings.opening === "xot" ? randomXot() : null);
  }

  // ===== 事件綁定 =====

  /** 目前的下棋節奏（見 PACES） */
  pace() {
    return PACES[this.settings.pace] || PACES.normal;
  }

  /** 極速節奏：不播動畫、不放落子音效 */
  isInstant() {
    return this.settings.pace === "instant";
  }

  /** 動畫要不要省略（使用者選了最少動畫，或極速節奏） */
  animMinimal() {
    return this.settings.animationLevel === "minimal" || this.isInstant();
  }

  applyAnimationLevel() {
    // 系統設定了「減少動態效果」（手機的無障礙設定常見）：照標準動畫設定的人改成最少動畫
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && (this.settings.animationLevel || "standard") === "standard";
    document.documentElement.dataset.anim = this.isInstant() || reduce ? "minimal" : (this.settings.animationLevel || "standard");
  }

  /** 預先計算的 worker：只有「人對 CPU」才用得到，第一次用到才開（少一條 worker、少約 8 MB 記憶體） */
  ponderWorker() {
    if (!this.ponderClient) this.ponderClient = new AiClient();
    return this.ponderClient;
  }

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
      this.renderTutorialLegend();
      this.renderHelpGuide();
      for (const side of ["black", "white"]) {
        const input = document.getElementById(side === "black" ? "settingBlackName" : "settingWhiteName");
        if (input) input.placeholder = tr(side);
      }
      document.querySelectorAll(".seatGroup .seatLabel").forEach((l) => { l.title = tr("renameTip"); });
      this.patternFx.retranslate();
      if (this.openingPick) this.renderOpeningPick(this.openingPick); // 新局視窗的說明文字
      this.sync();
      if (document.getElementById("skinModal")?.classList.contains("open")) this.renderSkinWorkshop();
    });

    document.getElementById("rulesBtn")?.addEventListener("click", () => this.openTutorialModal(this.helpTab || "rules"));
    document.querySelectorAll(".helpTab").forEach((btn) => btn.addEventListener("click", () => this.showHelpTab(btn.dataset.tab)));
    document.getElementById("exportBtn")?.addEventListener("click", () => this.exportRecord());
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
        pop.hidden = !pop.hidden;
        btn.setAttribute("aria-expanded", String(!pop.hidden));
      });
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".rolePop")) closeRolePops(); });
    // 選棋中：點棋盤、池子以外的地方就不下在那格（點其他格子由 handleCellClick 處理）
    document.addEventListener("click", (e) => {
      // 用事件當下的路徑判斷（點格子後格子會重畫，e.target 已經不在頁面上，closest 找不到棋盤）
      const inside = e.composedPath().some(el => el.id === "boardContainer" || el.id === "handWidget");
      if (this.tapPick && !inside) this.cancelTapPick();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRolePops(); });
    // 分頁切到背景（或手機關螢幕）：停掉局面分析，不在看不到的時候一直加深、耗電；回來再接著算
    // 離開頁面（重新整理、關分頁、手機切走）：馬上存，不等延遲
    window.addEventListener("pagehide", () => this.saveGame());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.cancelAnalysisJob();
        this.saveGame();
        // CPU 對 CPU：看不到就先暫停（背景的計時器會被瀏覽器拖慢，回來時已經錯過好幾手），回來按繼續
        if (this.session.seats.black === CPU_SEAT && this.session.seats.white === CPU_SEAT && !this.session.paused) this.handlePauseCpu();
      }
      else this.scheduleAnalysis();
    });

    const soundBtn = document.getElementById("soundToggleBtn");
    soundBtn?.addEventListener("click", () => {
      this.settings.soundEnabled = !this.settings.soundEnabled;
      sound.setEnabled(this.settings.soundEnabled);
      soundBtn.textContent = this.settings.soundEnabled ? "🔊" : "🔇";
      Storage.saveSettings(this.settings);
    });

    // 新局：在確認視窗裡選開局（標準／XOT），記住上次選的
    document.getElementById("restartBtn")?.addEventListener("click", () => this.openNewGameModal());
    document.querySelectorAll("#newGameModal .openingChip").forEach((chip) => {
      chip.addEventListener("click", () => this.renderOpeningPick(chip.dataset.opening));
    });
    document.getElementById("newGameCancelBtn")?.addEventListener("click", () => ModalManager.close("newGameModal"));
    document.getElementById("newGameOkBtn")?.addEventListener("click", () => {
      ModalManager.close("newGameModal");
      this.settings.opening = this.openingPick;
      Storage.saveSettings(this.settings);
      this.teardown();
      this.newGame();
      this.sync();
    });

    // 席位控制列：點一下即時改變「誰在下」
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

    this.bindSettingsForm();
  }

  bindSettingsForm() {
    const bind = (id, apply, initial) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = String(initial);
      el.addEventListener("change", (e) => apply(e.target.value));
    };
    bind("settingBlackLevel", (v) => {
      this.settings.blackLevel = clampLevel(v); Storage.saveSettings(this.settings); this.render();
    }, clampLevel(this.settings.blackLevel));
    bind("settingWhiteLevel", (v) => {
      this.settings.whiteLevel = clampLevel(v); Storage.saveSettings(this.settings); this.render();
    }, clampLevel(this.settings.whiteLevel));
    bind("settingV6Time", (v) => {
      this.settings.v6Time = Number(v) || 500; Storage.saveSettings(this.settings);
    }, this.settings.v6Time || 500);
    bind("settingPace", (v) => {
      this.settings.pace = PACES[v] ? v : "normal"; Storage.saveSettings(this.settings);
      this.applyAnimationLevel();
    }, PACES[this.settings.pace] ? this.settings.pace : "normal");
  }

  bindKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (ModalManager.activeModals.size > 0) return;
      switch (e.key) {
        case "Escape": if (this.tapPick) { e.preventDefault(); this.cancelTapPick(); } break;
        case "ArrowLeft": e.preventDefault(); this.goToStep(this.currentStep() - 1); break;
        case "ArrowRight": e.preventDefault(); this.goToStep(this.currentStep() + 1); break;
        case " ":
          // 空白鍵只有一個意思：暫停／繼續 CPU
          if (this.ui.ctrl === CTRL.CPU) { e.preventDefault(); this.handlePauseCpu(); }
          else if (this.ui.ctrl === CTRL.PAUSED) { e.preventDefault(); this.handleResumeCpu(); }
          break;
        case "h":
        case "H":
          e.preventDefault();
          this.toggleHint();
          break;
        case "1": case "2": case "3": case "4": {
          // 數字鍵選第幾組（用完的組別按了沒反應）
          const id = this.engine.pool.find(d => groupOf(d) === Number(e.key) - 1);
          if (id != null) this.handleSelectDisc(id);
          break;
        }
      }
    });
  }

  applyTheme(themeKey) {
    document.body.className = `theme-${themeKey}`;
    this.settings.theme = themeKey;
    Storage.saveSettings(this.settings);
  }

  // ===== 遊戲事件處理 =====

  handleEngineEvent(event, payload) {
    if (event === "MOVE_EXECUTED") {
      if (payload.move.five) {
        this.patternFx.playFive(payload.move.five, letterOf(payload.move.five.value), this.animMinimal());
      } else {
        this.patternFx.clear();
      }
      if (!this.isInstant()) sound.playPlace(payload.move.flips.length);
    } else if (event === "PASS_EXECUTED") {
      // 跳過的聲音在發現要跳過時就響了（見 sync），這裡不再重複
    } else if (event === "GAME_OVER") {
      if (this.engine.settlementData?.byFive) sound.playFive(); else sound.playGameEnd();
      this.session.assist = null;
      setTimeout(() => this.celebrate(payload), 80);
    } else if (event === "STATE_RESTORED") {
      if (payload.node.move?.five) this.patternFx.playFive(payload.node.move.five, letterOf(payload.node.move.five.value), true);
    } else if (event === "GAME_RESET") {
      this.teardown();
      this.analysisGen++; this.analysis.clear(); this.confirmNeed.clear();
      this.cancelAnalysisJob(); this.ponder = null; this.ponderJob = null;
      this.resetSessionToSettings();
    }
    this.sync();
  }

  // ===== 存檔（重新整理頁面後接著下） =====

  /**
   * 對局存進瀏覽器：整棵對局樹（含分支、走法標記）與局面分析（重新整理後不用重算）。
   * 席位不另外存：設定裡本來就有，分支研究的暫時席位由 syncResearchMode 依對局樹重建。
   */
  saveGame() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const round = (x) => Math.round(x * 1e4) / 1e4;
    const analysis = [];
    for (const [id, a] of this.analysis) {
      if (!this.engine.tree.getNode(id)) continue;
      analysis.push([id, a.level, a.scores.map(x => [x.sq, round(x.score)])]);
    }
    Storage.saveGame({ format: "five-othello-save", v: SAVE_VERSION, tree: this.engine.tree.toJSON(), analysis });
  }

  /** 畫面更新一次就排一次存檔，連續變動只存最後一次 */
  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveGame(), 400);
  }

  /** 讀回存檔；成功回傳 true（沒有存檔、格式不對都回傳 false，交給呼叫的人開新局） */
  loadGame() {
    const data = Storage.loadGame();
    if (!data || data.format !== "five-othello-save" || data.v !== SAVE_VERSION) return false; // 舊規則（v1）的存檔不讀
    try {
      this.engine.restoreTree(data.tree);
    } catch (e) {
      console.warn("存檔讀不回來，開新局", e);
      return false;
    }
    for (const [id, level, scores] of data.analysis || []) {
      if (!this.engine.tree.getNode(id) || !scores.length) {
        if (this.engine.tree.getNode(id)) this.analysis.set(id, { scores: [], best: 0, level });
        continue;
      }
      const list = scores.map(([sq, score]) => ({ sq, score })).sort((a, b) => b.score - a.score);
      this.analysis.set(id, { scores: list, best: list[0].score, level });
    }
    return true;
  }

  // ===== 狀態推導與同步中樞 =====

  /**
   * 分支研究模式跟著對局樹走：只要正在看分支，就是自己替雙方下（雙方都是人類、不存進設定）；
   * 回到主線就換回進入研究前的席位。不論是從哪個操作進出分支，都以這裡為準。
   */
  syncResearchMode() {
    const inBranch = this.engine.tree.activeBranchId !== "main";
    if (inBranch && !this.researchSeats) {
      this.researchSeats = { ...this.session.seats };
      this.session.seats.black = HUMAN;
      this.session.seats.white = HUMAN;
      this.session.assist = null;
      this.session.paused = false;
      this.syncEngineSeats();
    } else if (!inBranch && this.researchSeats) {
      this.session.seats.black = this.researchSeats.black;
      this.session.seats.white = this.researchSeats.white;
      this.researchSeats = null;
      this.syncEngineSeats();
    } else if (inBranch && (this.session.seats.black !== HUMAN || this.session.seats.white !== HUMAN)) {
      this.session.seats.black = HUMAN;
      this.session.seats.white = HUMAN;
      this.syncEngineSeats();
    }
  }

  sync() {
    this.syncResearchMode();
    // 暫停只用於「CPU 對 CPU」；人機對戰時 CPU 輪到就直接下，不需要暫停
    if (this.session.paused && !(this.session.seats.black === CPU_SEAT && this.session.seats.white === CPU_SEAT)) {
      this.session.paused = false;
    }

    const tipNode = this.engine.tree.getBranchTipNode();
    const currNode = this.engine.tree.getCurrentNode();
    const isAtTip = Boolean(currNode && tipNode && currNode.id === tipNode.id);
    const ui = deriveUiState({
      session: this.session,
      turn: this.engine.currentTurn,
      gameOver: this.engine.gameOver,
      isAtTip,
      passPending: Boolean(this.passTimer)
    });
    this.ui = ui;

    // 沒有合法位置：稍等一下讓玩家看清楚，然後自動 PASS
    const mustPass = ui.view === VIEW.LIVE && !this.engine.gameOver && this.engine.legalMoves().length === 0;
    if (mustPass && !this.passTimer) {
      sound.playPass();
      this.passTimer = setTimeout(() => {
        this.passTimer = null;
        this.engine.passTurn();
      }, this.pace().pass);
      this.ui = deriveUiState({ session: this.session, turn: this.engine.currentTurn, gameOver: false, isAtTip, passPending: true });
    }

    if (this.ui.runCpuTimer && !this.cpuTimer && !this.cpuRequest) {
      this.startCpuTimer();
    } else if (!this.ui.runCpuTimer && (this.cpuTimer || this.cpuRequest)) {
      this.stopCpuTimer();
    }

    this.render();
  }

  teardown() {
    this.stopCpuTimer();
    if (this.passTimer) { clearTimeout(this.passTimer); this.passTimer = null; }
    this.hoverSq = null;
    this.lockedDisc = null;
    this.tapPick = null;
    this.patternFx?.clear();
  }

  // ===== 玩家操作 =====

  /**
   * 點格子：選了棋（或池子只有一種棋）就直接下。還沒選棋時（滑鼠、觸控、鍵盤都一樣）：
   * 點一下顯示候選的第 1 顆，再點一下換下一顆（循環），長按就下目前這顆；點別的地方（包括其他格子）就不下在這格。
   */
  handleCellClick(r, c) {
    // 輪到人類、CPU 暫停時接手，或在歷史某一步（直接下就開分支）
    if (!this.canHumanAct()) return;
    const sq = r * 8 + c;
    if (!this.engine.findLegalMove(r, c)) { this.cancelTapPick(); return; }
    const disc = this.chosenDiscFor(sq);
    if (disc != null) { this.playAt(sq, disc); return; }
    this.tapCell(sq);
  }

  /** 選棋的候選：還有剩的每一組（依組別） */
  tapCandidates() {
    return [...this.engine.pool];
  }

  /** 點了 sq：同一格再點換下一顆（循環）；點別的格子就改從那格的第 1 顆開始。下棋靠長按（見 confirmTapPick） */
  tapCell(sq) {
    const n = this.tapCandidates().length;
    const tp = this.tapPick;
    if (tp && tp.sq === sq) tp.idx = (tp.idx + 1) % n;
    else this.tapPick = { sq, idx: 0 };
    sound.playPick();
    this.render();
  }

  /** 長按：下目前顯示的那顆 */
  confirmTapPick(sq) {
    if (this.tapPick?.sq !== sq || !this.canHumanAct()) return;
    const disc = this.tapPickDisc();
    if (disc == null) return;
    if (TOUCH) navigator.vibrate?.(15); // 手機長按成立：輕輕震一下，不用盯著進度環
    this.playAt(sq, disc);
  }

  /** 不下在選棋中的那一格 */
  cancelTapPick() {
    if (!this.tapPick) return;
    this.tapPick = null;
    this.render();
  }

  /** 選棋中目前試的那顆 */
  tapPickDisc() {
    const tp = this.tapPick;
    if (!tp) return null;
    const c = this.tapCandidates();
    return c.length ? c[tp.idx % c.length] : null;
  }

  /** 在 sq 下 disc（長按、或點格子時已經知道要下哪顆） */
  playAt(sq, disc) {
    this.tapPick = null;
    if (this.ui.view === VIEW.LIVE) this.takeOverIfPaused();
    this.executeMove(sq >> 3, sq & 7, disc);
  }

  /**
   * 點這一格要下哪顆棋；null = 要使用者自己挑（點一下換一顆、長按下棋，見 tapCell）。
   *   從池子選了某顆 → 那顆
   *   開著提示 → 這格勝率最高的那顆（答案已經攤在棋盤上，不用再一顆一顆試；滑鼠指著格子時會預覽它）
   *   只剩一組有棋 → 不用問
   */
  chosenDiscFor(sq) {
    const pool = this.engine.pool;
    if (this.lockedDisc != null && pool.includes(this.lockedDisc)) return this.lockedDisc;
    const best = this.hintBestDisc(sq);
    if (best != null) return best;
    if (pool.length === 1) return pool[0];
    return null;
  }

  /** 開著提示、而且目前局面的提示已經算好時：這格勝率最高的那顆（還沒算好、或沒開提示是 null） */
  hintBestDisc(sq) {
    if (!this.hintOn || this.hint?.nodeId !== this.engine.tree.currentNodeId) return null;
    const d = this.hint.best.get(sq)?.disc;
    return d != null && this.engine.pool.includes(d) ? d : null;
  }


  takeOverIfPaused() {
    if (this.ui.ctrl !== CTRL.PAUSED) return;
    const side = seatKey(this.engine.currentTurn);
    this.session.assist = null;
    if (this.session.seats[side] !== HUMAN) this.setSeat(side, HUMAN);
    else { this.session.paused = false; this.sync(); }
  }

  /** 人類現在能不能操作棋盤與池子：輪到人類、CPU 暫停時接手，或在歷史某一步（下了就開分支） */
  canHumanAct() {
    if (this.engine.gameOver || this.passTimer) return false;
    if (this.ui.view === VIEW.REVIEW) return true;
    if (this.ui.view !== VIEW.LIVE) return false;
    return this.ui.ctrl === CTRL.HUMAN || this.ui.ctrl === CTRL.PAUSED;
  }

  /** 從池子選要下的棋；提示模式下再點一次同一顆就取消，回到「每格用勝率最高的那顆」 */
  /** 從池子點一顆棋：固定用這顆；再點一次同一顆就解除，回到每格自動選最好的那顆 */
  handleSelectDisc(id) {
    if (!this.canHumanAct()) return;
    // 某一格正在選棋：點池子或按 1～4 就等於選這顆，直接下在那格
    const at = this.tapPick?.sq;
    if (at != null && this.lockedDisc == null && this.engine.pool.includes(id) && this.engine.findLegalMove(at >> 3, at & 7)) { this.playAt(at, id); return; }
    sound.playPick();
    this.lockedDisc = this.lockedDisc === id ? null : id;
    this.engine.selectDisc(id);
    this.render();
  }

  /** 提示模式下滑鼠移到合法格子：格子畫出要下的那顆棋，池子標出每顆棋下在這格的勝率 */
  handleCellHover(r, c, isEnter, pointerType = "mouse") {
    const sq = r * 8 + c;
    // 五連威脅：滑鼠指到某一組的棋或缺口 → 只突顯那一組
    const next = isEnter ? sq : (this.threatHoverSq === sq ? null : this.threatHoverSq);
    const focusChanged = next !== this.threatHoverSq;
    this.threatHoverSq = next;
    if (!this.canHumanAct()) { if (focusChanged) this.renderBoard(); return; }
    // 觸控、筆沒有真正的「移上去／移出」（手指點下、放開也會觸發）：只更新威脅連線的突顯
    if (pointerType !== "mouse") { if (focusChanged) this.renderBoard(); return; }
    if (!isEnter) {
      if (this.hoverSq === sq) { this.hoverSq = null; this.render(); }
      else if (focusChanged) this.renderBoard();
      return;
    }
    if (!this.engine.findLegalMove(r, c) || this.hoverSq === sq) { if (focusChanged) this.renderBoard(); return; }
    // 移到另一個可下的格子：池子亮出這格要下的那顆，格子上預覽；威脅連線也把它算進去（見 renderBoard）
    this.hoverSq = sq;
    this.render();
  }

  /** 下一步；在歷史某一步下會開分支（見 GameEngine.playMove） */
  /** @param {"human"|"cpu"} actor 誰下的（記在節點上，匯出棋譜時用） */
  executeMove(r, c, disc = this.engine.hand, actor = "human") {
    // 在主線的歷史某一步下棋 → 進入分支研究：自己跟自己研究，雙方都改成人類（不存進設定），
    // 退回分岔點或更早、分支消失時，換回原本的席位（見 goToStep）
    this.stopCpuTimer();
    this.hoverSq = null;
    this.lockedDisc = null;
    this.tapPick = null;
    const player = this.engine.currentTurn;
    // 回顧歷史時下的這一步跟紀錄裡的下一手一模一樣（同一格、同一顆）→ 等同按「下一手」，不開分支
    const step = this.currentStep();
    const nextNode = this.engine.tree.getBranchHistory()[step + 1];
    const nm = nextNode?.move;
    if (nm && nm.type === MOVE_TYPE.PLACE && nm.r === r && nm.c === c && nm.discId === disc) {
      this.goToStep(step + 1);
      return true;
    }
    const ok = this.engine.playMove(r, c, disc);
    if (ok) {
      const node = this.engine.tree.getCurrentNode();
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

  // ===== CPU 行動推進 =====

  startCpuTimer() {
    this.stopCpuTimer();
    if (!this.ui.runCpuTimer) return;
    this.cpuTurnStart = Date.now(); // 下棋節奏從輪到 CPU 開始算
    this.cpuTimer = setTimeout(() => {
      this.cpuTimer = null;
      this.performCpuMove();
    }, 0);
  }

  performCpuMove() {
    if (this.engine.gameOver || this.ui.ctrl !== CTRL.CPU) return;
    const turn = this.engine.currentTurn;
    const nodeId = this.engine.tree.currentNodeId;
    const board = this.engine.board, pool = [...this.engine.pool];
    const req = {};
    this.cpuRequest = req;
    const thinkMs = this.settings.v6Time || 500;
    const level = clampLevel(turn === BLACK ? this.settings.blackLevel : this.settings.whiteLevel);
    // 亮棋之前至少等：節奏的間隔扣掉亮棋時間；最高級另外至少等滿 AI 思考時間（其他級是固定層數，幾毫秒就算完，只看節奏）
    const pace = this.pace();
    const minMs = Math.max(pace.gap - pace.pick, level === MAX_CPU_LEVEL ? thinkMs : 0);
    const started = this.cpuTurnStart ?? Date.now();
    // 最高級（按時間搜）搜尋時局面分析先停：兩條 worker 同時搜會互搶記憶體／快取，CPU 的搜尋量少約兩成。
    // 正在算的如果是勝率條的第 1 級（最多 T），先等它算完，勝率走勢才不會缺點；更深的分析直接放棄，之後再算。
    // 其他級是固定層數，同時跑不影響棋力，分析照常。
    const timed = level === MAX_CPU_LEVEL;
    let before = Promise.resolve();
    if (timed) {
      this.cpuSearching = req; // 不排新的分析（存這次的請求：舊請求收尾時不會清掉新請求的標記）
      const job = this.analysisJob;
      if (job?.level === 1) before = job.promise;
      else this.cancelAnalysisJob();
    }
    before
      .then(() => {
        if (this.cpuRequest !== req) return null; // 等的時候已暫停、悔棋或換局
        if (timed) this.cancelAnalysisJob();
        return this.aiClient.search({ board, player: turn, pool, timeMs: thinkMs, level });
      })
      .then((res) => { if (timed && this.cpuSearching === req) { this.cpuSearching = null; this.scheduleAnalysis(); } return res; })
      .then((res) => new Promise((resolve) => setTimeout(() => resolve(res), Math.max(0, minMs - (Date.now() - started)))))
      .then((res) => {
        if (this.cpuRequest !== req) return; // 已暫停、悔棋或換局：結果作廢
        if (this.engine.tree.currentNodeId !== nodeId || this.ui.ctrl !== CTRL.CPU) { this.cpuRequest = null; this.sync(); return; }
        const move = res ? moveFromSquare(this.engine.board, turn, res.bestSq) : null;
        if (!move) { this.cpuRequest = null; this.engine.passTurn(); return; }
        // 趁 CPU 亮棋的空檔，先替下一個局面（輪到你）算提示
        try { this.startPonder(board, turn, move, res.disc); } catch (err) { console.error("ponder error:", err); }
        // 先在池子裡亮出 CPU 選的棋，停一下再落子。
        // 計時器要在畫面更新「之前」排好：就算畫面更新出錯，CPU 也不會停在思考中
        this.cpuPick = res.disc;
        this.cpuTimer = setTimeout(() => {
          this.cpuTimer = null;
          this.cpuPick = null;
          if (this.cpuRequest !== req) return;
          this.cpuRequest = null;
          if (this.engine.tree.currentNodeId !== nodeId || this.ui.ctrl !== CTRL.CPU) { this.sync(); return; }
          this.executeMove(move.r, move.c, res.disc, "cpu");
        }, pace.pick);
        try { this.render(); } catch (err) { console.error("render error:", err); }
      })
      .catch((err) => {
        // 搜尋或後續處理出錯：放掉這次請求，讓 sync 重新排一次 CPU，不要卡住
        console.error("CPU move error:", err);
        if (this.cpuSearching === req) this.cpuSearching = null;
        if (this.cpuRequest === req) { this.cpuRequest = null; this.cpuPick = null; this.sync(); }
      });
  }

  stopCpuTimer() {
    if (this.cpuTimer) { clearTimeout(this.cpuTimer); this.cpuTimer = null; }
    this.cpuRequest = null;
    this.cpuPick = null;
  }

  // ===== 席位與控制者切換 =====

  handlePauseCpu() {
    this.session.paused = true;
    this.stopCpuTimer();
    this.sync();
  }

  handleResumeCpu() {
    this.session.paused = false;
    this.sync();
  }

  syncEngineSeats() {
    this.engine.blackPlayerType = this.session.seats.black;
    this.engine.whitePlayerType = this.session.seats.white;
  }

  persistSeats() {
    if (this.researchSeats) return; // 分支研究中的席位是暫時的，不存進設定
    this.settings.blackRole = this.session.seats.black;
    this.settings.whiteRole = this.session.seats.white;
    Storage.saveSettings(this.settings);
  }

  resetSessionToSettings() {
    this.researchSeats = null;
    this.session = createSession({
      black: this.settings.blackRole || HUMAN,
      white: this.settings.whiteRole || CPU_SEAT
    });
    this.syncEngineSeats();
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;
  }

  /** 改變一個席位的操作者：「換我下 / 讓 CPU 下 / CPU 對戰」唯一的入口 */
  setSeat(side, owner) {
    if (side !== "black" && side !== "white") return;
    if (owner !== HUMAN && owner !== CPU_SEAT) return;
    if (this.session.seats[side] === owner) return;

    this.session.seats[side] = owner;
    this.persistSeats();
    this.syncEngineSeats();

    if (owner === CPU_SEAT) {
      this.session.paused = true; // 切換到 CPU 一律先暫停，讓使用者決定何時放行
      this.session.assist = null;
    } else if (side === seatKey(this.engine.currentTurn)) {
      this.session.assist = null;
      this.session.paused = false;
    }
    this.teardown();
    this.sync();
  }

  handleWatchCpuVsCpu() {
    this.session.seats.black = CPU_SEAT;
    this.session.seats.white = CPU_SEAT;
    this.session.assist = null;
    this.session.paused = false;
    this.persistSeats();
    this.syncEngineSeats();
    this.teardown();
    this.sync();
  }

  // ===== AI 提示與教練 =====

  /** 提示按鈕：開／關 */
  toggleHint() {
    this.hintOn = !this.hintOn;
    this.hoverSq = null;
    this.lockedDisc = null;
    this.tapPick = null; // 開了提示就改成點格子直接下勝率最高的那顆，正在逐顆試的取消
    if (!this.hintOn) this.hint = null;
    this.render(); // render 會依需要顯示提示（提示就是局面分析的結果，見 ensureHint）
  }

  /**
   * 提示（AI 教練）：顯示目前局面的分析——每個「棋＋格子」的勝率。提示不另外算，跟勝率條、走法標記是同一份分析：
   * 第 1 級（思考時間 T）先顯示淡色的數字，第 2 級（2T，教練的強度）起顯示正式的數字，你還在想時會繼續加深、數字跟著更新。
   */
  ensureHint() {
    if (!this.hintOn || !this.canHumanAct() || !this.engine.legalMoves().length) { this.hint = null; return; }
    const nodeId = this.engine.tree.currentNodeId;
    const a = this.analysis.get(nodeId);
    if (!a?.scores?.length) { if (this.hint?.nodeId !== nodeId) this.hint = null; return; }
    if (this.hint?.nodeId === nodeId && this.hint.level === a.level) return;
    this.hint = this.hintFromScores(nodeId, this.engine.board, [...this.engine.pool], a.scores, a.level < COACH_LEVEL);
    this.hint.level = a.level;
  }

  /**
   * 引擎的分數（sq = 棋 × 64 + 格）→ 提示：每個「組別（代表棋）：格子」的勝率，與每格最高的那組。
   * 用組別對（numberMask）：存檔讀回來的分析，代表棋的 id 可能跟現在的池子不一樣，同一組就一樣。prelim = 還在算、先用粗略的數字。
   */
  hintFromScores(nodeId, board, pool, scores, prelim = false) {
    const empties = board.flat().filter(d => !d).length;
    const pctOf = (score) => (score >= 0.999 ? 100 : Math.round(100 * displayWinProb(score, empties)));
    const byMask = new Map(); // 數字集合:格子 → 勝率
    for (const x of scores) {
      const k = `${numberMask(x.sq >> 6)}:${x.sq & 63}`;
      const p = pctOf(x.score);
      if (!byMask.has(k) || p > byMask.get(k)) byMask.set(k, p);
    }
    const pct = new Map(), best = new Map();
    for (const d of pool) {
      const m = numberMask(d);
      for (const [k, p] of byMask) {
        const [mk, sq] = k.split(":").map(Number);
        if (mk !== m) continue;
        pct.set(`${d}:${sq}`, p);
        const b = best.get(sq);
        if (!b || p > b.pct) best.set(sq, { disc: d, pct: p });
      }
    }
    return { nodeId, pct, best, prelim };
  }

  /**
   * 預先計算：CPU 選好棋、亮棋的空檔（還沒算完就接著在背景算），先替下一個局面（輪到你）算提示。
   * 自選組別沒有隨機補棋，下一個局面完全確定，算好就直接當作那個局面的第 2 級分析。
   */
  startPonder(board, turn, move, disc) {
    this.ponder = null;
    const next = turn === BLACK ? WHITE : BLACK;
    if (this.ui.seats[seatKey(next)] !== HUMAN || this.researchSeats) return;
    const nb = applyMoveToBoard(board, move, disc, turn);
    if (findFive(nb, turn)) return; // 這步就連成五：不用算了
    const pool = poolOf(nb);
    if (!pool.length) return;
    const promise = this.ponderWorker().search({ board: nb, player: next, pool, timeMs: this.levelMs(COACH_LEVEL), multiPV: true });
    this.ponder = { board: nb, player: next, pool, promise };
  }

  /** 這個局面是不是剛才預先計算的那個（同一個盤面、同一方） */
  takePonder(board, turn) {
    const p = this.ponder;
    if (!p || p.player !== turn) return null;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const a = board[r][c], b = p.board[r][c];
      if (!a !== !b || (a && (a.id !== b.id || a.face !== b.face))) return null;
    }
    this.ponder = null;
    return p;
  }

  /** 預先計算的結果 → 這個局面的第 2 級分析 */
  finishPonder(node, ponder) {
    const gen = this.analysisGen;
    this.ponderJob = node.id;
    ponder.promise.then((res) => {
      if (gen !== this.analysisGen) return;
      this.ponderJob = null;
      if (res?.scores?.length) this.storeAnalysis(node, res.scores.map(x => ({ sq: x.key, score: x.score })), COACH_LEVEL);
      this.render();
    });
  }

  /** 提示模式下每個合法格子要標的勝率：使用者點選過池子就用那顆，否則用這格最高的 */
  hintLabels() {
    const labels = new Map();
    if (!this.hintOn || !this.hint) return labels;
    let top = -1;
    for (const [sq, b] of this.hint.best) {
      const p = this.lockedDisc != null ? this.hint.pct.get(`${this.lockedDisc}:${sq}`) : b.pct;
      if (p == null) continue;
      labels.set(sq, { pct: p });
      if (p > top) top = p;
    }
    for (const v of labels.values()) v.best = v.pct === top;
    return labels;
  }

  // ===== 歷史回放：勝率折線圖、上一手／下一手 =====

  /** 目前在這條線的第幾手 */
  currentStep() {
    return this.engine.tree.getCurrentNode()?.stepIdx ?? 0;
  }

  /** 跳到目前這條線的第 step 手（退回分岔那一步或更早，分支消失回到主線） */
  /**
   * 從這裡繼續下（看歷史或分支研究時）：目前這一步變成最新一步——這條線到這一步設成正式棋譜，
   * 之後的棋與分支都刪掉，座位換回原本的設定，接著正常對局（不是分支研究）。輪到 CPU 時先暫停，跟回到最新一手一樣。
   */
  async resumeHere() {
    const curr = this.engine.tree.getCurrentNode();
    if (!curr || curr.gameOver) return;
    const ok = await ModalManager.confirm({
      title: tr("resumeTitle"),
      message: tr("resumeMsg", { n: curr.stepIdx }),
      confirmText: tr("resumeOk"),
      cancelText: tr("confirmCancel"),
      danger: true
    });
    if (!ok) return;
    this.teardown();
    if (!this.engine.makeCurrentLatest()) return;
    this.syncResearchMode(); // 分支沒了：座位換回進入研究前的設定
    if (this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT) this.session.paused = true;
    this.sync();
  }

  goToStep(step) {
    const line = this.engine.tree.getBranchHistory();
    if (step < 0 || step >= line.length || step === this.currentStep()) return;
    this.teardown();
    // 回到最新時若輪到 CPU，先暫停，由使用者決定何時放行
    if (step === line.length - 1 && this.session.seats[seatKey(line[step].turn)] === CPU_SEAT) this.session.paused = true;
    this.engine.goToStep(step);
    this.sync(); // 分支消失、回到主線時，sync 會換回進入研究前的席位
  }

  /** 折線圖的資料：主線、分支（從分岔點起）、每一手黑方的（校準）勝率與評價 */
  chartData() {
    const tree = this.engine.tree;
    // XOT 開局的隨機步：棋譜文字後面標「（XOT 開局）」
    const point = (node) => ({ step: node.stepIdx, black: this.blackPctOf(node), mark: node.mark?.sym || null, why: node.mark?.sym ? markWhyText(node.mark) : "", log: node.actor === "xot" ? tx(node.logText) + tr("xotLog") : node.logText });
    const main = tree.getBranchHistory("main").map(point);
    const line = tree.getBranchHistory();
    const branchInfo = tree.activeBranchId !== "main" ? tree.branches.get(tree.activeBranchId) : null;
    const branch = branchInfo ? { fork: branchInfo.forkStepIdx, points: line.slice(branchInfo.forkStepIdx).map(point) } : null;
    return { main, branch, current: this.currentStep(), lastStep: line.length - 1 };
  }

  /** 某一手之後的黑方勝率（%）：終局看結果，否則用分析結果換算；還沒分析是 null */
  /**
   * 匯出目前這條線的棋譜（JSON 檔）。每一手記下：下之前的局面（棋盤、輪到誰、每一組的代表棋）、下的棋（組別）與格子、
   * 誰下的（人／CPU 幾級）、走法評價與原因、黑方勝率。之後可以拿來重新分析，或統計真人對局的走法評價。
   */
  exportRecord() {
    const tree = this.engine.tree;
    const line = tree.getBranchHistory();
    const packBoard = (b) => b.map(row => row.map(d => (d ? [d.id, d.face] : 0)));
    const side = (t) => (t === BLACK ? "black" : "white");
    const moves = [];
    for (let i = 1; i < line.length; i++) {
      const prev = line[i - 1], node = line[i], m = node.move;
      if (!m) continue;
      moves.push({
        step: node.stepIdx,
        type: m.type,
        player: side(prev.turn),
        actor: node.actor || "unknown",
        cpuLevel: node.cpuLevel ?? null,
        disc: m.type === MOVE_TYPE.PLACE ? m.discId : null,
        sq: m.type === MOVE_TYPE.PLACE ? m.r * 8 + m.c : null,
        coord: m.type === MOVE_TYPE.PLACE ? posToCoord(m.r, m.c) : null,
        label: m.type === MOVE_TYPE.PLACE ? discLabel(m.discId) : null,
        group: m.type === MOVE_TYPE.PLACE ? groupOf(m.discId) + 1 : null,
        flips: m.flips?.length ?? 0,
        five: !!m.five,
        // 下之前的局面
        before: { turn: side(prev.turn), pool: [...prev.pool], board: packBoard(prev.board) },
        mark: node.mark?.sym ? { sym: node.mark.sym, why: node.mark.why, text: markWhyText(node.mark) } : null,
        blackWinPct: this.blackPctOf(node) == null ? null : Math.round(this.blackPctOf(node) * 10) / 10
      });
    }
    const last = line[line.length - 1];
    const branch = tree.branches.get(tree.activeBranchId);
    const record = {
      format: "five-othello-record", version: 2,
      rules: "4 組自選、同組五連獲勝（每組 16 顆，id 0～15 第 1 組、16～31 第 2 組…）",
      exportedAt: new Date().toISOString(),
      symbols: getSymbolSet(),
      seats: { black: this.ui.seats.black, white: this.ui.seats.white },
      levels: { black: clampLevel(this.settings.blackLevel), white: clampLevel(this.settings.whiteLevel) },
      thinkMs: this.settings.v6Time || 500,
      coachMs: this.coachMs(),
      line: tree.activeBranchId === "main" ? "main" : { branch: tree.activeBranchId, forkStep: branch?.forkStepIdx ?? null },
      start: { turn: side(line[0].turn), pool: [...line[0].pool], board: packBoard(line[0].board) },
      result: last.gameOver ? { winner: last.settlementData?.winner === BLACK ? "black" : last.settlementData?.winner === WHITE ? "white" : "draw", byFive: !!last.settlementData?.byFive, black: last.settlementData?.totalBlack ?? null, white: last.settlementData?.totalWhite ?? null } : null,
      moves
    };
    const pad = (n) => String(n).padStart(2, "0"), d = new Date();
    const name = `five-othello-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
    this.saveRecordFile(name, JSON.stringify(record, null, 1));
    return record;
  }

  /**
   * 存棋譜檔，依瀏覽器能做的事：
   *   1. 有「另存新檔」視窗（電腦版 Chrome、Edge）：自己選資料夾，預設是「下載」；下次會從上次存的資料夾開始（id）
   *   2. 手機：跳出分享選單，可以存到「檔案」、雲端硬碟或傳給別人（Discord、LINE 這類 App 內建的瀏覽器常常不能直接下載）
   *   3. 其他：一般下載，存到瀏覽器的下載資料夾
   * 要在點擊的當下呼叫（瀏覽器規定另存新檔視窗、分享選單都要由使用者的操作觸發）。
   */
  async saveRecordFile(name, text) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name, startIn: "downloads", id: "five-othello-records",
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
        });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        return "saved";
      } catch (e) {
        if (e?.name === "AbortError") return "cancel"; // 使用者按了取消
        // 其他錯誤（例如被瀏覽器擋下）：改用一般下載
      }
    }
    const file = typeof File === "function" ? new File([text], name, { type: "application/json" }) : null;
    if (TOUCH && file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return "shared";
      } catch (e) {
        if (e?.name === "AbortError") return "cancel";
      }
    }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded";
  }

  blackPctOf(node) {
    if (node.gameOver) {
      const w = node.settlementData?.winner;
      return w === BLACK ? 100 : w === WHITE ? 0 : 50;
    }
    const a = this.analysis.get(node.id);
    if (a && !a.scores.length) {
      // 輪到的一方沒有合法位置（要 PASS）：局面跟 PASS 之後（換對手下、盤面不變）一樣，用那一步的勝率
      const pass = node.children.map(id => this.engine.tree.getNode(id)).find(c => c?.move?.type === MOVE_TYPE.PASS);
      return pass ? this.blackPctOf(pass) : null;
    }
    if (!a?.scores?.length) return null;
    const empties = node.board.flat().filter(d => !d).length;
    const p = displayWinProb(a.best, empties);
    return 100 * (node.turn === BLACK ? p : 1 - p);
  }

  /** 「說明」視窗：規則／使用說明兩個分頁（第一次來的人先看規則） */
  openTutorialModal(tab = "rules") {
    this.renderHelpGuide();
    this.showHelpTab(tab);
    ModalManager.open("tutorialModal");
    Storage.setOnboardingSeen();
  }

  showHelpTab(tab) {
    this.helpTab = tab === "guide" ? "guide" : "rules";
    document.querySelectorAll(".helpTab").forEach((b) => {
      const on = b.dataset.tab === this.helpTab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll(".helpPanel").forEach((p) => { p.hidden = p.dataset.panel !== this.helpTab; });
    document.querySelector("#tutorialModal .modalBody")?.scrollTo?.(0, 0);
  }

  renderHelpGuide() {
    const el = document.getElementById("helpGuide");
    if (el) el.innerHTML = helpGuideHtml(curLang());
  }

  // ===== 棋子外觀工坊 =====

  openSkinModal() {
    ModalManager.open("skinModal");
    const sb = document.getElementById("soundToggleBtn");
    if (sb) sb.textContent = this.settings.soundEnabled ? "🔊" : "🔇";
    this.bindSkinEventsOnce();
    this.renderSkinWorkshop();
  }

  /** 棋子文字（希臘字母或自訂）：換掉 4 組的字（data-symbols 給 CSS 用） */
  applySymbolSet(name) {
    setSymbolSet(name, this.settings.customSymbols);
    // 舊設定（字母、圖案）或自訂字不合格時退回希臘字母
    const used = getSymbolSet();
    if (this.settings.symbolSet !== used) { this.settings.symbolSet = used; Storage.saveSettings(this.settings); }
    document.documentElement.dataset.symbols = used;
    this.renderTutorialLegend();
  }

  /** 教學裡的範例棋：用目前的字畫，說明文字也跟著換（前兩顆同一組、顏色不同；第三顆是另一組） */
  renderTutorialLegend() {
    const box = document.getElementById("legendFiveDiscs");
    const note = document.getElementById("legendFiveNote");
    if (!box || !note) return;
    box.innerHTML = [[0, BLACK], [1, WHITE], [GROUP_SIZE, BLACK]]
      .map(([d, f]) => `<div class="legendDisc">${discHtmlFive(d, f)}</div>`).join("");
    note.textContent = tr("legendFiveNote", { x: letterOf(1), y: letterOf(2) });
  }

  /** 棋子文字顏色（借用另一方的寶石色），寫進 CSS 變數 */
  applyTextColors() {
    const root = document.documentElement.style;
    for (const [isBlack, Key] of [[true, "Black"], [false, "White"]]) {
      const t = resolveTextColor(isBlack, this.settings[`textColor${Key}`]);
      root.setProperty(`--fn${Key}`, t.color);
      root.setProperty(`--fn${Key}Shadow`, t.shadow);
    }
  }

  renderSkinWorkshop() {
    const config = this.skinManager.config;
    const curTheme = this.settings.theme || "neon";
    document.querySelectorAll("#themePresetGroup .skinPresetChip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.theme === curTheme);
    });
    const sample = document.getElementById("customSymbolSample");
    const custom = parseCustomSymbols(this.settings.customSymbols);
    if (sample) sample.textContent = custom.ok ? custom.chars.join("") : "✎";
    const input = document.getElementById("customSymbolInput");
    if (input && document.activeElement !== input) input.value = this.settings.customSymbols || "";
    const curSymbols = this.settings.symbolSet || "suits";
    document.querySelectorAll("#symbolSetGroup .skinPresetChip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.symbols === curSymbols);
    });

    const renderSide = (side, isBlack, presets) => {
      const conf = config[side];
      const badge = document.getElementById(`${side}SkinBadge`);
      const disc = document.getElementById(`${side}PreviewDisc`);
      const group = document.getElementById(`${side}PresetGroup`);

      if (badge) badge.textContent = tr("p_" + conf.id);
      const key = isBlack ? "textColorBlack" : "textColorWhite";
      const text = resolveTextColor(isBlack, this.settings[key]);
      if (disc) {
        disc.style.background = getPieceBackgroundCss(conf, isBlack);
        // 預覽棋上放一個字，看得到文字顏色
        disc.innerHTML = `<span class="skinPreviewText" style="color:${text.color};text-shadow:${text.shadow}">${escapeHtml(letterOf(1))}</span>`;
      }
      // 文字顏色：另一方的寶石色（黑方棋面配淺色、白方棋面配深色）
      const textGroup = document.getElementById(`${side}TextColorGroup`);
      if (textGroup) {
        textGroup.innerHTML = "";
        for (const p of textPaletteFor(isBlack)) {
          const chip = document.createElement("button");
          chip.className = `skinPresetChip ${p.id === text.id ? "active" : ""}`;
          chip.innerHTML = `<span class="skinTextDot" style="color:${p.color};background:${getPieceBackgroundCss(conf, isBlack)}">${escapeHtml(letterOf(1))}</span><span>${tr("p_" + p.id)}</span>`;
          chip.addEventListener("click", () => {
            this.settings[key] = p.id;
            Storage.saveSettings(this.settings);
            this.applyTextColors();
            this.renderSkinWorkshop();
          });
          textGroup.appendChild(chip);
        }
      }
      if (group) {
        group.innerHTML = "";
        presets.forEach((p) => {
          const chip = document.createElement("button");
          chip.className = `skinPresetChip ${conf.id === p.id ? "active" : ""}`;
          chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color}"></span><span>${tr("p_" + p.id)}</span>`;
          chip.addEventListener("click", () => {
            this.saveSkin(side, { type: "preset", id: p.id, label: p.label, color: p.color, gradient: p.gradient, imageData: null, gloss: true });
          });
          group.appendChild(chip);
        });
      }
    };
    renderSide("black", true, DEFAULT_BLACK_PRESETS);
    renderSide("white", false, DEFAULT_WHITE_PRESETS);
  }

  saveSkin(side, conf) {
    this.skinManager.saveConfig({ [side]: conf });
    this.renderSkinWorkshop();
    this.render();
  }

  bindSkinEventsOnce() {
    if (this._skinEventsBound) return;
    this._skinEventsBound = true;

    // 棋子文字：希臘字母／自訂
    const symbolMsg = (text, bad = false) => {
      const el = document.getElementById("customSymbolMsg");
      if (!el) return;
      el.textContent = text;
      el.classList.toggle("bad", bad);
    };
    const useSymbols = (name) => {
      this.settings.symbolSet = name;
      Storage.saveSettings(this.settings);
      this.applySymbolSet(name);
      this.renderSkinWorkshop();
      this.sync();
    };
    const applyCustom = () => {
      const input = document.getElementById("customSymbolInput");
      const p = parseCustomSymbols(input?.value);
      if (!p.ok) {
        symbolMsg(p.reason === "count" ? tr("symCustomCount", { n: p.count }) : tr("symCustomDupe", { ch: p.dupe }), true);
        return;
      }
      this.settings.customSymbols = p.chars.join("");
      symbolMsg(tr("symCustomOk", { chars: p.chars.join(" ") }));
      useSymbols("custom");
    };
    document.querySelectorAll("#symbolSetGroup .skinPresetChip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (chip.dataset.symbols === "custom") { applyCustom(); return; }
        symbolMsg(tr("symbolHint"));
        useSymbols(chip.dataset.symbols);
      });
    });
    document.getElementById("customSymbolApply")?.addEventListener("click", applyCustom);
    document.getElementById("customSymbolInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyCustom(); });
    document.getElementById("customSymbolInput")?.addEventListener("input", (e) => {
      // 邊打邊提示還差幾個字
      const p = parseCustomSymbols(e.target.value);
      if (p.ok) symbolMsg(tr("symCustomReady"));
      else symbolMsg(p.reason === "count" ? tr("symCustomCount", { n: p.count }) : tr("symCustomDupe", { ch: p.dupe }), true);
    });
    document.querySelectorAll("#themePresetGroup .skinPresetChip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (!chip.dataset.theme) return;
        this.applyTheme(chip.dataset.theme);
        this.renderSkinWorkshop();
      });
    });

    document.getElementById("skinResetDefaultBtn")?.addEventListener("click", () => {
      this.applyTheme("neon");
      this.skinManager.resetDefaults();
      this.settings.textColorBlack = "";
      this.settings.textColorWhite = "";
      Storage.saveSettings(this.settings);
      this.applyTextColors();
      this.renderSkinWorkshop();
      this.render();
    });
  }

  // ===== 終局表現 =====

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
    const icons = ["🎉", "✨", "⭐", "🎊", "🏆"];
    for (let i = 0; i < 32; i++) {
      const p = document.createElement("span");
      p.className = "confettiPiece";
      const ang = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 190;
      p.textContent = icons[i % icons.length];
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

  checkDeveloperMode() {
    const hud = document.getElementById("developerHud");
    if (hud) hud.style.display = new URL(window.location.href).searchParams.get("debug") === "1" ? "grid" : "none";
  }

  // ===== 全域渲染 =====

  /** 能「下在某個合法位置就直接連成五」的組別（代表棋；輪到的人角度；選組別面板標 ★5） */
  poolFiveIds() {
    const out = new Set();
    if (this.engine.gameOver) return out;
    const me = this.engine.currentTurn;
    const moves = this.engine.legalMoves();
    for (const id of this.engine.pool) {
      if (moves.some(m => findFive(applyMoveToBoard(this.engine.board, m, id, me), me))) out.add(id);
    }
    return out;
  }

  /** 目前輪到的玩家的各個合法位置；選中的棋能直接連成五的位置標 ★5 */
  legalMoveMap() {
    const map = new Map();
    const pool = this.engine.pool;
    if (!pool.length || this.engine.gameOver) return map;
    const me = this.engine.currentTurn;
    // ★5：選了某組就只看那組；沒選的話，任何一組能在這格連成五就標
    const discs = this.lockedDisc != null && pool.includes(this.lockedDisc) ? [this.lockedDisc] : pool;
    for (const m of this.engine.legalMoves()) {
      const five = discs.some(d => findFive(applyMoveToBoard(this.engine.board, m, d, me), me));
      map.set(`${m.r},${m.c}`, { five, flips: m.flips });
    }
    return map;
  }

  // ===== 局面分析：勝率條、勝率走勢、提示、走法標記共用 =====

  /**
   * 第 level 級分析的時間：T × LEVEL_FACTORS[level − 1]，T = 設定的「AI 思考時間」（最高級 CPU 每步也想這麼久）。下棋快慢另外由「下棋節奏」管，見 PACES。
   *   第 1 級（T）：勝率條的下限      第 2 級（2T）：AI 教練的強度，走法標記在這一級確認
   *   第 3 級起（3T、5T、8T、13T，斐波那契數）：輪到你、還在想的時候繼續加深；提示數字到第 3 級才變清楚
   */
  levelMs(level) {
    return (this.settings.v6Time || 500) * LEVEL_FACTORS[Math.min(level, LEVEL_FACTORS.length) - 1];
  }

  /** 匯出棋譜用：AI 教練的時間 */
  coachMs() {
    return this.levelMs(COACH_LEVEL);
  }

  /** 輪到人類（或在看歷史）：可以繼續替你想 */
  userThinking() {
    return this.canHumanAct() && this.engine.legalMoves().length > 0;
  }

  analyzable(node) {
    return node && !node.gameOver && node.pool?.length > 0;
  }

  /**
   * 排下一件分析工作（一次只算一件），依優先順序：
   *   1. 目前局面到第 1 級（勝率條）
   *   2. 勝率走勢上還沒分析的局面，第 1 級
   *   3. 等著確認走法標記的局面到第 2 級
   *   4. 輪到你（或在看歷史）時，目前局面到第 2 級（教練的強度）
   *   5. 輪到你、還在想：目前局面繼續加深，最多到 MAX_LEVEL 級或單次 MAX_JOB_MS
   * CPU 搜尋的時候不排（見 performCpuMove）。
   * 換了局面：正在算的如果跟新局面、等著確認的局面都無關，直接放棄（見 cancelAnalysisJob）；勝率走勢這條線上的第 1 級除外。
   */
  scheduleAnalysis() {
    const tree = this.engine.tree;
    const curr = tree.getCurrentNode();
    if (!curr || document.hidden) return;
    // 換了局面：放棄跟現在無關的工作
    const job = this.analysisJob;
    // 例外：勝率走勢這條線上的第 1 級（最多 T）讓它算完，否則下得快的時候勝率走勢會斷斷續續
    const onLine = (id) => tree.getBranchHistory().some(n => n.id === id) || tree.getBranchHistory("main").some(n => n.id === id);
    if (job && job.nodeId !== curr.id && !this.confirmNeed.has(job.nodeId) && !(job.level === 1 && onLine(job.nodeId))) this.cancelAnalysisJob();
    // 預先計算過這個局面：補算新的那顆棋，當作第 2 級
    if (this.analyzable(curr) && (this.analysis.get(curr.id)?.level ?? 0) < COACH_LEVEL && this.ponderJob !== curr.id) {
      const p = this.takePonder(curr.board, curr.turn);
      if (p) this.finishPonder(curr, p);
    }
    this.updateMark(curr);
    if (this.analysisJob || this.cpuSearching) return; // CPU 搜完會再排一次
    const levelOf = (n) => this.analysis.get(n.id)?.level ?? 0;
    const pick = () => {
      const cur = this.analyzable(curr) && this.ponderJob !== curr.id ? curr : null;
      if (cur && levelOf(cur) < 1) return [cur, 1];
      // 勝率走勢缺的點（第 1 級，最多 T）排在標記確認（第 2 級，2T）前面：CPU 對下時 2T 的空檔常常等不到，
      // 確認排前面的話會一直被打斷重來，勝率走勢也跟著輪不到
      const todo = [...tree.getBranchHistory(), ...tree.getBranchHistory("main")].find(n => this.analyzable(n) && !this.analysis.has(n.id));
      if (todo) return [todo, 1];
      for (const id of [...this.confirmNeed].reverse()) {
        const n = tree.getNode(id);
        if (!this.analyzable(n) || levelOf(n) >= COACH_LEVEL) { this.confirmNeed.delete(id); continue; }
        return [n, COACH_LEVEL];
      }
      const thinking = this.userThinking();
      if (cur && levelOf(cur) < COACH_LEVEL && thinking) return [cur, COACH_LEVEL];
      const maxLevel = LOW_POWER ? MAX_LEVEL_LOW_POWER : MAX_LEVEL;
      if (cur && thinking && levelOf(cur) < maxLevel && this.levelMs(levelOf(cur) + 1) <= MAX_JOB_MS) return [cur, levelOf(cur) + 1];
      return null;
    };
    const next = pick();
    if (next) this.runAnalysis(next[0], next[1]);
  }

  runAnalysis(node, level) {
    const token = {};
    const gen = this.analysisGen;
    const promise = this.analysisClient.search({ board: node.board, player: node.turn, pool: node.pool, timeMs: this.levelMs(level), multiPV: true });
    this.analysisJob = { nodeId: node.id, level, token, promise }; // promise：最高級 CPU 會等第 1 級算完（見 performCpuMove）
    promise.then((res) => {
      if (gen !== this.analysisGen || this.analysisJob?.token !== token) return; // 已放棄或換局
      this.analysisJob = null;
      if (res?.scores?.length) this.storeAnalysis(node, res.scores.map(x => ({ sq: x.key, score: x.score })), level);
      else this.analysis.set(node.id, { scores: [], best: 0, level: MAX_LEVEL }); // 沒有合法位置（要跳過）：不用再算
      this.render(); // render 會排下一件工作
    });
  }

  cancelAnalysisJob() {
    if (!this.analysisJob) return;
    this.analysisJob = null;
    this.analysisClient.cancel();
  }

  /** 存一份分析（比原本的淺就不存），再重算用到它的走法標記 */
  storeAnalysis(node, scores, level) {
    const old = this.analysis.get(node.id);
    if (old && old.level >= level) return;
    scores.sort((a, b) => b.score - a.score);
    this.analysis.set(node.id, { scores, best: scores[0].score, level });
    if (level >= COACH_LEVEL) this.confirmNeed.delete(node.id);
    this.refreshMarksAround(node);
  }

  /** 某個局面的分析有了（或換成更準的）：用到它的評價重新算——這一步本身（設陷阱）、下一步、再下一步（終盤逆轉） */
  refreshMarksAround(node) {
    const tree = this.engine.tree;
    const curr = tree.getCurrentNode();
    if (curr) this.updateMark(curr);
    this.updateMark(node);
    for (const childId of node.children) {
      const c = tree.getNode(childId);
      if (!c) continue;
      this.updateMark(c);
      for (const gcId of c.children) { const gc = tree.getNode(gcId); if (gc) this.updateMark(gc); }
    }
  }

  /**
   * 這一步的評價（定義見 ai/move-quality.js）。用到三個局面的分析：
   *   上一個局面（這步的選擇）、下完的局面（判斷設陷阱）、上上個局面（對手下之前的勝率，判斷終盤逆轉）。
   * 分析陸續到齊、或加深了就重新算；上一個局面的分析還不到第 2 級時，要標任何記號都先等它確認。
   */
  updateMark(node) {
    if (!node.move || node.move.type !== "place" || !node.parentId) return;
    if (node.actor === "xot") return; // XOT 開局的隨機步不是誰下的，不評
    const tree = this.engine.tree;
    const parent = tree.getNode(node.parentId);
    const a = parent && this.analysis.get(parent.id);
    if (!a?.scores?.length) return;
    const nx = node.gameOver ? null : this.analysis.get(node.id) || null;
    const gp = parent.parentId ? tree.getNode(parent.parentId) : null;
    const ga = gp ? this.analysis.get(gp.id) : null;
    const inputs = `${a.level}|${nx?.level ?? 0}|${ga ? 1 : 0}`;
    if (node.markInputs === inputs) return;
    const toProb = (s, empties) => displayWinProb(s, empties);
    // 對手下之前，這一方的勝率（上上個局面的最佳步，換成這一方的角度）
    let prevP = null;
    if (ga?.scores?.length) {
      const p = ga.best >= 0.999 ? 1 : ga.best <= -0.999 ? 0 : toProb(ga.best, gp.board.flat().filter(d => !d).length);
      prevP = gp.turn === parent.turn ? p : 1 - p;
    }
    const { r, c } = node.move;
    const mark = classifyMove({
      scores: a.scores, played: node.move.discId * 64 + r * 8 + c,
      board: parent.board, turn: parent.turn, toProb,
      next: nx?.scores?.length ? { scores: nx.scores } : null, prevP
    });
    if (mark?.sym && a.level < COACH_LEVEL) {
      this.confirmNeed.add(parent.id); // 先不標，等上一個局面分析到第 2 級
      return;
    }
    node.mark = mark || null;
    node.markInputs = inputs;
  }

  /** 黑方勝率 [0, 1]：終局看結果，否則取目前局面的最佳步勝率 */
  renderEvalBar() {
    const node = this.engine.tree.getCurrentNode();
    if (!node) return;
    // 跟勝率走勢同一個算法（終局看結果；要 PASS 的局面用 PASS 之後的那一步）；勝率條用校準過的換算放大中盤的變化（見 ui/eval-bar.js）
    const pct = this.blackPctOf(node);
    if (pct == null) { this.evalBar.render({ blackProb: this.lastBlackProb ?? 0.5, pending: true }); return; }
    this.lastBlackProb = pct / 100;
    this.evalBar.render({ blackProb: this.lastBlackProb });
  }

  /** 首步／上手／下手／最新按鈕（目前這條線上） */
  renderPlaybackButtons() {
    const step = this.currentStep(), last = this.engine.tree.getBranchHistory().length - 1;
    const set = (id, on) => { const el = document.getElementById(id); if (el) el.disabled = !on; };
    set("historyFirstBtn", step > 0);
    set("historyPrevBtn", step > 0);
    set("historyNextBtn", step < last);
    set("historyLatestBtn", step < last);
  }

  renderBoard() {
    const state = this.engine.getState();
    const showLegal = this.canHumanAct();
    // 滑鼠所在的可下格子：畫出要下的那顆棋（沒固定選棋時是這格最好的那顆）
    // 選棋中：預覽正在試的那顆；否則滑鼠指著的格子：選了棋（或池子只有一種）就預覽那顆
    const tp = showLegal && this.tapPick ? this.tapPick : null;
    const hover = tp ? tp.sq : showLegal && this.hoverSq != null ? this.hoverSq : null;
    const hoverDisc = tp ? this.tapPickDisc() : hover != null ? this.chosenDiscFor(hover) : null;
    // 預覽：威脅連線當作那顆棋已經下在滑鼠所在的格子來算（威脅不分黑白，翻面不影響，只要放上去就好），
    // 例如三加上這顆變成四，虛線就會連到這格並變成實線
    let threatBoard = state.board;
    if (hover != null && hoverDisc != null && !state.board[hover >> 3][hover & 7]) {
      threatBoard = state.board.map(row => row.slice());
      threatBoard[hover >> 3][hover & 7] = { id: hoverDisc, face: state.currentTurn };
    }
    this.boardView.render({
      board: state.board,
      // 已經分出勝負（五連完成）就不再標威脅，只留五連的光效
      // 四的缺口只留真的有人下在那裡會連成五的，並標出是哪一方（見 withGapOwners）
      threatGroups: state.gameOver ? [] : withGapOwners(threatBoard, findThreatGroups(threatBoard)),
      threatFocus: this.threatHoverSq ?? null,
      legalMoves: showLegal ? this.legalMoveMap() : new Map(),
      lastMove: state.lastMove,
      lastMark: this.engine.tree.getCurrentNode()?.mark || null,
      hintLabels: showLegal ? this.hintLabels() : new Map(),
      previewGhostMove: hover != null ? { r: hover >> 3, c: hover & 7 } : null,
      ghostDisc: hoverDisc != null ? { id: hoverDisc, face: state.currentTurn } : null,
      tapPick: tp ? { sq: tp.sq, i: tp.idx % Math.max(1, this.tapCandidates().length) + 1, n: this.tapCandidates().length } : null
    });
    // 池子跟著棋盤一起更新：滑鼠在某格時，池子亮出要下的那顆，並標出每顆棋下在這格的勝率
    const discPcts = new Map();
    if (hover != null && this.hintOn && this.hint) for (const d of state.pool) {
      const p = this.hint.pct.get(`${d}:${hover}`);
      if (p != null) discPcts.set(d, p);
    }
    // 使用者固定選了某顆就亮那顆（發光）；否則只在滑鼠指著格子時，淡淡地框出那格要下的那顆
    const hintSel = !showLegal ? null : this.lockedDisc != null ? "locked" : hoverDisc != null ? "auto" : "none";
    this.poolView.render({
      pool: state.pool,
      selected: hintSel === "locked" ? this.lockedDisc : hintSel === "auto" ? hoverDisc : hintSel === "none" ? null : state.hand,
      hintSel,
      discPcts,
      canSelect: this.canHumanAct(),
      cpuPick: this.cpuPick ?? null,
      fiveIds: this.poolFiveIds(),
      face: state.currentTurn,
      counts: this.engine.groupCounts(),
      gameOver: state.gameOver
    });
  }

  render() {
    this.renderCount++;
    this.scheduleSave();
    const state = this.engine.getState();
    const ui = this.ui;
    const isCpuTurn = ui.ctrl === CTRL.CPU;
    const isPaused = ui.ctrl === CTRL.PAUSED;
    const isReview = ui.view === VIEW.REVIEW;
    const isEnded = ui.view === VIEW.ENDED;
    const currNode = this.engine.tree.getCurrentNode();

    const turnText = state.currentTurn === BLACK ? tr("sideBlack") : tr("sideWhite");
    // 選中的組別顯示成 α
    const humanPicks = this.canHumanAct();
    const shownDisc = !humanPicks ? state.hand
      : this.hoverSq != null ? (this.chosenDiscFor(this.hoverSq) ?? this.lockedDisc ?? null)
      : this.lockedDisc ?? null;
    const handDisc = shownDisc == null ? "?" : discLabel(shownDisc);

    // 1. 狀態橫幅
    const banner = document.getElementById("statusBanner");
    if (banner) banner.className = `statusBanner ${isReview ? "review" : (isEnded ? "ended" : ui.ctrl)}`;

    const statusText = document.getElementById("statusText");
    if (statusText) {
      let text;
      if (isReview) text = tr("stReview", { n: currNode ? currNode.stepIdx : 0 });
      else if (isEnded) text = tr("stEnded", { reason: state.settlementData ? tx(state.settlementData.reason) : tr("reasonDefault") });
      else if (this.passTimer) text = tr("stPassing", { turn: turnText });
      else if (isPaused) text = tr(ui.isCpuVsCpu ? "stPaused" : "stPausedOne", { turn: turnText });
      else if (isCpuTurn) {
        const actor = ui.isCpuVsCpu ? tr("stCpuVsCpu") : tr("stCpu");
        text = tr("stCpuThinkingFive", { actor, turn: turnText, disc: handDisc });
      } else {
        // 選棋說明：提示模式下沒有固定選棋 → 每格自動用勝率最高的那顆
        // 三種情況：固定選了某顆／滑鼠指著格子（自動選到這格最好的那顆）／都沒有（每格自動選）
        const tpd = this.tapPickDisc();
        const hoverBest = this.hoverSq != null ? this.hintBestDisc(this.hoverSq) : null;
        const pick = tpd != null ? tr("stTapPick", { disc: discLabel(tpd) })
          : this.lockedDisc != null ? tr("stPickDisc", { disc: handDisc })
          : hoverBest != null ? tr("stPickHintHover", { disc: discLabel(hoverBest) })
          : this.hintOn ? tr("stPickHint") : tr("stPickManual");
        if (this.researchSeats) {
          const fork = this.engine.tree.branches.get(this.engine.tree.activeBranchId)?.forkStepIdx ?? 0;
          text = tr("stResearch", { n: fork, turn: turnText, pick });
        } else text = tr(tpd != null || (this.hintOn && this.lockedDisc == null) ? "stHumanTap" : "stHumanPick", { turn: turnText, pick }); // 說明本身已經講了怎麼下，不用再接「請點選格子落子」
      }
      statusText.innerHTML = pieceify(escapeHtml(text));
    }

    const boardFrame = document.getElementById("boardFrame");
    if (boardFrame) {
      boardFrame.classList.toggle("board-review", isReview);
      boardFrame.classList.toggle("board-cpu", isCpuTurn);
      boardFrame.classList.toggle("board-paused", isPaused);
    }

    // 2. 比分（五連的分數就是棋子數）
    const sc = this.engine.scores();
    const totalB = sc.black;
    const totalW = sc.white;
    document.getElementById("scoreBlackNum").textContent = totalB;
    document.getElementById("scoreWhiteNum").textContent = totalW;
    const result = state.gameOver ? state.settlementData : null;
    document.querySelectorAll(".seatGroup").forEach((g) => {
      const mine = g.dataset.side === "black" ? BLACK : WHITE;
      g.classList.toggle("winner", !!result && result.winner === mine);
      g.classList.toggle("loser", !!result && result.winner !== EMPTY && result.winner !== mine);
      g.classList.toggle("drawn", !!result && result.winner === EMPTY);
    });

    // 3. 棋盤與抽棋面板。提示要在畫棋盤「之前」準備好：快取裡有的會立刻拿到，
    //    放在後面的話這一次畫的棋盤沒有數字，回顧歷史時又沒有別的東西會觸發重畫，數字就一直出不來
    this.ensureHint();
    // 提示數字的顏色：第 1 級 25%、第 2 級 50%、第 3 級以上 100%
    const hintLevel = this.hintOn && this.hint ? String(Math.min(this.hint.level || 1, 3)) : "";
    if (document.documentElement.dataset.hintLevel !== hintLevel) document.documentElement.dataset.hintLevel = hintLevel;
    this.renderBoard();

    // 4. 棋譜
    this.scheduleAnalysis();
    this.renderEvalBar();
    this.winChart.render(this.chartData());
    this.renderPlaybackButtons();

    // 5. 席位列
    const seatCurrentKey = seatKey(state.currentTurn);
    const seatsEditable = ui.view === VIEW.LIVE;
    document.querySelectorAll("#seatBar .seatGroup").forEach((g) => {
      g.classList.toggle("isTurn", g.dataset.side === seatCurrentKey);
    });
    document.querySelectorAll(".seatBtn").forEach((btn) => {
      btn.classList.toggle("active", ui.seats[btn.dataset.side] === btn.dataset.owner);
      btn.disabled = !seatsEditable || !!this.researchSeats; // 分支研究中雙方固定是人類
    });
    // 難度選單只對 CPU 有效：這一方是人類時暗掉
    for (const side of ["black", "white"]) {
      const sel = document.getElementById(side === "black" ? "settingBlackLevel" : "settingWhiteLevel");
      if (sel) sel.disabled = ui.seats[side] !== CPU_SEAT;
    }
    // 玩家卡上的「我／CPU 幾級」；分支研究中雙方暫時都是自己下，不能切換
    document.querySelectorAll(".pcRole").forEach((btn) => {
      const side = btn.dataset.side;
      const level = clampLevel(side === "black" ? this.settings.blackLevel : this.settings.whiteLevel);
      btn.textContent = this.researchSeats ? tr("roleResearch")
        : ui.seats[side] === CPU_SEAT ? tr("roleCpu", { n: level }) : tr("roleHuman");
      btn.classList.toggle("isCpu", !this.researchSeats && ui.seats[side] === CPU_SEAT);
      btn.disabled = !seatsEditable || !!this.researchSeats;
    });

    // 6. 動作列
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? "inline-flex" : "none"; };
    const live = ui.view === VIEW.LIVE;
    const hintBtn = document.getElementById("hintBtn");
    if (hintBtn) {
      hintBtn.style.display = !isEnded ? "inline-flex" : "none";
      hintBtn.classList.toggle("active", this.hintOn);
      hintBtn.setAttribute("aria-pressed", String(this.hintOn));
      hintBtn.textContent = tr(this.hintOn ? "btnHintOn" : "btnHint");
    }
    // 分支研究中（自己替雙方下）不提供 CPU 對下
    const research = !!this.researchSeats;
    show("watchBtn", live && !ui.isCpuVsCpu && !research);
    show("resumeHereBtn", (isReview || research) && !state.gameOver);
    const pauseBtn = document.getElementById("pauseResumeBtn");
    if (pauseBtn) {
      if (isCpuTurn) {
        pauseBtn.style.display = ui.isCpuVsCpu ? "inline-flex" : "none";
        pauseBtn.textContent = tr("pause");
        pauseBtn.title = tr("pauseTip");
        pauseBtn.className = "actBtn";
      } else if (isPaused) {
        pauseBtn.style.display = "inline-flex";
        pauseBtn.textContent = tr("resume");
        pauseBtn.title = tr("resumeTip");
        pauseBtn.className = "actBtn primary";
      } else {
        pauseBtn.style.display = "none";
      }
    }

    // 8. 開發者 HUD
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText("hudRenders", this.renderCount);
    setText("hudTurn", state.currentTurn === BLACK ? "BLACK" : "WHITE");
    setText("hudHand", state.hand != null ? `${state.hand} (${discLabel(state.hand)})` : "null");
    setText("hudNodes", this.engine.tree.nodes.size);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    window.__app = new WeightedOthelloApp();
    window.WeightedOthello = {
      app: window.__app,
      getEngine: () => window.__app.engine,
      getState: () => window.__app.engine.getState(),
      reset: () => window.__app.newGame()
    };
  });
}


