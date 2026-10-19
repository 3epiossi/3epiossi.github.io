/**
 * 劃區爭霸 (District) - 核心遊戲引擎
 */

import { GAME_MODES, PARTIES, CELLS_PER_BAG_COPY, TWO_PARTY_K_PER_CELL, buildParties, normalizeRules } from "./constants.js";
import { WALL_SHAPES } from "./shapes.js";
import {
  createBoardState,
  cloneBoardState,
  canPlaceWall,
  applyPlaceWall,
  getLegalPlacements,
  calculateRegions,
  tallyElectoralVotes
} from "./rules.js";
import { generateMap, createPRNG, defaultCompensationK } from "./map-generator.js";
import { GameTree } from "./game-tree.js";

const QUADRANT_NAMES = [
  "左上象限 (NW)",
  "右上象限 (NE)",
  "左下象限 (SW)",
  "右下象限 (SE)"
];

export class GameEngine {
  /**
   * @param {Object} options
   * @param {Array<{name?: string, color?: string}>} [options.parties] - 自訂政黨（2~6 黨，依行動順序）
   * @param {number} [options.numPlayers] - 未提供 parties 時使用預設政黨的前 numPlayers 個
   * @param {number} [options.boardSize] - 棋盤外接正方形邊長；省略時使用經典模式尺寸
   * @param {boolean[][]|null} [options.mask] - 自訂地圖輪廓（N x N 可用棋格）
   * @param {Object} [options.rules] - 自訂規則與機制（見 DEFAULT_RULES）
   */
  constructor(options = {}) {
    this.rules = normalizeRules(options.rules);
    this.parties = options.parties
      ? buildParties(options.parties)
      : PARTIES.slice(0, options.numPlayers || 2);
    this.numPlayers = this.parties.length;
    if (this.numPlayers < 2) throw new Error(`Unsupported player count: ${this.numPlayers}`);

    const classic = GAME_MODES[this.numPlayers] || null;
    this.boardSize = options.boardSize || (classic ? classic.boardSize : 10);
    this.mask = options.mask || null;

    const activeCells = this.mask
      ? this.mask.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
      : this.boardSize * this.boardSize;
    // 經典正方形棋盤沿用已平衡的參數；自訂地圖依可用格數縮放牌袋與先手補償
    const isClassic = Boolean(classic) && !this.mask && this.boardSize === classic.boardSize;
    const refCells = classic ? classic.totalCells : 100;
    const baseK = defaultCompensationK(this.numPlayers);
    const usesAllShapes = this.rules.families.length === 3 && this.rules.bagScale === 1;
    this.config = isClassic && usesAllShapes
      ? classic
      : {
        numPlayers: this.numPlayers,
        boardSize: this.boardSize,
        totalCells: activeCells,
        bagCopiesPerShape: this._bagCopies(isClassic ? classic.bagCopiesPerShape : activeCells / CELLS_PER_BAG_COPY),
        initialK: isClassic ? classic.initialK : (this.numPlayers === 2 ? Math.round(TWO_PARTY_K_PER_CELL * activeCells) : Math.round(baseK * activeCells / refCells))
      };
    this.bagShapes = WALL_SHAPES.filter((shape) => this.rules.families.includes(shape.type));
    if (this.config !== classic) {
      this.config.totalBagPieces = this.config.bagCopiesPerShape * this.bagShapes.length;
    }
    this.activeCellCount = activeCells;

    this.seed = options.seed !== undefined ? options.seed : 42;
    this.rng = options.rng || createPRNG(this.seed);
    this.k = options.k !== undefined ? options.k : Math.round(this.config.initialK * this.rules.compensation) || 0;

    // 1. 生成地圖數據（每格差異化人口、真實支持度）
    this.map = generateMap(this.numPlayers, this.seed, this.k, {
      boardSize: this.boardSize,
      mask: this.mask,
      popContrast: this.rules.popContrast,
      partyClustering: this.rules.partyClustering
    });

    // 2. 建立棋盤幾何與牆壁狀態
    this.boardState = createBoardState(this.boardSize, this.mask);

    // 3. 建立並洗勻牆塊袋（10 種造型：I4、S4、T4）
    this.wallBag = this._createWallBag();
    this.discardPile = [];

    // 4. 抽出手牌（預設 1 塊：抽到什麼就是什麼）
    this.candidatePool = [];
    this._refillHand();

    // 5. 回合與狀態控制
    this.currentPlayer = 0;
    this.turnCount = 0;
    this.consecutivePasses = 0;
    this.isGameOver = false;

    // 6. 終局結算快取；version 每次狀態改變時遞增，供報表與畫面快取判斷
    this.finalResults = null;
    this.version = 0;
    this._reportCache = null;

    // 7. 對局樹：每一步一個節點（含完整局面快照），支援回到任一步與分支
    this.tree = new GameTree(this._snapshot());
  }

