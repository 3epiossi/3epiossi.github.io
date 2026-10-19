/**
 * 誰會贏？ 核心遊戲引擎：單一真相來源（局面、骰子、對局樹），規則在 rules.js，電腦思考在 engine/。
 *
 * 流程：輪到的一方擲骰（rollDice；點數由種子決定，見 dice.js）→ 走一步（executeMove）或沒步可走（passTurn，
 * 對手下一手免擲骰、自選 1～6）。在歷史某一步直接下棋或指定點數，會從那一步開一條分支（只保留一條分支，同五連黑白棋）。
 */

import { msg } from "../i18n.js";
import { N, EMPTY, BLACK, WHITE, MOVE_TYPE, DEFAULT_KOMI } from "./constants.js";
import {
  opp, inBounds, createInitialBoard, cloneBoard, cloneMove, getLegalMovesForPiece, getAllLegalMoves,
  getAllDiceLegalMovesForPiece, applyMoveToBoard, canCaptureEver, fillTerritoryRule1Rule2, calculateSettlement, posToCoord
} from "./rules.js";
import { seededDie, randomSeed } from "./dice.js";
import { GameTree } from "../history/game-tree.js";

const NO_SELECTION = () => ({ spawns: [], captures: [] });

export class GameEngine {
  constructor(options = {}) {
    this.komi = options.komi != null ? options.komi : DEFAULT_KOMI;
    this.listeners = new Set();
    this.tree = new GameTree(createInitialBoard(), options.seed != null ? options.seed >>> 0 : randomSeed());
    this.resetState(createInitialBoard());
  }

  resetState(board) {
    this.board = board;
    this.currentTurn = BLACK;
    this.diceValue = null;
    this.isFreePickTurn = false;
    this.gameOver = false;
    this.selectedCell = null;
    this.legalMovesForSelected = NO_SELECTION();
    this.lastMove = null;
    this.endgameFilledCells = new Set();
    this.settlementData = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, payload) {
    for (const listener of this.listeners) {
      try { listener(event, payload, this.getState()); } catch (err) { console.error("GameEngine listener error:", err); }
    }
  }

