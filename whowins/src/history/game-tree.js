/**
 * 誰會贏？ 對局樹與多分支系統。
 * 節點是「這一步之後」的完整局面（棋盤、輪到誰、是不是自選點數回合）；
 * dice = 走出這一步時用的點數（PASS 節點記的是沒走成的那個點數）。
 * 結構與五連黑白棋的對局樹相同（分支、從這裡接手、存檔），多了骰子與種子。
 */

import { msg } from "../i18n.js";
import { cloneBoard, cloneMove } from "../core/rules.js";
import { BLACK } from "../core/constants.js";

export class GameTreeNode {
  constructor({
    id, parentId = null, branchId = "main", stepIdx = 0, turn = BLACK, dice = null, isFreePickTurn = false,
    move = null, board, endgameFilledCells = [], gameOver = false, settlementData = null, logText = "",
    tag = null, createdAt = Date.now()
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
    this.tag = tag;
    this.createdAt = createdAt;
    this.children = [];
  }
}

let idCounter = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export class GameTree {
  constructor(initialBoard, seed = 0) {
    this.nodes = new Map();
    this.branches = new Map();
    this.activeBranchId = "main";
    this.currentNodeId = null;
    this.seed = seed >>> 0;
    this.init(initialBoard, seed);
  }

  init(initialBoard, seed = this.seed) {
    this.nodes.clear();
    this.branches.clear();
    this.seed = seed >>> 0;
    const root = new GameTreeNode({ id: "root_0", stepIdx: 0, turn: BLACK, board: initialBoard, logText: msg("logRoot") });
    this.nodes.set(root.id, root);
    this.branches.set("main", {
      id: "main", name: msg("branchMain"), forkNodeId: null, forkStepIdx: 0, parentBranchId: null,
      tipNodeId: root.id, createdAt: Date.now()
    });
    this.activeBranchId = "main";
    this.currentNodeId = root.id;
  }

  getNode(nodeId) { return this.nodes.get(nodeId); }
  getCurrentNode() { return this.nodes.get(this.currentNodeId); }

  getBranchTipNode(branchId = this.activeBranchId) {
    const branch = this.branches.get(branchId);
    if (!branch) return this.getCurrentNode() || this.nodes.get("root_0");
    if (branch.tipNodeId && this.nodes.has(branch.tipNodeId)) return this.nodes.get(branch.tipNodeId);
    return this.getCurrentNode() || this.nodes.get("root_0");
  }

  /** 在目前節點之後新增一步 */
  appendMoveNode({ turn, dice, isFreePickTurn, move, board, endgameFilledCells, gameOver, settlementData, logText }) {
    const parent = this.getCurrentNode();
    const node = new GameTreeNode({
      id: nextId("node"), parentId: parent ? parent.id : null, branchId: this.activeBranchId,
      stepIdx: parent ? parent.stepIdx + 1 : 1,
      turn, dice, isFreePickTurn, move, board, endgameFilledCells, gameOver, settlementData, logText
    });
    this.nodes.set(node.id, node);
    if (parent) parent.children.push(node.id);
    this.currentNodeId = node.id;
    const branch = this.branches.get(this.activeBranchId);
    if (branch) branch.tipNodeId = node.id;
    return node;
  }

  /** 由根節點到分支端點的完整順序節點 */
  getBranchHistory(branchId = this.activeBranchId) {
    const list = [];
    let curr = this.getBranchTipNode(branchId);
    while (curr) {
      list.unshift(curr);
      if (!curr.parentId) break;
      curr = this.nodes.get(curr.parentId);
    }
    return list;
  }

  createBranchFromNode(forkNodeId, branchName) {
    const forkNode = this.nodes.get(forkNodeId);
    if (!forkNode) return null;
    const id = nextId("branch");
    const name = branchName || msg("branchFrom", { n: forkNode.stepIdx });
    this.branches.set(id, {
      id, name, forkNodeId, forkStepIdx: forkNode.stepIdx, parentBranchId: this.activeBranchId,
      tipNodeId: forkNodeId, createdAt: Date.now()
    });
    this.activeBranchId = id;
    this.currentNodeId = forkNodeId;
    return { branchId: id, name, forkNode };
  }

  /** 刪掉某條分支（只刪屬於這條分支的節點）；正在看的就切回主線 */
  deleteBranch(branchId) {
    if (branchId === "main" || !this.branches.has(branchId)) return false;
    for (const [id, node] of [...this.nodes]) {
      if (node.branchId !== branchId) continue;
      this.nodes.delete(id);
      const parent = node.parentId && this.nodes.get(node.parentId);
      if (parent) parent.children = parent.children.filter(c => c !== id);
    }
    this.branches.delete(branchId);
    if (this.activeBranchId === branchId) this.activeBranchId = "main";
    return true;
  }

  /** 把目前分支在 nodeId 之後的節點刪掉（在分支中途改下別步時用），分支端點改成 nodeId */
  truncateAfter(nodeId) {
    const branchId = this.activeBranchId;
    const drop = (id) => {
      const node = this.nodes.get(id);
      if (!node) return;
      for (const c of node.children) drop(c);
      this.nodes.delete(id);
    };
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    const keep = [];
    for (const c of node.children) {
      if (this.nodes.get(c)?.branchId === branchId) drop(c); else keep.push(c);
    }
    node.children = keep;
    const branch = this.branches.get(branchId);
    if (branch) branch.tipNodeId = nodeId;
    return true;
  }

  /** 把目前這條線（主線，或主線到分岔點加分支）從開局到 nodeId 設成主線，nodeId 就是最新一步 */
  promoteLineTo(nodeId) {
    const line = this.getBranchHistory();
    const end = line.findIndex(n => n.id === nodeId);
    if (end < 0) return false;
    const keep = line.slice(0, end + 1);
    const keepIds = new Set(keep.map(n => n.id));
    keep.forEach((node, i) => {
      node.branchId = "main";
      node.children = i < keep.length - 1 ? [keep[i + 1].id] : [];
    });
    for (const id of [...this.nodes.keys()]) if (!keepIds.has(id)) this.nodes.delete(id);
    for (const id of [...this.branches.keys()]) if (id !== "main") this.branches.delete(id);
    const main = this.branches.get("main");
    if (main) main.tipNodeId = nodeId;
    this.activeBranchId = "main";
    this.currentNodeId = nodeId;
    return true;
  }

  /** 存檔用：整棵樹（含分支、種子）轉成可以 JSON.stringify 的物件。棋盤壓成 8 個字串；app 加的欄位（actor、mark…）照原樣保留 */
  toJSON() {
    const pack = (b) => b.map(row => row.join(""));
    return {
      v: 1,
      seed: this.seed,
      nodes: [...this.nodes.values()].map(n => ({ ...n, board: pack(n.board) })),
      branches: [...this.branches.values()],
      activeBranchId: this.activeBranchId,
      currentNodeId: this.currentNodeId
    };
  }

  /** 讀回 toJSON 存的樹；格式不對就丟出錯誤 */
  static fromJSON(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.branches)) throw new Error("bad tree data");
    const unpack = (rows) => rows.map(s => [...s].map(Number));
    const tree = Object.create(GameTree.prototype);
    tree.nodes = new Map();
    tree.branches = new Map();
    tree.seed = (data.seed ?? 0) >>> 0;
    for (const raw of data.nodes) {
      const { children, board, ...rest } = raw;
      const node = new GameTreeNode({ ...rest, board: unpack(board) });
      Object.assign(node, rest, { board: node.board, move: node.move, endgameFilledCells: node.endgameFilledCells });
      node.children = [...children];
      tree.nodes.set(node.id, node);
    }
    for (const b of data.branches) tree.branches.set(b.id, { ...b });
    tree.activeBranchId = data.activeBranchId;
    tree.currentNodeId = data.currentNodeId;
    if (!tree.nodes.has("root_0") || !tree.nodes.has(tree.currentNodeId) || !tree.branches.has("main") || !tree.branches.has(tree.activeBranchId)) {
      throw new Error("bad tree data");
    }
    return tree;
  }

  switchBranch(branchId, targetNodeId = null) {
    if (!this.branches.has(branchId)) return false;
    this.activeBranchId = branchId;
    if (targetNodeId && this.nodes.has(targetNodeId)) { this.currentNodeId = targetNodeId; return true; }
    const tip = this.getBranchTipNode(branchId);
    if (tip) this.currentNodeId = tip.id;
    return true;
  }
}
