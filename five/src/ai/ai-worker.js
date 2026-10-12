/**
 * 🧵 搜尋專用的 Web Worker（CPU 選步，依難度）：深度搜尋要花一秒左右，放在背景執行緒才不會卡住畫面。
 * 只回傳格子與分數；翻面資訊與教練說明（需要語系）由主執行緒補上。
 */
import { searchLevel, LEVELS, clampLevel } from "./levels.js";
import { searchEngine } from "./ai-service.js";

self.onmessage = (e) => {
  const { id, board, player, pool, timeMs, multiPV, level } = e.data;
  let result = null;
  try {
    // level 有值 = CPU 下棋（依難度）；沒有 = 教練／局面分析（完整的 v13，可要求每一步的精確分數）
    const r = level != null
      ? searchLevel(board, player, pool, LEVELS[clampLevel(level) - 1], { timeMs })
      : searchEngine(board, player, pool, { timeMs, multiPV });
    if (r) result = { bestSq: r.bestSq, disc: r.disc, scores: r.scores, depth: r.depth, exact: r.exact, nodes: r.nodes };
  } catch (err) {
    console.error("v13 worker error:", err);
  }
  self.postMessage({ id, result });
};
