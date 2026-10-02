/**
 * 🎲 骰子黑白棋 (Dice Othello) - 核心遊戲引擎 (Game Engine)
 * 遵循單一真相來源 (Single Source of Truth) 與規則純邏輯獨立原則
 */

import { msg } from "../i18n.js";
import {
  BOARD_SIZE,
  N,
  PLAYER,
  EMPTY,
  BLACK,
  WHITE,
  MOVE_TYPE,
  GAME_MODE,
  DEFAULT_KOMI
} from "./constants.js";
import {
  opp,
  inBounds,
  createInitialBoard,
  cloneBoard,
  cloneMove,
  getLegalMovesForPiece,
  getAllLegalMoves,
  getAllDiceLegalMovesForPiece,
  applyMoveToBoard,
  canCaptureEver,
  fillTerritoryRule1Rule2,
  calculateSettlement,
  posToCoord
} from "./rules.js";
import { GameTree } from "../history/game-tree.js";

export class GameEngine {
  constructor(options = {}) {
    this.komi = options.komi != null ? options.komi : DEFAULT_KOMI;
    this.gameMode = options.gameMode || GAME_MODE.PVC;
    this.blackPlayerType = options.blackPlayerType || "human";
    this.whitePlayerType = options.whitePlayerType || "cpu";
    this.blackAlgo = options.blackAlgo || "v4";
    this.whiteAlgo = options.whiteAlgo || "v4";

    this.board = createInitialBoard();
    this.currentTurn = BLACK;
    this.diceValue = null;
    this.isFreePickTurn = false;
    this.gameOver = false;
    this.selectedCell = null;
    this.legalMovesForSelected = { spawns: [], captures: [] };
    this.lastMove = null;
    this.endgameFilledCells = new Set();
    this.settlementData = null;

    this.tree = new GameTree(this.board);
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload, this.getState());
      } catch (err) {
        console.error("GameEngine listener error:", err);
      }
    }
  }

  getState() {
    return {
      board: cloneBoard(this.board),
      currentTurn: this.currentTurn,
      diceValue: this.diceValue,
      isFreePickTurn: this.isFreePickTurn,
      gameOver: this.gameOver,
      komi: this.komi,
      selectedCell: this.selectedCell ? { ...this.selectedCell } : null,
      legalMovesForSelected: { ...this.legalMovesForSelected },
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      endgameFilledCells: new Set(this.endgameFilledCells),
      settlementData: this.settlementData ? { ...this.settlementData } : null,
      gameMode: this.gameMode,
      blackPlayerType: this.blackPlayerType,
      whitePlayerType: this.whitePlayerType,
      blackAlgo: this.blackAlgo,
      whiteAlgo: this.whiteAlgo,
      currentNode: this.tree.getCurrentNode()
    };
  }

  isCurrentPlayerCPU() {
    return this.currentTurn === BLACK
      ? this.blackPlayerType === "cpu"
      : this.whitePlayerType === "cpu";
  }

  /**
   * 嚴格檢查人類玩家當前是否允許控制/擲骰子 (防止 CPU 回合被人類干擾)
   */
  canControlDice() {
    if (this.gameOver) return false;
    if (this.isCurrentPlayerCPU()) return false;
    return true;
  }

  /**
   * 擲骰子或指定點數
   */
  rollDice(specifiedVal = null, force = false) {
    if (!force && !this.canControlDice()) return false;

    let val = specifiedVal;
    if (val == null) {
      val = Math.floor(Math.random() * 6) + 1;
    }
    val = Math.max(1, Math.min(6, Number(val)));

    this.diceValue = val;
    this.selectedCell = null;
    this.legalMovesForSelected = { spawns: [], captures: [] };

    // 檢查是否有合法走法
    const allLegals = getAllLegalMoves(this.board, this.currentTurn, this.diceValue);
    const hasMove = allLegals.spawns.length > 0 || allLegals.captures.length > 0;

    this.notify("DICE_ROLLED", { diceValue: this.diceValue, hasMove });

    if (!hasMove) {
      // 無合法走法，直接 PASS
      this.notify("PASS_REQUIRED", { player: this.currentTurn, diceValue: this.diceValue });
    }

    return true;
  }

  /**
   * 選擇盤上一顆己方棋子
   */
  selectPiece(r, c) {
    if (this.gameOver) return false;
    if (!inBounds(r, c)) return false;
    if (this.board[r][c] !== this.currentTurn) {
      this.selectedCell = null;
      this.legalMovesForSelected = { spawns: [], captures: [] };
      this.notify("SELECTION_CLEARED");
      return false;
    }

    this.selectedCell = { r, c };

    if (this.isFreePickTurn && this.diceValue == null) {
      // 特權自選模式：提供 1~6 步所有可能走法
      this.legalMovesForSelected = getAllDiceLegalMovesForPiece(this.board, r, c, this.currentTurn);
    } else if (this.diceValue != null) {
      this.legalMovesForSelected = getLegalMovesForPiece(this.board, r, c, this.currentTurn, this.diceValue);
    } else {
      this.legalMovesForSelected = { spawns: [], captures: [] };
    }

    this.notify("PIECE_SELECTED", {
      cell: { r, c },
      legalMoves: this.legalMovesForSelected
    });
    return true;
  }

  /**
   * 執行走步 (生子或吃子)
   */
  executeMove(move) {
    if (this.gameOver || !move) return false;

    // 保護：REVIEW 狀態（非分支最新端點）不允許直接落子，須透過「從這裡開始下」建立新分支
    const tipNode = this.tree.getBranchTipNode();
    const currNode = this.tree.getCurrentNode();
    if (currNode && tipNode && currNode.id !== tipNode.id) {
      return false;
    }

    const player = this.currentTurn;
    const fromR = move.fromR != null ? move.fromR : move.from.r;
    const fromC = move.fromC != null ? move.fromC : move.from.c;
    const toR = move.toR != null ? move.toR : move.to.r;
    const toC = move.toC != null ? move.toC : move.to.c;

    // 若使用帶有特定點數之走法，同步更新骰值
    if (move.usedDiceVal) {
      this.diceValue = move.usedDiceVal;
    }
    const usedDice = this.diceValue;

    // 套用走法至棋盤
    this.board = applyMoveToBoard(this.board, move, player);
    this.lastMove = { ...move, fromR, fromC, toR, toC, player };
    this.selectedCell = null;
    this.legalMovesForSelected = { spawns: [], captures: [] };

    // 檢查敵方是否全滅
    const enemy = opp(player);
    let enemyCount = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.board[r][c] === enemy) enemyCount++;
      }
    }

    const actionText = msg(move.type === MOVE_TYPE.CAPTURE ? "logCapture" : "logSpawn", { to: posToCoord(toR, toC) });
    const logText = msg("logMove", {
      idx: this.tree.getCurrentNode() ? this.tree.getCurrentNode().stepIdx + 1 : 1,
      side: msg(player === BLACK ? "sideBlack" : "sideWhite"),
      dice: usedDice || "?",
      from: posToCoord(fromR, fromC),
      to: posToCoord(toR, toC),
      action: actionText
    });

    if (enemyCount === 0) {
      // 敵方全滅，立即終局
      this.resolveEndgame(msg("reasonAnnihilate", { side: msg(enemy === BLACK ? "black" : "white") }));
      this.tree.appendMoveNode({
        turn: this.currentTurn,
        dice: usedDice,
        isFreePickTurn: false,
        move: this.lastMove,
        board: this.board,
        endgameFilledCells: this.endgameFilledCells,
        gameOver: this.gameOver,
        settlementData: this.settlementData,
        logText
      });
      this.notify("MOVE_EXECUTED", { move: this.lastMove, gameOver: true });
      return true;
    }

    // 輪替回合
    this.currentTurn = enemy;
    this.diceValue = null;
    this.isFreePickTurn = false;

    // 檢查是否已無互相吃子之幾何可能性 (自然終局)
    if (!canCaptureEver(this.board)) {
      this.resolveEndgame(msg("reasonNatural"));
      this.tree.appendMoveNode({
        turn: this.currentTurn,
        dice: usedDice,
        isFreePickTurn: false,
        move: this.lastMove,
        board: this.board,
        endgameFilledCells: this.endgameFilledCells,
        gameOver: this.gameOver,
        settlementData: this.settlementData,
        logText
      });
      this.notify("MOVE_EXECUTED", { move: this.lastMove, gameOver: true });
      return true;
    }

    this.tree.appendMoveNode({
      turn: this.currentTurn,
      dice: usedDice,
      isFreePickTurn: false,
      move: this.lastMove,
      board: this.board,
      endgameFilledCells: this.endgameFilledCells,
      gameOver: this.gameOver,
      settlementData: null,
      logText
    });

    this.notify("MOVE_EXECUTED", { move: this.lastMove, gameOver: false });
    return true;
  }

  /**
   * 從歷史節點開闢全新分支並跳轉至該節點 (唯一的建立分支進入點)
   */
  startFromHere(nodeId, customBranchName = null) {
    const node = this.tree.getNode(nodeId);
    if (!node) return false;

    let branchName = customBranchName;
    if (!branchName) {
      // 樹狀圖會顯示父子關係，名稱只需記錄分叉手數；重複時加序號
      let dupeCount = 0;
      for (const b of this.tree.branches.values()) {
        if (b.name && b.name.k && b.name.p && b.name.p.n === node.stepIdx) dupeCount++;
      }
      branchName = dupeCount === 0
        ? msg("branchFrom", { n: node.stepIdx })
        : msg("branchFromDup", { n: node.stepIdx, dup: dupeCount + 1 });
    }

    this.tree.createBranchFromNode(nodeId, branchName);
    this.jumpToNode(nodeId);
    return true;
  }

  /**
   * PASS 跳過本回合 (對手獲得自選點數特權)
   */
  passTurn() {
    if (this.gameOver) return false;

    const player = this.currentTurn;
    const enemy = opp(player);
    const diceStr = this.diceValue != null ? msg("steps", { n: this.diceValue }) : msg("noSteps");
    const logText = msg("logPass", {
      side: msg(player === BLACK ? "sideBlack" : "sideWhite"),
      dice: diceStr,
      enemy: msg(enemy === BLACK ? "black" : "white")
    });

    const usedDice = this.diceValue;
    this.selectedCell = null;
    this.legalMovesForSelected = { spawns: [], captures: [] };
    this.diceValue = null;
    this.currentTurn = enemy;
    this.isFreePickTurn = true; // 對手享有自選點數特權

    if (!canCaptureEver(this.board)) {
      this.resolveEndgame(msg("reasonNatural"));
      this.tree.appendMoveNode({
        turn: this.currentTurn,
        dice: usedDice,
        isFreePickTurn: true,
        move: null,
        board: this.board,
        endgameFilledCells: this.endgameFilledCells,
        gameOver: this.gameOver,
        settlementData: this.settlementData,
        logText
      });
      this.notify("PASS_EXECUTED", { player, gameOver: true });
      return true;
    }

    this.tree.appendMoveNode({
      turn: this.currentTurn,
      dice: usedDice,
      isFreePickTurn: true,
      move: null,
      board: this.board,
      endgameFilledCells: this.endgameFilledCells,
      gameOver: false,
      settlementData: null,
      logText
    });

    this.notify("PASS_EXECUTED", { player, gameOver: false });
    return true;
  }

  /**
   * 終局勢力填滿與結算
   */
  resolveEndgame(reason = msg("reasonDefault")) {
    this.gameOver = true;
    const { filledBoard, filledCount, newlyFilled } = fillTerritoryRule1Rule2(this.board, this.currentTurn);
    this.board = filledBoard;
    this.endgameFilledCells = newlyFilled;

    this.settlementData = {
      ...calculateSettlement(this.board, this.komi),
      reason,
      filledCount
    };

    this.notify("GAME_OVER", this.settlementData);
    return this.settlementData;
  }

  /**
   * 重設遊戲 / 重新開局
   */
  resetGame() {
    this.board = createInitialBoard();
    this.currentTurn = BLACK;
    this.diceValue = null;
    this.isFreePickTurn = false;
    this.gameOver = false;
    this.selectedCell = null;
    this.legalMovesForSelected = { spawns: [], captures: [] };
    this.lastMove = null;
    this.endgameFilledCells.clear();
    this.settlementData = null;

    this.tree.init(this.board);
    this.notify("GAME_RESET");
  }

  /**
   * 跳轉至對局樹中的特定節點
   */
  jumpToNode(nodeId) {
    const node = this.tree.getNode(nodeId);
    if (!node) return false;

    this.tree.currentNodeId = node.id;
    this.board = cloneBoard(node.board);
    this.currentTurn = node.turn;
    this.isFreePickTurn = node.isFreePickTurn;

    // node.dice 是「上一手玩家」擲出的骰子，不是當前玩家的。
    // 從當前分支的完整歷史找到本節點的下一步（覆蓋分叉前的共用節點也能正確處理）；
    // 若當前分支尚無下一步（新分支），退而求其次用任意子節點保留歷史骰子訊息。
    const branchHistory = this.tree.getBranchHistory();
    const currIdxInHistory = branchHistory.findIndex(n => n.id === node.id);
    let nextNode = currIdxInHistory >= 0 && currIdxInHistory + 1 < branchHistory.length
      ? branchHistory[currIdxInHistory + 1]
      : null;
    if (!nextNode) {
      nextNode = node.children.map(id => this.tree.getNode(id)).find(n => n != null) || null;
    }
    this.diceValue = nextNode ? nextNode.dice : null;
    this.gameOver = node.gameOver;
    this.lastMove = node.move ? cloneMove(node.move) : null;
    this.endgameFilledCells = new Set(node.endgameFilledCells);
    this.settlementData = node.settlementData ? { ...node.settlementData } : null;
    this.selectedCell = null;
    this.legalMovesForSelected = { spawns: [], captures: [] };

    this.notify("STATE_RESTORED", { node });
    return true;
  }
}
