/**
 * 誰會贏？ 快速規則核心（位元列表示法，make/unmake，無配置）
 *
 * 棋盤 8x8，每列一個位元組：列 r 的第 c 欄是位元 (1 << c)，r、c 皆從 0 起算，
 * 與 core/rules.js 的 (r, c) 完全相同。黑棋朝「上、左」（r、c 變小）進攻，白棋朝「下、右」。
 * 規則以 core/rules.js 為準，tests/whowins-engine.test.js 用隨機局面逐項比對。
 *
 * 走法編碼（整數）：to | (from << 6) | (isCapture << 12) | (die << 13)
 *   生子：from 固定等於 to（落子結果只和目標格有關，不同來源的同目標生子視為同一步）
 *   吃子：from 是出發格、to 是被吃的敵棋格
 */

export const BLACK = 1;
export const WHITE = 2;
export const KOMI_DEFAULT = 3.5;

export const POP = new Uint8Array(256);
for (let i = 1; i < 256; i++) POP[i] = POP[i >> 1] + (i & 1);

// LEFTFILL[seed][allowed]：種子位元向低位（左）延伸，只能走在 allowed 的連續區段內
// RIGHTFILL：向高位（右）延伸
const LEFTFILL = new Uint8Array(65536);
const RIGHTFILL = new Uint8Array(65536);
for (let allowed = 0; allowed < 256; allowed++) {
  for (let seed = 0; seed < 256; seed++) {
    let x = seed & allowed;
    for (let i = 0; i < 7; i++) x |= (x >> 1) & allowed;
    LEFTFILL[(seed << 8) | allowed] = x;
    let y = seed & allowed;
    for (let i = 0; i < 7; i++) y |= (y << 1) & allowed;
    RIGHTFILL[(seed << 8) | allowed] = y;
  }
}

export const mvTo = (m) => m & 63;
export const mvFrom = (m) => (m >> 6) & 63;
export const mvCap = (m) => (m >> 12) & 1;
export const mvDie = (m) => m >> 13;
export const mkMove = (from, to, cap, die) => to | (from << 6) | (cap << 12) | (die << 13);

export class Position {
  constructor() {
    this.b = new Uint8Array(8); // 黑棋各列
    this.w = new Uint8Array(8); // 白棋各列
    this.turn = BLACK;
    this.free = false; // true：對手 PASS 後的自選點數回合
    this.komi = KOMI_DEFAULT;
    this.reset();
  }

  reset() {
    this.b.fill(0); this.w.fill(0);
    this.w[0] = 1;        // A1 白
    this.b[7] = 1 << 7;   // H8 黑
    this.turn = BLACK;
    this.free = false;
    return this;
  }

  /** 從 rules.js 的二維陣列載入（0 空、1 黑、2 白） */
  load(grid, turn, free = false, komi = this.komi) {
    this.b.fill(0); this.w.fill(0);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (grid[r][c] === BLACK) this.b[r] |= 1 << c;
        else if (grid[r][c] === WHITE) this.w[r] |= 1 << c;
      }
    }
    this.turn = turn; this.free = !!free; this.komi = komi;
    return this;
  }

  toGrid() {
    const g = Array.from({ length: 8 }, () => Array(8).fill(0));
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.b[r] & (1 << c)) g[r][c] = BLACK;
        else if (this.w[r] & (1 << c)) g[r][c] = WHITE;
      }
    }
    return g;
  }

  clone() {
    const p = new Position();
    p.b.set(this.b); p.w.set(this.w);
    p.turn = this.turn; p.free = this.free; p.komi = this.komi;
    return p;
  }

  count(side) {
    const a = side === BLACK ? this.b : this.w;
    let n = 0;
    for (let r = 0; r < 8; r++) n += POP[a[r]];
    return n;
  }

  /** 落子（不改 turn）。生子：to 位元設為己方；吃子：from 清除、to 換成己方 */
  makeMove(m, side) {
    const to = m & 63, cap = (m >> 12) & 1;
    const tr = to >> 3, tb = 1 << (to & 7);
    if (side === BLACK) {
      this.b[tr] |= tb;
      if (cap) { this.w[tr] &= ~tb; const f = (m >> 6) & 63; this.b[f >> 3] &= ~(1 << (f & 7)); }
    } else {
      this.w[tr] |= tb;
      if (cap) { this.b[tr] &= ~tb; const f = (m >> 6) & 63; this.w[f >> 3] &= ~(1 << (f & 7)); }
    }
  }

  unmakeMove(m, side) {
    const to = m & 63, cap = (m >> 12) & 1;
    const tr = to >> 3, tb = 1 << (to & 7);
    if (side === BLACK) {
      this.b[tr] &= ~tb;
      if (cap) { this.w[tr] |= tb; const f = (m >> 6) & 63; this.b[f >> 3] |= 1 << (f & 7); }
    } else {
      this.w[tr] &= ~tb;
      if (cap) { this.b[tr] |= tb; const f = (m >> 6) & 63; this.w[f >> 3] |= 1 << (f & 7); }
    }
  }
}

