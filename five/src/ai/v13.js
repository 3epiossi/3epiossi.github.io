/**
 * v13：「4 組自選、同組五連立刻獲勝、沒人連成就比棋子數」專用的獨立引擎（不依賴其他引擎或規則模組）。
 *
 * 規則：64 顆棋分 4 組、每組 16 顆，雙方共用；每一手自己選組別（那組還有剩才能選）。
 *   同色、同一組的 5 顆連成一線（橫、直、斜）立刻獲勝；被翻面的棋組別不變。沒人連成就比棋子數。
 *
 * 位元棋盤：64 格拆成高、低兩個 32 位元整數（格 s = 列 × 8 + 行；s < 32 在低位）。
 *   P / O = 輪到的一方 / 對手的棋；組別用兩個位元平面 G0、G1 存（組別 = G0 + 2 × G1，只在有棋的格子有意義）。
 *
 * 搜尋：迭代加深 NegaScout、置換表、殺手與歷史著法排序、LMR；剩 exactEmpties 格以內精確算到終局。
 *   1. 每個節點先看能不能直接連成五（能就贏）
 *   2. 葉節點：對手下一手就能連成五 → 延伸去擋（最多 threatExt 層）
 *   3. 組別合併：選哪一組只影響經過這格的 5 格窗口。走法只展開「經過這格、還活著的窗口用到的組別」
 *      加上一個「周圍沒出現過、剩最多的組別」（等於切斷所有連線）；其他組別效果相同，不重複搜。
 * 評估（輪到的一方角度）：黑白棋（行動力、邊界、角落與 X/C 格、棋子數）× othelloScale
 *   ＋ 連線（還沒混組、還補得滿的窗口，依還差幾格給分）× lineScale。
 */

const N = 64, LEN = 5, GROUPS = 4, GROUP_SIZE = 16;
export const WIN = 10000;

export const V13_PARAMS = {
  othelloScale: 1,
  // 連線評估的比重。調參（tests/g2-arena.js，對 v12，各 40 局）：1 → 33%、0.5 → 35%、0.2 → 50～63%、0.1 → 57%、0.05 → 68%、0 → 65%
  // 連線的輸贏幾乎都由搜尋決定（每個節點先找能不能連成五、對手快連成時延伸去擋），靜態的連線分數大了反而讓黑白棋變差
  lineScale: 0.1,
  lineTm: [0, 28, 9, 2.5, 0.4, 0.1], // 依「還差幾格」：差 1 格 28 …
  oppFactor: 0.4,   // 窗口裡每有一顆對手的棋，打這個折（之後可能翻回來）
  tempo: 1.4,       // 輪到自己：自己的連線更有威脅
  mobEarly: 1.2, mobLate: 0.54,
  frontier: 0.41,
  corner: 2.74, xSquare: 4.31, cSquare: 1.25,
  // 不穩定的棋子：開局越多越不利（容易被利用、行動力變少），終局才變成正分。
  // 調參（對 v12，各 40 局）：開局 +0.3 → 40%；開局 −0.37、終局 +0.05 → 68%（比棋子數的局從 3 勝 14 負變成 7 勝 1 負）
  discEarly: -0.37, discLate: 0.05,
  stable: 1.5,      // 每顆穩定子（再也翻不掉的棋）
  threatExt: 4,
  lmr: true,
  merge: true,      // 組別合併（見檔案開頭）；false = 每一組都展開（測試用）
  exactEmpties: 10
};

