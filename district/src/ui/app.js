/**
 * 劃區爭霸 (District) - 主應用控制器 (v4.0)
 *
 * 版面：頂部列只有「規則」與「新局設定」兩個入口；左側是計分列與棋盤；
 * 右側是回合行動卡（本回合所有操作）與戰況分頁。所有開局選項集中在新局設定對話框。
 */

import { GameEngine } from "../core/game-engine.js";
import { AIPlayer } from "../ai/ai-player.js";
import { luckOfTurnAsync, luckOfPieceGen } from "../ai/luck.js";
import { BoardView } from "./board-view.js";
import { PoolView } from "./pool-view.js";
import { ScoreView } from "./score-view.js";
import { SetupView } from "./setup-view.js";
import { loadSettings, saveSettings, toEngineOptions, loadGame, saveGame } from "./settings.js";
import { ICONS } from "./icons.js";
import { openHelp } from "../../../shared/help.js";
import { initLang, onLang } from "../../../shared/i18n.js";
import { t, partyDisplayName } from "../i18n.js";

const CPU_DELAY_MS = 320;
const AUTO_DELAY_MS = 280;

export class DistrictApp {
  constructor() {
    initLang();
    this.settings = loadSettings();
    this.engine = null;
    this.ais = [];
    this.cpuTimer = null;
    this._cpuToken = 0;   // 每次停計時器就加一：還在算的電腦步驟算完後發現不是這一輪，就丟掉
    this._cpuPending = null;
    this.hintMove = null;
    this.isCompareMode = false;
    this.paused = false;   // 暫停：輪到電腦時停住；按「繼續」放行，或直接在棋盤下就換成自己下

    this._initUI();
    if (!this._restoreGame()) this.startNewGame();
  }

  /** 分支研究中雙方（所有政黨）都由玩家下，不改設定；回到主線就換回原本的席位 */
  get playerTypes() {
    if (this.engine && this.engine.inBranch) return this.settings.parties.map(() => "human");
    return this.settings.parties.map((p) => p.type);
  }

  /** 正在看歷史局面（不是最新一步）：電腦不動，直接下棋會開分支 */
  _isReview() {
    return Boolean(this.engine && !this.engine.isAtTip());
  }