  get seed() { return this.tree.seed; }

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
      currentNode: this.tree.getCurrentNode()
    };
  }

  /** 目前這一手（對局樹的步數）：擲骰用它決定點數 */
  get step() { return this.tree.getCurrentNode()?.stepIdx ?? 0; }

  /** 目前局面、目前點數下的所有合法走法（點數還沒定的自選回合是全部點數） */
  legalMoves() {
    if (this.gameOver) return [];
    const out = [];
    if (this.diceValue != null) {
      const m = getAllLegalMoves(this.board, this.currentTurn, this.diceValue);
      for (const x of m.spawns.concat(m.captures)) out.push({ ...x, usedDiceVal: this.diceValue });
    } else if (this.isFreePickTurn) {
      for (let d = 1; d <= 6; d++) {
        const m = getAllLegalMoves(this.board, this.currentTurn, d);
        for (const x of m.spawns.concat(m.captures)) out.push({ ...x, usedDiceVal: d });
      }
    }
    return out;
  }

  /** 這個點數有沒有合法走法 */
  hasMoveFor(d) {
    const m = getAllLegalMoves(this.board, this.currentTurn, d);
    return m.spawns.length > 0 || m.captures.length > 0;
  }

  /**
   * 擲骰或指定點數。沒指定時，點數由（種子、目前步數）決定，所以重播與分支都一致。
   * 沒有合法走法時送出 PASS_REQUIRED。
   */
  rollDice(specifiedVal = null) {
    if (this.gameOver) return false;
    const val = specifiedVal != null ? Math.max(1, Math.min(6, Math.round(Number(specifiedVal)))) : seededDie(this.tree.seed, this.step);
    this.diceValue = val;
    this.selectedCell = null;
    this.legalMovesForSelected = NO_SELECTION();
    const hasMove = this.hasMoveFor(val);
    this.notify("DICE_ROLLED", { diceValue: val, hasMove });
    if (!hasMove) this.notify("PASS_REQUIRED", { player: this.currentTurn, diceValue: val });
    return true;
  }

  /** 目前是不是最新一步（不是的話，下棋或指定點數會開分支） */
  isAtTip() {
    const tip = this.tree.getBranchTipNode(), curr = this.tree.getCurrentNode();
    return !curr || !tip || curr.id === tip.id;
  }

  /** 在歷史某一步要改下別的：主線上開一條分支（舊分支刪掉），分支上就把這一步之後換掉 */
  branchHere() {
    const tree = this.tree, curr = tree.getCurrentNode();
    if (tree.activeBranchId === "main") {
      for (const id of [...tree.branches.keys()]) if (id !== "main") tree.deleteBranch(id);
      tree.createBranchFromNode(curr.id, msg("branchFrom", { n: curr.stepIdx }));
    } else {
      tree.truncateAfter(curr.id);
    }
  }

  /**
   * 研究模式指定點數（「如果當時擲出 6 呢？」）。
   * 最新一步：等於指定這一手的點數；歷史某一步：這一手原本的點數不一樣就開分支，一樣就不動。
   */
  chooseDie(val) {
    if (this.gameOver) return false;
    if (!this.isAtTip()) {
      const next = this.tree.getBranchHistory()[this.step + 1];
      if (next && next.dice === val && !this.isFreePickTurn) { this.diceValue = val; this.notify("DICE_ROLLED", { diceValue: val, hasMove: this.hasMoveFor(val) }); return true; }
      this.branchHere();
    }
    return this.rollDice(val);
  }

  selectPiece(r, c) {
    if (this.gameOver) return false;
    if (!inBounds(r, c)) return false;
    if (this.board[r][c] !== this.currentTurn) {
      this.selectedCell = null;
      this.legalMovesForSelected = NO_SELECTION();
      this.notify("SELECTION_CLEARED");
      return false;
    }
    this.selectedCell = { r, c };
    if (this.isFreePickTurn && this.diceValue == null) {
      this.legalMovesForSelected = getAllDiceLegalMovesForPiece(this.board, r, c, this.currentTurn);
    } else if (this.diceValue != null) {
      this.legalMovesForSelected = getLegalMovesForPiece(this.board, r, c, this.currentTurn, this.diceValue);
    } else {
      this.legalMovesForSelected = NO_SELECTION();
    }
    this.notify("PIECE_SELECTED", { cell: { r, c }, legalMoves: this.legalMovesForSelected });
    return true;
  }

  /** 對局樹記錄與事件：每一手都經過這裡 */
  record(node, event, payload) {
    this.tree.appendMoveNode(node);
    this.notify(event, payload);
  }

  /** 執行走步（生子或吃子）。在歷史某一步執行會開分支。 */
  executeMove(move) {
    if (this.gameOver || !move) return false;
    if (!this.isAtTip()) this.branchHere();

    const player = this.currentTurn;
    const fromR = move.fromR != null ? move.fromR : move.from.r;
    const fromC = move.fromC != null ? move.fromC : move.from.c;
    const toR = move.toR != null ? move.toR : move.to.r;
    const toC = move.toC != null ? move.toC : move.to.c;
    if (move.usedDiceVal) this.diceValue = move.usedDiceVal;
    const usedDice = this.diceValue;
    const wasFree = this.isFreePickTurn;

    this.board = applyMoveToBoard(this.board, move, player);
    this.lastMove = { ...move, fromR, fromC, toR, toC, player, dice: usedDice };
    this.selectedCell = null;
    this.legalMovesForSelected = NO_SELECTION();

    const enemy = opp(player);
    let enemyCount = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.board[r][c] === enemy) enemyCount++;

    const actionText = msg(move.type === MOVE_TYPE.CAPTURE ? "logCapture" : "logSpawn", { to: posToCoord(toR, toC) });
    const logText = msg("logMove", {
      idx: this.step + 1,
      side: msg(player === BLACK ? "sideBlack" : "sideWhite"),
      dice: usedDice || "?",
      from: posToCoord(fromR, fromC),
      to: posToCoord(toR, toC),
      action: actionText
    });

    const base = { dice: usedDice, move: this.lastMove, logText };
    if (enemyCount === 0) {
      // 敵方全滅：立即終局（距離相同的空格歸落子方）
      this.resolveEndgame(msg("reasonAnnihilate", { side: msg(enemy === BLACK ? "black" : "white") }));
      this.record({ ...base, turn: this.currentTurn, isFreePickTurn: false, board: this.board, endgameFilledCells: this.endgameFilledCells, gameOver: true, settlementData: this.settlementData },
        "MOVE_EXECUTED", { move: this.lastMove, gameOver: true, wasFree });
      return true;
    }

    this.currentTurn = enemy;
    this.diceValue = null;
    this.isFreePickTurn = false;

    if (!canCaptureEver(this.board)) {
      this.resolveEndgame(msg("reasonNatural"));
      this.record({ ...base, turn: this.currentTurn, isFreePickTurn: false, board: this.board, endgameFilledCells: this.endgameFilledCells, gameOver: true, settlementData: this.settlementData },
        "MOVE_EXECUTED", { move: this.lastMove, gameOver: true, wasFree });
      return true;
    }

    this.record({ ...base, turn: this.currentTurn, isFreePickTurn: false, board: this.board, endgameFilledCells: this.endgameFilledCells, gameOver: false, settlementData: null },
      "MOVE_EXECUTED", { move: this.lastMove, gameOver: false, wasFree });
    return true;
  }

  /** 沒有合法走法：PASS，對手下一手免擲骰、自選點數（1～6） */
  passTurn() {
    if (this.gameOver) return false;
    if (!this.isAtTip()) this.branchHere();
    const player = this.currentTurn, enemy = opp(player);
    const diceStr = this.diceValue != null ? msg("steps", { n: this.diceValue }) : msg("noSteps");
    const logText = msg("logPass", {
      side: msg(player === BLACK ? "sideBlack" : "sideWhite"), dice: diceStr, enemy: msg(enemy === BLACK ? "black" : "white")
    });
    const usedDice = this.diceValue;
    const wasFree = this.isFreePickTurn;
    this.selectedCell = null;
    this.legalMovesForSelected = NO_SELECTION();
    this.diceValue = null;
    this.currentTurn = enemy;
    this.isFreePickTurn = true;
    this.lastMove = null;
    // 盤面沒變，canCaptureEver 仍是真。但雙方連續都沒有任何走法（自選點數也沒有）時規則會無限 PASS 下去：直接結算
    const anyMove = (side) => { for (let d = 1; d <= 6; d++) { const m = getAllLegalMoves(this.board, side, d); if (m.spawns.length || m.captures.length) return true; } return false; };
    const stuck = wasFree && !anyMove(player) && !anyMove(enemy);
    const over = !canCaptureEver(this.board) || stuck;
    if (over) this.resolveEndgame(msg("reasonNatural"));
    this.record({
      turn: this.currentTurn, dice: usedDice, isFreePickTurn: true, move: null, board: this.board,
      endgameFilledCells: this.endgameFilledCells, gameOver: over, settlementData: over ? this.settlementData : null, logText
    }, "PASS_EXECUTED", { player, gameOver: over });
    return true;
  }

  /** 終局勢力填滿與結算 */
  resolveEndgame(reason = msg("reasonDefault")) {
    this.gameOver = true;
    const { filledBoard, filledCount, newlyFilled } = fillTerritoryRule1Rule2(this.board, this.currentTurn);
    this.board = filledBoard;
    this.endgameFilledCells = newlyFilled;
    this.settlementData = { ...calculateSettlement(this.board, this.komi), reason, filledCount };
    this.notify("GAME_OVER", this.settlementData);
    return this.settlementData;
  }

  /** 開新局。seed 省略就抽新的；board 可給自訂開局盤面（自由排盤）；先手固定黑方 */
  resetGame({ seed = null, board = null } = {}) {
    const b = board ? cloneBoard(board) : createInitialBoard();
    this.resetState(cloneBoard(b));
    this.tree.init(b, seed != null ? seed >>> 0 : randomSeed());
    this.notify("GAME_RESET");
  }

  /** 讀回存檔或匯入的對局樹，停在存檔時看的那一步；格式不對會丟出錯誤，原本的局面不變 */
  restoreTree(data) {
    this.tree = GameTree.fromJSON(data);
    return this.jumpToNode(this.tree.currentNodeId);
  }

  /** 目前這一步變成最新一步：這條線到這一步設成正式棋譜，之後的棋與分支都刪掉 */
  makeCurrentLatest() {
    const curr = this.tree.getCurrentNode();
    if (!curr || curr.gameOver) return false;
    if (!this.tree.promoteLineTo(curr.id)) return false;
    return this.jumpToNode(curr.id);
  }

  lineNodeAt(step) { return this.tree.getBranchHistory()[step] || null; }

  /** 跳到目前這條線的第 step 步；正在看分支又退回分岔那一步或更早，分支消失、回到主線 */
  goToStep(step) {
    const tree = this.tree;
    const branch = tree.branches.get(tree.activeBranchId);
    if (tree.activeBranchId !== "main" && branch && step <= branch.forkStepIdx) {
      tree.deleteBranch(tree.activeBranchId);
      tree.activeBranchId = "main";
    }
    const node = this.lineNodeAt(step);
    return node ? this.jumpToNode(node.id) : false;
  }

  /**
   * 跳到某個節點。node.dice 是走到這個節點的那一手用的點數（上一手玩家的），
   * 這個節點的「擲骰」點數要看這條線上的下一手；最新一步還沒擲骰，diceValue 是 null。
   */
  jumpToNode(nodeId) {
    const node = this.tree.getNode(nodeId);
    if (!node) return false;
    this.tree.currentNodeId = node.id;
    this.board = cloneBoard(node.board);
    this.currentTurn = node.turn;
    this.isFreePickTurn = node.isFreePickTurn;
    const line = this.tree.getBranchHistory();
    const idx = line.findIndex(n => n.id === node.id);
    const next = idx >= 0 && idx + 1 < line.length ? line[idx + 1] : null;
    this.diceValue = next ? next.dice : null;
    this.gameOver = node.gameOver;
    this.lastMove = node.move ? cloneMove(node.move) : null;
    this.endgameFilledCells = new Set(node.endgameFilledCells);
    this.settlementData = node.settlementData ? { ...node.settlementData } : null;
    this.selectedCell = null;
    this.legalMovesForSelected = NO_SELECTION();
    this.notify("STATE_RESTORED", { node });
    return true;
  }

  /** 棋盤上雙方的棋數 */
  scores() {
    let black = 0, white = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (this.board[r][c] === BLACK) black++; else if (this.board[r][c] === WHITE) white++;
    }
    return { black, white };
  }
}
