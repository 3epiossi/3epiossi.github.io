/**
 * 🚀 骰子黑白棋 (Dice Othello) - 應用程式主入口與控制器 (Application Controller)
 */

import {
  BOARD_SIZE,
  N,
  PLAYER,
  EMPTY,
  BLACK,
  WHITE,
  MOVE_TYPE,
  GAME_MODE,
  AI_MODELS,
  DEFAULT_KOMI
} from "./core/constants.js";
import { posToCoord, opp } from "./core/rules.js";
import { GameEngine } from "./core/game-engine.js";
import { BoardView } from "./ui/board-view.js";
import { DiceView } from "./ui/dice-view.js";
import { CoachView } from "./ui/coach-view.js";
import { HistoryView } from "./ui/history-view.js";
import { ModalManager } from "./ui/modal-manager.js";
import { sound } from "./ui/sound.js";
import { Storage } from "./storage/storage.js";
import { tr, tx, pieceify, escapeHtml, clampName } from "./i18n.js";
import { findBestMoveForCPU, rankCandidateMoves } from "./ai/ai-service.js";
import {
  SkinManager,
  DEFAULT_BLACK_PRESETS,
  DEFAULT_WHITE_PRESETS,
  PATH_BLACK_PRESETS,
  PATH_WHITE_PRESETS,
  getPieceBackgroundCss
} from "./ui/skin-workshop.js";
import {
  VIEW,
  CTRL,
  HUMAN,
  CPU_SEAT,
  seatKey,
  createSession,
  deriveUiState
} from "./core/control-state.js";

export class DiceOthelloApp {
  constructor() {
    this.settings = Storage.getSettings();
    window.takuNames = { black: clampName(this.settings.blackName), white: clampName(this.settings.whiteName) };
    sound.setEnabled(this.settings.soundEnabled);
    this.skinManager = new SkinManager();

    const initialBlackSeat = this.settings.blackRole || HUMAN;
    const initialWhiteSeat = this.settings.whiteRole || CPU_SEAT;

    this.engine = new GameEngine({
      komi: this.settings.komi != null ? this.settings.komi : DEFAULT_KOMI,
      gameMode: GAME_MODE.PVC,
      blackPlayerType: initialBlackSeat,
      whitePlayerType: initialWhiteSeat,
      blackAlgo: this.settings.blackAlgo || "v5",
      whiteAlgo: this.settings.whiteAlgo || "v5"
    });

    // 席位控制模型：seats 是「誰在下」的唯一事實來源
    this.session = createSession({
      black: initialBlackSeat,
      white: initialWhiteSeat
    });
    this.ui = deriveUiState({
      session: this.session,
      turn: this.engine.currentTurn,
      gameOver: false,
      isAtTip: true
    });

    this.currentMode = "play"; // "play" | "setup" | "rules"
    this.setupBrush = "toggle"; // "toggle" | "black" | "white" | "empty"
    this.cpuTimer = null;
    this.cpuMoveTimer = null;
    this.passTimer = null;
    this.isCpuThinking = false;
    this.activeAiCandidates = [];
    this.hintOpen = false;
    this.previewGhostMove = null;
    this.renderCount = 0;
    this.lastAssistEnded = false;

    this.init();
  }

  init() {
    ModalManager.init();

    // 1. 初始化各 UI 元件
    this.boardView = new BoardView({
      boardContainer: document.getElementById("boardContainer"),
      svgOverlay: document.getElementById("movePathSvg"),
      onCellClick: (r, c) => this.handleCellClick(r, c),
      onCellHover: (r, c, isEnter) => this.handleCellHover(r, c, isEnter)
    });

    this.diceView = new DiceView({
      container: document.getElementById("diceContainer"),
      sideWidget: null,
      onRollClick: () => this.handleRollDice(),
      onSelectDiceVal: (val) => this.handleSelectDiceVal(val)
    });

    this.coachView = new CoachView({
      container: document.getElementById("coachContainer"),
      onPreviewMove: (move) => {
        this.previewGhostMove = move;
        const state = this.engine.getState();
        this.boardView.render({
          board: state.board,
          currentTurn: state.currentTurn,
          selectedCell: state.selectedCell,
          legalMoves: state.legalMovesForSelected,
          lastMove: state.lastMove,
          endgameFilledCells: state.endgameFilledCells,
          activeAiHints: this.activeAiCandidates,
          previewGhostMove: this.previewGhostMove,
          piecesWithMoves: new Set()
        });
      },
      onApplyMove: (move) => {
        this.previewGhostMove = null;
        if (this.ui.view === VIEW.REVIEW) {
          // 在歷史局面採用建議：先從此處分岔成新分支，再由使用者接手落子
          this.handleStartFromHere();
        } else {
          this.executeMove(move);
        }
      }
    });

    this.historyView = new HistoryView({
      historyContainer: document.getElementById("historyBox"),
      branchSelectEl: document.getElementById("branchSelect"),
      onJumpToNode: (nodeId) => this.handleJumpToNode(nodeId),
      onOpenBranchModal: () => this.openBranchModal(),
      onStepFirst: () => this.handleStepFirst(),
      onStepPrev: () => this.handleStepBack(),
      onStepNext: () => this.handleStepForward(),
      onStepLatest: () => this.handleStepLatest(),
      onSwitchBranch: (branchId) => {
        this.engine.tree.switchBranch(branchId);
        const node = this.engine.tree.getCurrentNode();
        if (node) this.engine.jumpToNode(node.id);
        this.sync();
      }
    });

    // 2. 訂閱引擎事件
    this.engine.subscribe((event, payload, state) => {
      this.handleEngineEvent(event, payload, state);
    });

    // 3. 綁定按鈕與事件監聽
    this.bindDOMEvents();
    this.bindKeyboardShortcuts();

    // 4. 套用初始主題
    this.applyTheme(this.settings.theme || "neon");

    // 5. 開新局（不從網址載入棋局：網址內容不可信，且曾被用來注入 HTML）
    this.engine.resetGame();
    // 開場若輪到 CPU，先停在暫停狀態，別讓使用者一進來就被 CPU 搶著下
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;

    // 6. 檢查是否需要顯示 60 秒新手教學
    if (!Storage.hasSeenOnboarding()) {
      setTimeout(() => {
        this.openTutorialModal();
      }, 500);
    }

    // 7. 開發者模式檢查 (?debug=1)
    this.checkDeveloperMode();

    // 8. 統一透過 sync() 推導並驅動首次渲染與狀態 (flow.md 第 8.2 節)
    this.sync();

    // 9. 初始化提示分析區域（顯示引導提示）
    this.coachView.render([], false);
  }

  applyFlip() {
    const f = !!this.settings.flipped;
    this.boardView.setFlipped(f);
    document.querySelector(".seatPlayers")?.classList.toggle("flipped", f);
      }