// ===== 位元工具 =====
const bitH = (s) => (s < 32 ? 0 : (1 << (s - 32)) | 0);
const bitL = (s) => (s < 32 ? (1 << s) | 0 : 0);
const has = (h, l, s) => (s < 32 ? (l >>> s) & 1 : (h >>> (s - 32)) & 1);
function pop(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24); }
const NOT_A = 0xfefefefe | 0, NOT_H = 0x7f7f7f7f;
let SH = 0, SL = 0;
/** 往方向 d 移一格（0 東、1 西、2 南、3 北、4 東南、5 西南、6 東北、7 西北），結果在 SH/SL */
function shift(d, h, l) {
  switch (d) {
    case 0: SH = ((h << 1) | (l >>> 31)) & NOT_A; SL = (l << 1) & NOT_A; break;
    case 1: SL = ((l >>> 1) | (h << 31)) & NOT_H; SH = (h >>> 1) & NOT_H; break;
    case 2: SH = (h << 8) | (l >>> 24); SL = l << 8; break;
    case 3: SL = (l >>> 8) | (h << 24); SH = h >>> 8; break;
    case 4: SH = ((h << 9) | (l >>> 23)) & NOT_A; SL = (l << 9) & NOT_A; break;
    case 5: SH = ((h << 7) | (l >>> 25)) & NOT_H; SL = (l << 7) & NOT_H; break;
    case 6: SL = ((l >>> 7) | (h << 25)) & NOT_A; SH = (h >>> 7) & NOT_A; break;
    default: SL = ((l >>> 9) | (h << 23)) & NOT_H; SH = (h >>> 9) & NOT_H;
  }
}
let MH = 0, ML = 0;
/** P 的合法位置，結果在 MH/ML */
function mobility(pH, pL, oH, oL) {
  const eH = ~(pH | oH), eL = ~(pL | oL);
  let rh = 0, rl = 0;
  for (let d = 0; d < 8; d++) {
    shift(d, pH, pL);
    let th = SH & oH, tl = SL & oL;
    for (let k = 0; k < 5; k++) { shift(d, th, tl); th |= SH & oH; tl |= SL & oL; }
    shift(d, th, tl);
    rh |= SH & eH; rl |= SL & eL;
  }
  MH = rh; ML = rl;
}
/** 周圍 8 格（結果在 SH/SL 之外的 NBH/NBL） */
let NBH = 0, NBL = 0;
function neighbors(h, l) {
  let rh = 0, rl = 0;
  for (let d = 0; d < 8; d++) { shift(d, h, l); rh |= SH; rl |= SL; }
  NBH = rh; NBL = rl;
}
const RAYS = []; // RAYS[s * 8 + d] = 方向 d 上的格子
const DR = [0, 0, 1, -1, 1, 1, -1, -1], DC = [1, -1, 0, 0, 1, -1, 1, -1];
for (let s = 0; s < N; s++) for (let d = 0; d < 8; d++) {
  const ray = [];
  for (let r = (s >> 3) + DR[d], c = (s & 7) + DC[d]; r >= 0 && r < 8 && c >= 0 && c < 8; r += DR[d], c += DC[d]) ray.push(r * 8 + c);
  RAYS.push(ray);
}
let FH = 0, FL = 0;
/** P 下在 s 會翻掉的棋，結果在 FH/FL */
function flips(pH, pL, oH, oL, s) {
  let rh = 0, rl = 0;
  for (let d = 0; d < 8; d++) {
    const ray = RAYS[s * 8 + d];
    let th = 0, tl = 0, k = 0;
    for (; k < ray.length && has(oH, oL, ray[k]); k++) { th |= bitH(ray[k]); tl |= bitL(ray[k]); }
    if (k > 0 && k < ray.length && has(pH, pL, ray[k])) { rh |= th; rl |= tl; }
  }
  FH = rh; FL = rl;
}

// ===== 5 格窗口 =====
const WH = [], WL = [], WSQ = [];
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
  const sq = [];
  for (let k = 0; k < LEN; k++) { const y = r + k * dr, x = c + k * dc; if (y < 0 || y > 7 || x < 0 || x > 7) break; sq.push(y * 8 + x); }
  if (sq.length < LEN) continue;
  WH.push(sq.reduce((a, s) => a | bitH(s), 0)); WL.push(sq.reduce((a, s) => a | bitL(s), 0)); WSQ.push(sq);
}
const NW = WH.length;
const SQW = Array.from({ length: N }, () => []);
for (let w = 0; w < NW; w++) for (const s of WSQ[w]) SQW[s].push(w);

/** 窗口裡有棋的格子（mh/ml）是不是同一組；是的話回傳組別，否則 -1 */
function groupOfMask(mh, ml, a0H, a0L, a1H, a1L) {
  const x0h = a0H & mh, x0l = a0L & ml, x1h = a1H & mh, x1l = a1L & ml;
  const g0 = (x0h | x0l) === 0 ? 0 : (x0h === mh && x0l === ml ? 1 : -1);
  const g1 = (x1h | x1l) === 0 ? 0 : (x1h === mh && x1l === ml ? 2 : -1);
  return g0 < 0 || g1 < 0 ? -1 : g0 + g1;
}
/** 下完之後（P、組別平面已更新），經過 changed 格子的窗口有沒有 P 的同組五連 */
function fiveAfter(pH, pL, a0H, a0L, a1H, a1L, chH, chL) {
  while (chH !== 0 || chL !== 0) {
    let q;
    if (chL !== 0) { const b = chL & -chL; q = 31 - Math.clz32(b); chL ^= b; } else { const b = chH & -chH; q = 63 - Math.clz32(b); chH ^= b; }
    const ws = SQW[q];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i], h = WH[w], l = WL[w];
      if ((pH & h) === h && (pL & l) === l && groupOfMask(h, l, a0H, a0L, a1H, a1L) >= 0) return true;
    }
  }
  return false;
}

