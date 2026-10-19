/**
 * 🔍 v6 搜尋引擎（參考 Zebra 的架構）
 *
 * Zebra 做的事                         | 這裡的對應
 * ------------------------------------ | ------------------------------------------------
 * 位元棋盤                             | bitboard.js（hi / lo 兩個 32 位元整數）
 * 迭代加深 + NegaScout (PVS)           | iterate() + nega()，依思考時間決定深度
 * 雜湊表 (Zobrist) 存最佳步與分數界限   | TT_* 型別陣列；另把「手上那顆棋落在哪」也編進雜湊
 * 走法排序：雜湊步、淺層搜尋、          | 雜湊步優先 → 角落 → 落子後對手可下位置最少者優先
 *   fastest-first（終盤）               |
 * 終盤精確求解                         | 剩下 EXACT_EMPTIES 格以內：對每一次抽棋做精確期望值
 *                                      | (expectimax)，因為袋子裡剩哪些棋是確定的
 *
 * 和一般黑白棋不同的兩點：
 * - 每顆棋兩面權重不同：分數是權重和，評估見 eval.js。
 * - 抽棋是機會節點：中盤搜尋時，未來落下的棋以「袋中剩餘棋子的平均權重」代入，
 *   在權重線性加總的前提下這就是期望值，搜尋樹不必展開每種抽法；
 *   只有終盤格數夠少時才逐一展開每一種抽法。
 */

import {
  RH, RL, mobility, flips, setBit, count, squaresOf, popcount
} from "./bitboard.js";
import { evaluate, finalDiff, PARAMS } from "./eval.js";

const BLACK = 1, WHITE = 2;
export const EXACT_EMPTIES = 7;

// ===== Zobrist 雜湊 =====
let seed = 0x9E3779B9;
const rand32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
export const Z1 = new Int32Array(128), Z2 = new Int32Array(128);   // [顏色 0/1][格]
export const H1 = new Int32Array(64), H2 = new Int32Array(64);     // 手上那顆棋落在哪一格
for (let i = 0; i < 128; i++) { Z1[i] = rand32(); Z2[i] = rand32(); }
for (let i = 0; i < 64; i++) { H1[i] = rand32(); H2[i] = rand32(); }
export const SIDE1 = rand32(), SIDE2 = rand32();

// ===== 置換表（v7 也共用這組陣列：兩個引擎不會同時搜尋） =====
const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
export const TT_MASK = TT_SIZE - 1;
export const TT_K2 = new Int32Array(TT_SIZE);
export const TT_DEPTH = new Int8Array(TT_SIZE);
export const TT_FLAG = new Uint8Array(TT_SIZE);
export const TT_SCORE = new Float32Array(TT_SIZE);
export const TT_MOVE = new Int8Array(TT_SIZE);
export const EXACT = 0, LOWER = 1, UPPER = 2;

// 靜態落子順序：角落最好、X 格最差（只用於排序）
export const SQ_ORDER = new Int8Array([
  9, 2, 6, 5, 5, 6, 2, 9,
  2, 0, 3, 3, 3, 3, 0, 2,
  6, 3, 4, 4, 4, 4, 3, 6,
  5, 3, 4, 0, 0, 4, 3, 5,
  5, 3, 4, 0, 0, 4, 3, 5,
  6, 3, 4, 4, 4, 4, 3, 6,
  2, 0, 3, 3, 3, 3, 0, 2,
  9, 2, 6, 5, 5, 6, 2, 9
]);

// ===== 搜尋狀態（模組層級，避免配置） =====
const FB = new Float64Array(64);   // 每格黑面權重
const FW = new Float64Array(64);   // 每格白面權重
let avgB = 4.5, avgW = 4.5;
let deadline = Infinity;
let nodes = 0;
let params = PARAMS;
const ABORT = { abort: true };
const MAX_PLY = 70;
const MOVES = Array.from({ length: MAX_PLY }, () => new Int8Array(32));
const KEYS = Array.from({ length: MAX_PLY }, () => new Float64Array(32));
const NULL_EPS = 0.01;
const sqBuf = [];

