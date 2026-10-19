/**
 * 誰會贏？ 靜態評估：線性特徵，權重由自我對戰資料迴歸而來（tests/whowins/train-eval.js）。
 *
 * 評估在「擲骰前」的局面（機率節點）進行，視角是輪到擲骰的一方（mover）：
 *   淨勝分預測 = sum_i A[phase][i] * f_i(mover) + sum_i B[phase][i] * f_i(other)
 * 兩方用同一組特徵 f，但權重分開（輪到擲骰的一方威脅更大），所以不需要依顏色對稱。
 * 淨勝分 = 該方棋數 - 對方棋數 - 貼目（站在 mover 的角度；貼目對白方是加分）。
 *
 * 訓練資料（weights.js 的來源）：自我對戰 10000 局、1203422 個擲骰前的局面——6000 局「1 層搜尋、每步最多 40% 隨機」
 * 與 4000 局「2 層搜尋、每步最多 15% 隨機」（用前一輪訓練出來的權重下棋），每局的骰子種子不同。
 * 每個（盤上棋子數分組 x 顏色）一組 ridge 迴歸到終局淨勝分；分組的 RMSE 在 13~18 分之間（骰子運氣讓終局淨勝分的變異很大），
 * 勝率的 sigmoid 刻度（WEIGHTS.scale）對每個分組擬合「最後有沒有贏」的 log loss。
 */

import { BLACK, WHITE, POP, Position, fillTerritory, RB, RW } from "./core.js";
import { WEIGHTS } from "./weights.js";

export const NF = 11;
export const FEATURE_NAMES = [
  "bias", "pieces", "fill", "reach", "capDice", "capCount", "deadDice", "advance", "pieceRows", "targets", "frontier"
];
export const NPHASE = 3;

const OB = new Uint8Array(8), OW = new Uint8Array(8);
const SPA = new Uint8Array(8), SPB = new Uint8Array(8);
const TG = new Uint8Array(8), FR = new Uint8Array(8);

export function phaseOf(total) {
  return total < 14 ? 0 : total < 26 ? 1 : 2;
}

// 每方一組特徵（f[0..NF-1]）；mover 的 firstTurn 優勢已寫在 fill 裡
function sideFeatures(pos, side, fillSet, reachSet, f, o) {
  const mine = side === BLACK ? pos.b : pos.w;
  const theirs = side === BLACK ? pos.w : pos.b;
  let pieces = 0, advance = 0, capMask = 0, capCount = 0, rows = 0;
  TG.fill(0); FR.fill(0);
  for (let r = 0; r < 8; r++) {
    const row = mine[r];
    if (!row) continue;
    rows++;
    pieces += POP[row];
    for (let c = 0; c < 8; c++) {
      if (!(row & (1 << c))) continue;
      if (side === BLACK) {
        advance += (7 - r) + (7 - c);
        for (let k = 1; k <= 6 && c - k >= 0; k++) if (theirs[r] & (1 << (c - k))) { capMask |= 1 << k; capCount++; TG[r] |= 1 << (c - k); break; }
        for (let k = 1; k <= 6 && r - k >= 0; k++) if (theirs[r - k] & (1 << c)) { capMask |= 1 << k; capCount++; TG[r - k] |= 1 << c; break; }
      } else {
        advance += r + c;
        for (let k = 1; k <= 6 && c + k < 8; k++) if (theirs[r] & (1 << (c + k))) { capMask |= 1 << k; capCount++; TG[r] |= 1 << (c + k); break; }
        for (let k = 1; k <= 6 && r + k < 8; k++) if (theirs[r + k] & (1 << c)) { capMask |= 1 << k; capCount++; TG[r + k] |= 1 << c; break; }
      }
    }
  }
  // 各點數是否有生子可走（整隊推進）
  let moveMask = capMask;
  let cur = SPA, nxt = SPB;
  for (let r = 0; r < 8; r++) cur[r] = mine[r];
  for (let k = 1; k <= 6; k++) {
    let any = 0;
    if (side === BLACK) {
      for (let r = 0; r < 8; r++) {
        const below = r < 7 ? cur[r + 1] : 0;
        const v = (((cur[r] >> 1) | below) & ~theirs[r]) & 255;
        nxt[r] = v;
        any |= v & ~(mine[r] | theirs[r]);
        FR[r] |= v & ~(mine[r] | theirs[r]);
      }
    } else {
      for (let r = 0; r < 8; r++) {
        const above = r > 0 ? cur[r - 1] : 0;
        const v = ((((cur[r] << 1) & 255) | above) & ~theirs[r]) & 255;
        nxt[r] = v;
        any |= v & ~(mine[r] | theirs[r]);
        FR[r] |= v & ~(mine[r] | theirs[r]);
      }
    }
    if (any) moveMask |= 1 << k;
    const t = cur; cur = nxt; nxt = t;
  }
  let capDice = 0, dead = 0;
  for (let k = 1; k <= 6; k++) { if (capMask & (1 << k)) capDice++; if (!(moveMask & (1 << k))) dead++; }
  f[o] = 1;
  f[o + 1] = pieces;
  f[o + 2] = fillSet;
  f[o + 3] = reachSet;
  f[o + 4] = capDice;
  f[o + 5] = capCount;
  f[o + 6] = dead;
  f[o + 7] = advance;
  f[o + 8] = rows;
  let tg = 0, fr = 0;
  for (let r = 0; r < 8; r++) { tg += POP[TG[r]]; fr += POP[FR[r]]; }
  f[o + 9] = tg;
  f[o + 10] = fr;
}

