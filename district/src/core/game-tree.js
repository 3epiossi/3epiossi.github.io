/**
 * 劃區爭霸 (District) - 對局樹與多分支系統。
 * 結構與誰會贏？、五連黑白棋的對局樹相同（分支、從這裡接手、回到歷史任一步），
 * 節點存的是「這一步之後」的完整局面快照（牆、牌袋、手牌、輪到誰、是否終局）。
 * 牆塊順序由種子決定，所以每個快照自己帶著牌袋，分支上抽到的牆就是當時牌袋的下一塊。
 */

export const MAIN = "main";

let idCounter = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export class TreeNode {
  constructor({ id, parentId = null, branchId = MAIN, stepIdx = 0, entry = null, snap }) {
    this.id = id;
    this.parentId = parentId;
    this.branchId = branchId;
    this.stepIdx = stepIdx;
    this.entry = entry;       // 走到這一步的紀錄（place／pass），開局節點是 null
    this.snap = snap;         // 這一步之後的局面快照
    this.children = [];
  }
}

export class GameTree {
  constructor(rootSnap, branchLabel = "主線") {
    this.nodes = new Map();
    this.branches = new Map();
    this.init(rootSnap, branchLabel);
  }

  init(rootSnap, branchLabel = "主線") {
    this.nodes.clear();
    this.branches.clear();
    const root = new TreeNode({ id: "root_0", snap: rootSnap });
    this.nodes.set(root.id, root);
    this.branches.set(MAIN, { id: MAIN, name: branchLabel, forkNodeId: null, forkStepIdx: 0, parentBranchId: null, tipNodeId: root.id });
    this.activeBranchId = MAIN;
    this.currentNodeId = root.id;
  }

  getNode(id) { return this.nodes.get(id); }
  getCurrentNode() { return this.nodes.get(this.currentNodeId); }

  getBranchTipNode(branchId = this.activeBranchId) {
    const branch = this.branches.get(branchId);
    if (branch && this.nodes.has(branch.tipNodeId)) return this.nodes.get(branch.tipNodeId);
    return this.getCurrentNode() || this.nodes.get("root_0");
  }

  /** 在目前節點之後新增一步 */
  appendNode({ entry, snap }) {
    const parent = this.getCurrentNode();
    const node = new TreeNode({
      id: nextId("node"), parentId: parent.id, branchId: this.activeBranchId,
      stepIdx: parent.stepIdx + 1, entry, snap
    });
    this.nodes.set(node.id, node);
    parent.children.push(node.id);
    this.currentNodeId = node.id;
    this.branches.get(this.activeBranchId).tipNodeId = node.id;
    return node;
  }

  /** 由開局到分支端點的完整節點順序 */
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

  createBranchFromNode(forkNodeId, name) {
    const fork = this.nodes.get(forkNodeId);
    if (!fork) return null;
    const id = nextId("branch");
    this.branches.set(id, { id, name, forkNodeId, forkStepIdx: fork.stepIdx, parentBranchId: this.activeBranchId, tipNodeId: forkNodeId });
    this.activeBranchId = id;
    this.currentNodeId = forkNodeId;
    return id;
  }

  /** 刪掉某條分支（只刪屬於這條分支的節點）；正在看的就切回主線 */
  deleteBranch(branchId) {
    if (branchId === MAIN || !this.branches.has(branchId)) return false;
    for (const [id, node] of [...this.nodes]) {
      if (node.branchId !== branchId) continue;
      this.nodes.delete(id);
      const parent = node.parentId && this.nodes.get(node.parentId);
      if (parent) parent.children = parent.children.filter((c) => c !== id);
    }
    this.branches.delete(branchId);
    if (this.activeBranchId === branchId) this.activeBranchId = MAIN;
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

  /** 把目前這條線從開局到 nodeId 設成主線，nodeId 就是最新一步；其他分支與之後的節點都刪掉 */
  promoteLineTo(nodeId) {
    const line = this.getBranchHistory();
    const end = line.findIndex((n) => n.id === nodeId);
    if (end < 0) return false;
    const keep = line.slice(0, end + 1);
    const keepIds = new Set(keep.map((n) => n.id));
    keep.forEach((node, i) => {
      node.branchId = MAIN;
      node.children = i < keep.length - 1 ? [keep[i + 1].id] : [];
    });
    for (const id of [...this.nodes.keys()]) if (!keepIds.has(id)) this.nodes.delete(id);
    for (const id of [...this.branches.keys()]) if (id !== MAIN) this.branches.delete(id);
    this.branches.get(MAIN).tipNodeId = nodeId;
    this.activeBranchId = MAIN;
    this.currentNodeId = nodeId;
    return true;
  }
}