// ===== Multi-ProbCut（Zebra 的 probcut.c / midgame.c） =====
// 以淺層搜尋預測深層搜尋：deep ≈ shallow − bias，誤差標準差 sigma。
// 若淺層結果已「幾乎確定」超出 [alpha, beta]，就不做完整的深層搜尋。
// 配對與 Zebra 相同的思路：淺層深度與深層同奇偶，評估偏差較小。
export const MPC_SHALLOW = [0, 0, 0, 1, 2, 1, 2, 3, 4, 3, 4, 5, 6, 5, 6, 7, 8, 7, 8, 9, 10];
// MPC_STATS[深度] = [開局段, 中盤段, 終盤段]，每段 [bias, sigma]；由 tests/mpc-stats.js 統計自我對戰局面而得
export const MPC_STATS = [];
{
  // tests/mpc-stats.js 實測（10 局自我對戰、164 個局面）；9～12 層沒有實測，沿用同樣淺層距離的數據並放寬 15%
  const measured = {
    3: [[0.61, 3.17], [0.14, 5.24], [-1.63, 18.88]],
    4: [[-0.7, 2.52], [0.92, 5.3], [-3.29, 20.61]],
    5: [[0.61, 3.56], [0.02, 9.26], [-2.73, 29.26]],
    6: [[-0.58, 3.37], [1.42, 9.07], [-1.05, 31.2]],
    7: [[-0.61, 2.7], [-1.39, 11.98], [-1.75, 29.63]],
    8: [[-0.25, 2.6], [-0.13, 12.32], [0.98, 27.78]]
  };
  for (const d in measured) MPC_STATS[d] = measured[d];
  for (let d = 9; d < MPC_SHALLOW.length; d++) {
    MPC_STATS[d] = MPC_STATS[d - 2].map(([b, sg]) => [b, Math.round(sg * 115) / 100]);
  }
}
export const MPC_MIN_PLY = 2;      // 根節點附近不做選擇性剪枝（Zebra 的 FULL_WIDTH_DEPTH）
let inMpc = false;

// ===== 歷史啟發式（Zebra 以 advance_move 把好棋往前挪，這裡用歷史分數） =====
const HISTORY = new Int32Array(128);   // [顏色 0/1][格]

export function blackWeight(id) { return (id & 7) + 1; }
export function whiteWeight(id) { return (id >> 3) + 1; }

/** 把 s 與翻面的棋對雜湊做 XOR（color 下棋，flipped 由對手變成 color） */
export function keyAfter(k, Z, color, s, fH, fL) {
  const me = color === BLACK ? 0 : 64, op = color === BLACK ? 64 : 0;
  k ^= Z[me + s];
  while (fL !== 0) { const b = fL & -fL; const q = 31 - Math.clz32(b); k ^= Z[me + q] ^ Z[op + q]; fL ^= b; }
  while (fH !== 0) { const b = fH & -fH; const q = 63 - Math.clz32(b); k ^= Z[me + q] ^ Z[op + q]; fH ^= b; }
  return k;
}

export function insertionSort(moves, keys, n) {
  for (let i = 1; i < n; i++) {
    const m = moves[i], k = keys[i];
    let j = i - 1;
    while (j >= 0 && keys[j] < k) { moves[j + 1] = moves[j]; keys[j + 1] = keys[j]; j--; }
    moves[j + 1] = m; keys[j + 1] = k;
  }
}

/**
 * NegaScout。P = 下棋者（顏色 color），O = 對手。回傳下棋者角度的分數。
 */