/**
 * 取出雙方特徵：out[0..NF) 是 mover，out[NF..2NF) 是 other。回傳 phase。
 */
export function extractFeatures(pos, mover, out) {
  const other = mover === BLACK ? WHITE : BLACK;
  fillTerritory(pos, mover, OB, OW);
  let fb = 0, fw = 0, rb = 0, rw = 0;
  for (let r = 0; r < 8; r++) {
    fb += POP[OB[r]]; fw += POP[OW[r]];
    rb += POP[RB[r]]; rw += POP[RW[r]];
  }
  const fM = mover === BLACK ? fb : fw, fO = mover === BLACK ? fw : fb;
  const rM = mover === BLACK ? rb : rw, rO = mover === BLACK ? rw : rb;
  sideFeatures(pos, mover, fM, rM, out, 0);
  sideFeatures(pos, other, fO, rO, out, NF);
  let total = 0;
  for (let r = 0; r < 8; r++) total += POP[pos.b[r]] + POP[pos.w[r]];
  return phaseOf(total);
}

const FBUF = new Float64Array(2 * NF);

/** 預測淨勝分（mover 的角度，已含貼目：對 mover 是黑方則減貼目，白方則加貼目由權重的 bias 學） */
export function evalDiff(pos, mover, weights = WEIGHTS) {
  const ph = extractFeatures(pos, mover, FBUF);
  const w = weights[ph + (mover === BLACK ? 0 : NPHASE)];
  let s = 0;
  for (let i = 0; i < 2 * NF; i++) s += w[i] * FBUF[i];
  return s;
}

/** 以 sigmoid 轉成 mover 的勝率（SCALE 由 train-eval 依自我對戰資料擬合） */
export function winFromDiff(d, ph, mover) {
  const sc = WEIGHTS.scale[ph];
  return 1 / (1 + Math.exp(-d / sc));
}

export function evalWin(pos, mover) {
  const ph = extractFeatures(pos, mover, FBUF);
  const w = WEIGHTS[ph + (mover === BLACK ? 0 : NPHASE)];
  let s = 0;
  for (let i = 0; i < 2 * NF; i++) s += w[i] * FBUF[i];
  // 權重是用貼目 3.5 訓練的：貼目不同時，把差額補在淨勝分上（黑方吃虧、白方佔便宜）
  if (pos.komi !== 3.5) s += (mover === BLACK ? -1 : 1) * (pos.komi - 3.5);
  return 1 / (1 + Math.exp(-s / WEIGHTS.scale[ph]));
}

export { Position };
