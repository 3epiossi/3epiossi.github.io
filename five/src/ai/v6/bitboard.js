/**
 * ⚡ v6 位元棋盤 (Bitboard)
 *
 * 參考 Zebra 以 64 位元整數表示棋盤，但 JavaScript 的 BigInt 太慢，
 * 這裡拆成兩個 32 位元整數：lo = 第 0～31 格（第 1～4 列），hi = 第 32～63 格（第 5～8 列）。
 * 第 s 格 = 列 r * 8 + 欄 c，每列佔一個位元組，欄 c 是該位元組的第 c 位。
 *
 * 為了不在熱路徑上配置物件，多值回傳一律寫進模組層級的暫存變數（RH / RL）。
 */

export const INNER = 0x7E7E7E7E;  // 去掉 A、H 欄：橫向／斜向延伸時避免跨列繞回
const NOT_A = 0xFEFEFEFE | 0;    // 往東位移後清掉 A 欄
const NOT_H = 0x7F7F7F7F;         // 往西位移後清掉 H 欄

export let RH = 0, RL = 0;

// 8 個方向的位移量；正數往高位（南、東），負數往低位
const SHIFTS = [1, -1, 8, -8, 9, -9, 7, -7];
const HORIZONTAL = [true, true, false, false, true, true, true, true];

export function popcount(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0F0F0F0F;
  return Math.imul(x, 0x01010101) >>> 24;
}

export const count = (h, l) => popcount(h) + popcount(l);

export function bitAt(h, l, s) {
  return s < 32 ? (l >>> s) & 1 : (h >>> (s - 32)) & 1;
}

/** 第 s 格的單一位元 */
export function setBit(s) {
  if (s < 32) { RH = 0; RL = (1 << s) | 0; } else { RH = (1 << (s - 32)) | 0; RL = 0; }
}

/** 最低位那一格的索引（無則 -1） */
export function lowestSquare(h, l) {
  if (l !== 0) return 31 - Math.clz32(l & -l);
  if (h !== 0) return 63 - Math.clz32(h & -h);
  return -1;
}

/** 列出所有為 1 的格子 */
export function squaresOf(h, l, out = []) {
  out.length = 0;
  while (l !== 0) { const b = l & -l; out.push(31 - Math.clz32(b)); l ^= b; }
  while (h !== 0) { const b = h & -h; out.push(63 - Math.clz32(b)); h ^= b; }
  return out;
}

// 位移 n 格（n 可正可負，|n| < 32），結果寫入 RH / RL
function shift(h, l, n) {
  if (n > 0) { RH = (h << n) | (l >>> (32 - n)); RL = l << n; }
  else { const m = -n; RL = (l >>> m) | (h << (32 - m)); RH = h >>> m; }
}

/**
 * 合法落子點（Kogge-Stone 的簡化版：每個方向沿著對手棋子延伸 6 次）
 * P = 下棋者，O = 對手。結果寫入 RH / RL。
 */
export function mobility(pH, pL, oH, oL) {
  const eH = ~(pH | oH), eL = ~(pL | oL);
  let mH = 0, mL = 0;
  for (let d = 0; d < 8; d++) {
    const n = SHIFTS[d];
    const omH = HORIZONTAL[d] ? oH & INNER : oH;
    const omL = HORIZONTAL[d] ? oL & INNER : oL;
    shift(pH, pL, n);
    let tH = RH & omH, tL = RL & omL;
    for (let k = 0; k < 5; k++) {
      shift(tH, tL, n);
      tH |= RH & omH; tL |= RL & omL;
    }
    shift(tH, tL, n);
    mH |= RH & eH; mL |= RL & eL;
  }
  RH = mH; RL = mL;
}

/** 與一組棋子相鄰的格子（8 方向），結果寫入 RH / RL */
export function neighbors(h, l) {
  let nH = 0, nL = 0;
  for (let d = 0; d < 8; d++) {
    const n = SHIFTS[d];
    shift(h, l, n);
    let rh = RH, rl = RL;
    // 有橫向分量的方向要清掉繞回的那一欄
    if (n === 1 || n === 9 || n === -7) { rh &= NOT_A; rl &= NOT_A; }
    else if (n === -1 || n === -9 || n === 7) { rh &= NOT_H; rl &= NOT_H; }
    nH |= rh; nL |= rl;
  }
  RH = nH; RL = nL;
}

// 每一格往 8 個方向的射線（格子索引陣列），用來算翻面
const DR = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, -1, 0, 0, 1, -1, -1, 1];
export const RAYS = [];
for (let s = 0; s < 64; s++) {
  const r0 = s >> 3, c0 = s & 7, rays = [];
  for (let d = 0; d < 8; d++) {
    const ray = [];
    let r = r0 + DR[d], c = c0 + DC[d];
    while (r >= 0 && r < 8 && c >= 0 && c < 8) { ray.push(r * 8 + c); r += DR[d]; c += DC[d]; }
    if (ray.length >= 2) rays.push(ray);
  }
  RAYS.push(rays);
}

/** 在 s 落子會翻的棋（P 下、O 被翻），結果寫入 RH / RL */
export function flips(pH, pL, oH, oL, s) {
  let fH = 0, fL = 0;
  const rays = RAYS[s];
  for (let i = 0; i < rays.length; i++) {
    const ray = rays[i];
    let lH = 0, lL = 0, k = 0;
    for (; k < ray.length; k++) {
      const q = ray[k];
      if (q < 32) {
        const b = 1 << q;
        if (oL & b) { lL |= b; continue; }
        if ((pL & b) && k > 0) { fH |= lH; fL |= lL; }
      } else {
        const b = 1 << (q - 32);
        if (oH & b) { lH |= b; continue; }
        if ((pH & b) && k > 0) { fH |= lH; fL |= lL; }
      }
      break;
    }
  }
  RH = fH; RL = fL;
}

/** 從遊戲棋盤（{id, face} 陣列）轉成雙方位元棋盤 */
export function fromBoard(board, BLACK) {
  let bH = 0, bL = 0, wH = 0, wL = 0;
  for (let s = 0; s < 64; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    const isB = d.face === BLACK;
    if (s < 32) { if (isB) bL |= 1 << s; else wL |= 1 << s; }
    else { if (isB) bH |= 1 << (s - 32); else wH |= 1 << (s - 32); }
  }
  return { bH, bL, wH, wL };
}