function nega(pH, pL, oH, oL, color, depth, alpha, beta, k1, k2, ply) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw ABORT;

  const alphaOrig = alpha;
  const idx = k1 & TT_MASK;
  let ttMove = -1;
  if (TT_K2[idx] === k2 && TT_DEPTH[idx] >= 0) {
    ttMove = TT_MOVE[idx];
    if (TT_DEPTH[idx] >= depth) {
      const sc = TT_SCORE[idx], fl = TT_FLAG[idx];
      if (fl === EXACT) return sc;
      if (fl === LOWER) { if (sc > alpha) alpha = sc; }
      else if (sc < beta) beta = sc;
      if (alpha >= beta) return sc;
    }
  }

  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  const other = color === BLACK ? WHITE : BLACK;
  if ((mH | mL) === 0) {
    mobility(oH, oL, pH, pL);
    if ((RH | RL) === 0) return finalDiff(pH, pL, oH, oL, color, FB, FW);
    return -nega(oH, oL, pH, pL, other, depth, -beta, -alpha, k1 ^ SIDE1, k2 ^ SIDE2, ply + 1);
  }
  if (depth <= 0) return evaluate(pH, pL, oH, oL, color, FB, FW, params);

  // Multi-ProbCut：淺層搜尋已足以判斷這個節點會被剪掉
  if (params.mpc && !inMpc && ply >= MPC_MIN_PLY && depth < MPC_SHALLOW.length && MPC_SHALLOW[depth] > 0 &&
      alpha > -Infinity && beta < Infinity) {
    const st = MPC_STATS[depth];
    const empties = 64 - count(pH | oH, pL | oL);
    // depth >= empties 表示這個節點會直接算到終局：保持精確，不做機率剪枝
    if (st && depth < empties) {
      const [bias, sigma] = st[empties > 40 ? 0 : empties > 20 ? 1 : 2];
      const w = params.mpcT * sigma;
      const shallow = MPC_SHALLOW[depth];
      inMpc = true;
      try {
        const hi = beta + bias + w;
        if (nega(pH, pL, oH, oL, color, shallow, hi - NULL_EPS, hi, k1, k2, ply) >= hi) return beta;
        const lo = alpha + bias - w;
        if (nega(pH, pL, oH, oL, color, shallow, lo, lo + NULL_EPS, k1, k2, ply) <= lo) return alpha;
      } finally {
        inMpc = false;
      }
    }
  }

  // 走法排序
  const moves = MOVES[ply], keys = KEYS[ply];
  const hBase = color === BLACK ? 0 : 64;
  squaresOf(mH, mL, sqBuf);
  const n = sqBuf.length;
  for (let i = 0; i < n; i++) {
    const s = sqBuf[i];
    moves[i] = s;
    let key = SQ_ORDER[s];
    if (params.history) key += Math.min(HISTORY[hBase + s] >> 6, 40);
    if (s === ttMove) key += 1000;
    else if (depth >= 3) {
      flips(pH, pL, oH, oL, s);
      const fH = RH, fL = RL;
      setBit(s);
      // fastest-first：落子後對手能下的位置越少越好
      mobility(oH & ~fH, oL & ~fL, pH | fH | RH, pL | fL | RL);
      key -= 2 * count(RH, RL);
    }
    keys[i] = key;
  }
  insertionSort(moves, keys, n);

  let best = -Infinity, bestMove = -1;
  for (let i = 0; i < n; i++) {
    const s = moves[i];
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL;
    setBit(s);
    const nPH = pH | fH | RH, nPL = pL | fL | RL;
    const nOH = oH & ~fH, nOL = oL & ~fL;
    FB[s] = avgB; FW[s] = avgW;
    const c1 = keyAfter(k1, Z1, color, s, fH, fL) ^ SIDE1;
    const c2 = keyAfter(k2, Z2, color, s, fH, fL) ^ SIDE2;

    let v;
    if (i === 0) {
      v = -nega(nOH, nOL, nPH, nPL, other, depth - 1, -beta, -alpha, c1, c2, ply + 1);
    } else {
      v = -nega(nOH, nOL, nPH, nPL, other, depth - 1, -alpha - NULL_EPS, -alpha, c1, c2, ply + 1);
      if (v > alpha && v < beta) v = -nega(nOH, nOL, nPH, nPL, other, depth - 1, -beta, -alpha, c1, c2, ply + 1);
    }
    if (v > best) { best = v; bestMove = s; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  if (params.history && bestMove >= 0 && best > alphaOrig) HISTORY[hBase + bestMove] += depth * depth;

  TT_K2[idx] = k2;
  TT_DEPTH[idx] = depth;
  TT_SCORE[idx] = best;
  TT_MOVE[idx] = bestMove;
  TT_FLAG[idx] = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
  return best;
}

// ===== 終盤：逐一展開抽棋的精確期望值 =====

/** 輪到 color 抽棋：對袋中每一顆棋取平均 */
function chance(pH, pL, oH, oL, color, bag, n) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw ABORT;
  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  const other = color === BLACK ? WHITE : BLACK;
  if ((mH | mL) === 0) {
    mobility(oH, oL, pH, pL);
    if ((RH | RL) === 0) return finalDiff(pH, pL, oH, oL, color, FB, FW);
    // PASS：抽到的棋放回袋子，由對手重新抽
    return -chance(oH, oL, pH, pL, other, bag, n);
  }
  const moves = squaresOf(mH, mL, []);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const id = bag[i];
    bag[i] = bag[n - 1]; bag[n - 1] = id;          // 把抽到的棋移到尾端，前 n-1 顆就是剩下的袋子
    sum += placeBest(pH, pL, oH, oL, color, moves, blackWeight(id), whiteWeight(id), bag, n - 1);
    bag[n - 1] = bag[i]; bag[i] = id;
  }
  return sum / n;
}