// ===== 庫存（共用：每組 16 顆減掉盤上的） =====
const SUP = Array.from({ length: 130 }, () => new Int8Array(GROUPS));
function supplyInto(out, pH, pL, oH, oL, a0H, a0L, a1H, a1L) {
  const c3 = pop(a0H & a1H) + pop(a0L & a1L);
  const c1 = pop(a0H & ~a1H) + pop(a0L & ~a1L);
  const c2 = pop(a1H & ~a0H) + pop(a1L & ~a0L);
  const c0 = pop(pH | oH) + pop(pL | oL) - c1 - c2 - c3;
  out[0] = GROUP_SIZE - c0; out[1] = GROUP_SIZE - c1; out[2] = GROUP_SIZE - c2; out[3] = GROUP_SIZE - c3;
  return out;
}

/** P 下 s、用第 g 組，能不能連成五 */
function tryWin(pH, pL, oH, oL, a0H, a0L, a1H, a1L, s, g) {
  flips(pH, pL, oH, oL, s);
  const bh = bitH(s), bl = bitL(s), ch = FH | bh, cl = FL | bl;
  return fiveAfter(pH | ch, pL | cl, g & 1 ? a0H | bh : a0H, g & 1 ? a0L | bl : a0L, g & 2 ? a1H | bh : a1H, g & 2 ? a1L | bl : a1L, ch, cl);
}
/**
 * P（合法位置 mH/mL、庫存 sup）能直接連成五的走法（格 × 4 + 組）；沒有回傳 -1。
 * 下一顆棋最多讓一個窗口多 1 顆，所以只有兩種窗口可能：4 格有棋、同組（下在空格）；5 格全滿、同組（靠翻棋）。
 */
function findWin(pH, pL, oH, oL, a0H, a0L, a1H, a1L, mH, mL, sup) {
  const occH = pH | oH, occL = pL | oL;
  let needFlip = false;
  for (let w = 0; w < NW; w++) {
    const h = WH[w], l = WL[w], oh = occH & h, ol = occL & l;
    const n = pop(oh) + pop(ol);
    if (n < LEN - 1) continue;
    const g = groupOfMask(oh, ol, a0H, a0L, a1H, a1L);
    if (g < 0) continue;
    if (n === LEN - 1) {
      if (!sup[g]) continue;
      const eh = h & ~oh & mH, el = l & ~ol & mL;
      if (!(eh | el)) continue;
      const s = el ? 31 - Math.clz32(el) : 63 - Math.clz32(eh);
      if (tryWin(pH, pL, oH, oL, a0H, a0L, a1H, a1L, s, g)) return s * 4 + g;
    } else if ((oH & h) | (oL & l)) needFlip = true;
  }
  if (needFlip) {
    let g = 0;
    while (!sup[g]) g++; // 下在窗口外：用哪一組都一樣
    let mh = mH, ml = mL;
    while (mh !== 0 || ml !== 0) {
      let s;
      if (ml !== 0) { const b = ml & -ml; s = 31 - Math.clz32(b); ml ^= b; } else { const b = mh & -mh; s = 63 - Math.clz32(b); mh ^= b; }
      if (tryWin(pH, pL, oH, oL, a0H, a0L, a1H, a1L, s, g)) return s * 4 + g;
    }
  }
  return -1;
}

