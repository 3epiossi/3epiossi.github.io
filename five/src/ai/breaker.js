/**
 * 🧱 破壞者引擎：用黑白棋的方法贏，盡量不讓盤上出現連線（規則實驗用，見 tests/breaker-selfplay.js、tests/rule-variants.js）。
 *
 *   選格子：Zebra 式的黑白棋搜尋——v9 關掉所有連線判斷（params.five = false），每顆 1 分，只比棋子數。
 *   選棋（或分組規則的組別），依序比，越小越好：
 *     ① 跟周圍 8 格的棋有共同文字（分組規則：同一組）的有幾顆
 *     ② 經過這格的最長連線（同一直線上連續、有共同文字的棋，不分顏色）有幾顆
 *     ③ 下完後盤上的連線分數（三算 1、四算 2）
 *     還是平手就隨機挑（不要固定偏向某一組）。
 *   takeWin = true 時，能直接連成獲勝就連（像真人一樣不放過）；false 時完全不主動連線，只量「躲不掉」的連線。
 *
 * 規則（連幾顆、共同符號或同一組）跟著 core/five-rules.js 的規則變體走。
 */
import { searchPoolV9 } from "./v9.js";
import { V9_PLAIN_PARAMS } from "./v9/search.js";
import { findThreatGroups, findFive, numberMask } from "../core/five-rules.js";
import { applyMoveToBoard, getLegalMoves } from "../core/rules.js";

const OTHELLO_ONLY = { ...V9_PLAIN_PARAMS, five: false };
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** 盤上的連線分數：三算 1、四算 2（不分顏色，跟棋盤上畫的一樣） */
export function lineScore(board) {
  let s = 0;
  for (const g of findThreatGroups(board)) s += g.kind === 4 ? 2 : 1;
  return s;
}

/** 周圍 8 格裡，跟 disc 有共同文字（分組規則：同一組）的棋有幾顆 */
export function sameNeighbors(board, sq, disc) {
  const r = sq >> 3, c = sq & 7, m = numberMask(disc);
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const d = board[r + dr]?.[c + dc];
    if (d && (numberMask(d.id) & m)) n++;
  }
  return n;
}

/** 把 disc 放在 sq：經過這格的最長連線（同一直線上連續、全部有共同文字的棋，不分顏色）有幾顆 */
export function longestRun(board, sq, disc) {
  const r = sq >> 3, c = sq & 7;
  let best = 1;
  for (const [dr, dc] of DIRS) {
    let m = numberMask(disc), len = 1;
    for (const s of [1, -1]) {
      for (let k = 1; ; k++) {
        const d = board[r + s * k * dr]?.[c + s * k * dc];
        if (!d || !(m & numberMask(d.id))) break;
        m &= numberMask(d.id); len++;
      }
    }
    best = Math.max(best, len);
  }
  return best;
}

/**
 * 破壞者下一步。choices = 可以下的棋（池子裡的棋；自選組別規則是每組還有剩的代表棋）。
 * @returns {{ sq:number, disc:number } | null}
 */
export function breakerMove(board, player, choices, { timeMs = 300, rng = Math.random, takeWin = true } = {}) {
  // 選格子只看黑白棋：用哪顆棋都一樣，只搜一顆省時間
  const r = searchPoolV9(board, player, [choices[0]], { timeMs, params: OTHELLO_ONLY });
  if (!r) return null;
  return { sq: r.bestSq, disc: breakerDiscFor(board, player, r.bestSq, choices, { rng, takeWin }) };
}

/** 格子已經決定（sq）：破壞者挑哪顆棋（或哪一組）。規則見檔案開頭 */
export function breakerDiscFor(board, player, sq, choices, { rng = Math.random, takeWin = true } = {}) {
  const mv = getLegalMoves(board, player).find(x => x.r * 8 + x.c === sq);
  let best = null, ties = 0;
  for (const d of choices) {
    const nb = applyMoveToBoard(board, mv, d, player);
    if (takeWin && findFive(nb, player)) return d;
    const key = [sameNeighbors(board, sq, d), longestRun(board, sq, d), lineScore(nb)];
    const cmp = !best ? -1 : key[0] - best.key[0] || key[1] - best.key[1] || key[2] - best.key[2];
    if (cmp < 0) { best = { disc: d, key }; ties = 1; }
    else if (cmp === 0 && rng() < 1 / ++ties) best = { disc: d, key }; // 平手：每個一樣機率
  }
  return best.disc;
}