/** 手上拿著 (wb, ww) 這顆棋，選最好的位置 */
function placeBest(pH, pL, oH, oL, color, moves, wb, ww, bag, n) {
  const other = color === BLACK ? WHITE : BLACK;
  let best = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const s = moves[i];
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL;
    setBit(s);
    FB[s] = wb; FW[s] = ww;
    const v = -chance(oH & ~fH, oL & ~fL, pH | fH | RH, pL | fL | RL, other, bag, n);
    if (v > best) best = v;
  }
  return best;
}

/** 袋中剩餘棋子的平均權重（搜尋中未知的落子以此代入） */
function setBagStats(bag) {
  avgB = 4.5; avgW = 4.5;
  if (!bag.length) return;
  let sb = 0, sw = 0;
  for (const id of bag) { sb += blackWeight(id); sw += whiteWeight(id); }
  avgB = sb / bag.length; avgW = sw / bag.length;
}

// ===== 根節點 =====

/**
 * @param {object} o
 * @param {Array}  o.board     遊戲棋盤（{id, face} | null）
 * @param {number} o.player    下棋者顏色
 * @param {number} o.handId    手上那顆棋
 * @param {number[]} o.bag     袋中剩餘棋子（不含手上那顆）
 * @param {number} [o.timeMs]  思考時間
 * @param {number} [o.maxDepth]
 * @param {boolean} [o.multiPV] 每個根節點走法都要精確分數（教練用，較慢）
 * @param {object} [o.params]  評估參數（調校用）
 * @returns {{ bestSq:number, scores:{sq:number, score:number}[], depth:number, exact:boolean, nodes:number, ms:number } | null}
 */