// ===== 評估 =====
let P = V13_PARAMS;
// 穩定子：四個方向（橫、直、兩條斜）各自「整條線都滿了」或「至少一邊是邊界或同色穩定子」
const LINE_MASKS = [[], [], [], []]; // 橫、直、斜（左上→右下）、斜（右上→左下）
for (let k = 0; k < 8; k++) {
  const row = [], col = [];
  for (let j = 0; j < 8; j++) { row.push(k * 8 + j); col.push(j * 8 + k); }
  LINE_MASKS[0].push(row); LINE_MASKS[1].push(col);
}
for (let k = -7; k <= 7; k++) {
  const d1 = [], d2 = [];
  for (let r = 0; r < 8; r++) { const c1 = r - k, c2 = k + 7 - r; if (c1 >= 0 && c1 < 8) d1.push(r * 8 + c1); if (c2 >= 0 && c2 < 8) d2.push(r * 8 + c2); }
  LINE_MASKS[2].push(d1); LINE_MASKS[3].push(d2);
}
const LM = LINE_MASKS.map(ls => ls.map(sq => [sq.reduce((a, s) => a | bitH(s), 0), sq.reduce((a, s) => a | bitL(s), 0)]));
const maskOf = (f) => { let h = 0, l = 0; for (let s = 0; s < 64; s++) if (f(s >> 3, s & 7)) { h |= bitH(s); l |= bitL(s); } return [h, l]; };
const [EW_H, EW_L] = maskOf((r, c) => c === 0 || c === 7), [NS_H, NS_L] = maskOf((r) => r === 0 || r === 7);
const [BD_H, BD_L] = maskOf((r, c) => r === 0 || r === 7 || c === 0 || c === 7);
const FULL = new Int32Array(8); // 每個方向：整條線都滿的格子（高、低）
/** X 的穩定子數量（FULL 要先算好） */
function stableCount(xH, xL) {
  let sH = 0, sL = 0;
  for (let it = 0; it < 10; it++) {
    let okH = xH, okL = xL;
    // 方向 0（橫）：東西鄰居；1（直）：南北；2（左上→右下）：東南、西北；3（右上→左下）：西南、東北
    shift(0, sH, sL); let aH = SH, aL = SL; shift(1, sH, sL); okH &= FULL[0] | EW_H | aH | SH; okL &= FULL[1] | EW_L | aL | SL;
    shift(2, sH, sL); aH = SH; aL = SL; shift(3, sH, sL); okH &= FULL[2] | NS_H | aH | SH; okL &= FULL[3] | NS_L | aL | SL;
    shift(4, sH, sL); aH = SH; aL = SL; shift(7, sH, sL); okH &= FULL[4] | BD_H | aH | SH; okL &= FULL[5] | BD_L | aL | SL;
    shift(5, sH, sL); aH = SH; aL = SL; shift(6, sH, sL); okH &= FULL[6] | BD_H | aH | SH; okL &= FULL[7] | BD_L | aL | SL;
    if (okH === sH && okL === sL) break;
    sH = okH; sL = okL;
  }
  return pop(sH) + pop(sL);
}
function computeFull(occH, occL) {
  for (let a = 0; a < 4; a++) {
    let fh = 0, fl = 0;
    const ms = LM[a];
    for (let i = 0; i < ms.length; i++) { const [h, l] = ms[i]; if ((occH & h) === h && (occL & l) === l) { fh |= h; fl |= l; } }
    FULL[a * 2] = fh; FULL[a * 2 + 1] = fl;
  }
}

const CORNERS = [0, 7, 56, 63], XSQ = [9, 14, 49, 54], CSQ = [[1, 8], [6, 15], [48, 57], [55, 62]];

function othelloEval(pH, pL, oH, oL, mP, mO) {
  const occH = pH | oH, occL = pL | oL;
  const cP = pop(pH) + pop(pL), cO = pop(oH) + pop(oL);
  const empties = 64 - cP - cO, t = 1 - empties / 60;
  let v = (mP - mO) * (P.mobEarly + (P.mobLate - P.mobEarly) * t);
  const eH = ~occH, eL = ~occL;
  neighbors(pH, pL); const fP = pop(NBH & eH) + pop(NBL & eL);
  neighbors(oH, oL); const fO = pop(NBH & eH) + pop(NBL & eL);
  v += (fO - fP) * P.frontier * (1 - 0.6 * t);
  for (let i = 0; i < 4; i++) {
    const cs = CORNERS[i];
    if (has(pH, pL, cs)) { v += P.corner; continue; }
    if (has(oH, oL, cs)) { v -= P.corner; continue; }
    const k = 1 - 0.5 * t, x = XSQ[i];
    if (has(pH, pL, x)) v -= P.xSquare * k; else if (has(oH, oL, x)) v += P.xSquare * k;
    for (const c of CSQ[i]) { if (has(pH, pL, c)) v -= P.cSquare * k; else if (has(oH, oL, c)) v += P.cSquare * k; }
  }
  v += (cP - cO) * (P.discEarly + (P.discLate - P.discEarly) * t * t);
  if (P.stable) { computeFull(occH, occL); v += P.stable * (stableCount(pH, pL) - stableCount(oH, oL)); }
  return v;
}