  /** 牌袋每種形狀份數：依倍率縮放，少了家族時把份數補給其他形狀，維持牌袋總量 */
  _bagCopies(base) {
    const shapeCount = WALL_SHAPES.filter((shape) => this.rules.families.includes(shape.type)).length;
    return Math.max(2, Math.round(base * this.rules.bagScale * WALL_SHAPES.length / shapeCount));
  }

  /** 連續放棄達此次數即結束 */
  get passLimit() {
    return this.numPlayers * this.rules.passRounds;
  }

  _refillHand() {
    while (this.candidatePool.length < this.rules.handSize && this.wallBag.length > 0) {
      this.candidatePool.push(this.wallBag.pop());
    }
  }

  _bumpVersion() {
    this.version++;
    this._reportCache = null;
  }

  _tallyOptions() {
    return { minDistrictSize: this.rules.minDistrictSize, shapes: this.bagShapes };
  }

  /** 每格開票資料（地圖外棋格人口為 0） */
  _cellData() {
    return Array.from({ length: this.boardSize }, (_, r) =>
      Array.from({ length: this.boardSize }, (_, c) => ({
        support: this.map.cells[r][c].support,
        votes: this.map.cells[r][c].electoralVotes
      }))
    );
  }

  /** 目前局面的完整快照（對局樹節點用） */
  _snapshot() {
    return {
      boardState: cloneBoardState(this.boardState),
      wallBag: [...this.wallBag],
      discardPile: [...this.discardPile],
      candidatePool: [...this.candidatePool],
      currentPlayer: this.currentPlayer,
      turnCount: this.turnCount,
      consecutivePasses: this.consecutivePasses,
      isGameOver: this.isGameOver,
      finalResults: this.finalResults
    };
  }

  _restore(snap) {
    this.boardState = cloneBoardState(snap.boardState);
    this.wallBag = [...snap.wallBag];
    this.discardPile = [...snap.discardPile];
    this.candidatePool = [...snap.candidatePool];
    this.currentPlayer = snap.currentPlayer;
    this.turnCount = snap.turnCount;
    this.consecutivePasses = snap.consecutivePasses;
    this.isGameOver = snap.isGameOver;
    this.finalResults = snap.finalResults;
    this._bumpVersion();
  }

  /** 從開局到目前這一步的行動紀錄 */
  get history() {
    const out = [];
    for (let n = this.tree.getCurrentNode(); n && n.entry; n = this.tree.getNode(n.parentId)) out.unshift(n.entry);
    return out;
  }

  /** 目前這條線上所有節點（含目前這一步之後的「未來」），第 0 個是開局 */
  lineNodes() {
    return this.tree.getBranchHistory();
  }

  /** 目前在第幾步（0 = 開局） */
  get currentStep() {
    return this.tree.getCurrentNode().stepIdx;
  }

  /** 目前是不是這條線的最新一步（不是的話，下棋會開分支） */
  isAtTip() {
    return this.tree.getCurrentNode().id === this.tree.getBranchTipNode().id;
  }

  /** 是否正在看分支（不是主線） */
  get inBranch() {
    return this.tree.activeBranchId !== "main";
  }

  /** 跳到某個節點，局面整個換成那一步的快照 */
  jumpToNode(nodeId) {
    const node = this.tree.getNode(nodeId);
    if (!node) return false;
    this.tree.currentNodeId = node.id;
    this._restore(node.snap);
    return true;
  }

  /** 跳到目前這條線的第 step 步；正在看分支又退回分岔那一步或更早，分支消失、回到主線 */
  goToStep(step) {
    const tree = this.tree;
    const branch = tree.branches.get(tree.activeBranchId);
    if (tree.activeBranchId !== "main" && branch && step <= branch.forkStepIdx) {
      tree.deleteBranch(tree.activeBranchId);
      tree.activeBranchId = "main";
    }
    const node = tree.getBranchHistory()[step];
    return node ? this.jumpToNode(node.id) : false;
  }