const SP = []; // 生子可達集：SP[d] 為 8 列位元組
for (let d = 0; d <= 6; d++) SP.push(new Uint8Array(8));
const TMP = new Uint8Array(8);

/**
 * 產生 side 在點數 d（1..6）的所有走法，寫入 out，回傳數量；dice 為 0 表示全部點數 1..6。
 * 吃子排在前面。生子以目標格去重。
 */
export function genMoves(pos, side, d, out) {
  let n = 0;
  const mine = side === BLACK ? pos.b : pos.w;
  const theirs = side === BLACK ? pos.w : pos.b;
  const d0 = d === 0 ? 1 : d, d1 = d === 0 ? 6 : d;

  // 吃子：每顆棋每個方向至多一步（第一個敵棋，距離 <= 6）
  for (let r = 0; r < 8; r++) {
    const row = mine[r];
    if (!row) continue;
    for (let c = 0; c < 8; c++) {
      if (!(row & (1 << c))) continue;
      const from = (r << 3) | c;
      if (side === BLACK) {
        for (let k = 1; k <= 6 && c - k >= 0; k++) {
          if (theirs[r] & (1 << (c - k))) { if (k >= d0 && k <= d1) out[n++] = mkMove(from, (r << 3) | (c - k), 1, k); break; }
        }
        for (let k = 1; k <= 6 && r - k >= 0; k++) {
          if (theirs[r - k] & (1 << c)) { if (k >= d0 && k <= d1) out[n++] = mkMove(from, ((r - k) << 3) | c, 1, k); break; }
        }
      } else {
        for (let k = 1; k <= 6 && c + k < 8; k++) {
          if (theirs[r] & (1 << (c + k))) { if (k >= d0 && k <= d1) out[n++] = mkMove(from, (r << 3) | (c + k), 1, k); break; }
        }
        for (let k = 1; k <= 6 && r + k < 8; k++) {
          if (theirs[r + k] & (1 << c)) { if (k >= d0 && k <= d1) out[n++] = mkMove(from, ((r + k) << 3) | c, 1, k); break; }
        }
      }
    }
  }

  // 生子：整隊同時推進 d1 步，第 k 步的集合 & 空格 就是點數 k 的生子目標
  let cur = SP[0];
  for (let r = 0; r < 8; r++) cur[r] = mine[r];
  for (let k = 1; k <= d1; k++) {
    const nxt = SP[k];
    if (side === BLACK) {
      for (let r = 0; r < 8; r++) {
        const below = r < 7 ? cur[r + 1] : 0;
        nxt[r] = (((cur[r] >> 1) | below) & ~theirs[r]) & 255;
      }
    } else {
      for (let r = 0; r < 8; r++) {
        const above = r > 0 ? cur[r - 1] : 0;
        nxt[r] = ((((cur[r] << 1) & 255) | above) & ~theirs[r]) & 255;
      }
    }
    cur = nxt;
    if (k >= d0) {
      for (let r = 0; r < 8; r++) {
        let bits = nxt[r] & ~(mine[r] | theirs[r]) & 255;
        while (bits) {
          const lb = bits & -bits;
          const c = 31 - Math.clz32(lb);
          const sq = (r << 3) | c;
          out[n++] = mkMove(sq, sq, 0, k);
          bits ^= lb;
        }
      }
    }
  }
  return n;
}

const VB = new Uint8Array(8);
const VW = new Uint8Array(8);

