/**
 * 🌿 骰子黑白棋 (Dice Othello) - 對局樹與多分支系統 (Game Tree & Multi-Branch System)
 * 統一 Undo / Redo / Branch / Replay / Compare 的核心資料結構
 */

import { msg } from "../i18n.js";
import { cloneBoard, cloneMove } from "../core/rules.js";
import { BLACK, WHITE, MOVE_TYPE } from "../core/constants.js";

export class GameTreeNode {
  constructor({
    id,
    parentId = null,
    branchId = "main",
    stepIdx = 0,
    turn = BLACK,
    dice = null,
    isFreePickTurn = false,
    move = null,
    board,
    endgameFilledCells = [],
    gameOver = false,
    settlementData = null,
    logText = "",
    bookmark = false,
    tag = null,
    createdAt = Date.now()
  }) {
    this.id = id;
    this.parentId = parentId;
    this.branchId = branchId;
    this.stepIdx = stepIdx;
    this.turn = turn;
    this.dice = dice;
    this.isFreePickTurn = isFreePickTurn;
    this.move = move ? cloneMove(move) : null;
    this.board = cloneBoard(board);
    this.endgameFilledCells = Array.isArray(endgameFilledCells) ? [...endgameFilledCells] : Array.from(endgameFilledCells || []);
    this.gameOver = gameOver;
    this.settlementData = settlementData ? { ...settlementData } : null;
    this.logText = logText;
    this.bookmark = bookmark;
    this.tag = tag;
    this.createdAt = createdAt;
    this.children = [];
  }
}

export class GameTree {
  constructor(initialBoard) {
    this.nodes = new Map();
    this.branches = new Map();
    this.activeBranchId = "main";
    this.currentNodeId = null;

    this.init(initialBoard);
  }

  init(initialBoard) {
    this.nodes.clear();
    this.branches.clear();

    const rootNode = new GameTreeNode({
      id: "root_0",
      parentId: null,
      branchId: "main",
      stepIdx: 0,
      turn: BLACK,
      dice: null,
      isFreePickTurn: false,
      move: null,
      board: initialBoard,
      logText: msg("logRoot")
    });

    this.nodes.set(rootNode.id, rootNode);
    this.branches.set("main", {
      id: "main",
      name: msg("branchMain"),
      forkNodeId: null,
      forkStepIdx: 0,
      parentBranchId: null,
      tipNodeId: rootNode.id,
      createdAt: Date.now()
    });

    this.activeBranchId = "main";
    this.currentNodeId = rootNode.id;
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  getCurrentNode() {
    return this.nodes.get(this.currentNodeId);
  }

  /**
   * 取得指定分支之最新端點節點 (Tip Node)
   */
  getBranchTipNode(branchId = this.activeBranchId) {
    const branch = this.branches.get(branchId);
    if (!branch) return this.getCurrentNode() || this.nodes.get("root_0");

    if (branch.tipNodeId && this.nodes.has(branch.tipNodeId)) {
      return this.nodes.get(branch.tipNodeId);
    }

    // 搜尋屬於該分支的最大 stepIdx 節點
    let deepest = null;
    let maxStep = -1;
    for (const node of this.nodes.values()) {
      if (node.branchId === branchId && node.stepIdx > maxStep) {
        deepest = node;
        maxStep = node.stepIdx;
      }
    }
    return deepest || this.getCurrentNode() || this.nodes.get("root_0");
  }

  /**
   * 新增一步行動節點
   */
  appendMoveNode({
    turn,
    dice,
    isFreePickTurn,
    move,
    board,
    endgameFilledCells,
    gameOver,
    settlementData,
    logText
  }) {
    const parentNode = this.getCurrentNode();
    const nextStepIdx = parentNode ? parentNode.stepIdx + 1 : 1;
    const newNodeId = `node_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const newNode = new GameTreeNode({
      id: newNodeId,
      parentId: parentNode ? parentNode.id : null,
      branchId: this.activeBranchId,
      stepIdx: nextStepIdx,
      turn,
      dice,
      isFreePickTurn,
      move,
      board,
      endgameFilledCells,
      gameOver,
      settlementData,
      logText
    });

    this.nodes.set(newNodeId, newNode);
    if (parentNode) {
      parentNode.children.push(newNodeId);
    }
    this.currentNodeId = newNodeId;

    // 更新當前分支最新端點
    const branch = this.branches.get(this.activeBranchId);
    if (branch) {
      branch.tipNodeId = newNodeId;
    }

    return newNode;
  }

  /**
   * 取得指定分支之所有順序節點 (由根節點至該分支之最新端點節點，完整保留歷程)
   */
  getBranchHistory(branchId = this.activeBranchId) {
    const tip = this.getBranchTipNode(branchId);
    if (!tip) return [];

    const list = [];
    let curr = tip;
    while (curr) {
      list.unshift(curr);
      if (!curr.parentId) break;
      curr = this.nodes.get(curr.parentId);
    }

    return list;
  }

  /**
   * 從特定步數/節點分叉出新分支 (Branching)
   */
  createBranchFromNode(forkNodeId, branchName) {
    const forkNode = this.nodes.get(forkNodeId);
    if (!forkNode) return null;

    const newBranchId = `branch_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const name = branchName || msg("branchDefault", { n: forkNode.stepIdx });

    this.branches.set(newBranchId, {
      id: newBranchId,
      name,
      forkNodeId,
      forkStepIdx: forkNode.stepIdx,
      parentBranchId: this.activeBranchId,
      tipNodeId: forkNodeId,
      createdAt: Date.now()
    });

    this.activeBranchId = newBranchId;
    this.currentNodeId = forkNodeId;

    return {
      branchId: newBranchId,
      name,
      forkNode
    };
  }

  /**
   * 切換活躍分支
   */
  switchBranch(branchId, targetNodeId = null) {
    if (!this.branches.has(branchId)) return false;
    this.activeBranchId = branchId;

    if (targetNodeId && this.nodes.has(targetNodeId)) {
      this.currentNodeId = targetNodeId;
      return true;
    }

    const tip = this.getBranchTipNode(branchId);
    if (tip) {
      this.currentNodeId = tip.id;
    }
    return true;
  }

  /**
   * 比較兩條分支的走法與結算差異 (Branch Compare)
   */
  compareBranches(branchAId, branchBId) {
    const branchA = this.branches.get(branchAId);
    const branchB = this.branches.get(branchBId);
    if (!branchA || !branchB) return null;

    const nodesA = [];
    const nodesB = [];

    for (const n of this.nodes.values()) {
      if (n.branchId === branchAId) nodesA.push(n);
      if (n.branchId === branchBId) nodesB.push(n);
    }
    nodesA.sort((a, b) => a.stepIdx - b.stepIdx);
    nodesB.sort((a, b) => a.stepIdx - b.stepIdx);

    const leafA = nodesA[nodesA.length - 1];
    const leafB = nodesB[nodesB.length - 1];

    return {
      branchA: {
        id: branchAId,
        name: branchA.name,
        length: nodesA.length,
        finalSettlement: leafA ? leafA.settlementData : null
      },
      branchB: {
        id: branchBId,
        name: branchB.name,
        length: nodesB.length,
        finalSettlement: leafB ? leafB.settlementData : null
      },
      divergeStep: Math.min(branchA.forkStepIdx || 0, branchB.forkStepIdx || 0)
    };
  }

  toggleBookmark(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.bookmark = !node.bookmark;
      return node.bookmark;
    }
    return false;
  }

  setTag(nodeId, tag) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.tag = tag;
      return true;
    }
    return false;
  }
}
