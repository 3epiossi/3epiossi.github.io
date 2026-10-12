/**
 * ⚖️ 五連黑白棋 (Five-in-a-Row Othello) - 核心遊戲引擎 (Game Engine)
 * 遵循單一真相來源 (Single Source of Truth)：棋盤、輪次、公開池子都存在這裡，
 * 並透過對局樹記錄每一手，以支援時光機與分支。
 *
 * 4 組自選：64 顆棋分成 4 組、每組 16 顆，雙方共用；輪到的人自己選要下哪一組（那組還有剩才能選）。
 * 「池子」（pool）沿用舊名字，現在是「每一組還有剩的話，那組下一顆要用的棋」，依組別排好（最多 4 顆）。
 * 選池子裡的哪一顆 = 選哪一組；下完那組換下一顆（同一組的棋都一樣，id 只是用來區分）。
 * hand = 目前選中、準備要下的那顆（介面選擇用；預設是池子第一顆）。
 *
 * 勝負：同色、同一組的五顆連成一線直接獲勝，否則比棋子數（core/five-rules.js）。
 */

import { msg } from "../i18n.js";
import { BLACK, WHITE, MOVE_TYPE } from "./constants.js";
import {
  opp,
  cloneBoard,
  cloneMove,
  createInitialBoard,
  getLegalMoves,
  hasLegalMove,
  applyMoveToBoard,
  isBoardFull,
  posToCoord
} from "./rules.js";
import { GameTree } from "../history/game-tree.js";
import { findFive, fiveScores, groupOf, GROUPS, GROUP_SIZE } from "./five-rules.js";

/** 盤上還沒用到的棋：每一組各自剩下的 id（由小到大） */
export function remainingByGroup(board) {
  const used = new Set();
  for (const row of board) for (const d of row) if (d) used.add(d.id);
  const left = Array.from({ length: GROUPS }, () => []);
  for (let id = 0; id < GROUPS * GROUP_SIZE; id++) if (!used.has(id)) left[groupOf(id)].push(id);
  return left;
}
/** 池子：每一組還有剩的話，那組下一顆要用的棋（依組別排好） */
export function poolOf(board) {
  return remainingByGroup(board).filter(L => L.length).map(L => L[0]);
}

