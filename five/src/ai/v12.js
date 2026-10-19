/**
 * v12：「N 組自選」規則的通用引擎（4 組連五、4 組連六用；連幾顆、幾組跟著規則變體）。
 *
 * 載入前要先設定規則變體（core/five-rules.js），例如 4 組連六：
 *   globalThis.FIVE_RULES_VARIANT = { len: 6, match: "group", groups: 4 };
 *
 *   1. 能直接連成 → 直接連（每個合法位置 × 每一組，下下看）
 *   2. 其餘 → v9 的搜尋核心：根節點每一組各搜一次（思考時間平分）
 *      deep = true：搜尋深處也當成「想要哪一組就拿得到」（自選規則本來就是這樣）；
 *      false 是 v9 原本的作法：深處的組別當成從棋袋隨機抽（4 組時只有 1/4 機率拿到想要的組，會低估連線）
 * 終盤（剩 5 格以內）由 v9 精確計算。v10 的位元棋盤只支援 2 組，這裡不用。
 */
import { searchPoolV9 } from "./v9.js";
import { V9_PLAIN_PARAMS } from "./v9/search.js";
import { findFive, FIVE } from "../core/five-rules.js";
import { applyMoveToBoard, getLegalMoves } from "../core/rules.js";

/**
 * 調參（tests/g2-arena.js，4 組，對 v9，每步 0.3 秒，各 40 局；誤差約 ±15%，見 docs/two-group-rule.md）
 *   連五：deep 61%、deep + 不打折對手連線 55%、v9 原本的作法 53% → 用 deep
 *   連六：deep 44%、deep + 不打折對手連線 55%、v9 原本的作法 49% → 用 deep + 不打折
 */
export const V12_PARAMS = FIVE >= 6
  ? { v9: { ...V9_PLAIN_PARAMS, oppFiveTrust: 1 }, deep: true }
  : { v9: V9_PLAIN_PARAMS, deep: true };

/**
 * @param {number[]} reps 每一組的代表棋 id（還有剩的組別才放）
 * @returns {{ sq:number, disc:number, depth:number, stage:"win"|"search" } | null}
 */
export function searchV12(board, player, reps, { timeMs = 1000, params = V12_PARAMS } = {}) {
  const moves = getLegalMoves(board, player);
  if (!moves.length || !reps.length) return null;
  for (const m of moves) for (const d of reps) {
    if (findFive(applyMoveToBoard(board, m, d, player), player)) return { sq: m.r * 8 + m.c, disc: d, depth: 1, stage: "win" };
  }
  const r = searchPoolV9(board, player, reps, { timeMs, poolSize: 64, params: params.v9, deep: params.deep });
  return { sq: r.bestSq, disc: r.disc, depth: r.depth, stage: "search" };
}