export function searchRoot({
  board, player, handId, bag, timeMs = 1000, maxDepth = 60, multiPV = false, params: p = PARAMS,
  exactEmpties = EXACT_EMPTIES
}) {
  const t0 = Date.now();
  params = p;
  nodes = 0;

  let pH = 0, pL = 0, oH = 0, oL = 0;
  for (let s = 0; s < 64; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    FB[s] = blackWeight(d.id); FW[s] = whiteWeight(d.id);
    const mine = d.face === player;
    if (s < 32) { if (mine) pL |= 1 << s; else oL |= 1 << s; }
    else if (mine) pH |= 1 << (s - 32); else oH |= 1 << (s - 32);
  }
  setBagStats(bag);

  mobility(pH, pL, oH, oL);
  const rootMoves = squaresOf(RH, RL, []);
  if (rootMoves.length === 0) return null;

  const hb = blackWeight(handId), hw = whiteWeight(handId);
  const other = player === BLACK ? WHITE : BLACK;
  const empties = 64 - count(pH | oH, pL | oL);

  const child = (s) => {
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL;
    setBit(s);
    return { s, fH, fL, nPH: pH | fH | RH, nPL: pL | fL | RL, nOH: oH & ~fH, nOL: oL & ~fL };
  };

  // 1) 終盤精確求解：每一次抽棋都展開。超過時間就退回下面的平均棋搜尋
  if (empties <= exactEmpties) {
    deadline = t0 + Math.max(timeMs, 300) * 2;
    const bagArr = bag.slice();
    try {
      const scores = rootMoves.map(s => {
        const c = child(s);
        FB[s] = hb; FW[s] = hw;
        return { sq: s, score: -chance(c.nOH, c.nOL, c.nPH, c.nPL, other, bagArr, bagArr.length) };
      });
      scores.sort((a, b) => b.score - a.score);
      return { bestSq: scores[0].sq, scores, depth: empties, exact: true, chanceExact: true, nodes, ms: Date.now() - t0 };
    } catch (e) {
      if (e !== ABORT) throw e;
      // 復原被打亂的權重：下面重新從棋盤讀
      for (let s = 0; s < 64; s++) {
        const d = board[s >> 3][s & 7];
        if (d) { FB[s] = blackWeight(d.id); FW[s] = whiteWeight(d.id); }
      }
    }
  }

  // 2) 迭代加深 NegaScout
  TT_DEPTH.fill(-1);
  HISTORY.fill(0);
  inMpc = false;
  deadline = Date.now() + timeMs;
  let k1 = 0, k2 = 0;
  for (let s = 0; s < 64; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    const ci = d.face === BLACK ? 0 : 64;
    k1 ^= Z1[ci + s]; k2 ^= Z2[ci + s];
  }

  let order = rootMoves.map(s => ({ sq: s, score: SQ_ORDER[s] }));
  let completed = null, completedDepth = 0;
  const limit = Math.min(maxDepth, empties);

  for (let depth = 1; depth <= limit; depth++) {
    const results = [];
    let alpha = -Infinity;
    try {
      for (let i = 0; i < order.length; i++) {
        const c = child(order[i].sq);
        const s = c.s;
        FB[s] = hb; FW[s] = hw;
        const c1 = keyAfter(k1, Z1, player, s, c.fH, c.fL) ^ SIDE1 ^ H1[s];
        const c2 = keyAfter(k2, Z2, player, s, c.fH, c.fL) ^ SIDE2 ^ H2[s];
        let v;
        if (multiPV || i === 0) {
          v = -nega(c.nOH, c.nOL, c.nPH, c.nPL, other, depth - 1, -Infinity, Infinity, c1, c2, 1);
        } else {
          v = -nega(c.nOH, c.nOL, c.nPH, c.nPL, other, depth - 1, -alpha - NULL_EPS, -alpha, c1, c2, 1);
          if (v > alpha) v = -nega(c.nOH, c.nOL, c.nPH, c.nPL, other, depth - 1, -Infinity, -alpha, c1, c2, 1);
        }
        results.push({ sq: s, score: v });
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      if (e !== ABORT) throw e;
      // 這一層沒跑完：若已跑完的走法中有比上一層最佳步更好的，採用它
      if (completed && results.length) {
        const bestNew = results.reduce((a, b) => (b.score > a.score ? b : a));
        const prevBest = completed[0];
        if (bestNew.sq !== prevBest.sq && results[0].sq === prevBest.sq && bestNew.score > results[0].score) {
          completed = [bestNew, ...completed.filter(x => x.sq !== bestNew.sq)];
        }
      }
      break;
    }
    results.sort((a, b) => b.score - a.score);
    completed = results;
    completedDepth = depth;
    order = results;
    if (Date.now() - t0 > timeMs * 0.45) break; // 下一層大概跑不完，提早停
  }

  if (!completed) completed = order; // 連第一層都沒跑完（極短時間）
  return {
    bestSq: completed[0].sq,
    scores: completed,
    depth: completedDepth,
    exact: completedDepth >= empties,
    nodes,
    ms: Date.now() - t0
  };
}

/**
 * 統計用：在「輪到 player、手上沒有已知的棋」的局面，以平均棋做固定深度的全寬度搜尋（不做 MPC）。
 */
export function probeValue({ board, player, bag, depth, params: p = PARAMS }) {
  params = { ...p, mpc: false };
  let pH = 0, pL = 0, oH = 0, oL = 0, k1 = 0, k2 = 0;
  for (let s = 0; s < 64; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    FB[s] = blackWeight(d.id); FW[s] = whiteWeight(d.id);
    const ci = d.face === BLACK ? 0 : 64;
    k1 ^= Z1[ci + s]; k2 ^= Z2[ci + s];
    const mine = d.face === player;
    if (s < 32) { if (mine) pL |= 1 << s; else oL |= 1 << s; }
    else if (mine) pH |= 1 << (s - 32); else oH |= 1 << (s - 32);
  }
  setBagStats(bag);
  deadline = Infinity;
  TT_DEPTH.fill(-1);
  return nega(pH, pL, oH, oL, player, depth, -Infinity, Infinity, k1, k2, 1);
}

export { popcount };