export class GameEngine {
  /**
   * @param {object} options
   * @param {() => number} [options.rng] 亂數來源（測試可注入固定種子）
   */
  constructor(options = {}) {
    this.rng = options.rng || Math.random;
    this.blackPlayerType = options.blackPlayerType || "human";
    this.whitePlayerType = options.whitePlayerType || "cpu";

    this.board = null;
    this.currentTurn = BLACK;
    this.pool = [];     // 公開池子裡的棋 id
    this.selected = null; // 選中準備要下的棋（不在池子裡時視為池子第一顆）
    this.gameOver = false;
    this.lastMove = null;
    this.settlementData = null;
    this.tree = null;
    this.listeners = new Set();

    this.#newPosition();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, payload) {
    if (this.silent) return; // 開新局時一次下完 XOT 的開局步：不通知（不播音效、不畫動畫）
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
      hand: this.hand,
      pool: [...this.pool],
      gameOver: this.gameOver,
      lastMove: this.lastMove ? cloneMove(this.lastMove) : null,
      settlementData: this.settlementData ? { ...this.settlementData } : null,
      blackPlayerType: this.blackPlayerType,
      whitePlayerType: this.whitePlayerType,
      currentNode: this.tree ? this.tree.getCurrentNode() : null
    };
  }

  /** 目前選中準備要下的棋；終局或池子空了是 null */
  get hand() {
    if (this.gameOver || this.pool.length === 0) return null;
    return this.pool.includes(this.selected) ? this.selected : this.pool[0];
  }

  /** 選擇要下的棋（必須在池子裡） */
  selectDisc(id) {
    if (!this.pool.includes(id) || id === this.hand) return false;
    this.selected = id;
    this.notify("SELECTION_CHANGED", { id });
    return true;
  }

  /** 每一組還剩幾顆（依組別：[第 1 組, 第 2 組, …]） */
  groupCounts() {
    return remainingByGroup(this.board).map(L => L.length);
  }

  legalMoves() {
    return this.gameOver ? [] : getLegalMoves(this.board, this.currentTurn);
  }

  findLegalMove(r, c) {
    return this.legalMoves().find(m => m.r === r && m.c === c) || null;
  }

  // 開新局面：標準開局，中間四顆每一組各一顆，位置隨機（initGroups 有給就照它排：createInitialBoard 的順序 D4、E4、D5、E5）
  #newPosition(initGroups = null) {
    const groups = initGroups ? [...initGroups] : Array.from({ length: GROUPS }, (_, g) => g);
    if (!initGroups) for (let i = groups.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [groups[i], groups[j]] = [groups[j], groups[i]];
    }
    let k = 0;
    this.board = createInitialBoard(() => {
      const g = groups[k % groups.length], n = Math.floor(k / groups.length); // 4 組時 n 都是 0：每組的第一顆
      k++;
      return g * GROUP_SIZE + n;
    });
    this.currentTurn = BLACK;
    this.gameOver = false;
    this.lastMove = null;
    this.settlementData = null;
    this.pool = poolOf(this.board);
    this.selected = this.pool[0] ?? null;
    if (this.tree) this.tree.init(this.board, this.currentTurn, this.pool);
    else this.tree = new GameTree(this.board, this.currentTurn, this.pool);
  }

  /**
   * 開新局。opening（XOT 開局，見 core/xot-openings.js）：{ init: 中間四顆的組別, moves: [[格, 組], …] }，
   * 開局步一次下完、記在對局樹上（節點標 actor = "xot"），之後輪到誰就從誰開始。
   * 開局步下不出來（不合法、那組沒棋了）就停在下不出來的前一步。
   */
  resetGame(opening = null) {
    this.#newPosition(opening?.init || null);
    if (opening?.moves?.length) {
      this.silent = true;
      try {
        for (const [sq, g] of opening.moves) {
          const disc = this.pool.find(id => groupOf(id) === g);
          if (disc == null || this.gameOver || !this.executeMove(sq >> 3, sq & 7, disc)) break;
          this.tree.getCurrentNode().actor = "xot";
        }
      } finally { this.silent = false; }
    }
    this.notify("GAME_RESET");
  }

  /**
   * 執行走步：把池子裡的 discId（預設是選中的那顆）下在 (r, c)。朝上的顏色就是下棋者的顏色。
   */
  executeMove(r, c, discId = this.hand) {
    if (this.gameOver || discId == null || !this.pool.includes(discId)) return false;

    // REVIEW 狀態（非分支最新端點）不允許直接落子，須透過「從這裡開始下」建立新分支
    const tip = this.tree.getBranchTipNode();
    const curr = this.tree.getCurrentNode();
    if (curr && tip && curr.id !== tip.id) return false;

    const move = this.findLegalMove(r, c);
    if (!move) return false;

    const player = this.currentTurn;
    const placedId = discId;
    
    this.board = applyMoveToBoard(this.board, move, placedId, player);
    this.lastMove = {
      type: MOVE_TYPE.PLACE, player, r, c, discId: placedId,
      flips: move.flips.map(f => [...f])
    };
    this.pool = poolOf(this.board); // 那一組換下一顆（用完就從池子消失）

    // 連成五連直接獲勝（翻面造成的也算）
    const five = findFive(this.board, player);
    const fiveText = five ? msg("logFive", { v: { $sym: five.value } }) : "";

    const logText = msg("logMove", {
      idx: (curr ? curr.stepIdx : 0) + 1,
      side: msg(player === BLACK ? "sideBlack" : "sideWhite"),
      to: posToCoord(r, c),
      disc: { $disc: placedId },
      n: move.flips.length,
      five: fiveText
    });
    if (five) {
      this.lastMove.five = five;
      this.#finishByFive(player, five, logText);
    } else {
      this.#advance(opp(player), logText, this.lastMove);
    }
    this.notify("MOVE_EXECUTED", { move: this.lastMove, gameOver: this.gameOver });
    if (this.gameOver) this.notify("GAME_OVER", this.settlementData);
    return true;
  }

  /** 雙方目前的分數（每顆 1 分）與棋子數 */
  scores() {
    return { ...fiveScores(this.board, false), ...this.#discCounts() };
  }

  #discCounts() {
    let blackCount = 0, whiteCount = 0;
    for (const row of this.board) for (const d of row) if (d) { if (d.face === BLACK) blackCount++; else whiteCount++; }
    return { blackCount, whiteCount };
  }

  /** 五連獲勝：立刻結束，記錄在對局樹 */
  #finishByFive(player, five, logText) {
    const sc = this.scores();
    this.gameOver = true;
    this.settlementData = {
      ...sc,
      winner: player,
      diff: Math.abs(sc.black - sc.white),
      totalBlack: sc.black,
      totalWhite: sc.white,
      byFive: true,
      five,
      reason: msg("reasonFive", { side: msg(player === BLACK ? "sideBlack" : "sideWhite"), v: { $sym: five.value } })
    };
    this.tree.appendMoveNode({
      turn: this.currentTurn,
      pool: this.pool,
      move: this.lastMove,
      board: this.board,
      gameOver: true,
      settlementData: this.settlementData,
      logText
    });
  }

  /** PASS：輪到對手，池子不變 */
  passTurn() {
    if (this.gameOver) return false;
    const player = this.currentTurn;
    this.lastMove = { type: MOVE_TYPE.PASS, player, flips: [] };

    const logText = msg("logPass", {
      side: msg(player === BLACK ? "sideBlack" : "sideWhite"),
      enemy: msg(player === BLACK ? "sideWhite" : "sideBlack")
    });
    this.#advance(opp(player), logText, this.lastMove);
    this.notify("PASS_EXECUTED", { player, gameOver: this.gameOver });
    if (this.gameOver) this.notify("GAME_OVER", this.settlementData);
    return true;
  }

  // 輪到 next：判斷終局、必要時要求 PASS，並寫入對局樹
  #advance(next, logText, move) {
    let over = false;
    if (isBoardFull(this.board) || (!hasLegalMove(this.board, next) && !hasLegalMove(this.board, opp(next)))) {
      over = true;
    }
    this.selected = this.pool[0] ?? null;
    this.currentTurn = next;
    if (over) {
      this.gameOver = true;
      this.settlementData = this.#settle();
    }

    this.tree.appendMoveNode({
      turn: this.currentTurn,
      pool: this.pool,
      move,
      board: this.board,
      gameOver: this.gameOver,
      settlementData: this.settlementData,
      logText
    });

    if (!over && !hasLegalMove(this.board, this.currentTurn)) {
      this.notify("PASS_REQUIRED", { player: this.currentTurn });
    }
  }

  /** 終局結算：比棋子數，多者勝 */
  #settle() {
    const reason = msg(isBoardFull(this.board) ? "reasonFull" : "reasonNoMoves");
    const sc = this.scores();
    return {
      ...sc, reason, totalBlack: sc.black, totalWhite: sc.white,
      winner: sc.black === sc.white ? 0 : (sc.black > sc.white ? BLACK : WHITE),
      diff: Math.abs(sc.black - sc.white)
    };
  }

  /** 從歷史節點開闢全新分支並跳轉到該節點（唯一建立分支的入口） */
  startFromHere(nodeId, customBranchName = null) {
    const node = this.tree.getNode(nodeId);
    if (!node) return false;

    let name = customBranchName;
    if (!name) {
      let dupe = 0;
      for (const b of this.tree.branches.values()) {
        if (b.name && b.name.k && b.name.p && b.name.p.n === node.stepIdx) dupe++;
      }
      name = dupe === 0
        ? msg("branchFrom", { n: node.stepIdx })
        : msg("branchFromDup", { n: node.stepIdx, dup: dupe + 1 });
    }
    this.tree.createBranchFromNode(nodeId, name);
    this.jumpToNode(nodeId);
    return true;
  }

  /**
   * 下一步，不論是不是在最新局面：
   *   在主線的歷史某一步下 → 從這一步開一條分支（只保留一條分支，舊的分支會被刪掉）
   *   在分支的歷史某一步下 → 這一步之後的分支內容換成新的這一步
   */
  playMove(r, c, discId = this.hand) {
    if (this.gameOver || !this.findLegalMove(r, c) || !this.pool.includes(discId)) return false;
    const tree = this.tree;
    const curr = tree.getCurrentNode();
    const tip = tree.getBranchTipNode();
    if (curr && tip && curr.id !== tip.id) {
      if (tree.activeBranchId === "main") {
        for (const id of [...tree.branches.keys()]) if (id !== "main") tree.deleteBranch(id);
        tree.createBranchFromNode(curr.id, msg("branchFrom", { n: curr.stepIdx }));
      } else {
        tree.truncateAfter(curr.id);
      }
    }
    return this.executeMove(r, c, discId);
  }

  /** 讀回存檔的對局樹（GameTree.toJSON 的結果），停在存檔時看的那一步；格式不對會丟出錯誤，原本的局面不變 */
  restoreTree(data) {
    const tree = GameTree.fromJSON(data);
    this.tree = tree;
    return this.jumpToNode(tree.currentNodeId);
  }

  /** 目前這一步變成最新一步：這條線到這一步設成正式棋譜，之後的棋與分支都刪掉，可以直接接著下 */
  makeCurrentLatest() {
    const curr = this.tree.getCurrentNode();
    if (!curr || curr.gameOver) return false;
    if (!this.tree.promoteLineTo(curr.id)) return false;
    return this.jumpToNode(curr.id);
  }

  /** 目前這條線（主線，或主線到分岔點＋分支）上第 step 步的節點 */
  lineNodeAt(step) {
    return this.tree.getBranchHistory()[step] || null;
  }

  /**
   * 跳到目前這條線的第 step 步。
   * 正在看分支、又退回分岔那一步或更早：分支消失，回到主線。
   */
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

  jumpToNode(nodeId) {
    const node = this.tree.getNode(nodeId);
    if (!node) return false;
    this.tree.currentNodeId = node.id;
    this.board = cloneBoard(node.board);
    this.currentTurn = node.turn;
    this.pool = [...node.pool];
    this.selected = this.pool[0] ?? null;
    this.gameOver = node.gameOver;
    this.lastMove = node.move ? cloneMove(node.move) : null;
    this.settlementData = node.settlementData ? { ...node.settlementData } : null;
    this.notify("STATE_RESTORED", { node });
    return true;
  }
}