  _initUI() {
    this.scoreView = new ScoreView(document.getElementById("scoreboard"));

    this.boardView = new BoardView(document.getElementById("boardContainer"), {
      onPlaceWall: (poolIdx, vr, vc) => this.handlePlayerMove(poolIdx, vr, vc)
    });

    this.poolView = new PoolView(document.getElementById("panel"), {
      onSelectPiece: (idx, shape) => {
        if (this.boardView.selectedShape !== shape) this.boardView.setSelectedPiece(idx, shape);
      },
      onPass: (idx) => this.handlePass(idx),
      onUndo: () => this.handleUndo(),
      onNext: () => this.goToStep(this.engine.currentStep + 1),
      onGoToStep: (step) => this.goToStep(step),
      onToggleHint: () => this.toggleHint(),
      onHighlightRegion: (id) => this.boardView.setHighlightRegion(id),
      onHighlightWall: (id) => this.boardView.setHighlightWall(id),
      onNewGame: () => this.startNewGame(),
      onToggleAuto: () => this.watchCpuVsCpu(),
      onTogglePause: () => this.togglePause(),
      onRestart: () => {
        if (this.engine.history.length > 0 && !this.engine.isGameOver && !window.confirm(t("newGameConfirm"))) return;
        this.startNewGame();
      },
    });

    this.setupView = new SetupView(document.getElementById("setupDialog"), {
      onStart: (settings) => {
        this.settings = settings;
        saveSettings(settings);
        this.startNewGame();
      },
      onClose: () => this._checkTriggerCpu()
    });


    this._renderChrome();
    onLang(() => this._onLangChange());
    document.getElementById("setupBtn").addEventListener("click", () => this.openSetup());
    document.getElementById("rulesBtn").addEventListener("click", () => this.showRules());

    window.addEventListener("keydown", (e) => this._onKey(e));
    window.addEventListener("pagehide", () => this._saveGame());
    // 電腦對電腦時分頁被切到背景：計時器會被拖慢，先暫停，回來按繼續
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.engine && !this.engine.isGameOver && this.playerTypes.every((ty) => ty === "cpu") && !this.paused) this.togglePause();
    });
  }

  /** 標題列文字與網頁標題（語言切換時重畫） */
  _renderChrome() {
    document.getElementById("setupBtn").innerHTML = `${ICONS.settings}<span>${t("btnSettings")}</span>`;
    document.getElementById("rulesBtn").innerHTML = `${ICONS.help}<span>${t("btnRules")}</span>`;
    document.title = t("pageTitle");
  }

  /** 政黨沒改過名字時，名稱跟著語言走 */
  _localizeParties() {
    if (!this.engine) return;
    this.engine.parties.forEach((party, i) => {
      party.name = partyDisplayName(this.settings.parties[i]?.name, i);
      party.shortName = Array.from(party.name)[0];
    });
  }

  _onLangChange() {
    this._renderChrome();
    this._localizeParties();
    this.setupView.relocalize();
    this.boardView.render();
    this.updateUI();
  }

  _onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "Escape") {
      if (this.setupView.isOpen() && this.setupView.canCancel) {
        this.setupView.close();
        this._checkTriggerCpu();
      } else if (this.hintMove) {
        this.setHint(null);
      }
      return;
    }
    if (this.setupView.isOpen() || document.querySelector("dialog[open]")) return;

    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      // 輪到電腦席時，空白鍵是暫停／繼續（同五連黑白棋）；輪到玩家才是放棄這塊
      if (this._isCpuSeat()) this.togglePause();
      else if (this._isHumanTurn()) this.handlePass(this.poolView.selectedIndex ?? 0);
    } else if (["1", "2", "3"].includes(e.key) && this._isHumanTurn()) {
      this.poolView.selectPiece(Number(e.key) - 1);
    } else if (e.key === "z" || e.key === "Z" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      // 按住不放時鍵盤每秒重複幾十次，畫面來不及畫就會一下跳很多步：重複的按鍵限制成每 0.15 秒走一步
      const now = performance.now();
      if (e.repeat && now - (this._lastStepKey || 0) < 150) return;
      this._lastStepKey = now;
      if (e.key === "ArrowRight") this.goToStep(this.engine.currentStep + 1);
      else this.handleUndo();
    } else if (e.key === "Home") {
      e.preventDefault();
      this.goToStep(0);
    } else if (e.key === "End") {
      e.preventDefault();
      this.goToStep(this.engine.lineNodes().length - 1);
    } else if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      this.toggleHint();
    }
  }

  /** 現在輪到的政黨是電腦席 */
  _isCpuSeat() {
    return this.engine && !this._isReview() && this.playerTypes[this.engine.currentPlayer] === "cpu";
  }

  /** 暫停中（只有輪到電腦席時才有意義） */
  _isPaused() {
    return Boolean(this.paused && !this.engine.isGameOver && this._isCpuSeat());
  }

  /** 玩家現在能不能操作棋盤：輪到玩家，或電腦暫停中（一下就換成自己下） */
  _isHumanTurn() {
    return Boolean(this.engine && !this.engine.isGameOver &&
      (this._isReview() || this.playerTypes[this.engine.currentPlayer] === "human" || this._isPaused()));
  }

  /** 暫停中直接下棋：把這個政黨換成玩家 */
  _takeOverIfPaused() {
    if (!this._isPaused()) return;
    const p = this.engine.currentPlayer;
    this.settings.parties[p].type = "human";
    this.paused = false;
    saveSettings(this.settings);
  }

  /** 改某個政黨由誰操作（玩家／電腦）：切成電腦時，輪到它就先暫停，讓玩家決定何時放行 */
  _setSeat(p, owner) {
    const party = this.settings.parties[p];
    if (!party || (owner !== "human" && owner !== "cpu") || party.type === owner || !this.engine) return;
    party.type = owner;
    saveSettings(this.settings);
    this._stopTimers();
    this.hintMove = null;
    const isCurrent = p === this.engine.currentPlayer && !this.engine.isGameOver;
    if (owner === "cpu") this.paused = isCurrent;
    else if (isCurrent) this.paused = false;
    this.updateUI();
    this._checkTriggerCpu();
  }

  /** 全部政黨都交給電腦，看它們對下 */
  watchCpuVsCpu() {
    if (!this.engine || this.engine.isGameOver) return;
    this.settings.parties.forEach((party) => { party.type = "cpu"; });
    saveSettings(this.settings);
    this._stopTimers();
    this.hintMove = null;
    this.paused = false;
    this.updateUI();
    this._checkTriggerCpu();
  }

  openSetup() {
    this._stopTimers();
    this.setupView.open(this.settings);
  }

  _stopTimers() {
    this._cpuToken++;
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (this.cpuTimer) {
      clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
  }

  startNewGame() {
    this._stopTimers();
    this.hintMove = null;
    this.isCompareMode = false;

    this.engineOptions = {
      ...toEngineOptions(this.settings),
      seed: this.settings.seed ?? Math.floor(Math.random() * 1000000)
    };
    this._setEngine(new GameEngine(this.engineOptions));
  }

  _setEngine(engine) {
    this.engine = engine;
    this.ais = this.engine.parties.map((_, i) => new AIPlayer(i, { level: this.settings.parties[i]?.level }));

    this.poolView.setPlayerTypes(this.playerTypes);
    this.boardView.setEngine(this.engine);
    this.poolView.setEngine(this.engine);
    // 開局先輪到電腦：先停住，別讓玩家一進來電腦就搶著下
    this.paused = this._isCpuSeat();
    this.updateUI();
    this._checkTriggerCpu();
  }

  updateUI() {
    this.poolView.isPaused = this._isPaused();
    this.poolView.allCpu = this.playerTypes.every((ty) => ty === "cpu");
    this._syncCompare();
    this.poolView.hintMove = this.hintMove;
    this.poolView.setPlayerTypes(this.playerTypes);
    this.boardView.hintMove = this.hintMove;
    this.boardView.setInteractive(this._isHumanTurn());
    this._renderScore();
    this.boardView.render();
    this.poolView.render();
    this._scheduleLuck();
    this._schedulePieceLuck();
    this._scheduleSave();
  }

  /** 離開或重新整理後回到同一局：存開局參數、主線與分支的每一步、目前看到第幾步（同五連黑白棋、誰會贏？） */
  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveGame(), 250);
  }

  _saveGame() {
    if (!this.engine || !this.engineOptions) return;
    const e = this.engine;
    const encode = (node) => {
      const h = node.entry;
      return h.action === "place" ? { t: "p", u: h.wallId, r: h.vr, c: h.vc } : { t: "s", u: h.discarded?.uid ?? null };
    };
    const main = e.tree.getBranchHistory("main").slice(1).map(encode);
    const branchInfo = e.inBranch ? e.tree.branches.get(e.tree.activeBranchId) : null;
    const branch = branchInfo ? { fork: branchInfo.forkStepIdx, moves: e.lineNodes().slice(branchInfo.forkStepIdx + 1).map(encode) } : null;
    saveGame({ v: 1, options: this.engineOptions, main, branch, step: e.currentStep });
  }

  /** 照存檔重下一遍（地圖與牌袋由種子決定，重下的結果一模一樣）；任何一步對不上就放棄存檔、開新局 */
  _restoreGame() {
    const data = loadGame();
    if (!data || data.v !== 1 || !data.options || !Array.isArray(data.main)) return false;
    if (data.options.parties?.length !== this.settings.parties.length) return false;
    try {
      const engine = new GameEngine(data.options);
      const play = (m) => {
        const idx = Math.max(0, engine.candidatePool.findIndex((p) => p.uid === m.u));
        const res = m.t === "p" ? engine.placeWall(idx, m.r, m.c) : engine.pass(idx);
        if (!res.success) throw new Error("replay failed");
      };
      data.main.forEach(play);
      if (data.branch) {
        engine.goToStep(data.branch.fork);
        data.branch.moves.forEach(play);
      }
      const step = Number.isInteger(data.step) ? Math.min(data.step, engine.lineNodes().length - 1) : engine.lineNodes().length - 1;
      engine.goToStep(step);
      this.engineOptions = data.options;
      this._setEngine(engine);
      return true;
    } catch (_) {
      return false;
    }
  }

  _renderScore() {
    this.scoreView.render(this.engine, this.playerTypes, {
      levels: this.settings.parties.map((p) => p.level),
      onLevel: (p, level) => this._setPartyLevel(p, level),
      onSeat: (p, owner) => this._setSeat(p, owner)
    });
  }

  /** 背景算每一步的牌運（一次一步，算完才重畫側欄）；換局或換分支時作廢重來 */
  /** 手上選中的那塊牆的運氣（目前局面）：背景算，算完重畫手牌卡；換步或換牆就重算 */
  _schedulePieceLuck() {
    const e = this.engine;
    const piece = e && !e.isGameOver ? e.candidatePool[this.poolView.selectedIndex ?? 0] : null;
    if (!piece) { this.poolView.pieceLuck = undefined; return; }
    const key = `${e.tree.currentNodeId}|${piece.shape.id}`;
    if (this._pieceLuckKey === key) return;
    this._pieceLuckKey = key;
    this.poolView.pieceLuck = undefined;
    const total = e.getAnalyticsReport().totalElectoralVotes || 1;
    const it = luckOfPieceGen(e, piece.shape);
    (async () => {
      let r = it.next();
      while (!r.done) { await new Promise((resolve) => setTimeout(resolve, 0)); r = it.next(); }
      return r.value;
    })().then((v) => {
      if (this._pieceLuckKey !== key || this.engine !== e) return;
      this.poolView.pieceLuck = v == null ? null : (v / total) * 100;
      this.poolView.render();
    }).catch(() => {});
  }

  _scheduleLuck() {
    if (this._luckBusy || !this.engine) return;
    const engine = this.engine;
    const line = [...engine.lineNodes(), ...engine.tree.getBranchHistory("main")];
    const idx = line.findIndex((n, i) => i > 0 && n.luck === undefined && engine.tree.getNode(n.id));
    if (idx < 0) return;
    const node = line[idx];
    const parent = engine.tree.getNode(node.parentId);
    if (!parent) { node.luck = null; return; }
    this._luckBusy = true;
    const total = engine.getAnalyticsReport().totalElectoralVotes || 1;
    luckOfTurnAsync(engine, parent).then((v) => {
      node.luck = v == null ? null : (v / total) * 100;
    }).catch(() => { node.luck = null; }).finally(() => {
      this._luckBusy = false;
      if (engine !== this.engine) { this._scheduleLuck(); return; }
      this.poolView.render();
      this._renderScore();
      this._scheduleLuck();
    });
  }

  /** 開票時棋盤自動切到「劃區前後對比」（終局那一步）；退回上一手就恢復，不想看就拖到旁邊 */
  _syncCompare() {
    const on = Boolean(this.engine?.isGameOver);
    this.isCompareMode = on;
    if (this.boardView.compareMode !== on) this.boardView.setCompareMode(on, 0);
    this.poolView.isCompareMode = on;
  }

  setHint(hint) {
    this.hintMove = hint;
    this.boardView.setHintMove(hint);
    this.poolView.setHintMove(hint);
  }

  toggleHint() {
    if (!this._isHumanTurn()) return;
    if (this.hintMove) {
      this.setHint(null);
      return;
    }
    const p = this.engine.currentPlayer;
    const move = this.ais[p].decideMove(this.engine);
    const piece = move.action === "place" ? this.engine.candidatePool[move.poolIndex] : null;
    if (piece) {
      this.poolView.selectedIndex = move.poolIndex;
      this.setHint({
        action: "place",
        poolIndex: move.poolIndex,
        vr: move.vr,
        vc: move.vc,
        shape: piece.shape
      });
    } else {
      this.setHint({ action: "pass" });
    }
  }

  _afterAction() {
    this.paused = false;
    this.hintMove = null;
    this.poolView.selectedIndex = 0;
    this.boardView.highlightWallId = null;
    this.updateUI();
    this._checkTriggerCpu();
  }

  handlePlayerMove(poolIndex, vr, vc) {
    if (!this._isHumanTurn()) return;
    this._takeOverIfPaused();
    const res = this.engine.placeWall(poolIndex, vr, vc);
    if (res.success) this._afterAction();
  }

  handlePass(poolIndex = 0) {
    if (!this._isHumanTurn()) return;
    this._takeOverIfPaused();
    this.engine.pass(poolIndex);
    this._afterAction();
  }

  handleUndo() {
    this.goToStep(this.engine.currentStep - 1);
  }

  /** 回到歷史某一步（或回到最新）；退回分岔點或更早，分支消失、回到主線 */
  goToStep(step) {
    const e = this.engine;
    if (!e || step < 0 || step >= e.lineNodes().length || step === e.currentStep) return;
    this._stopTimers();
    this.hintMove = null;
    e.goToStep(step);
    this.boardView.highlightWallId = null;
    // 回到最新一步時若輪到電腦：先停住，讓玩家決定何時放行
    this.paused = !e.isGameOver && this._isCpuSeat();
    this.updateUI();
    this._checkTriggerCpu();
  }

  /** 計分列上改某個電腦政黨的強度：立刻生效、存進設定 */
  _setPartyLevel(p, level) {
    if (!this.settings.parties[p]) return;
    this.settings.parties[p].level = level;
    saveSettings(this.settings);
    if (this.ais[p]) this.ais[p].level = level;
    this.updateUI();
  }

  _cpuStep() {
    if (this.engine.isGameOver) return;
    const p = this.engine.currentPlayer;
    const move = this.ais[p].decideMove(this.engine);
    if (move.action === "place") this.engine.placeWall(move.poolIndex, move.vr, move.vc);
    else this.engine.pass();
  }

  /**
   * 電腦走一步（非同步）：慢的強度會分段計算，不卡住畫面。
   * 算的途中如果玩家悔棋、開新局或打開設定（_stopTimers），這一步就作廢，回傳 false。
   */
  async _cpuStepAsync() {
    if (this.engine.isGameOver) return false;
    const token = this._cpuToken;
    const engine = this.engine;
    const p = engine.currentPlayer;
    const move = await this.ais[p].decideMoveAsync(engine);
    if (token !== this._cpuToken || engine !== this.engine || engine.isGameOver || engine.currentPlayer !== p) return false;
    if (move.action === "place") engine.placeWall(move.poolIndex, move.vr, move.vc);
    else engine.pass();
    return true;
  }

  /** 暫停 / 繼續電腦 */
  togglePause() {
    if (!this.engine || this.engine.isGameOver) return;
    this.hintMove = null;
    if (this.paused) {
      this.paused = false;
      this.updateUI();
      this._checkTriggerCpu();
      return;
    }
    this.paused = true;
    this._stopTimers();
    this.updateUI();
  }

  _checkTriggerCpu() {
    if (this.cpuTimer) {
      clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    if (!this.engine || this.engine.isGameOver || this.setupView.isOpen() || this._isReview()) return;
    if (this.playerTypes[this.engine.currentPlayer] !== "cpu") { this.paused = false; return; }
    if (this.paused) return;
    this.cpuTimer = setTimeout(async () => {
      this.cpuTimer = null;
      if (this.engine.isGameOver || this.paused || this.playerTypes[this.engine.currentPlayer] !== "cpu") return;
      const token = this._cpuToken;
      if (this._cpuPending === token) return; // 這一輪已經有一步在算了
      this._cpuPending = token;
      const done = await this._cpuStepAsync();
      if (this._cpuPending === token) this._cpuPending = null;
      if (!done) return;
      this.updateUI();
      this._checkTriggerCpu();
    }, CPU_DELAY_MS);
  }

  showRules() {
    openHelp({ gameId: "district" });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    window.app = new DistrictApp();
  });
}