function lineEval(pH, pL, oH, oL, a0H, a0L, a1H, a1L, sup) {
  const TM = P.lineTm, f = P.oppFactor, occH = pH | oH, occL = pL | oL;
  let mine = 0, theirs = 0;
  for (let w = 0; w < NW; w++) {
    const h = WH[w], l = WL[w], oh = occH & h, ol = occL & l;
    if (!(oh | ol)) continue;
    const g = groupOfMask(oh, ol, a0H, a0L, a1H, a1L);
    if (g < 0) continue;
    const a = pop(pH & h) + pop(pL & l), o = pop(oH & h) + pop(oL & l);
    if (LEN - a - o > sup[g]) continue; // 那一組剩的不夠補滿
    if (a) mine += TM[LEN - a] * (o ? f ** o : 1);
    if (o) theirs += TM[LEN - o] * (a ? f ** a : 1);
  }
  return mine * P.tempo - theirs;
}

// ===== 置換表 =====
const TT_BITS = 19, // 52 萬格、每條 worker 約 8 MB（網頁同時開三條 worker：CPU、局面分析、預先計算）
      TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
// 置換表等到第一次搜尋才配置（約 8 MB）：只用到另一個引擎的 worker 不用背這份記憶體
let TT_K2 = null, TT_DEPTH = null, TT_FLAG = null, TT_SCORE = null, TT_MOVE = null;
function allocTT() {
  TT_K2 = new Int32Array(TT_SIZE); TT_DEPTH = new Int8Array(TT_SIZE).fill(-1); TT_FLAG = new Uint8Array(TT_SIZE);
  TT_SCORE = new Float64Array(TT_SIZE); TT_MOVE = new Int16Array(TT_SIZE);
}
const EXACT = 0, LOWER = 1, UPPER = 2;
function mix(h, x) { h = Math.imul(h ^ x, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); return h ^ (h >>> 13); }
function hashOf(seed, pH, pL, oH, oL, a0H, a0L, a1H, a1L) {
  return mix(mix(mix(mix(mix(mix(mix(mix(seed, pH), pL), oH), oL), a0H), a0L), a1H), a1L);
}
export function clearTTV13() { TT_DEPTH?.fill(-1); }

// ===== 搜尋 =====
const ABORT = { abort: true };
let nodes = 0, deadline = 0, EXACT_RUN = false;
const MOVES = Array.from({ length: 130 }, () => new Int16Array(256));
const KEYS = Array.from({ length: 130 }, () => new Float64Array(256));
const LIVE = Array.from({ length: 130 }, () => new Uint8Array(N));
const KILLER = new Int16Array(260).fill(-1);
const HISTORY = new Float64Array(N * GROUPS);
// 格子排序：角落最先、X 格最後
const SQ_ORDER = new Float64Array(N);
for (let s = 0; s < N; s++) {
  const r = s >> 3, c = s & 7, edge = r === 0 || r === 7 || c === 0 || c === 7;
  SQ_ORDER[s] = CORNERS.includes(s) ? 3 : XSQ.includes(s) ? -2 : CSQ.flat().includes(s) ? -1 : edge ? 1 : 0;
}

/** 經過每一格、還活著（有棋的格子同一組、那一組還補得滿）的窗口用到哪些組別：LIVE[ply][s] 的位元 */
function scanLive(live, pH, pL, oH, oL, a0H, a0L, a1H, a1L, sup) {
  live.fill(0);
  const occH = pH | oH, occL = pL | oL;
  for (let w = 0; w < NW; w++) {
    const h = WH[w], l = WL[w], oh = occH & h, ol = occL & l;
    if (!(oh | ol)) continue;
    const g = groupOfMask(oh, ol, a0H, a0L, a1H, a1L);
    if (g < 0) continue;
    if (LEN - pop(oh) - pop(ol) > sup[g]) continue;
    const sq = WSQ[w];
    for (let k = 0; k < LEN; k++) if (!has(occH, occL, sq[k])) live[sq[k]] |= 1 << g;
  }
}
/** 走法（格 × 4 + 組） */
function genMoves(mH, mL, sup, live, out) {
  let n = 0, avail = 0, bestAbsent = -1;
  for (let g = 0; g < GROUPS; g++) if (sup[g] > 0) avail |= 1 << g;
  let ml = mL, mh = mH;
  while (ml !== 0 || mh !== 0) {
    let s;
    if (ml !== 0) { const b = ml & -ml; s = 31 - Math.clz32(b); ml ^= b; } else { const b = mh & -mh; s = 63 - Math.clz32(b); mh ^= b; }
    if (!P.merge) { for (let g = 0; g < GROUPS; g++) if (avail >> g & 1) out[n++] = s * 4 + g; continue; }
    const lg = live[s] & avail, absent = avail & ~live[s];
    for (let g = 0; g < GROUPS; g++) if (lg >> g & 1) out[n++] = s * 4 + g;
    if (absent) {
      bestAbsent = -1;
      for (let g = 0; g < GROUPS; g++) if (absent >> g & 1 && (bestAbsent < 0 || sup[g] > sup[bestAbsent])) bestAbsent = g;
      out[n++] = s * 4 + bestAbsent;
    }
  }
  return n;
}