  bindDOMEvents() {
    const flipBtn = document.getElementById("flipBtn");
    if (flipBtn) {
      flipBtn.addEventListener("click", () => {
        this.settings.flipped = !this.settings.flipped;
        Storage.saveSettings(this.settings);
        this.applyFlip();
        this.render();
      });
    }
    const applyName = (side, v) => {
      this.settings[side + "Name"] = v;
      window.takuNames = { ...window.takuNames, [side]: v };
      Storage.saveSettings(this.settings);
      const input = document.getElementById(side === "black" ? "settingBlackName" : "settingWhiteName");
      if (input) input.value = v;
      window.applyI18n?.();
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
        window.applyI18n?.();
        this.sync();
      });
    }
    this.applyFlip();
    window.addEventListener("langchange", () => {
      for (const side of ["black", "white"]) {
        const input = document.getElementById(side === "black" ? "settingBlackName" : "settingWhiteName");
        if (input) input.placeholder = tr(side);
      }
      this.sync();
      if (this.hintOpen) this.calculateAiHints(); else this.coachView.render([], false);
      if (document.getElementById("skinModal")?.classList.contains("open")) this.renderSkinWorkshop();
    });

    // 模式切換器
    const modeTabs = document.querySelectorAll(".modeTabs .tabBtn");
    modeTabs.forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.mode === "rules") { this.openTutorialModal(); return; }
        modeTabs.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.setMode(btn.dataset.mode);
      });
    });

    // 頂部捷徑按鈕
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => this.openSkinModal());
    }

    const openSkinFromSettings = document.getElementById("openSkinFromSettingsBtn");
    if (openSkinFromSettings) {
      openSkinFromSettings.addEventListener("click", () => {
        ModalManager.close("settingsModal");
        this.openSkinModal();
      });
    }

    const soundBtn = document.getElementById("soundToggleBtn");
    if (soundBtn) {
      soundBtn.addEventListener("click", () => {
        this.settings.soundEnabled = !this.settings.soundEnabled;
        sound.setEnabled(this.settings.soundEnabled);
        soundBtn.textContent = this.settings.soundEnabled ? "🔊" : "🔇";
        Storage.saveSettings(this.settings);
      });
    }

    const settingsBtn = document.getElementById("settingsBtn");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => ModalManager.open("settingsModal"));
    }

    const restartBtn = document.getElementById("restartBtn");
    if (restartBtn) {
      restartBtn.addEventListener("click", async () => {
        const ok = await ModalManager.confirm({
          title: tr("restartTitle"),
          message: tr("restartMsg"),
          confirmText: tr("restartOk"),
          danger: true
        });
        if (ok) {
          this.teardown();
          this.engine.resetGame();
          this.resetSessionToSettings();
          this.sync();
        }
      });
    }

    // 席位控制列：點一下即時改變「誰在下」
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button.seatBtn");
      if (btn && !btn.disabled) { this.setSeat(btn.dataset.side, btn.dataset.owner); return; }
    });

    // 底部工具欄按鈕
    const hintBtn = document.getElementById("hintBtn");
    if (hintBtn) {
      hintBtn.addEventListener("click", () => this.toggleHint());
    }

    const watchBtn = document.getElementById("watchBtn");
    if (watchBtn) {
      watchBtn.addEventListener("click", () => this.handleWatchCpuVsCpu());
    }

    const twoPlayerBtn = document.getElementById("twoPlayerBtn");
    if (twoPlayerBtn) {
      twoPlayerBtn.addEventListener("click", () => this.handleTwoPlayers());
    }

    const vsCpuBtn = document.getElementById("vsCpuBtn");
    if (vsCpuBtn) {
      vsCpuBtn.addEventListener("click", () => this.handleVsCpu());
    }

    const pauseResumeBtn = document.getElementById("pauseResumeBtn");
    if (pauseResumeBtn) {
      pauseResumeBtn.addEventListener("click", () => {
        if (this.ui.ctrl === CTRL.CPU) {
          this.handlePauseCpu();
        } else if (this.ui.ctrl === CTRL.PAUSED) {
          this.handleResumeCpu();
        }
      });
    }

    const setupModeBtn = document.getElementById("setupModeBtn");
    if (setupModeBtn) {
      setupModeBtn.addEventListener("click", () => {
        if (this.currentMode === "setup") {
          this.setMode("play");
          document.querySelector('.modeTabs .tabBtn[data-mode="play"]')?.classList.add("active");
        } else {
          this.setMode("setup");
        }
      });
    }

    // 狀態橫幅按鈕委派事件 (Status Banner Action Delegation)
    const statusBanner = document.getElementById("statusBanner");
    if (statusBanner) {
      statusBanner.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const act = btn.dataset.action;
        if (act === "resumeLatest") this.handleStepLatest();
        else if (act === "startFromHere") this.handleStartFromHere();
        else if (act === "restart") restartBtn?.click();
      });
    }

    // 擺盤工具按鈕
    const brushBtns = document.querySelectorAll(".brushBtn");
    brushBtns.forEach(b => {
      b.addEventListener("click", () => {
        brushBtns.forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        this.setupBrush = b.dataset.brush;
      });
    });

    const setupContinueBtn = document.getElementById("setupContinueBtn");
    if (setupContinueBtn) {
      setupContinueBtn.addEventListener("click", () => {
        this.setMode("play");
        const playTab = document.querySelector(".modeTabs .tabBtn[data-mode='play']");
        if (playTab) playTab.click();
      });
    }

    // Modal 關閉按鈕
    document.querySelectorAll(".modalCloseBtn, .modalCancelBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const modal = btn.closest(".modalBackdrop");
        if (modal) ModalManager.close(modal.id);
      });
    });

    // 設定表單連動
    this.bindSettingsForm();
  }

  bindSettingsForm() {
    const blackAlgoSelect = document.getElementById("settingBlackAlgo");
    const whiteAlgoSelect = document.getElementById("settingWhiteAlgo");
    const komiInput = document.getElementById("settingKomi");
    const cpuSpeedSelect = document.getElementById("settingCpuSpeed");

    if (blackAlgoSelect) {
      blackAlgoSelect.value = this.engine.blackAlgo;
      blackAlgoSelect.addEventListener("change", (e) => {
        this.engine.blackAlgo = e.target.value;
        this.settings.blackAlgo = e.target.value;
        Storage.saveSettings(this.settings);
      });
    }

    if (whiteAlgoSelect) {
      whiteAlgoSelect.value = this.engine.whiteAlgo;
      whiteAlgoSelect.addEventListener("change", (e) => {
        this.engine.whiteAlgo = e.target.value;
        this.settings.whiteAlgo = e.target.value;
        Storage.saveSettings(this.settings);
      });
    }

    if (komiInput) {
      const komiValues = [0];
      for (let v = 0.5; v <= 9.5; v += 1) komiValues.push(v);
      if (this.engine.komi < 0 || this.engine.komi > 9.5) this.engine.komi = DEFAULT_KOMI;
      const fillKomiOptions = () => {
        const cur = String(this.engine.komi);
        komiInput.innerHTML = "";
        for (const v of komiValues) {
          const opt = document.createElement("option");
          opt.value = String(v);
          const key = { 0: "komi0", 3.5: "komi35", 5.5: "komi55" }[v];
          opt.textContent = key ? window.t(key) : `${v > 0 ? "+" : ""}${v}${window.t("komiUnit")}`.trimEnd();
          komiInput.appendChild(opt);
        }
        if (![...komiInput.options].some((o) => o.value === cur)) {
          const extra = document.createElement("option");
          extra.value = cur;
          extra.textContent = `${Number(cur) > 0 ? "+" : ""}${cur}${window.t("komiUnit")}`.trimEnd();
          komiInput.appendChild(extra);
        }
        komiInput.value = cur;
      };
      fillKomiOptions();
      window.addEventListener("langchange", fillKomiOptions);
      komiInput.addEventListener("change", (e) => {
        const v = Number(e.target.value);
        this.engine.komi = Number.isFinite(v) ? v : DEFAULT_KOMI;
        this.settings.komi = this.engine.komi;
        Storage.saveSettings(this.settings);
        this.render();
      });
    }

    if (cpuSpeedSelect) {
      cpuSpeedSelect.value = this.settings.cpuSpeed || 600;
      cpuSpeedSelect.addEventListener("change", (e) => {
        this.settings.cpuSpeed = Number(e.target.value) || 600;
        Storage.saveSettings(this.settings);
      });
    }
  }

  bindKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      // 避免在文字輸入框內觸發快捷鍵
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          this.handleStepBack();
          break;
        case "ArrowRight":
          e.preventDefault();
          this.handleStepForward();
          break;
        case " ":
          // 空白鍵只有一個意思：暫停／繼續 CPU
          if (this.ui.ctrl === CTRL.CPU) {
            e.preventDefault();
            this.handlePauseCpu();
          } else if (this.ui.ctrl === CTRL.PAUSED) {
            e.preventDefault();
            this.handleResumeCpu();
          }
          break;
        case "h":
        case "H":
          e.preventDefault();
          this.calculateAiHints(true);
          break;
        case "r":
        case "R":
          if (this.ui.ctrl === CTRL.HUMAN && this.engine.diceValue == null && !this.engine.gameOver) {
            e.preventDefault();
            this.handleRollDice();
          }
          break;
        case "Escape":
          this.engine.selectedCell = null;
          this.engine.legalMovesForSelected = { spawns: [], captures: [] };
          this.previewGhostMove = null;
          this.render();
          break;
      }
    });
  }

  setMode(mode) {
    this.currentMode = mode;
    const setupBar = document.getElementById("setupToolsBar");
    if (setupBar) {
      setupBar.style.display = mode === "setup" ? "flex" : "none";
    }
    this.render();
  }

  applyTheme(themeKey) {
    document.body.className = `theme-${themeKey}`;
    this.settings.theme = themeKey;
    Storage.saveSettings(this.settings);
  }

  cycleTheme() {
    const themes = ["neon", "classic", "wood", "slate"];
    const currIdx = themes.indexOf(this.settings.theme || "neon");
    const nextTheme = themes[(currIdx + 1) % themes.length];
    this.applyTheme(nextTheme);
  }

  // ===== 遊戲事件處理 =====
  // ===== 遊戲事件處理 =====
  handleEngineEvent(event, payload, state) {
    if (event === "DICE_ROLLED") {
      sound.playDiceRoll();
      if (this.diceView && typeof this.diceView.triggerRollAnimation === "function") {
        this.diceView.triggerRollAnimation();
      }
      if (this.hintOpen && this.ui && this.ui.ctrl === CTRL.HUMAN) {
        this.calculateAiHints(false);
      }
    } else if (event === "PASS_REQUIRED") {
      sound.playPass();
      this.passTimer = setTimeout(() => {
        this.passTimer = null;
        this.engine.passTurn();
      }, 700);
    } else if (event === "MOVE_EXECUTED") {
      if (payload.move.type === MOVE_TYPE.CAPTURE) {
        sound.playCapture();
      } else {
        sound.playSpawn();
      }
      this.activeAiCandidates = [];
      this.hintOpen = false;
      this.coachView.render([], false);
    } else if (event === "PASS_EXECUTED") {
      sound.playPass();
      this.activeAiCandidates = [];
      this.hintOpen = false;
      this.coachView.render([], false);
    } else if (event === "GAME_OVER") {
      sound.playVictory();
      this.session.assist = null;
      setTimeout(() => this.celebrate(payload), 80);
    } else if (event === "GAME_RESET") {
      this.teardown();
      this.resetSessionToSettings();
    }

    this.sync();
  }

  // ===== 狀態推導與同步中樞 (flow.md 第 8.2 節) =====
  sync() {
    // 暫停只用於「CPU 對 CPU」；人機對戰時 CPU 輪到就直接下，不需要暫停
    if (this.session.paused && !(this.session.seats.black === CPU_SEAT && this.session.seats.white === CPU_SEAT)) {
      this.session.paused = false;
    }

    const tipNode = this.engine.tree.getBranchTipNode();
    const currNode = this.engine.tree.getCurrentNode();
    const isAtTip = Boolean(currNode && tipNode && currNode.id === tipNode.id);

    let ui = deriveUiState({
      session: this.session,
      turn: this.engine.currentTurn,
      gameOver: this.engine.gameOver,
      isAtTip,
      passPending: Boolean(this.passTimer)
    });
    this.ui = ui;

    // 人類回合或 CPU 暫停中且骰子未擲：自動擲骰（分支若已有 node.dice 就不會觸發；isFreePickTurn 讓玩家自選）
    if ((ui.ctrl === CTRL.HUMAN || ui.ctrl === CTRL.PAUSED) && this.engine.diceValue == null && !this.engine.gameOver && !this.engine.isFreePickTurn) {
      this.engine.rollDice(null, true);
      ui = deriveUiState({
        session: this.session,
        turn: this.engine.currentTurn,
        gameOver: this.engine.gameOver,
        isAtTip,
        passPending: Boolean(this.passTimer)
      });
      this.ui = ui;
    }

    // 啟動或關閉 CPU 計時器
    // isCpuThinking 防止 roll→move 延遲期間重入（避免 DICE_ROLLED 觸發 sync 再次啟動 CPU 計時）
    if (ui.runCpuTimer && !this.cpuTimer && !this.cpuMoveTimer && !this.isCpuThinking) {
      if (this.engine.diceValue != null) {
        // Dice already rolled (e.g. paused after roll, now resumed) — skip straight to move
        this.isCpuThinking = true;
        const moveDelay = Math.max(550, this.settings.cpuSpeed || 600);
        this.cpuMoveTimer = setTimeout(() => {
          this.cpuMoveTimer = null;
          this.performCpuMoveExecution();
        }, moveDelay);
      } else {
        this.startCpuTimer();
      }
    } else if (!ui.runCpuTimer) {
      // If cpuTimer (dice roll) is still pending, let it fire so the dice shows before pausing.
      // Only cancel the move timer here; performCpuDiceRoll() checks session.paused itself.
      if (this.cpuTimer) {
        if (this.cpuMoveTimer) {
          clearTimeout(this.cpuMoveTimer);
          this.cpuMoveTimer = null;
        }
      } else {
        this.stopCpuTimer();
      }
    }

    this.render();
  }

  // ===== 清場復位機制 (flow.md 第 5 節) =====
  teardown() {
    if (this.cpuTimer) {
      clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    if (this.cpuMoveTimer) {
      clearTimeout(this.cpuMoveTimer);
      this.cpuMoveTimer = null;
    }
    if (this.passTimer) {
      clearTimeout(this.passTimer);
      this.passTimer = null;
    }
    this.isCpuThinking = false;
    this.engine.selectedCell = null;
    this.engine.legalMovesForSelected = { spawns: [], captures: [] };
    this.previewGhostMove = null;
    this.activeAiCandidates = [];
  }

  handleRollDice() {
    if (this.ui.ctrl !== CTRL.HUMAN || this.engine.diceValue != null || this.engine.gameOver) return;
    this.engine.rollDice();
    this.sync();
  }

  handleSelectDiceVal(val) {
    if (this.ui.ctrl !== CTRL.HUMAN || this.engine.gameOver) return;
    this.engine.rollDice(val, true);
    this.sync();
  }

  handleCellClick(r, c) {
    if (this.currentMode === "setup") {
      this.handleSetupCellClick(r, c);
      return;
    }

    // CPU 暫停且已有可走步數時，棋盤開放給人類：真的下出合法步伐時才接管該席位
    const pausedTakeoverOk = this.ui.view === VIEW.LIVE && this.ui.ctrl === CTRL.PAUSED &&
      (this.engine.diceValue != null || this.engine.isFreePickTurn);
    if (this.ui.boardLocked && !pausedTakeoverOk) return;

    if (this.hintOpen) {
      const sel = this.engine.selectedCell;
      const lm = this.engine.legalMovesForSelected;
      const toOf = (m) => ({ r: m.toR != null ? m.toR : (m.to ? m.to.r : -1), c: m.toC != null ? m.toC : (m.to ? m.to.c : -1) });
      const isSelectedDest = sel && [...lm.spawns, ...lm.captures].some(m => { const t = toOf(m); return t.r === r && t.c === c; });
      const picked = isSelectedDest ? null : this.activeAiCandidates.find(h => { const t = toOf(h.move); return t.r === r && t.c === c; });
      this.hintOpen = false;
      const pickedMove = picked ? picked.move : null;
      this.activeAiCandidates = [];
      this.previewGhostMove = null;
      this.coachView.render([], false);
      if (pickedMove) {
        this.takeOverIfPaused();
        this.executeMove(pickedMove);
        return;
      }
      this.render();
    }

    const b = this.engine.board;
    const turn = this.engine.currentTurn;

    // 1. 若點選己方棋子：切換選中狀態
    if (b[r][c] === turn) {
      if (this.engine.selectedCell && this.engine.selectedCell.r === r && this.engine.selectedCell.c === c) {
        this.engine.selectedCell = null;
        this.engine.legalMovesForSelected = { spawns: [], captures: [] };
        this.render();
      } else {
        this.engine.selectPiece(r, c);
        this.render();
      }
      return;
    }

    // 2. 若已有選中棋子，點選目標格：嘗試執行走步
    if (this.engine.selectedCell) {
      const legals = this.engine.legalMovesForSelected;
      const spawnMove = legals.spawns.find(m => (m.toR != null ? m.toR : m.to.r) === r && (m.toC != null ? m.toC : m.to.c) === c);
      const captureMove = legals.captures.find(m => (m.toR != null ? m.toR : m.to.r) === r && (m.toC != null ? m.toC : m.to.c) === c);

      const targetMove = captureMove || spawnMove;
      if (targetMove) {
        this.takeOverIfPaused();
        this.executeMove(targetMove);
      } else {
        this.engine.selectedCell = null;
        this.engine.legalMovesForSelected = { spawns: [], captures: [] };
        this.render();
      }
    }
  }

  takeOverIfPaused() {
    if (this.ui.ctrl !== CTRL.PAUSED) return;
    const side = seatKey(this.engine.currentTurn);
    this.session.assist = null;
    if (this.session.seats[side] !== HUMAN) {
      this.setSeat(side, HUMAN);
    } else {
      this.session.paused = false;
      this.sync();
    }
  }

  handleSetupCellClick(r, c) {
    const b = this.engine.board;
    if (this.setupBrush === "toggle") {
      if (b[r][c] === EMPTY) b[r][c] = BLACK;
      else if (b[r][c] === BLACK) b[r][c] = WHITE;
      else b[r][c] = EMPTY;
    } else if (this.setupBrush === "black") {
      b[r][c] = BLACK;
    } else if (this.setupBrush === "white") {
      b[r][c] = WHITE;
    } else if (this.setupBrush === "empty") {
      b[r][c] = EMPTY;
    }
    this.render();
  }

  handleCellHover(r, c, isEnter) {
    if (!isEnter) {
      if (this.previewGhostMove) {
        const toR = this.previewGhostMove.toR != null ? this.previewGhostMove.toR : (this.previewGhostMove.to ? this.previewGhostMove.to.r : -1);
        const toC = this.previewGhostMove.toC != null ? this.previewGhostMove.toC : (this.previewGhostMove.to ? this.previewGhostMove.to.c : -1);
        if (toR === r && toC === c) {
          this.previewGhostMove = null;
          const state = this.engine.getState();
          this.boardView.render({
            board: state.board,
            currentTurn: state.currentTurn,
            selectedCell: state.selectedCell,
            legalMoves: state.legalMovesForSelected,
            lastMove: state.lastMove,
            endgameFilledCells: state.endgameFilledCells,
            activeAiHints: this.activeAiCandidates,
            previewGhostMove: null,
            piecesWithMoves: new Set()
          });
        }
      }
      return;
    }

    if (!this.activeAiCandidates.length) return;
    const hintCandidate = this.activeAiCandidates.find(h => {
      const m = h.move;
      const toR = m.toR != null ? m.toR : (m.to ? m.to.r : -1);
      const toC = m.toC != null ? m.toC : (m.to ? m.to.c : -1);
      return toR === r && toC === c;
    });
    if (!hintCandidate || this.previewGhostMove === hintCandidate.move) return;

    this.previewGhostMove = hintCandidate.move;
    const state = this.engine.getState();
    this.boardView.render({
      board: state.board,
      currentTurn: state.currentTurn,
      selectedCell: state.selectedCell,
      legalMoves: state.legalMovesForSelected,
      lastMove: state.lastMove,
      endgameFilledCells: state.endgameFilledCells,
      activeAiHints: this.activeAiCandidates,
      previewGhostMove: this.previewGhostMove,
      piecesWithMoves: new Set()
    });
  }

  executeMove(move) {
    const tip = this.engine.tree.getBranchTipNode();
    const curr = this.engine.tree.getCurrentNode();
    if (curr && tip && curr.id !== tip.id) {
      return false; // REVIEW 狀態不允許直接落子
    }

    this.stopCpuTimer();
    const player = this.engine.currentTurn;
    const success = this.engine.executeMove(move);
    if (success) {
      // 處理 CPU 代下次數扣抵 (flow.md 第 5 節 事件 1 & 2)
      if (this.session.assist && this.session.assist.color === player) {
        this.session.assist.left -= 1;
        if (this.session.assist.left <= 0) {
          this.session.assist = null;
          this.lastAssistEnded = true;
        }
      }
      this.sync();
    }
    return success;
  }

  // ===== CPU 行動推進邏輯 (兩階段可視化，解除黑箱) =====
  startCpuTimer() {
    this.stopCpuTimer();
    if (!this.ui.runCpuTimer) return;

    this.isCpuThinking = true;
    const speed = this.settings.cpuSpeed || 600;

    // 第一階段：CPU 擲骰子
    this.cpuTimer = setTimeout(() => {
      this.cpuTimer = null;
      this.performCpuDiceRoll();
    }, Math.max(250, Math.floor(speed / 2)));
  }

  performCpuDiceRoll() {
    if (this.engine.gameOver) {
      this.isCpuThinking = false;
      return;
    }
    // Allow the dice roll to show even if the user pressed pause mid-flight,
    // but skip scheduling the move afterwards.
    const pausedMidFlight = this.session.paused;
    if (!pausedMidFlight && this.ui.ctrl !== CTRL.CPU) {
      this.isCpuThinking = false;
      return;
    }

    const turn = this.engine.currentTurn;
    const algo = turn === BLACK ? this.engine.blackAlgo : this.engine.whiteAlgo;

    // 若享有特權自選模式，在 1~6 步中搜尋最佳點數
    let chosenDice = null;
    if (this.engine.isFreePickTurn) {
      let maxScore = -Infinity;
      for (let d = 1; d <= 6; d++) {
        const res = findBestMoveForCPU(this.engine.board, turn, d, algo);
        if (res && res.chosen && res.maxScore > maxScore) {
          maxScore = res.maxScore;
          chosenDice = d;
        }
      }
      this.engine.rollDice(chosenDice || 3, true);
    } else {
      // 正常隨機擲骰
      this.engine.rollDice(null, true);
    }

    // 骰子點數已確立！立即全域渲染，讓玩家能清楚看見 CPU 擲出的骰子點數與盤面！
    this.render();

    // 若 rollDice 觸發了 PASS_REQUIRED（passTimer 已被設定），跳過落子階段
    // 避免 cpuMoveTimer(~600ms) 比 passTimer(700ms) 先發火造成雙重 passTurn
    if (this.passTimer) return;

    // 暫停狀態：骰子已顯示，不排程落子 (讓使用者看清楚骰子結果後再按繼續)
    if (pausedMidFlight) {
      this.isCpuThinking = false;
      return;
    }

    // 第二階段：預留清晰的視覺停頓 (600~800ms)，隨後執行落子
    const moveDelay = Math.max(550, this.settings.cpuSpeed || 600);
    this.cpuMoveTimer = setTimeout(() => {
      this.cpuMoveTimer = null;
      this.performCpuMoveExecution();
    }, moveDelay);
  }

  performCpuMoveExecution() {
    if (this.engine.gameOver || this.ui.ctrl !== CTRL.CPU) {
      this.isCpuThinking = false;
      return;
    }

    const turn = this.engine.currentTurn;
    const algo = turn === BLACK ? this.engine.blackAlgo : this.engine.whiteAlgo;
    const bestResult = findBestMoveForCPU(this.engine.board, turn, this.engine.diceValue, algo);

    this.isCpuThinking = false;

    if (bestResult && bestResult.chosen) {
      this.executeMove(bestResult.chosen);
    } else {
      this.engine.passTurn();
    }
  }

  stopCpuTimer() {
    if (this.cpuTimer) {
      clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    if (this.cpuMoveTimer) {
      clearTimeout(this.cpuMoveTimer);
      this.cpuMoveTimer = null;
    }
    this.isCpuThinking = false;
  }

  // ===== 控制者狀態切換操作 (flow.md 第 5 節) =====
  handlePauseCpu() {
    this.session.paused = true;
    // Clear the move timer (if dice already rolled, stop before executing the move)
    // but leave cpuTimer running so the dice roll can still complete and be shown
    if (this.cpuMoveTimer) {
      clearTimeout(this.cpuMoveTimer);
      this.cpuMoveTimer = null;
    }
    this.sync();
  }

  handleResumeCpu() {
    this.session.paused = false;
    this.sync();
  }

  /**
   * 把 seats 寫回引擎，讓 engine.canControlDice() 的守門判斷與 UI 永遠一致
   */
  syncEngineSeats() {
    this.engine.blackPlayerType = this.session.seats.black;
    this.engine.whitePlayerType = this.session.seats.white;
  }

  persistSeats() {
    this.settings.blackRole = this.session.seats.black;
    this.settings.whiteRole = this.session.seats.white;
    Storage.saveSettings(this.settings);
  }

  resetSessionToSettings() {
    this.session = createSession({
      black: this.settings.blackRole || HUMAN,
      white: this.settings.whiteRole || CPU_SEAT
    });
    this.syncEngineSeats();
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;
  }

  /**
   * 改變一個席位的操作者。這是「換我下 / 讓 CPU 下 / CPU 對戰」唯一的入口，
   * 因此不可能出現席位與某個模式旗標互相矛盾的狀態。
   */
  setSeat(side, owner) {
    if (side !== "black" && side !== "white") return;
    if (owner !== HUMAN && owner !== CPU_SEAT) return;
    if (this.session.seats[side] === owner) return;

    this.session.seats[side] = owner;
    this.persistSeats();
    this.syncEngineSeats();

    if (owner === CPU_SEAT) {
      // 切換到 CPU 一律先暫停，讓使用者決定何時放行
      this.session.paused = true;
      this.session.assist = null;
    } else if (side === seatKey(this.engine.currentTurn)) {
      // 切回「我」且是當前回合：清掉代下暫停
      this.session.assist = null;
      this.session.paused = false;
    }

    this.teardown();
    this.sync();
  }

  /** 一鍵觀戰：兩個席位都交給 CPU */
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

  handleVsCpu() {
    this.setSeat(seatKey(this.engine.currentTurn), CPU_SEAT);
    this.session.paused = false;
    this.sync();
  }

  handleTwoPlayers() {
    this.session.seats.black = HUMAN;
    this.session.seats.white = HUMAN;
    this.session.assist = null;
    this.session.paused = false;
    this.persistSeats();
    this.syncEngineSeats();
    this.teardown();
    this.sync();
  }

  // ===== AI 提示與教練計算 =====
  toggleHint() {
    if (this.hintOpen) {
      this.hintOpen = false;
      this.activeAiCandidates = [];
      this.previewGhostMove = null;
      this.coachView.render([], false);
      this.render();
    } else {
      this.hintOpen = true;
      this.calculateAiHints(true);
    }
  }

  calculateAiHints(force = false) {
    if (this.engine.gameOver) {
      this.activeAiCandidates = [];
      this.coachView.render([], false, tr("coachEmptyEnded"));
      this.render();
      return;
    }

    const dice = this.engine.diceValue;
    if (dice == null && !this.engine.isFreePickTurn) {
      this.coachView.render([], false, tr("coachEmptyRoll"));
      this.render();
      return;
    }

    const turn = this.engine.currentTurn;
    const algo = turn === BLACK ? this.engine.blackAlgo : this.engine.whiteAlgo;

    const candidates = rankCandidateMoves(this.engine.board, turn, dice, algo, 3);
    this.activeAiCandidates = candidates;
    if (candidates.length === 0) {
      this.coachView.render([], false, tr("coachEmptyNoMove"));
    } else {
      this.coachView.render(candidates, false);
    }
    this.render();
  }

  // ===== 歷史回放、跳轉與分支開闢 (flow.md 第 6.3 節) =====
  handleJumpToNode(nodeId) {
    this.teardown();
    this.engine.jumpToNode(nodeId);
    this.sync();
  }

  handleStepFirst() {
    const root = this.engine.tree.getNode("root_0");
    if (root) {
      this.handleJumpToNode(root.id);
    }
  }

  handleStepLatest() {
    const tip = this.engine.tree.getBranchTipNode();
    if (tip) {
      // 回到最新時若輪到 CPU，先暫停，由使用者決定何時放行
      if (this.session.seats[seatKey(tip.turn)] === CPU_SEAT) {
        this.session.paused = true;
      }
      this.handleJumpToNode(tip.id);
    }
  }

  handleStepBack() {
    if (ModalManager.activeModals.has("settlementModal")) {
      ModalManager.close("settlementModal");
    }
    const historyList = this.engine.tree.getBranchHistory();
    const currId = this.engine.tree.currentNodeId;
    const idx = historyList.findIndex((n) => n.id === currId);
    if (idx > 0) {
      this.handleJumpToNode(historyList[idx - 1].id);
    }
  }

  handleStepForward() {
    if (ModalManager.activeModals.has("settlementModal")) {
      ModalManager.close("settlementModal");
    }
    const historyList = this.engine.tree.getBranchHistory();
    const currId = this.engine.tree.currentNodeId;
    const idx = historyList.findIndex((n) => n.id === currId);
    if (idx >= 0 && idx < historyList.length - 1) {
      this.handleJumpToNode(historyList[idx + 1].id);
    }
  }

  /**
   * 智慧悔棋 (flow.md 第 9.6 節)：回到「我方席位」的上一個回合
   */
  handleUndo() {
    if (ModalManager.activeModals.has("settlementModal")) {
      ModalManager.close("settlementModal");
    }

    if (this.ui.ctrl === CTRL.CPU) {
      this.session.paused = true;
    }

    this.teardown();

    const historyList = this.engine.tree.getBranchHistory();
    const currId = this.engine.tree.currentNodeId;
    const currIdx = historyList.findIndex((n) => n.id === currId);
    if (currIdx <= 0) return;

    // 判斷人類玩家席位
    const { black, white } = this.session.seats;
    const humanColor = (black === HUMAN && white !== HUMAN)
      ? BLACK
      : (white === HUMAN && black !== HUMAN)
        ? WHITE
        : null;

    if (humanColor != null) {
      let targetNode = null;
      for (let i = currIdx - 1; i >= 0; i--) {
        const node = historyList[i];
        if (node.turn === humanColor) {
          targetNode = node;
          break;
        }
      }
      if (targetNode) {
        this.handleJumpToNode(targetNode.id);
        return;
      }
    }

    // 雙人人類或自對弈時，退回前一手
    this.handleJumpToNode(historyList[currIdx - 1].id);
  }

  /**
   * 從歷史局面直接開闢新分支。原路線完整保留在分支選單裡，
   * 因此這是可回復的動作，不需要再跳一層對話框確認。
   * 席位沿用目前設定，要改隨時點棋盤上方的席位列。
   */
  handleStartFromHere(nodeId = null) {
    const targetNodeId = nodeId || this.engine.tree.currentNodeId;
    const node = this.engine.tree.getNode(targetNodeId);
    if (!node) return;

    this.teardown();
    this.session.assist = null;
    this.engine.startFromHere(targetNodeId);

    // 新分支若輪到 CPU，先暫停，讓使用者看清楚再放行
    this.session.paused = this.session.seats[seatKey(this.engine.currentTurn)] === CPU_SEAT;

    sound.playSpawn();
    this.sync();
  }

  handleForkBranch(nodeId) {
    this.handleStartFromHere(nodeId);
  }

  // ===== 棋子外觀工坊 =====
  openSkinModal() {
    ModalManager.open("skinModal");
    const sb = document.getElementById("soundToggleBtn");
    if (sb) sb.textContent = this.settings.soundEnabled ? "🔊" : "🔇";
    this.bindSkinEventsOnce();
    this.renderSkinWorkshop();
  }

  renderSkinWorkshop() {
    const config = this.skinManager.config;

    // 0. 主題風格設定
    const curTheme = this.settings.theme || "neon";
    const themeChips = document.querySelectorAll("#themePresetGroup .skinPresetChip");
    themeChips.forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.theme === curTheme);
    });

    document.querySelectorAll("#pathStyleGroup .skinPresetChip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.pathStyle === (config.pathStyle || "step"));
    });

    // 1. 黑方設定
    const bConfig = config.black;
    const bBadge = document.getElementById("blackSkinBadge");
    const bDisc = document.getElementById("blackPreviewDisc");
    const bColorInput = document.getElementById("blackColorInput");
    const bColorDot = document.getElementById("blackColorDot");
    const bClearBtn = document.getElementById("blackClearImgBtn");
    const bGlossToggle = document.getElementById("blackGlossToggle");

    if (bBadge) bBadge.textContent = bConfig.type === "preset" ? tr("p_" + bConfig.id) : (bConfig.type === "image" ? tr("customImage") : tr("customColor"));
    if (bDisc) bDisc.style.background = getPieceBackgroundCss(bConfig, true);
    if (bColorInput && bConfig.color) bColorInput.value = bConfig.color;
    if (bColorDot && bConfig.color) bColorDot.style.background = bConfig.color;
    if (bClearBtn) bClearBtn.style.display = bConfig.type === "image" ? "inline-flex" : "none";
    if (bGlossToggle) bGlossToggle.checked = bConfig.gloss !== false;

    const bPresetGroup = document.getElementById("blackPresetGroup");
    if (bPresetGroup) {
      bPresetGroup.innerHTML = "";
      DEFAULT_BLACK_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip ${bConfig.type === "preset" && bConfig.id === p.id ? "active" : ""}`;
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color}"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.skinManager.saveConfig({
            black: {
              type: "preset",
              id: p.id,
              label: p.label,
              color: p.color,
              gradient: p.gradient,
              imageData: null,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.boardView.render(this.engine.getState());
        });
        bPresetGroup.appendChild(chip);
      });
    }

    // 2. 白方設定
    const wConfig = config.white;
    const wBadge = document.getElementById("whiteSkinBadge");
    const wDisc = document.getElementById("whitePreviewDisc");
    const wColorInput = document.getElementById("whiteColorInput");
    const wColorDot = document.getElementById("whiteColorDot");
    const wClearBtn = document.getElementById("whiteClearImgBtn");
    const wGlossToggle = document.getElementById("whiteGlossToggle");

    if (wBadge) wBadge.textContent = wConfig.type === "preset" ? tr("p_" + wConfig.id) : (wConfig.type === "image" ? tr("customImage") : tr("customColor"));
    if (wDisc) wDisc.style.background = getPieceBackgroundCss(wConfig, false);
    if (wColorInput && wConfig.color) wColorInput.value = wConfig.color;
    if (wColorDot && wConfig.color) wColorDot.style.background = wConfig.color;
    if (wClearBtn) wClearBtn.style.display = wConfig.type === "image" ? "inline-flex" : "none";
    if (wGlossToggle) wGlossToggle.checked = wConfig.gloss !== false;

    const wPresetGroup = document.getElementById("whitePresetGroup");
    if (wPresetGroup) {
      wPresetGroup.innerHTML = "";
      DEFAULT_WHITE_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip ${wConfig.type === "preset" && wConfig.id === p.id ? "active" : ""}`;
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color}"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.skinManager.saveConfig({
            white: {
              type: "preset",
              id: p.id,
              label: p.label,
              color: p.color,
              gradient: p.gradient,
              imageData: null,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.boardView.render(this.engine.getState());
        });
        wPresetGroup.appendChild(chip);
      });
    }

    // 3. 路徑箭頭顏色 Preset Chips
    const bPathColor = config.pathBlack || "#111827";
    const bPathId    = config.pathBlackId || "obsidian";
    const wPathColor = config.pathWhite || "#e2e8f0";
    const wPathId    = config.pathWhiteId || "pearl";

    const bPathGroup = document.getElementById("blackPathPresetGroup");
    if (bPathGroup) {
      bPathGroup.innerHTML = "";
      PATH_BLACK_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip compact ${bPathId === p.id ? "active" : ""}`;
        chip.title = tr("p_" + p.id);
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color};"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.skinManager.saveConfig({ pathBlack: p.color, pathBlackId: p.id });
          this.renderSkinWorkshop();
        });
        bPathGroup.appendChild(chip);
      });
    }

    const wPathGroup = document.getElementById("whitePathPresetGroup");
    if (wPathGroup) {
      wPathGroup.innerHTML = "";
      PATH_WHITE_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip compact ${wPathId === p.id ? "active" : ""}`;
        chip.title = tr("p_" + p.id);
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color};"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.skinManager.saveConfig({ pathWhite: p.color, pathWhiteId: p.id });
          this.renderSkinWorkshop();
        });
        wPathGroup.appendChild(chip);
      });
    }

    // 自訂路徑色彩（拖曳選色時不重建整組 chips，避免選色器被銷毀）
    const addCustomPathChip = (group, side, curColor, curId) => {
      if (!group) return;
      const isBlack = side === "black";
      const chip = document.createElement("label");
      chip.className = `skinPresetChip compact customPathChip ${curId === "custom" ? "active" : ""}`;
      chip.title = window.t("skinPathCustom");
      const dot = document.createElement("span");
      dot.className = "skinPresetDot";
      dot.style.background = curId === "custom" ? curColor : "conic-gradient(#f43f5e, #f59e0b, #22c55e, #38bdf8, #a855f7, #f43f5e)";
      const text = document.createElement("span");
      text.textContent = window.t("skinPathCustom");
      const input = document.createElement("input");
      input.type = "color";
      input.value = /^#[0-9a-f]{6}$/i.test(curColor) ? curColor : (isBlack ? "#111827" : "#e2e8f0");
      input.style.cssText = "position:absolute;opacity:0;width:0;height:0;pointer-events:none;";
      chip.style.position = "relative";
      chip.append(dot, text, input);
      input.addEventListener("input", () => {
        const hex = input.value;
        dot.style.background = hex;
        group.querySelectorAll(".skinPresetChip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        this.skinManager.saveConfig(isBlack ? { pathBlack: hex, pathBlackId: "custom" } : { pathWhite: hex, pathWhiteId: "custom" });
        const headDot = document.getElementById(isBlack ? "blackPathColorDot" : "whitePathColorDot");
        if (headDot) headDot.style.background = hex;
        this.render();
      });
      group.appendChild(chip);
    };
    addCustomPathChip(bPathGroup, "black", bPathColor, bPathId);
    addCustomPathChip(wPathGroup, "white", wPathColor, wPathId);

    // 顏色預覽點
    const bPathDot = document.getElementById("blackPathColorDot");
    const wPathDot = document.getElementById("whitePathColorDot");
    if (bPathDot) bPathDot.style.background = bPathColor;
    if (wPathDot) wPathDot.style.background = wPathColor;
  }

  bindSkinEventsOnce() {
    if (this._skinEventsBound) return;
    this._skinEventsBound = true;

    document.getElementById("pathStyleGroup")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-path-style]");
      if (!chip) return;
      this.skinManager.saveConfig({ pathStyle: chip.dataset.pathStyle });
      this.renderSkinWorkshop();
      this.render();
    });

    // 黑方色彩選擇
    const bColorInput = document.getElementById("blackColorInput");
    if (bColorInput) {
      bColorInput.addEventListener("input", (e) => {
        const hex = e.target.value;
        this.skinManager.saveConfig({
          black: {
            type: "color",
            id: "custom-black",
            label: "自訂色彩",
            color: hex,
            gradient: null,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.boardView.render(this.engine.getState());
      });
    }

    // 白方色彩選擇
    const wColorInput = document.getElementById("whiteColorInput");
    if (wColorInput) {
      wColorInput.addEventListener("input", (e) => {
        const hex = e.target.value;
        this.skinManager.saveConfig({
          white: {
            type: "color",
            id: "custom-white",
            label: "自訂色彩",
            color: hex,
            gradient: null,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.boardView.render(this.engine.getState());
      });
    }

    // 黑方上傳圖片
    const bImgInput = document.getElementById("blackImgInput");
    if (bImgInput) {
      bImgInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await SkinManager.resizeImageToDataUrl(file, 256);
          this.skinManager.saveConfig({
            black: {
              type: "image",
              id: "custom-img-black",
              label: "自訂圖片",
              color: null,
              gradient: null,
              imageData: dataUrl,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.boardView.render(this.engine.getState());
        } catch (err) {
          alert(tr("imgReadFail") + (err?.message || err));
        }
        bImgInput.value = "";
      });
    }

    // 白方上傳圖片
    const wImgInput = document.getElementById("whiteImgInput");
    if (wImgInput) {
      wImgInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await SkinManager.resizeImageToDataUrl(file, 256);
          this.skinManager.saveConfig({
            white: {
              type: "image",
              id: "custom-img-white",
              label: "自訂圖片",
              color: null,
              gradient: null,
              imageData: dataUrl,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.boardView.render(this.engine.getState());
        } catch (err) {
          alert(tr("imgReadFail") + (err?.message || err));
        }
        wImgInput.value = "";
      });
    }

    // 移除黑棋圖片
    const bClearBtn = document.getElementById("blackClearImgBtn");
    if (bClearBtn) {
      bClearBtn.addEventListener("click", () => {
        const def = DEFAULT_BLACK_PRESETS[0];
        this.skinManager.saveConfig({
          black: {
            type: "preset",
            id: def.id,
            label: def.label,
            color: def.color,
            gradient: def.gradient,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.boardView.render(this.engine.getState());
      });
    }

    // 移除白棋圖片
    const wClearBtn = document.getElementById("whiteClearImgBtn");
    if (wClearBtn) {
      wClearBtn.addEventListener("click", () => {
        const def = DEFAULT_WHITE_PRESETS[0];
        this.skinManager.saveConfig({
          white: {
            type: "preset",
            id: def.id,
            label: def.label,
            color: def.color,
            gradient: def.gradient,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.boardView.render(this.engine.getState());
      });
    }

    // 水晶高光開關
    const bGloss = document.getElementById("blackGlossToggle");
    if (bGloss) {
      bGloss.addEventListener("change", (e) => {
        const cur = this.skinManager.config.black;
        this.skinManager.saveConfig({
          black: { ...cur, gloss: e.target.checked }
        });
        this.renderSkinWorkshop();
        this.boardView.render(this.engine.getState());
      });
    }

    const wGloss = document.getElementById("whiteGlossToggle");
    if (wGloss) {
      wGloss.addEventListener("change", (e) => {
        const cur = this.skinManager.config.white;
        this.skinManager.saveConfig({
          white: { ...cur, gloss: e.target.checked }
        });
        this.renderSkinWorkshop();
        this.boardView.render(this.engine.getState());
      });
    }

    // 黑方路徑色彩（preset 點擊由 renderSkinWorkshop 動態建立，此處無需額外綁定）
    // 白方路徑色彩（同上）

    // 棋盤主題切換
    const themeChips = document.querySelectorAll("#themePresetGroup .skinPresetChip");
    themeChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const theme = chip.dataset.theme;
        if (theme) {
          this.applyTheme(theme);
          this.renderSkinWorkshop();
        }
      });
    });

    // 重設全部預設
    const resetBtn = document.getElementById("skinResetDefaultBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this.applyTheme("neon");
        this.skinManager.resetDefaults();
        this.renderSkinWorkshop();
        this.boardView.render(this.engine.getState());
      });
    }
  }

  // ===== 彈窗控制 =====
  openTutorialModal() {
    ModalManager.open("tutorialModal");
    Storage.setOnboardingSeen();
  }

  openBranchModal() {
    const listEl = document.getElementById("branchTreeList");
    if (listEl) {
      const tree = this.engine.tree;
      const buildHtml = (branchId, depth, isLast) => {
        const branch = tree.branches.get(branchId);
        if (!branch) return "";
        const isActive = branchId === tree.activeBranchId;
        const children = [...tree.branches.values()]
          .filter(b => b.parentBranchId === branchId)
          .sort((a, b) => a.forkStepIdx - b.forkStepIdx);
        const prefix = depth > 0 ? (isLast ? "└─ " : "├─ ") : "";
        let html = `<div class="branchTreeRow${isActive ? " active" : ""}" data-branch-id="${branchId}" style="--depth:${depth}">
          <span class="branchTreePrefix">${prefix}</span>
          <span class="branchTreeName">${escapeHtml(tx(branch.name))}</span>
          ${isActive ? '<span class="branchTreeCheck">✓</span>' : ""}
        </div>`;
        for (let i = 0; i < children.length; i++) {
          html += buildHtml(children[i].id, depth + 1, i === children.length - 1);
        }
        return html;
      };
      listEl.innerHTML = buildHtml("main", 0, true);
      listEl.onclick = (e) => {
        const row = e.target.closest(".branchTreeRow");
        if (!row) return;
        const branchId = row.dataset.branchId;
        if (!branchId) return;
        tree.switchBranch(branchId);
        const node = tree.getCurrentNode();
        if (node) this.engine.jumpToNode(node.id);
        ModalManager.close("branchModal");
        this.sync();
      };
    }
    ModalManager.open("branchModal");
  }

  celebrate(data) {
    if (!data || data.winner === EMPTY || this.settings.animationLevel === "minimal") return;
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
    if (typeof window === "undefined" || !window.location) return;
    const url = new URL(window.location.href);
    const debug = url.searchParams.get("debug");
    const hud = document.getElementById("developerHud");
    if (hud) {
      hud.style.display = debug === "1" ? "grid" : "none";
    }
  }

  // ===== 全域渲染 (flow.md 核心架構) =====
  render() {
    this.renderCount++;
    const state = this.engine.getState();

    // 取得當前 UI 狀態模型 (若尚未推導則依目前節點端點判定)
    const tipNode = this.engine.tree.getBranchTipNode();
    const currNode = this.engine.tree.getCurrentNode();
    const isAtTip = Boolean(currNode && tipNode && currNode.id === tipNode.id);
    const ui = this.ui || deriveUiState({
      session: this.session,
      turn: state.currentTurn,
      gameOver: state.gameOver,
      isAtTip,
      passPending: Boolean(this.passTimer)
    });

    const isCpuTurn = ui.ctrl === CTRL.CPU;
    const isPaused = ui.ctrl === CTRL.PAUSED;
    const isReview = ui.view === VIEW.REVIEW;
    const isEnded = ui.view === VIEW.ENDED;

    const turnText = state.currentTurn === BLACK ? tr("sideBlack") : tr("sideWhite");
    const algoKey = state.currentTurn === BLACK ? this.engine.blackAlgo : this.engine.whiteAlgo;
    const algoName = AI_MODELS[algoKey] ? tr("ai_" + algoKey + "_name") : algoKey;

    // 1. 模式 × 控制者 狀態橫幅 (#statusBanner) (flow.md 第 2 & 7 節)
    const statusBanner = document.getElementById("statusBanner");
    const statusBadge = document.getElementById("statusBadge");
    const statusText = document.getElementById("statusText");
    const statusActions = document.getElementById("statusActions");

    if (statusBanner) {
      statusBanner.className = `statusBanner ${isReview ? "review" : (isEnded ? "ended" : ui.ctrl)}`;
    }

    if (statusBadge) {
      if (isReview) statusBadge.textContent = "🟠";
      else if (isEnded) statusBadge.textContent = "⚪";
      else if (isPaused) statusBadge.textContent = "🟡";
      else if (isCpuTurn) statusBadge.textContent = "🟣";
      else statusBadge.textContent = "🔵";
    }

    if (statusText) {
      if (isReview) {
        const stepIdx = currNode ? currNode.stepIdx : 0;
        const diceTag = currNode && currNode.dice ? tr("stReviewDice", { d: currNode.dice }) : tr("stReviewStart");
        statusText.textContent = tr("stReview", { n: stepIdx, tag: diceTag });
      } else if (isEnded) {
        statusText.textContent = tr("stEnded", { reason: state.settlementData ? tx(state.settlementData.reason) : tr("reasonDefault") });
      } else if (isPaused) {
        statusText.textContent = tr(ui.isCpuVsCpu ? "stPaused" : "stPausedOne", { turn: turnText });
      } else if (isCpuTurn) {
        const actor = ui.isAssisted
          ? tr("stAssist", { n: ui.assistLeft })
          : (ui.isCpuVsCpu ? tr("stCpuVsCpu") : tr("stCpu", { algo: algoName }));
        if (state.diceValue != null) {
          statusText.textContent = tr("stCpuThinking", { actor, turn: turnText, d: state.diceValue });
        } else {
          statusText.textContent = tr("stCpuEval", { actor, turn: turnText });
        }
      } else {
        // LIVE · HUMAN
        if (state.diceValue == null) {
          if (state.isFreePickTurn) {
            statusText.textContent = tr("stFree", { turn: turnText });
          } else {
            statusText.textContent = tr("stRoll", { turn: turnText });
          }
        } else if (state.selectedCell == null) {
          statusText.textContent = tr("stPick", { turn: turnText, d: state.diceValue });
        } else {
          statusText.textContent = tr("stDest", { turn: turnText, d: state.diceValue });
        }
      }
          statusText.innerHTML = pieceify(escapeHtml(statusText.textContent));
    }

    if (statusActions) {
      if (isReview) {
        statusActions.innerHTML = `
          <button class="btn small success" data-action="startFromHere" title="${tr("startFromHereTip")}">${tr("startFromHere")}</button>
        `;
      } else if (isEnded) {
        statusActions.innerHTML = `
          <button class="btn small" data-action="restart" title="${tr("restartTip")}">${tr("restart")}</button>
        `;
      } else {
        statusActions.innerHTML = "";
      }
    }

    // 2. 棋盤外框與浮動狀態覆蓋層 (flow.md 第 7 節)
    const boardFrame = document.getElementById("boardFrame");
    if (boardFrame) {
      boardFrame.classList.toggle("board-review", isReview);
      boardFrame.classList.toggle("board-cpu", isCpuTurn);
      boardFrame.classList.toggle("board-paused", isPaused);
    }

    // 3. 頂部狀態列 (玩家角色卡片)
    const turnDot = document.getElementById("turnDot");
    const turnTextEl = document.getElementById("turnText");
    const turnRole = document.getElementById("turnRole");

    if (turnDot) {
      turnDot.className = `turnIndicatorDot ${state.currentTurn === BLACK ? 'black' : 'white'}`;
    }
    if (turnTextEl) {
      turnTextEl.textContent = isEnded
        ? tr("diceEnded")
        : (state.currentTurn === BLACK ? tr("blackTurn") : tr("whiteTurn"));
    }
    if (turnRole) {
      if (isReview) {
        turnRole.textContent = tr("roleReview");
      } else if (isEnded) {
        turnRole.textContent = tr("roleEnded");
      } else if (isCpuTurn) {
        turnRole.textContent = ui.isAssisted ? tr("roleAssist", { algo: algoName }) : tr("roleCpu", { algo: algoName });
      } else if (isPaused) {
        turnRole.textContent = tr("rolePaused");
      } else {
        turnRole.textContent = tr("roleHuman");
      }
    }

    // 3b. 同步側邊骰子 Widget（只顯示點數）
    const sideDiceGrid = document.querySelector("#sideDiceWidget .sideDiceGrid");
    if (sideDiceGrid && this.diceView) {
      this.diceView.drawPips(state.diceValue, sideDiceGrid);
    }
    const sideDiceValLabel = document.getElementById("sideDiceValLabel");
    if (sideDiceValLabel) {
      if (state.gameOver) {
        sideDiceValLabel.textContent = tr("diceEnded");
      } else if (state.diceValue != null) {
        sideDiceValLabel.textContent = tr("steps", { n: state.diceValue });
      } else if (state.isFreePickTurn) {
        sideDiceValLabel.textContent = tr("diceFree");
      } else {
        sideDiceValLabel.textContent = "—";
      }
    }

    // 4. 比分指示
    let bTotal = 0, wTotal = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (state.board[r][c] === BLACK) bTotal++;
        else if (state.board[r][c] === WHITE) wTotal++;
      }
    }
    const wFinal = Math.round((wTotal + state.komi) * 10) / 10;
    const komiTagEl = document.getElementById("komiTag");
    if (komiTagEl) komiTagEl.textContent = window.t("komiTag").replace("{k}", state.komi);
    const bScoreEl = document.getElementById("scoreBlackNum");
    const wScoreEl = document.getElementById("scoreWhiteNum");
    const leadBadge = document.getElementById("scoreLeadBadge");

    if (bScoreEl) bScoreEl.textContent = bTotal;
    if (wScoreEl) wScoreEl.textContent = wFinal;
    const result = state.gameOver ? state.settlementData : null;
    document.querySelectorAll(".seatGroup").forEach((g) => {
      const mine = g.dataset.side === "black" ? BLACK : WHITE;
      g.classList.toggle("winner", !!result && result.winner === mine);
      g.classList.toggle("loser", !!result && result.winner !== EMPTY && result.winner !== mine);
      g.classList.toggle("drawn", !!result && result.winner === EMPTY);
    });
    if (leadBadge) {
      const diff = Math.round((bTotal - wFinal) * 10) / 10;
      leadBadge.classList.toggle("final", !!result);
      if (result) {
        leadBadge.textContent = result.winner === EMPTY
          ? tr("finalDraw")
          : tr("finalWin", { name: tr(result.winner === BLACK ? "black" : "white"), n: Math.abs(diff) });
        leadBadge.style.background = "rgba(250, 204, 21, 0.25)";
        leadBadge.style.color = "#fde047";
      } else if (diff > 0) {
        leadBadge.textContent = tr("leadBlack", { n: diff });
        leadBadge.style.background = "rgba(56, 189, 248, 0.2)";
        leadBadge.style.color = "#38bdf8";
      } else if (diff < 0) {
        leadBadge.textContent = tr("leadWhite", { n: Math.abs(diff) });
        leadBadge.style.background = "rgba(250, 204, 21, 0.2)";
        leadBadge.style.color = "#facc15";
      } else {
        leadBadge.textContent = tr("leadTie");
        leadBadge.style.background = "rgba(255, 255, 255, 0.1)";
        leadBadge.style.color = "#cbd5e1";
      }
    }

    // 5. 行動指示說明條
    const instructionBox = document.getElementById("instructionBox");
    if (instructionBox) {
      if (isEnded) {
        instructionBox.innerHTML = tr("insEnded", { reason: escapeHtml(state.settlementData ? tx(state.settlementData.reason) : tr("reasonDefault")) });
      } else if (isReview) {
        instructionBox.innerHTML = "";
      } else if (isPaused) {
        instructionBox.innerHTML = "";
      } else if (isCpuTurn) {
        instructionBox.innerHTML = "";
      } else if (state.isFreePickTurn && state.diceValue == null) {
        instructionBox.innerHTML = tr("insFree");
      } else if (state.diceValue == null) {
        instructionBox.innerHTML = tr("insRolling");
      } else if (state.selectedCell == null) {
        instructionBox.innerHTML = tr("insPickPiece", { d: state.diceValue });
      } else {
        const sCount = state.legalMovesForSelected.spawns.length;
        const cCount = state.legalMovesForSelected.captures.length;
        instructionBox.innerHTML = tr("insPickDest", { s: sCount, c: cCount });
      }
    }

    // 6. 計算有可行步數的己方棋子集合
    const piecesWithMoves = new Set();
    if (!state.gameOver && state.diceValue != null && !isReview) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (state.board[r][c] === state.currentTurn) {
            const legals = this.engine.legalMovesForSelected;
            if (this.engine.selectPiece) {
              const m = state.board;
            }
          }
        }
      }
    }

    // 7. 渲染棋盤
    this.boardView.render({
      board: state.board,
      currentTurn: state.currentTurn,
      selectedCell: state.selectedCell,
      legalMoves: state.legalMovesForSelected,
      lastMove: state.lastMove,
      endgameFilledCells: state.endgameFilledCells,
      activeAiHints: this.activeAiCandidates,
      previewGhostMove: this.previewGhostMove,
      piecesWithMoves
    });

    // 8. 渲染骰子元件
    this.diceView.render({
      diceValue: state.diceValue,
      isFreePickTurn: state.isFreePickTurn,
      canControl: ui.ctrl === CTRL.HUMAN && state.diceValue == null && !state.gameOver && !isReview,
      gameOver: state.gameOver,
      currentTurn: state.currentTurn,
      isCpu: isCpuTurn || isPaused,
      isReview
    });

    // 9. 渲染棋譜
    this.historyView.render({
      gameTree: this.engine.tree,
      currentNodeId: this.engine.tree.currentNodeId
    });

    // 9b. 「自由排盤」按鈕只在 LIVE 模式下顯示；唯讀／終局時隱藏並自動離開排盤模式
    const canSetup = ui.view === VIEW.LIVE;
    const setupModeBtn = document.getElementById("setupModeBtn");
    if (setupModeBtn) {
      setupModeBtn.style.display = canSetup ? "inline-flex" : "none";
      setupModeBtn.classList.toggle("active", this.currentMode === "setup");
    }
    if (!canSetup && this.currentMode === "setup") {
      this.currentMode = "play";
      const setupBar = document.getElementById("setupToolsBar");
      if (setupBar) setupBar.style.display = "none";
    }

    // 10. 席位控制列 (誰在下 — 唯一事實來源)
    const seatCurrentKey = seatKey(state.currentTurn);
    const seatsEditable = ui.view === VIEW.LIVE;
    document.querySelectorAll("#seatBar .seatGroup").forEach((group) => {
      // isTurn 高亮在任何模式下都顯示（含歷史檢視），讓使用者知道當時輪到誰
      group.classList.toggle("isTurn", group.dataset.side === seatCurrentKey);
    });
    document.querySelectorAll(".seatBtn").forEach((btn) => {
      btn.classList.toggle("active", ui.seats[btn.dataset.side] === btn.dataset.owner);
      btn.disabled = !seatsEditable;
    });

    // 11. 底部動作工具列 (只放「動作」，不放「模式」)
    const hintBtn = document.getElementById("hintBtn");
    const watchBtn = document.getElementById("watchBtn");
    const twoPlayerBtn = document.getElementById("twoPlayerBtn");
    const pauseResumeBtn = document.getElementById("pauseResumeBtn");


    if (hintBtn) {
      hintBtn.style.display = !isEnded ? "inline-flex" : "none";
      hintBtn.classList.toggle("active", this.hintOpen);
    }

    const vsCpuBtn = document.getElementById("vsCpuBtn");
    if (vsCpuBtn) {
      const pvp = ui.seats.black === HUMAN && ui.seats.white === HUMAN;
      vsCpuBtn.style.display = (ui.view === VIEW.LIVE && pvp) ? "inline-flex" : "none";
      vsCpuBtn.textContent = tr("vsCpu", { name: state.currentTurn === BLACK ? tr("black") : tr("white") });
    }

    if (twoPlayerBtn) {
      const bothHuman = ui.seats.black === HUMAN && ui.seats.white === HUMAN;
      twoPlayerBtn.style.display = (ui.view === VIEW.LIVE && !bothHuman) ? "inline-flex" : "none";
    }

    if (watchBtn) {
      // 已經是 CPU 對 CPU 就沒有這個動作可做了 (席位列本身就是停止的方式)
      watchBtn.style.display = (ui.view === VIEW.LIVE && !ui.isCpuVsCpu) ? "inline-flex" : "none";
    }

    if (pauseResumeBtn) {
      if (isCpuTurn) {
        // 人機對戰時 CPU 思考很快，不需要暫停鍵；只有 CPU 對戰才顯示
        pauseResumeBtn.style.display = ui.isCpuVsCpu ? "inline-flex" : "none";
        pauseResumeBtn.textContent = tr("pause");
        pauseResumeBtn.title = tr("pauseTip");
        pauseResumeBtn.className = "btn small";
      } else if (isPaused) {
        pauseResumeBtn.style.display = "inline-flex";
        pauseResumeBtn.textContent = tr("resume");
        pauseResumeBtn.title = tr("resumeTip");
        pauseResumeBtn.className = "btn small primary";
      } else {
        pauseResumeBtn.style.display = "none";
      }
    }

    // 12. 開發者模式 HUD 更新
    const hudRenders = document.getElementById("hudRenders");
    const hudTurn = document.getElementById("hudTurn");
    const hudDice = document.getElementById("hudDice");
    const hudNodes = document.getElementById("hudNodes");
    if (hudRenders) hudRenders.textContent = this.renderCount;
    if (hudTurn) hudTurn.textContent = state.currentTurn === BLACK ? "BLACK" : "WHITE";
    if (hudDice) hudDice.textContent = state.diceValue != null ? state.diceValue : "null";
    if (hudNodes) hudNodes.textContent = this.engine.tree.nodes.size;
  }
}

// 啟動應用
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    window.__app = new DiceOthelloApp();
    // Section 66: window.DiceOthello API 正式化
    window.DiceOthello = {
      app: window.__app,
      getEngine: () => window.__app.engine,
      getState: () => window.__app.engine.getState(),
      reset: () => window.__app.engine.resetGame(),
      rollDice: (val) => window.__app.engine.rollDice(val, true)
    };
  });
}
