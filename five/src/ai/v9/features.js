/**
 * v9（規則可變的 v8，見 ./search.js）。以下是 v8 原本的說明：
 * 🧠 v8 學習型評估：局面特徵
 *
 * 評估函數 = 依剩餘空格分成 6 個階段，每個階段一組線性權重（邏輯回歸），輸出下棋者的勝率。
 * 權重由自我對戰的棋局訓練（tests/train-eval.js），這是 Zebra / Logistello 的作法：
 * 大量局面 → 記錄最後輸贏 → 回歸找出最能預測勝負的特徵組合。
 *
 * 特徵都從「輪到下棋的一方（P）」看，數值多半是「己方 − 對手」：
 *   v6 評估值：v6 調好的黑白棋評估（每顆 1 分），讓回歸學「各階段該多信任它」，而不是從零學起
 *   黑白棋：棋子數差、穩定子差、行動力差、邊界子差、角落、X 格、C 格、奇偶
 *   五連：雙方在「仍有共同符號」的五連窗口中佔 2／3／4 格的數量，以及「四缺一且下一手可下」的直接威脅
 */

import { mobility, neighbors, count, RH, RL } from "../v6/bitboard.js";
import { stableCounts, evaluate as v6Evaluate, PARAMS as V6_PARAMS } from "../v6/eval.js";
import { FIVE_WINDOWS, FIVE, numberMask } from "../../core/five-rules.js";

// v9：窗口長度跟著規則（FIVE，現行規則 5）。威脅特徵用「還差幾顆」對應到五連的同一級：
// 四連的「差 1 顆」＝五連的「四」、「差 2 顆」＝「三」，所以 v8 學到的權重在 v9 裡意義不變。
const SHIFT = 5 - FIVE; // 窗口裡已佔 a 格 → 相當於五連的 a + SHIFT 格

export const FEATURE_NAMES = [
  "bias", "v6Eval", "discDiff", "stableDiff", "mobilityDiff", "frontierDiff", "cornerDiff", "xSquareDiff", "cSquareDiff", "parity",
  "five2Diff", "five3Diff", "five4Diff", "threatMine", "threatTheirs"
];
export const NF = FEATURE_NAMES.length;
export const PHASES = 6;
/** 剩餘空格 → 階段（0 = 開局 … 5 = 終盤） */
export const phaseOf = (empties) => Math.min(PHASES - 1, Math.max(0, Math.floor((60 - empties) / 10)));

// 五連窗口
const NW = FIVE_WINDOWS.length;
const WSQ = new Int8Array(NW * FIVE);
const WH = new Int32Array(NW), WL = new Int32Array(NW);
FIVE_WINDOWS.forEach((cells, w) => {
  let h = 0, l = 0;
  cells.forEach(([r, c], k) => {
    const s = r * 8 + c;
    WSQ[w * FIVE + k] = s;
    if (s < 32) l |= 1 << s; else h |= 1 << (s - 32);
  });
  WH[w] = h; WL[w] = l;
});
const popcount = (x) => {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24);
};
const CORNER_BITS = { h: (1 << 24) | (1 << 31), l: 1 | (1 << 7) };            // A1 H1 A8 H8
const X_SQ = [[9, 0], [14, 7], [49, 56], [54, 63]];                              // [X 格, 對應角落]
const C_SQ = [[1, 0], [8, 0], [6, 7], [15, 7], [48, 56], [57, 56], [55, 63], [62, 63]];
const bit = (h, l, s) => (s < 32 ? (l >>> s) & 1 : (h >>> (s - 32)) & 1);

const ONES = new Float64Array(64).fill(1); // 五連模式：每顆 1 分

/** 數字未知的棋（搜尋中的平均棋）在五連特徵裡打的折 */
const UNKNOWN_FACTOR = 0.3;

/**
 * 計算特徵向量（寫入 out，長度 NF）。
 * NM / KNOWN：每格棋子的符號集合與是否已知（v8 搜尋的狀態；離線訓練時全部已知）。
 */