function finalScore(pH, pL, oH, oL) { return pop(pH) + pop(pL) - pop(oH) - pop(oL); }

function nega(pH, pL, oH, oL, a0H, a0L, a1H, a1L, depth, alpha, beta, ply, ext, passed) {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) throw ABORT;
  mobility(pH, pL, oH, oL);
  const mH = MH, mL = ML;
  if (!(mH | mL)) {
    mobility(oH, oL, pH, pL);
    if (passed || !(MH | ML)) return finalScore(pH, pL, oH, oL);
    return -nega(oH, oL, pH, pL, a0H, a0L, a1H, a1L, depth, -beta, -alpha, ply + 1, ext, true);
  }
  const sup = supplyInto(SUP[ply], pH, pL, oH, oL, a0H, a0L, a1H, a1L);
  if (findWin(pH, pL, oH, oL, a0H, a0L, a1H, a1L, mH, mL, sup) >= 0) return WIN - ply;

  if (depth <= 0) {
    mobility(oH, oL, pH, pL);
    const omH = MH, omL = ML;
    if (ext < P.threatExt && findWin(oH, oL, pH, pL, a0H, a0L, a1H, a1L, omH, omL, sup) >= 0) { depth = 1; ext++; }
    else {
      const mP = pop(mH) + pop(mL), mO = pop(omH) + pop(omL);
      return P.othelloScale * othelloEval(pH, pL, oH, oL, mP, mO) + P.lineScale * lineEval(pH, pL, oH, oL, a0H, a0L, a1H, a1L, sup);
    }
  }

  const k1 = hashOf(0x2545f491, pH, pL, oH, oL, a0H, a0L, a1H, a1L), k2 = hashOf(0x6c8e9cf5, pH, pL, oH, oL, a0H, a0L, a1H, a1L);
  const idx = k1 & TT_MASK, alphaOrig = alpha;
  let ttMove = -1;
  if (TT_K2[idx] === k2 && TT_DEPTH[idx] >= 0) {
    ttMove = TT_MOVE[idx];
    if (TT_DEPTH[idx] >= depth) {
      const sc = TT_SCORE[idx], fl = TT_FLAG[idx];
      if (fl === EXACT) return sc;
      if (fl === LOWER && sc > alpha) alpha = sc; else if (fl === UPPER && sc < beta) beta = sc;
      if (alpha >= beta) return sc;
    }
  }

  const live = LIVE[ply];
  scanLive(live, pH, pL, oH, oL, a0H, a0L, a1H, a1L, sup);
  const moves = MOVES[ply], keys = KEYS[ply];
  const n = genMoves(mH, mL, sup, live, moves);
  const kA = KILLER[ply * 2], kB = KILLER[ply * 2 + 1];
  for (let i = 0; i < n; i++) {
    const mv = moves[i];
    keys[i] = mv === ttMove ? 1e9 : (mv === kA || mv === kB ? 1e6 : 0) + HISTORY[mv] + SQ_ORDER[mv >> 2] * 50;
  }
  for (let i = 1; i < n; i++) {
    const m = moves[i], k = keys[i];
    let j = i - 1;
    while (j >= 0 && keys[j] < k) { moves[j + 1] = moves[j]; keys[j + 1] = keys[j]; j--; }
    moves[j + 1] = m; keys[j + 1] = k;
  }

  let best = -Infinity, bestMove = -1;
  for (let i = 0; i < n; i++) {
    const mv = moves[i], s = mv >> 2, g = mv & 3;
    flips(pH, pL, oH, oL, s);
    const bh = bitH(s), bl = bitL(s), fH = FH | bh, fL = FL | bl;
    const nPH = pH | fH, nPL = pL | fL, nOH = oH & ~fH, nOL = oL & ~fL;
    const n0H = g & 1 ? a0H | bh : a0H, n0L = g & 1 ? a0L | bl : a0L, n1H = g & 2 ? a1H | bh : a1H, n1L = g & 2 ? a1L | bl : a1L;
    let v;
    if (i === 0) v = -nega(nOH, nOL, nPH, nPL, n0H, n0L, n1H, n1L, depth - 1, -beta, -alpha, ply + 1, ext, false);
    else {
      const reduce = P.lmr && !EXACT_RUN && depth >= 3 && i >= 3 && mv !== kA && mv !== kB ? 1 : 0;
      v = -nega(nOH, nOL, nPH, nPL, n0H, n0L, n1H, n1L, depth - 1 - reduce, -alpha - 1e-3, -alpha, ply + 1, ext, false);
      if (reduce && v > alpha) v = -nega(nOH, nOL, nPH, nPL, n0H, n0L, n1H, n1L, depth - 1, -alpha - 1e-3, -alpha, ply + 1, ext, false);
      if (v > alpha && v < beta) v = -nega(nOH, nOL, nPH, nPL, n0H, n0L, n1H, n1L, depth - 1, -beta, -alpha, ply + 1, ext, false);
    }
    if (v > best) { best = v; bestMove = mv; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) {
      HISTORY[mv] += depth * depth;
      if (KILLER[ply * 2] !== mv) { KILLER[ply * 2 + 1] = KILLER[ply * 2]; KILLER[ply * 2] = mv; }
      break;
    }
  }
  TT_K2[idx] = k2; TT_DEPTH[idx] = Math.min(127, depth); TT_SCORE[idx] = best; TT_MOVE[idx] = bestMove;
  TT_FLAG[idx] = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
  return best;
}

