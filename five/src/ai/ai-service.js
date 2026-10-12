/**
 * 🧠 五連黑白棋 - AI 服務層：把引擎（第 6 級與局面分析用 v14，第 2～5 級用 v13）的結果轉成網頁用的格式
 *
 * 網頁的「池子」是每一組下一顆要用的棋（見 core/game-engine.js），選哪一顆 = 選哪一組。
 * v13 回傳「格子 × 組別」的分數（棋子數差的尺度，連成五 = ±WIN）；這裡換成：
 *   - 走法 key = 棋 × 64 + 格（棋 = 池子裡那一組的那顆）
 *   - 分數換成 [-1, 1]：一定贏（連成五、或終盤算到底贏）≥ 0.999，一定輸 ≤ −0.999，其餘 tanh(分數 ÷ SCORE_SCALE)
 *     （勝率條、提示、走法評價再用 ui/eval-bar.js 的校準換成勝率）
 */

import { searchV13, WIN } from "./v13.js";
import { searchV14 } from "./v14.js";
import { groupOf } from "../core/five-rules.js";
import { toSearchBoard, legalMovesSb } from "./search-board.js";

/** 引擎分數 → [-1, 1] 的換算係數（校準見 ui/eval-bar.js）：v13（手寫評估的尺度）、v14（棋子差） */
export const SCORE_SCALE = 40;
export const SCORE_SCALE_V14 = 16; // 棋子差 16 顆 → tanh(1) ≈ 0.76；勝率的校準見 ui/eval-bar.js
const ENGINES = { v13: { search: searchV13, scale: SCORE_SCALE }, v14: { search: searchV14, scale: SCORE_SCALE_V14 } };

/** 引擎的分數（下棋者角度）→ [-1, 1]。exact = 終盤已經算到底：正分就是一定贏 */
export function toUnit(v, exact = false, scale = SCORE_SCALE_V14) {
  if (v > WIN / 2) return 1 - Math.min(0.0009, (WIN - v) * 1e-5); // 越快連成越好
  if (v < -WIN / 2) return -1 + Math.min(0.0009, (WIN + v) * 1e-5);
  if (exact) return v > 0 ? 0.9995 : v < 0 ? -0.9995 : 0;
  return Math.tanh(v / scale);
}

/**
 * 從池子選「棋＋位置」（池子 = 每一組的代表棋）。
 * @returns {{ bestSq:number, disc:number, scores:{sq:number, disc:number, key:number, score:number}[], depth:number, exact:boolean, nodes:number } | null}
 *   scores 由高到低；multiPV 時每一步都是精確分數，否則只有最佳步準
 */
export function searchEngine(board, player, pool, { timeMs = 1000, multiPV = false, maxDepth, params, engine = "v14" } = {}) {
  if (!pool.length) return null;
  const discOf = new Map(pool.map(id => [groupOf(id), id]));
  const E = ENGINES[engine];
  const r = E.search(board, player, groupOf, { timeMs, multiPV, ...(maxDepth != null ? { maxDepth } : {}), ...(params ? { params } : {}) });
  if (!r) return null;
  const scores = (r.scores.length ? r.scores : [{ sq: r.sq, group: r.group, score: r.score }])
    .filter(x => discOf.has(x.group))
    .map(x => { const disc = discOf.get(x.group); return { sq: x.sq, disc, key: disc * 64 + x.sq, score: toUnit(x.score, r.exact, E.scale) }; });
  const disc = discOf.get(r.group) ?? pool[0];
  return { bestSq: r.sq, disc, scores, depth: r.depth, exact: r.exact, nodes: r.nodes };
}

const N = 8;
const toGameMove = (m, player, disc) => ({ r: m.r, c: m.c, player, disc, flips: m.flips.map(j => [Math.floor(j / N), j % N]) });

/**
 * 選出最佳走步（同步版，測試與評測用；網頁用 AiClient 在 Worker 裡算）
 * @returns {{ chosen: object|null, maxScore: number, info?: object }}
 */
export function findBestMoveForCPU(board, player, pool, { timeMs = 1000, maxDepth, params, engine } = {}) {
  const res = searchEngine(board, player, pool, { timeMs, maxDepth, params, engine });
  if (!res) return { chosen: null, maxScore: -Infinity };
  return { chosen: moveFromSquare(board, player, res.bestSq, res.disc), maxScore: res.scores[0]?.score ?? 0, info: res };
}

/** Worker 回傳的最佳格轉成遊戲走步 */
export function moveFromSquare(board, player, sq, disc = null) {
  const m = legalMovesSb(toSearchBoard(board), player).find(x => x.r * N + x.c === sq);
  return m ? toGameMove(m, player, disc) : null;
}