/** 雙方是否還有可能互相吃子（同 rules.canCaptureEver） */
export function canCaptureEver(pos) {
  const B = pos.b, W = pos.w;
  let bAny = 0, wAny = 0;
  for (let r = 0; r < 8; r++) { bAny |= B[r]; wAny |= W[r]; }
  if (!bAny || !wAny) return false;
  let prev = 0;
  for (let r = 7; r >= 0; r--) {
    const allowed = ~W[r] & 255;
    const seed = B[r] | (prev & allowed);
    prev = LEFTFILL[(seed << 8) | allowed];
    VB[r] = prev;
  }
  prev = 0;
  for (let r = 0; r < 8; r++) {
    const allowed = ~B[r] & 255;
    const seed = W[r] | (prev & allowed);
    prev = RIGHTFILL[(seed << 8) | allowed];
    VW[r] = prev;
  }
  let above = 0;
  for (let r = 0; r < 8; r++) {
    const vb = VB[r], vw = VW[r];
    if (vb && vw) {
      const lowW = vw & -vw;
      const hiB = 1 << (31 - Math.clz32(vb));
      if (lowW < hiB) return true;
    }
    if (vb & above) return true;
    above |= vw;
  }
  return false;
}

export const RB = new Uint8Array(8), RW = new Uint8Array(8);
const NB = new Uint8Array(8), NW = new Uint8Array(8);
const FB = new Uint8Array(8), FW = new Uint8Array(8);

function stepBlack(src, dst, W) {
  let any = 0;
  for (let r = 0; r < 8; r++) {
    const below = r < 7 ? src[r + 1] : 0;
    const v = (((src[r] >> 1) | below) & ~W[r]) & 255;
    dst[r] = v; any |= v;
  }
  return any;
}
function stepWhite(src, dst, B) {
  let any = 0;
  for (let r = 0; r < 8; r++) {
    const above = r > 0 ? src[r - 1] : 0;
    const v = ((((src[r] << 1) & 255) | above) & ~B[r]) & 255;
    dst[r] = v; any |= v;
  }
  return any;
}

/**
 * 終局勢力填滿（同 rules.fillTerritoryRule1Rule2）。結果寫入 outB / outW（各 8 列），
 * 回傳 { }：不配置物件，直接回傳 (黑格數 - 白格數) 與填滿格數可由 outB/outW 算出。
 * firstTurn：距離相同時歸誰。
 */
export function fillTerritory(pos, firstTurn, outB, outW) {
  const B = pos.b, W = pos.w;
  for (let r = 0; r < 8; r++) {
    RB[r] = B[r]; RW[r] = W[r]; outB[r] = B[r]; outW[r] = W[r];
  }
  // 逐層擴張：RB / RW 是已到達集合（含棋子本身）
  for (let lvl = 1; lvl <= 16; lvl++) {
    stepBlack(RB, NB, W);
    stepWhite(RW, NW, B);
    let any = 0;
    for (let r = 0; r < 8; r++) {
      const newB = NB[r] & ~RB[r];
      const newW = NW[r] & ~RW[r];
      if (!(newB | newW)) { FB[r] = 0; FW[r] = 0; continue; }
      const prevB = RB[r], prevW = RW[r];
      // 只算空格：棋子本身在層 0 已在 RB / RW
      const both = newB & newW;
      let gB = newB & ~prevW & ~both;
      let gW = newW & ~prevB & ~both;
      if (both) { if (firstTurn === BLACK) gB |= both & ~prevB & ~prevW; else gW |= both & ~prevB & ~prevW; }
      // 先前已被對方（較早層）到達的格子不算
      outB[r] |= gB & ~W[r] & ~B[r];
      outW[r] |= gW & ~W[r] & ~B[r];
      FB[r] = newB; FW[r] = newW; any |= newB | newW;
    }
    for (let r = 0; r < 8; r++) { RB[r] |= FB[r]; RW[r] |= FW[r]; }
    if (!any) break;
  }
}

const OB = new Uint8Array(8), OW = new Uint8Array(8);

/** 終局結算：回傳黑方淨勝分（黑格 - 白格 - 貼目），不含平手（貼目 x.5） */
export function settleDiff(pos, firstTurn) {
  fillTerritory(pos, firstTurn, OB, OW);
  let bn = 0, wn = 0;
  for (let r = 0; r < 8; r++) { bn += POP[OB[r]]; wn += POP[OW[r]]; }
  return bn - wn - pos.komi;
}

/** 落子後若敵方全滅或已無互吃可能，回傳終局黑方淨勝分；否則回傳 null（呼叫者用 isTerminalAfterMove） */
export function isTerminal(pos) {
  return !canCaptureEver(pos);
}
