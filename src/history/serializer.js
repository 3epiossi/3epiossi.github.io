import { tr } from "../i18n.js";
/**
 * 💾 骰子黑白棋 (Dice Othello) - 棋譜序列化、匯入匯出與分享 (Serializer & Share Service)
 */

export function exportGameToJSON(engine) {
  const historyNodes = [];
  for (const node of engine.tree.nodes.values()) {
    historyNodes.push({
      id: node.id,
      parentId: node.parentId,
      branchId: node.branchId,
      stepIdx: node.stepIdx,
      turn: node.turn,
      dice: node.dice,
      isFreePickTurn: node.isFreePickTurn,
      move: node.move,
      board: node.board,
      endgameFilledCells: node.endgameFilledCells,
      gameOver: node.gameOver,
      settlementData: node.settlementData,
      logText: node.logText,
      bookmark: node.bookmark,
      tag: node.tag
    });
  }

  const branches = Array.from(engine.tree.branches.values());

  const data = {
    version: 2,
    rules: "Dice Othello Standard",
    komi: engine.komi,
    gameMode: engine.gameMode,
    blackPlayerType: engine.blackPlayerType,
    whitePlayerType: engine.whitePlayerType,
    blackAlgo: engine.blackAlgo,
    whiteAlgo: engine.whiteAlgo,
    activeBranchId: engine.tree.activeBranchId,
    currentNodeId: engine.tree.currentNodeId,
    branches,
    nodes: historyNodes,
    exportedAt: new Date().toISOString()
  };

  return JSON.stringify(data, null, 2);
}

export function importGameFromJSON(jsonStr, engine) {
  try {
    const data = JSON.parse(jsonStr);
    if (!data || !data.nodes || !Array.isArray(data.nodes)) {
      return { success: false, error: tr("importFail") };
    }

    engine.komi = data.komi != null ? data.komi : 3.5;
    engine.gameMode = data.gameMode || "p_vs_cpu";
    engine.blackPlayerType = data.blackPlayerType || "human";
    engine.whitePlayerType = data.whitePlayerType || "cpu";
    engine.blackAlgo = data.blackAlgo || "v4";
    engine.whiteAlgo = data.whiteAlgo || "v4";

    engine.tree.nodes.clear();
    engine.tree.branches.clear();

    if (data.branches && Array.isArray(data.branches)) {
      for (const b of data.branches) {
        engine.tree.branches.set(b.id, b);
      }
    }

    for (const n of data.nodes) {
      engine.tree.nodes.set(n.id, {
        ...n,
        children: []
      });
    }

    // 重建父子關聯
    for (const n of engine.tree.nodes.values()) {
      if (n.parentId && engine.tree.nodes.has(n.parentId)) {
        engine.tree.nodes.get(n.parentId).children.push(n.id);
      }
    }

    engine.tree.activeBranchId = data.activeBranchId || "main";
    const targetNodeId = data.currentNodeId || data.nodes[data.nodes.length - 1].id;
    engine.jumpToNode(targetNodeId);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 產生便於分享的 URL 參數字串
 */
export function generateShareUrl(engine) {
  try {
    const jsonStr = exportGameToJSON(engine);
    // 壓縮並轉為 base64
    const b64 = btoa(encodeURIComponent(jsonStr));
    const url = new URL(window.location.href);
    url.searchParams.set("game", b64);
    return url.toString();
  } catch (e) {
    return window.location.href;
  }
}

/**
 * 嘗試自 URL 載入分享之棋局
 */
export function tryLoadFromUrl(engine) {
  if (typeof window === "undefined" || !window.location) return false;
  try {
    const url = new URL(window.location.href);
    const gameParam = url.searchParams.get("game");
    if (!gameParam) return false;

    const jsonStr = decodeURIComponent(atob(gameParam));
    const res = importGameFromJSON(jsonStr, engine);
    return res.success;
  } catch (e) {
    return false;
  }
}