  /** 目前這一步變成最新一步：這條線到這一步設成正式棋譜，之後的棋與分支都刪掉 */
  makeCurrentLatest() {
    const curr = this.tree.getCurrentNode();
    if (!curr || curr.snap.isGameOver) return false;
    if (!this.tree.promoteLineTo(curr.id)) return false;
    return this.jumpToNode(curr.id);
  }

  /** 在歷史某一步要改下別的：主線上開一條分支（舊分支刪掉），分支上就把這一步之後換掉 */
  _branchHere() {
    const tree = this.tree, curr = tree.getCurrentNode();
    if (tree.activeBranchId === "main") {
      for (const id of [...tree.branches.keys()]) if (id !== "main") tree.deleteBranch(id);
      tree.createBranchFromNode(curr.id, null);
    } else {
      tree.truncateAfter(curr.id);
    }
  }

  /** 歷史局面下的這一步，跟這條線的下一手一模一樣就等同按「下一手」，不開分支。回傳 true 表示已經跳過去了 */
  _replayIfSame(entry) {
    if (this.isAtTip()) return false;
    const next = this.tree.getBranchHistory()[this.currentStep + 1];
    const ne = next && next.entry;
    if (!ne || ne.action !== entry.action) return false;
    const same = entry.action === "place"
      ? ne.wallId === entry.wallId && ne.vr === entry.vr && ne.vc === entry.vc
      : ne.discarded?.uid === entry.discarded?.uid;
    if (!same) return false;
    this.goToStep(this.currentStep + 1);
    return true;
  }

  /** 是否可以悔棋（回到上一步） */
  canUndo() {
    return this.currentStep > 0;
  }

  /** 回到上一步（之後的步仍留在這條線上，可以用 goToStep 回去；從這裡下別的就會開分支） */
  undo() {
    if (!this.canUndo()) {
      return { success: false, reason: "NOTHING_TO_UNDO" };
    }
    this.goToStep(this.currentStep - 1);
    return { success: true };
  }

  /** 建立牆塊袋並使用 PRNG 洗勻 */
  _createWallBag() {
    const bag = [];
    let uid = 1;
    const copies = this.config.bagCopiesPerShape;

    for (const shape of this.bagShapes) {
      for (let c = 0; c < copies; c++) {
        bag.push({
          uid: uid++,
          shapeId: shape.id,
          shape
        });
      }
    }

    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }

    return bag;
  }

  /** 取得開票結果（只有確定當選的選區才計入已得票） */
  getProvisionalResults() {
    const regions = calculateRegions(this.boardState);
    return tallyElectoralVotes(regions, this._cellData(), this.numPlayers, this.boardState, this.isGameOver, this._tallyOptions());
  }

  /** 取得開票結果（政黨支持度全程固定不變，與 getProvisionalResults 完全一致） */
  getTrueResults() {
    return this.getProvisionalResults();
  }

  /**
   * 取得完整統計與數據分析報告
   */
  getAnalyticsReport() {
    if (this._reportCache && this._reportCache.version === this.version) {
      return this._reportCache.report;
    }
    const report = this._buildAnalyticsReport();
    this._reportCache = { version: this.version, report };
    return report;
  }

  _buildAnalyticsReport() {
    const activeResults = this.getProvisionalResults();
    const pollResults = activeResults;
    const trueResults = activeResults;

    const wallsByPlayer = Array(this.numPlayers).fill(0);
    for (const w of this.boardState.placedWalls) {
      if (w.playerId >= 0 && w.playerId < this.numPlayers) {
        wallsByPlayer[w.playerId]++;
      }
    }

    const districts = [];
    for (let i = 0; i < activeResults.regionResults.length; i++) {
      const activeR = activeResults.regionResults[i];

      let safetyLabel = "爭奪中";
      if (activeR.isVoid) {
        safetyLabel = "均分選區";
      } else if (activeR.isSecured) {
        safetyLabel = "確定當選";
      } else if (activeR.isTie) {
        safetyLabel = "平手均分";
      } else if (activeR.marginPct <= 8) {
        safetyLabel = "激戰搖擺";
      } else if (activeR.marginPct <= 15) {
        safetyLabel = "溫和領先";
      }

      districts.push({
        id: activeR.id,
        displayId: activeR.id + 1,
        size: activeR.size,
        cellCount: activeR.size,
        cells: activeR.cells,
        population: activeR.votes,
        votes: activeR.votes,
        electoralVotes: activeR.votes,
        support: activeR.support,
        winners: activeR.winners,
        isTie: activeR.isTie,
        isVoid: Boolean(activeR.isVoid),
        margin: activeR.margin,
        marginPct: activeR.marginPct,
        isSecured: activeR.isSecured,
        securedWinner: activeR.securedWinner,
        // 向前相容屬性
        pollSupport: activeR.support,
        pollWinners: activeR.winners,
        pollIsTie: activeR.isTie,
        pollMargin: activeR.margin,
        pollMarginPct: activeR.marginPct,
        trueSupport: activeR.support,
        trueWinners: activeR.winners,
        trueIsTie: activeR.isTie,
        trueMargin: activeR.margin,
        trueMarginPct: activeR.marginPct,
        activeSupport: activeR.support,
        activeWinners: activeR.winners,
        activeIsTie: activeR.isTie,
        activeMargin: activeR.margin,
        activeMarginPct: activeR.marginPct,
        poll: {
          votes: activeR.support,
          winners: activeR.winners,
          isTie: activeR.isTie,
          margin: activeR.margin,
          marginPct: activeR.marginPct,
          isSwing: activeR.marginPct <= 8
        },
        true: {
          votes: activeR.support,
          winners: activeR.winners,
          isTie: activeR.isTie,
          margin: activeR.margin,
          marginPct: activeR.marginPct,
          isSwing: activeR.marginPct <= 8
        },
        active: {
          votes: activeR.support,
          winners: activeR.winners,
          isTie: activeR.isTie,
          margin: activeR.margin,
          marginPct: activeR.marginPct,
          isSwing: activeR.marginPct <= 8
        },
        wastedByParty: activeR.wastedByParty,
        isFlipped: false,
        safetyLabel
      });
    }

    const partyStats = Array.from({ length: this.numPlayers }, (_, p) => {
      const party = this.parties[p];
      const ev = activeResults.electoralVotes[p];
      const provEv = activeResults.provisionalElectoralVotes ? activeResults.provisionalElectoralVotes[p] : ev;
      const provSeatShare = activeResults.provisionalSeatShares
        ? activeResults.provisionalSeatShares[p]
        : (activeResults.totalElectoralVotes > 0 ? (provEv / activeResults.totalElectoralVotes) * 100 : 0);
      const provDistWon = activeResults.provisionalDistrictsWon
        ? activeResults.provisionalDistrictsWon[p]
        : activeResults.districtsWon[p];
      const pop = activeResults.popularVotes[p];
      return {
        partyId: p,
        playerId: p,
        name: party.name,
        shortName: party.shortName,
        color: party.color,
        electoralVotes: ev,
        confirmedElectoralVotes: ev,
        provisionalElectoralVotes: provEv,
        leadingUnsecuredVotes: Math.max(0, provEv - ev),
        pollElectoralVotes: ev,
        trueElectoralVotes: ev,
        electoralVoteDelta: 0,
        pollToTrueDelta: 0,
        seatShare: activeResults.seatShares[p],
        provisionalSeatShare: provSeatShare,
        pollSeatShare: activeResults.seatShares[p],
        trueSeatShare: activeResults.seatShares[p],
        popularVotes: pop,
        pollPopularVotes: pop,
        truePopularVotes: pop,
        targetTotalPopulation: this.map.targetTotals[p],
        voteShare: activeResults.voteShares[p],
        pollVoteShare: activeResults.voteShares[p],
        trueVoteShare: activeResults.voteShares[p],
        regionsWon: activeResults.regionsWon[p],
        districtsWon: activeResults.districtsWon[p],
        confirmedDistrictsWon: activeResults.districtsWon[p],
        provisionalDistrictsWon: provDistWon,
        pollRegionsWon: activeResults.regionsWon[p],
        trueRegionsWon: activeResults.regionsWon[p],
        pollDistrictsWon: activeResults.districtsWon[p],
        trueDistrictsWon: activeResults.districtsWon[p],
        gerrymanderAdvantage: activeResults.gerrymanderAdvantage[p],
        pollGerrymanderAdvantage: activeResults.gerrymanderAdvantage[p],
        trueGerrymanderAdvantage: activeResults.gerrymanderAdvantage[p],
        seatVoteGapPct: activeResults.seatShares[p] - activeResults.voteShares[p],
        provisionalSeatVoteGapPct: provSeatShare - activeResults.voteShares[p],
        surplusWasted: activeResults.surplusWastedVotes[p],
        lostWasted: activeResults.lostWastedVotes[p],
        totalWasted: activeResults.totalWastedVotes[p],
        surplusWastedVotes: activeResults.surplusWastedVotes[p],
        lostWastedVotes: activeResults.lostWastedVotes[p],
        totalWastedVotes: activeResults.totalWastedVotes[p],
        wallsPlaced: wallsByPlayer[p]
      };
    });

    // 計算效率差距 (Efficiency Gap)：2人局為兩黨總浪費票差 ÷ 全盤總票數
    let efficiencyGap = null;
    if (activeResults.totalPopularVotes > 0 && this.numPlayers === 2) {
      const w0 = activeResults.totalWastedVotes[0];
      const w1 = activeResults.totalWastedVotes[1];
      efficiencyGap = (Math.abs(w0 - w1) / activeResults.totalPopularVotes) * 100;
    }

    const quadrantBiases = (this.map.quadrantBiases || []).map((bias, idx) => ({
      id: idx,
      name: QUADRANT_NAMES[idx] || `象限 ${idx + 1}`,
      bias
    }));

    const flipsCount = 0;
    const swingCount = districts.filter(d => d.activeMarginPct <= 8).length;

    return {
      isGameOver: this.isGameOver,
      boardSize: this.boardSize,
      parties: this.parties,
      activeCellCount: this.activeCellCount,
      numPlayers: this.numPlayers,
      k: this.k,
      totalElectoralVotes: activeResults.totalElectoralVotes,
      totalConfirmedElectoralVotes: activeResults.totalConfirmedElectoralVotes,
      totalUnsecuredElectoralVotes: activeResults.totalUnsecuredElectoralVotes,
      totalVoidElectoralVotes: activeResults.totalVoidVotes || 0,
      rules: this.rules,
      totalPopularVotes: activeResults.totalPopularVotes,
      totalPopulation: activeResults.totalPopularVotes,
      pollResults,
      trueResults,
      activeResults,
      districts,
      partyStats,
      efficiencyGap,
      efficiencyGapPct: efficiencyGap ?? 0,
      quadrantBiases,
      flipsCount,
      flippedDistrictsCount: flipsCount,
      swingCount,
      swingDistrictsCount: swingCount,
      totalRegions: districts.length,
      numDistricts: districts.length
    };
  }

  /**
   * 放置牆塊行動 (poolIndex 固定為 0，對應當前抽出的牆塊)
   */
  placeWall(poolIndex, vr, vc) {
    if (this.isGameOver) {
      return { success: false, reason: "GAME_ALREADY_OVER", detail: "遊戲已結束" };
    }

    if (poolIndex < 0 || poolIndex >= this.candidatePool.length) {
      return { success: false, reason: "INVALID_POOL_INDEX", detail: "無效的牆塊索引" };
    }

    const piece = this.candidatePool[poolIndex];
    const check = canPlaceWall(this.boardState, piece.shape, vr, vc);
    if (!check.valid) {
      return { success: false, reason: check.reason, detail: check.detail };
    }

    const entry = {
      turn: this.turnCount,
      player: this.currentPlayer,
      action: "place",
      piece,
      vr,
      vc,
      wallId: piece.uid
    };
    if (this._replayIfSame(entry)) return { success: true, wallId: piece.uid, replayed: true };
    if (!this.isAtTip()) this._branchHere();

    applyPlaceWall(this.boardState, piece.shape, vr, vc, this.currentPlayer, piece.uid);

    this.candidatePool.splice(poolIndex, 1);
    this._refillHand();

    this.consecutivePasses = 0;
    this._bumpVersion();
    this._checkGameOverAfterAction();

    if (!this.isGameOver) {
      this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
      this.turnCount++;
    }
    this.tree.appendNode({ entry, snap: this._snapshot() });

    return { success: true, wallId: piece.uid };
  }

  /**
   * Pass 行動：棄除一塊手牌（預設最舊的一塊），並從袋中補抽
   */
  pass(poolIndex = 0) {
    if (this.isGameOver) {
      return { success: false, reason: "GAME_ALREADY_OVER", detail: "遊戲已結束" };
    }

    const idx = poolIndex >= 0 && poolIndex < this.candidatePool.length ? poolIndex : 0;
    const entry = {
      turn: this.turnCount,
      player: this.currentPlayer,
      action: "pass",
      discarded: this.candidatePool[idx] || null
    };
    if (this._replayIfSame(entry)) return { success: true, action: "pass", discarded: entry.discarded, replayed: true };
    if (!this.isAtTip()) this._branchHere();

    let discarded = null;
    if (this.candidatePool.length > 0) {
      discarded = this.candidatePool.splice(idx, 1)[0];
      this.discardPile.push(discarded);
      this._refillHand();
    }

    this.consecutivePasses++;

    this._bumpVersion();
    this._checkGameOverAfterAction();

    if (!this.isGameOver) {
      this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
      this.turnCount++;
    }
    this.tree.appendNode({ entry, snap: this._snapshot() });

    return { success: true, action: "pass", discarded };
  }

  /**
   * 檢查遊戲結束條件
   */
  _checkGameOverAfterAction() {
    if (this.consecutivePasses >= this.passLimit) {
      this._endGame();
      return;
    }

    if (this.candidatePool.length === 0 && this.wallBag.length === 0) {
      this._endGame();
      return;
    }

    let hasAnyMove = false;
    for (const piece of this.candidatePool) {
      const legal = getLegalPlacements(this.boardState, piece.shape);
      if (legal.length > 0) {
        hasAnyMove = true;
        break;
      }
    }

    if (!hasAnyMove && this.wallBag.length === 0) {
      this._endGame();
    }
  }

  /** 結束遊戲並產生完整最終結算報告 */
  _endGame() {
    this.isGameOver = true;
    this._bumpVersion();
    const report = this.getAnalyticsReport();
    const sortedByMargin = [...report.districts].sort((a, b) => b.pollMargin - a.pollMargin);

    this.finalResults = {
      pollResults: report.pollResults,
      trueResults: report.trueResults,
      districts: report.districts,
      electionNightOrder: sortedByMargin,
      partyStats: report.partyStats,
      efficiencyGapPct: report.efficiencyGapPct,
      winner: report.trueResults.winner,
      isGameTie: report.trueResults.isGameTie,
      ranking: report.trueResults.ranking,
      totalVoidElectoralVotes: report.totalVoidElectoralVotes,
      flipsCount: report.flipsCount,
      swingCount: report.swingCount,
      totalRegions: report.totalRegions
    };
  }

  /** 預覽放下一塊牆後的選舉人票變化 */
  previewMoveDelta(poolIndex, vr, vc, player = this.currentPlayer) {
    if (poolIndex < 0 || poolIndex >= this.candidatePool.length) return null;
    const piece = this.candidatePool[poolIndex];
    const check = canPlaceWall(this.boardState, piece.shape, vr, vc);
    if (!check.valid) return null;

    const currentResults = this.getAnalyticsReport().activeResults;
    const clonedBoard = cloneBoardState(this.boardState);
    applyPlaceWall(clonedBoard, piece.shape, vr, vc, player, 9999);

    const regions = calculateRegions(clonedBoard);
    const nextResults = tallyElectoralVotes(regions, this._cellData(), this.numPlayers, clonedBoard, false, this._tallyOptions());

    const delta = [];
    const confirmedDelta = [];
    for (let p = 0; p < this.numPlayers; p++) {
      delta.push(nextResults.provisionalElectoralVotes[p] - currentResults.provisionalElectoralVotes[p]);
      confirmedDelta.push(nextResults.confirmedElectoralVotes[p] - currentResults.confirmedElectoralVotes[p]);
    }

    return {
      delta,
      confirmedDelta,
      currentVotes: currentResults.provisionalElectoralVotes,
      nextVotes: nextResults.provisionalElectoralVotes,
      currentConfirmedVotes: currentResults.confirmedElectoralVotes,
      nextConfirmedVotes: nextResults.confirmedElectoralVotes,
      currentUnsecuredVotes: currentResults.unsecuredElectoralVotes,
      nextUnsecuredVotes: nextResults.unsecuredElectoralVotes,
      regionDelta: nextResults.regionResults.length - currentResults.regionResults.length
    };
  }
}
