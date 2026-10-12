/**
 * 🎚️ 難度分級：第 2～5 級是 v13 的削弱版，第 6 級是完整的 v13，最高的第 7 級是完整的 v14（v13 換上棋型評估）；
 * 第 6、7 級吃滿設定的思考時間。
 *
 * 削弱的方式，各級自由搭配：
 *   depth  搜尋層數上限（固定層數，棋力不受電腦快慢影響）
 *   exact  剩幾格以內才做終盤精確求解（0 = 不做；省略 = v13 預設 10 格）
 *   eps    每一步有多少機率改走隨機的合法位置、隨機的組別（模擬失誤）
 * 第 1 級（kind: "grab"）只顧五連：任何一組能一步連成五就下，否則隨機挑組別、隨機落子。
 *
 * 每一級都從池子（每一組的代表棋）挑「棋＋位置」，回傳的 disc 是要下的那顆（= 那一組）。
 * 相鄰兩級的勝率目標約 80%，各級的設定由 tests/level-ladder.js 對戰校準（數據見 LEVELS 上方）。
 */

import { getLegalMoves, applyMoveToBoard } from "../core/rules.js";
import { findFive } from "../core/five-rules.js";
import { searchEngine } from "./ai-service.js";
import { V13_PARAMS } from "./v13.js";
import { V14_PARAMS } from "./v14.js";

// 相鄰兩級對戰的實測勝率（上一級贏；tests/level-ladder.js，前 4 手隨機、成對開局；目標約 80%，±5% 以內）：
// 2→1 79%、3→2 75%、4→3 77%、5→4 84%（各 200 局）、6→5 79%（每步 0.5 秒＝預設，100 局；1 秒時 85%，120 局）、
// 7→6 75%（v14 對 v13，各 0.5 秒，120 局）。v14 直接對第 5 級是 97%，差太多，所以完整的 v13 留下來當第 6 級
// v13 每多搜一層棋力差很多（2 層對 1 層 90%），用少量隨機失誤（eps）微調相鄰兩級的差距。
// 試過 4 層一級：它對 3 層＋5% 失誤只贏 73%、完整 v13 對它也只贏 66%，兩邊都不到 80%，所以拿掉，總共 6 級
export const LEVELS = [
  { id: 1, kind: "grab" },                    // 只顧五連
  { id: 2, depth: 1, exact: 0, eps: 0.3 },
  { id: 3, depth: 1, exact: 0 },
  { id: 4, depth: 2, exact: 0, eps: 0.05 },
  { id: 5, depth: 3, exact: 6, eps: 0.02 },
  { id: 6, engine: "v13" },                   // 完整的 v13，吃滿設定的思考時間
  { id: 7, engine: "v14" }                    // 完整的 v14（黑白棋用棋型評估），吃滿設定的思考時間
];

export const MAX_LEVEL = LEVELS.length;
/** 這一級是按時間搜尋（吃滿 AI 思考時間），不是固定層數 */
export const isTimedLevel = (n) => { const c = LEVELS[n - 1]; return !!c && c.kind !== "grab" && !c.depth; };
export const clampLevel = (n) => Math.min(MAX_LEVEL, Math.max(1, Math.round(Number(n)) || MAX_LEVEL));

const pickResult = (sq, disc) => ({ bestSq: sq, disc, scores: [{ sq, disc, key: disc * 64 + sq, score: 0 }], depth: 0, exact: false });

function randomPick(board, player, pool, rng) {
  const moves = getLegalMoves(board, player);
  if (!moves.length || !pool.length) return null;
  const m = moves[Math.floor(rng() * moves.length)];
  return pickResult(m.r * 8 + m.c, pool[Math.floor(rng() * pool.length)]);
}

/**
 * 依難度從池子選「棋＋位置」。回傳 { bestSq, disc, scores, ... }，沒有合法位置時回傳 null。
 * @param {number[]} pool 池子（每一組的代表棋）
 * @param {object} cfg LEVELS 的一項（測試可直接傳自訂設定）
 */
export function searchLevel(board, player, pool, cfg, { timeMs = 1000, rng = Math.random } = {}) {
  if (cfg.kind === "grab") {
    const moves = getLegalMoves(board, player);
    for (const disc of pool) {
      const win = moves.find(m => findFive(applyMoveToBoard(board, m, disc, player), player));
      if (win) return pickResult(win.r * 8 + win.c, disc);
    }
    return randomPick(board, player, pool, rng);
  }
  if (cfg.eps && rng() < cfg.eps) return randomPick(board, player, pool, rng);
  const engine = cfg.engine || "v13", base = engine === "v14" ? V14_PARAMS : V13_PARAMS;
  return searchEngine(board, player, pool, {
    timeMs: cfg.depth ? 600000 : (cfg.time || timeMs),
    maxDepth: cfg.depth,
    engine,
    params: cfg.exact != null ? { ...base, exactEmpties: cfg.exact } : base
  });
}
