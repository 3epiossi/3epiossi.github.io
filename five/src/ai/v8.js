/**
 * v8（五連模式）：v6 的黑白棋搜尋 + 五子棋的成五／威脅判斷。細節見 ./v8/search.js。
 */
import { remainingBag } from "../core/rules.js";
import { searchRootV8, V8_PLAIN_PARAMS } from "./v8/search.js";
import { V6_DEFAULT_TIME } from "./v6.js";
import { numberMask } from "../core/five-rules.js";

export function searchV8(board, player, handId, { timeMs = V6_DEFAULT_TIME, multiPV = false, maxDepth, params = V8_PLAIN_PARAMS, exactEmpties, pool = null } = {}) {
  const all = remainingBag(board, handId);
  let bag = all;
  // 池子規則：池子裡的棋是已知的，不算在隨機的袋子裡（終盤精確計算用）；
  // 搜尋深處「之後可能拿到哪些棋」的機率仍以全部未上盤的棋估計（池子裡的棋之後也拿得到）
  if (pool) {
    const held = new Set([...(pool.rest || []), ...(pool.opp || [])]);
    bag = bag.filter(id => !held.has(id));
  }
  return searchRootV8({ board, player, handId, bag, statBag: all, timeMs, multiPV, maxDepth, params, pool, ...(exactEmpties != null ? { exactEmpties } : {}) });
}

/**
 * 公開池子規則：池子裡每一種棋（數字集合相同的只算一次）各搜尋一次，合併成「棋＋位置」的候選。
 * 思考時間平均分給每一種棋。
 * @returns {{ bestSq, disc, scores: {sq, disc, key, score}[], depth, exact, chanceExact } | null}
 *   key = disc × 64 + sq（同一格配不同的棋是不同的走法）
 *
 * AI 教練的「預先計算」（CPU 選好棋、還沒落子時，先替下一個局面算）用到兩個選項：
 *   poolSize：池子實際有幾顆。預先計算時只知道 3 顆，第 4 顆（之後補進來的）當作袋子裡的隨機棋
 *   only：只搜這幾顆棋（局面出現後，只剩新補的那顆要算；其他棋的對手模型仍用整個池子）
 */
export function searchPoolV8(board, player, pool, { timeMs = V6_DEFAULT_TIME, multiPV = false, maxDepth, params = V8_PLAIN_PARAMS, exactEmpties, poolSize, only } = {}) {
  const discs = only ? distinctDiscs(only) : distinctDiscs(pool);
  if (!discs.length) return null;
  const share = Math.max(30, Math.floor(timeMs / discs.length));
  const scores = [];
  let depth = Infinity, exact = true, chanceExact = true, nodes = 0;
  for (const disc of discs) {
    const rest = pool.slice();
    if (rest.includes(disc)) rest.splice(rest.indexOf(disc), 1);
    const r = searchV8(board, player, disc, {
      timeMs: share, multiPV, maxDepth, params,
      exactEmpties: Math.min(exactEmpties ?? POOL_EXACT_EMPTIES, POOL_EXACT_EMPTIES),
      pool: { n: poolSize ?? pool.length, mode: "shared", rest, deep: false }
    });
    if (!r) return null; // 沒有合法位置（與用哪顆棋無關）
    for (const x of r.scores) scores.push({ sq: x.sq, disc, key: disc * 64 + x.sq, score: x.score });
    depth = Math.min(depth, r.depth);
    nodes += r.nodes || 0;
    exact = exact && r.exact;
    chanceExact = chanceExact && !!r.chanceExact;
  }
  scores.sort((a, b) => b.score - a.score);
  return {
    bestSq: scores[0].sq, disc: scores[0].disc, scores,
    depth, exact, chanceExact, nodes
  };
}

/** 池子規則的終盤精確計算很花時間（每一種棋 × 每一格 × 每一種補棋），只在剩這麼多格以內做 */
export const POOL_EXACT_EMPTIES = 5;

/** 池子裡數字集合不同的棋（相同的效果一樣，只留第一顆） */
export function distinctDiscs(pool) {
  const seen = new Set(), out = [];
  for (const id of pool) {
    const m = numberMask(id);
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(id);
  }
  return out;
}