export function extractFeatures(pH, pL, oH, oL, NM, KNOWN, out) {
  const occH = pH | oH, occL = pL | oL;
  const empties = 64 - count(occH, occL);
  const eH = ~occH, eL = ~occL;

  out[0] = 1;
  out[1] = v6Evaluate(pH, pL, oH, oL, 1, ONES, ONES, V6_PARAMS);
  out[2] = count(pH, pL) - count(oH, oL);
  const st = stableCounts(pH, pL, oH, oL);
  out[3] = st.mine - st.theirs;
  mobility(pH, pL, oH, oL);
  const myMovesH = RH, myMovesL = RL;
  const mP = count(RH, RL);
  mobility(oH, oL, pH, pL);
  const opMovesH = RH, opMovesL = RL;
  const mO = count(RH, RL);
  out[4] = mP - mO;
  neighbors(pH, pL);
  const fP = count(RH & eH, RL & eL);
  neighbors(oH, oL);
  const fO = count(RH & eH, RL & eL);
  out[5] = fO - fP;
  out[6] = count(pH & CORNER_BITS.h, pL & CORNER_BITS.l) - count(oH & CORNER_BITS.h, oL & CORNER_BITS.l);
  let x = 0, c = 0;
  for (const [sq, corner] of X_SQ) {
    if (bit(occH, occL, corner)) continue;
    x += bit(pH, pL, sq) - bit(oH, oL, sq);
  }
  for (const [sq, corner] of C_SQ) {
    if (bit(occH, occL, corner)) continue;
    c += bit(pH, pL, sq) - bit(oH, oL, sq);
  }
  out[7] = x; out[8] = c;
  out[9] = empties & 1 ? 1 : -1;

  // 五連特徵
  let f2 = 0, f3 = 0, f4 = 0, tMine = 0, tTheirs = 0;
  for (let w = 0; w < NW; w++) {
    const b = w * FIVE;
    let m = 0xFF, unknown = 0;
    for (let k = 0; k < FIVE; k++) {
      const q = WSQ[b + k];
      if (!bit(occH, occL, q)) continue;
      if (KNOWN[q]) m &= NM[q]; else unknown++;
    }
    if (!m) continue;
    const a0 = popcount(pH & WH[w]) + popcount(pL & WL[w]);
    const o0 = popcount(oH & WH[w]) + popcount(oL & WL[w]);
    if (a0 + o0 >= FIVE) continue;
    const a = a0 ? a0 + SHIFT : 0, o = o0 ? o0 + SHIFT : 0; // 換成五連的同一級
    const uf = unknown ? UNKNOWN_FACTOR ** unknown : 1;
    // 只有一方的棋（另一方要先翻掉才能用）
    if (o === 0) { if (a === 2) f2 += uf; else if (a === 3) f3 += uf; else if (a === 4) f4 += uf; }
    if (a === 0) { if (o === 2) f2 -= uf; else if (o === 3) f3 -= uf; else if (o === 4) f4 -= uf; }
    // 四缺一，空格是誰的合法步
    if (a + o === 4 && (a === 4 || o === 4)) {
      const emptyH = eH & WH[w], emptyL = eL & WL[w];
      if (a === 4 && ((emptyH & myMovesH) | (emptyL & myMovesL))) tMine += uf;
      if (o === 4 && ((emptyH & opMovesH) | (emptyL & opMovesL))) tTheirs += uf;
    }
  }
  out[10] = f2; out[11] = f3; out[12] = f4; out[13] = tMine; out[14] = tTheirs;
  return empties;
}

/** 從遊戲棋盤計算特徵（離線訓練用；所有棋子的符號都已知） */
const NM_ALL = new Uint8Array(64), KNOWN_ALL = new Uint8Array(64).fill(1);
export function featuresFromBoard(board, player, out = new Float64Array(NF)) {
  let pH = 0, pL = 0, oH = 0, oL = 0;
  for (let s = 0; s < 64; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    NM_ALL[s] = numberMask(d.id); // 跟著規則（分組規則是組別）
    const mine = d.face === player;
    if (s < 32) { if (mine) pL |= 1 << s; else oL |= 1 << s; }
    else if (mine) pH |= 1 << (s - 32); else oH |= 1 << (s - 32);
  }
  const empties = extractFeatures(pH, pL, oH, oL, NM_ALL, KNOWN_ALL, out);
  return { empties, features: out };
}