/** 遊戲棋盤 → 輪到 player 的角度的位元棋盤 [pH, pL, oH, oL, a0H, a0L, a1H, a1L] */
function toBits(board, player, groupOf) {
  let pH = 0, pL = 0, oH = 0, oL = 0, a0H = 0, a0L = 0, a1H = 0, a1L = 0;
  for (let s = 0; s < N; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    const bh = bitH(s), bl = bitL(s), g = groupOf(d.id);
    if (d.face === player) { pH |= bh; pL |= bl; } else { oH |= bh; oL |= bl; }
    if (g & 1) { a0H |= bh; a0L |= bl; }
    if (g & 2) { a1H |= bh; a1L |= bl; }
  }
  return [pH, pL, oH, oL, a0H, a0L, a1H, a1L];
}

/** 只看黑白棋的靜態評估（player 的角度，不往下算）：走法評價判斷「只看盤面看不出來」用 */
export function othelloEvalV13(board, player, groupOf, params = V13_PARAMS) {
  P = { ...V13_PARAMS, ...params };
  const [pH, pL, oH, oL] = toBits(board, player, groupOf);
  mobility(pH, pL, oH, oL); const mP = pop(MH) + pop(ML);
  mobility(oH, oL, pH, pL); const mO = pop(MH) + pop(ML);
  return othelloEval(pH, pL, oH, oL, mP, mO);
}

/**
 * @param {{id:number, face:number}|null[][]} board 8×8；face 是顏色
 * @param {number} player 輪到的顏色
 * @param {(id:number)=>number} groupOf 棋子 id → 組別 0～3
 * @param {boolean} [o.multiPV] 每一步都算出精確分數（提示要替每個格子、每一組標勝率）；否則只有最佳步準
 * @returns {{ sq:number, group:number, score:number, scores:{sq:number, group:number, score:number}[],
 *             depth:number, exact:boolean, nodes:number, ms:number } | null}
 *   scores：每個格子 × 每一組還有剩的組別。組別合併沒展開的組別（效果跟「切斷連線」那一組一樣）用那一組的分數
 */
export function searchV13(board, player, groupOf, { timeMs = 1000, maxDepth = 60, multiPV = false, params = V13_PARAMS } = {}) {
  if (!TT_K2) allocTT();
  const [pH, pL, oH, oL, a0H, a0L, a1H, a1L] = toBits(board, player, groupOf);
  P = { ...V13_PARAMS, ...params };
  const t0 = Date.now();
  nodes = 0;
  HISTORY.fill(0); KILLER.fill(-1);
  mobility(pH, pL, oH, oL);
  const mH = MH, mL = ML;
  if (!(mH | mL)) return null;
  const sup = supplyInto(SUP[0], pH, pL, oH, oL, a0H, a0L, a1H, a1L);
  if (!sup.some(x => x > 0)) return null;
  const win = findWin(pH, pL, oH, oL, a0H, a0L, a1H, a1L, mH, mL, sup);
  if (win >= 0 && !multiPV) return { sq: win >> 2, group: win & 3, score: WIN - 1, scores: [{ sq: win >> 2, group: win & 3, score: WIN - 1 }], depth: 1, exact: true, nodes, ms: Date.now() - t0 };

  const empties = 64 - pop(pH | oH) - pop(pL | oL);
  const live = new Uint8Array(N);
  scanLive(live, pH, pL, oH, oL, a0H, a0L, a1H, a1L, sup);
  const buf = new Int16Array(256);
  const n = genMoves(mH, mL, sup, live, buf);
  let order = Array.from(buf.subarray(0, n)).map(mv => ({ mv, score: SQ_ORDER[mv >> 2] }));
  order.sort((a, b) => b.score - a.score);
  let best = order[0].mv, bestScore = -Infinity, doneDepth = 0, exact = false;
  let done = null; // 最後一次算完的每一步分數

  const iterate = (depth, until) => {
    deadline = until;
    let alpha = -Infinity, cur = -1, curScore = -Infinity;
    for (let i = 0; i < order.length; i++) {
      if (multiPV) { // 每一步都用完整的窗口算（分數都精確）
        const mv = order[i].mv, s = mv >> 2, g = mv & 3;
        flips(pH, pL, oH, oL, s);
        const bh = bitH(s), bl = bitL(s), fH = FH | bh, fL = FL | bl;
        const v = tryWin(pH, pL, oH, oL, a0H, a0L, a1H, a1L, s, g) ? WIN - 1
          : -nega(oH & ~fH, oL & ~fL, pH | fH, pL | fL, g & 1 ? a0H | bh : a0H, g & 1 ? a0L | bl : a0L, g & 2 ? a1H | bh : a1H, g & 2 ? a1L | bl : a1L, depth - 1, -Infinity, Infinity, 1, 0, false);
        order[i].score = v;
        if (v > curScore) { cur = mv; curScore = v; }
        continue;
      }
      const mv = order[i].mv, s = mv >> 2, g = mv & 3;
      flips(pH, pL, oH, oL, s);
      const bh = bitH(s), bl = bitL(s), fH = FH | bh, fL = FL | bl;
      const args = [oH & ~fH, oL & ~fL, pH | fH, pL | fL, g & 1 ? a0H | bh : a0H, g & 1 ? a0L | bl : a0L, g & 2 ? a1H | bh : a1H, g & 2 ? a1L | bl : a1L];
      let v;
      if (i === 0) v = -nega(...args, depth - 1, -Infinity, Infinity, 1, 0, false);
      else {
        v = -nega(...args, depth - 1, -alpha - 1e-3, -alpha, 1, 0, false);
        if (v > alpha) v = -nega(...args, depth - 1, -Infinity, -alpha, 1, 0, false);
      }
      order[i].score = v;
      if (v > alpha) { alpha = v; cur = mv; curScore = v; }
    }
    order.sort((a, b) => b.score - a.score);
    done = order.map(o => ({ mv: o.mv, score: o.score }));
    return { cur, curScore };
  };

  if (empties <= P.exactEmpties) {
    EXACT_RUN = true;
    try {
      const r = iterate(empties, t0 + timeMs * 2);
      best = r.cur; bestScore = r.curScore; doneDepth = empties; exact = true;
    } catch (e) { if (e !== ABORT) throw e; } finally { EXACT_RUN = false; }
  }
  if (!exact) {
    for (let d = 1; d <= Math.min(maxDepth, empties); d++) {
      try {
        const r = iterate(d, t0 + timeMs);
        best = r.cur; bestScore = r.curScore; doneDepth = d;
        if (Math.abs(bestScore) > WIN / 2) break; // 已經算出勝負
      } catch (e) { if (e !== ABORT) throw e; break; }
      if (Date.now() - t0 > timeMs * 0.5) break; // 下一層大概算不完
    }
  }
  // 每一格 × 每一組：沒展開的組別（不在活的窗口裡）跟「切斷連線」那一組效果一樣，用它的分數
  const scores = [];
  if (done) {
    const at = new Map(done.map(x => [x.mv, x.score]));
    let ml = mL, mh = mH;
    while (ml !== 0 || mh !== 0) {
      let s;
      if (ml !== 0) { const b = ml & -ml; s = 31 - Math.clz32(b); ml ^= b; } else { const b = mh & -mh; s = 63 - Math.clz32(b); mh ^= b; }
      let cut = null;
      for (let g = 0; g < GROUPS; g++) if (at.has(s * 4 + g) && !(live[s] >> g & 1)) cut = at.get(s * 4 + g);
      for (let g = 0; g < GROUPS; g++) {
        if (!sup[g]) continue;
        const v = at.has(s * 4 + g) ? at.get(s * 4 + g) : cut;
        if (v != null) scores.push({ sq: s, group: g, score: v });
      }
    }
    scores.sort((a, b) => b.score - a.score);
  }
  return { sq: best >> 2, group: best & 3, score: bestScore, scores, depth: doneDepth, exact, nodes, ms: Date.now() - t0 };
}
