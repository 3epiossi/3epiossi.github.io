/**
 * 誰會贏？ 搜尋：機率節點（擲骰）+ 極大節點（選步）的 expectimax。
 *
 * 值一律是「該節點輪到的一方」的勝率 [0, 1]，終局是精確的 0 或 1，葉節點用 eval.js 的勝率。
 * 優化：Star1（Ballard *-minimax）對機率節點收窄子視窗；Star2 風格的探測（先用 TT 最佳步對每個點數
 * 取下界，加總後可直接截斷）；Zobrist 置換表；吃子與歷史啟發排序；迭代加深與時間上限。
 *
 * 規則細節（與 core/game-engine.js 相同）：
 *  - 擲出的點數沒有任何合法步 => PASS，對手進入「自選點數」節點：那一層是對手的 max 節點（任意點數、任意步），
 *    不是機率節點。自選節點若也無步可走，再 PASS 回來；連續兩次視為終局估值。
 *  - 落子後敵方全滅，或 canCaptureEver 為否 => 終局精確值（填滿勢力、含貼目）：
 *    全滅時距離同分歸落子方；自然終局歸下一手（對手）。
 */

import {
  BLACK, WHITE, Position, genMoves, canCaptureEver, settleDiff,
  mvTo, mvFrom, mvCap, mvDie
} from "./core.js";
import { evalWin } from "./eval.js";

const MAXPLY = 80;
const opp = (s) => (s === BLACK ? WHITE : BLACK);

// Zobrist（固定種子，結果可重現）
function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) | 0; };
}
const zr = mulberry(0xC0FFEE);
const Z1 = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
const Z2 = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
for (let s = 1; s <= 2; s++) for (let i = 0; i < 64; i++) { Z1[s][i] = zr(); Z2[s][i] = zr(); }
const TK1 = [0, zr(), zr()], TK2 = [0, zr(), zr()];
const DK1 = [], DK2 = [];
for (let d = 0; d <= 8; d++) { DK1.push(zr()); DK2.push(zr()); }

const TT_BITS = 21;
const EXACT = 0, LOWER = 1, UPPER = 2;

export class Searcher {
  constructor() {
    const n = 1 << TT_BITS;
    this.mask = n - 1;
    this.chk = new Int32Array(n);
    this.dep = new Int8Array(n).fill(-1);
    this.flg = new Uint8Array(n);
    this.val = new Float32Array(n);
    this.mv = new Int32Array(n);
    this.bufs = [];
    this.scores = [];
    for (let i = 0; i < MAXPLY; i++) { this.bufs.push(new Int32Array(512)); this.scores.push(new Int32Array(512)); }
    this.hist = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
    this.pos = new Position();
    this.h1 = 0; this.h2 = 0;
    this.nodes = 0; this.leaves = 0;
    this.abort = false; this.deadline = 0;
  }

  clearTT() { this.dep.fill(-1); this.hist.forEach(a => a.fill(0)); }

  // ---- 雜湊 ----
  _hashMove(m, side) {
    const to = m & 63;
    if ((m >> 12) & 1) {
      const from = (m >> 6) & 63, e = opp(side);
      this.h1 ^= Z1[side][from] ^ Z1[side][to] ^ Z1[e][to];
      this.h2 ^= Z2[side][from] ^ Z2[side][to] ^ Z2[e][to];
    } else {
      this.h1 ^= Z1[side][to]; this.h2 ^= Z2[side][to];
    }
  }
  _initHash() {
    let h1 = 0, h2 = 0;
    const p = this.pos;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const sq = (r << 3) | c;
      if (p.b[r] & (1 << c)) { h1 ^= Z1[BLACK][sq]; h2 ^= Z2[BLACK][sq]; }
      else if (p.w[r] & (1 << c)) { h1 ^= Z1[WHITE][sq]; h2 ^= Z2[WHITE][sq]; }
    }
    this.h1 = h1; this.h2 = h2;
  }

  _tick() {
    if ((++this.nodes & 127) === 0 && Date.now() > this.deadline) this.abort = true;
  }

  /** 落子後的終局檢查：回傳 [-1 未終局 | 該落子方的勝率 0/1] */
  _terminal(side) {
    const p = this.pos;
    const e = side === BLACK ? p.w : p.b;
    let any = 0;
    for (let r = 0; r < 8; r++) any |= e[r];
    if (!any) return 1;
    if (canCaptureEver(p)) return -1;
    const diff = settleDiff(p, opp(side));
    return (side === BLACK ? diff > 0 : diff < 0) ? 1 : 0;
  }

  // ---- 排序 ----
  _order(side, n, ply, ttMove) {
    const buf = this.bufs[ply], sc = this.scores[ply], h = this.hist[side];
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      let s = h[m & 63];
      if ((m >> 12) & 1) s += 100000;
      if (m === ttMove) s += 1000000;
      sc[i] = s;
    }
    for (let i = 1; i < n; i++) {
      const m = buf[i], s = sc[i];
      let j = i - 1;
      while (j >= 0 && sc[j] < s) { buf[j + 1] = buf[j]; sc[j + 1] = sc[j]; j--; }
      buf[j + 1] = m; sc[j + 1] = s;
    }
  }

  /** 深度 >= 3 的極大節點：用子節點（機率節點）在置換表裡已有的值排序（前一層迭代留下的），比歷史啟發準 */
  _orderByTT(side, n, ply, ttMove) {
    const buf = this.bufs[ply], sc = this.scores[ply], h = this.hist[side], pos = this.pos, e = opp(side);
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      let s = h[m & 63];
      if ((m >> 12) & 1) s += 100000;
      pos.makeMove(m, side); this._hashMove(m, side);
      const k1 = this.h1 ^ TK1[e] ^ DK1[0], k2 = this.h2 ^ TK2[e] ^ DK2[0];
      const idx = k1 & this.mask;
      if (this.chk[idx] === k2 && this.dep[idx] >= 0) {
        const v = this.val[idx], f = this.flg[idx];
        // 子節點是對手的勝率：越低對我越好；邊界值（UPPER / LOWER）只當粗略排序
        s += Math.round((1 - v) * 200000) + 300000;
        if (f === UPPER) s += 0; // 保持簡單：不細分
      }
      pos.unmakeMove(m, side); this._hashMove(m, side);
      if (m === ttMove) s += 10000000;
      sc[i] = s;
    }
    for (let i = 1; i < n; i++) {
      const m = buf[i], s = sc[i];
      let j = i - 1;
      while (j >= 0 && sc[j] < s) { buf[j + 1] = buf[j]; sc[j + 1] = sc[j]; j--; }
      buf[j + 1] = m; sc[j + 1] = s;
    }
  }

  _probe(key1, key2, depth) {
    const i = key1 & this.mask;
    if (this.chk[i] === key2 && this.dep[i] >= depth) return i;
    return -1;
  }
  _ttMove(key1, key2) {
    const i = key1 & this.mask;
    return this.chk[i] === key2 && this.dep[i] >= 0 ? this.mv[i] : -1;
  }
  _store(key1, key2, depth, flag, value, move) {
    const i = key1 & this.mask;
    if (this.chk[i] !== key2 || depth >= this.dep[i]) {
      this.chk[i] = key2; this.dep[i] = depth; this.flg[i] = flag; this.val[i] = value; this.mv[i] = move;
    }
  }

  // ---- 節點 ----
  /** 機率節點：side 擲骰前。 */
  chance(side, depth, alpha, beta, ply) {
    const k1 = this.h1 ^ TK1[side] ^ DK1[0], k2 = this.h2 ^ TK2[side] ^ DK2[0];
    const pi = this._probe(k1, k2, depth);
    if (depth <= 0) {
      // 葉節點的靜態評估也進置換表：不同走法順序常到同一局面
      if (pi >= 0 && this.flg[pi] === EXACT) return this.val[pi];
      this.leaves++;
      const v = evalWin(this.pos, side);
      this._store(k1, k2, 0, EXACT, v, 0);
      return v;
    }
    if (pi >= 0) {
      const v = this.val[pi], f = this.flg[pi];
      if (f === EXACT) return v;
      if (f === LOWER && v >= beta) return v;
      if (f === UPPER && v <= alpha) return v;
    }
    let sum = 0;
    const a0 = alpha, b0 = beta;
    let result = -1, flag = EXACT;
    for (let i = 0; i < 6; i++) {
      const rest = 5 - i;
      const ai = 6 * alpha - sum - rest, bi = 6 * beta - sum;
      const lo = ai > 0 ? ai : 0, hi = bi < 1 ? bi : 1;
      const v = this.maxNode(side, i + 1, depth, lo, hi, ply);
      if (this.abort) return 0;
      sum += v;
      if (v <= ai && ai > 0) { result = (sum + rest) / 6; flag = UPPER; break; }
      if (v >= bi && bi < 1) { result = sum / 6; flag = LOWER; break; }
    }
    if (result < 0) result = sum / 6;
    if (flag === EXACT && (result <= a0 || result >= b0)) flag = result <= a0 ? UPPER : LOWER;
    this._store(k1, k2, depth, flag, result, 0);
    return result;
  }

  /** 極大節點：side 擲出 d，選一步。 */
  maxNode(side, d, depth, alpha, beta, ply) {
    this._tick();
    if (this.abort) return 0;
    const k1 = this.h1 ^ TK1[side] ^ DK1[d], k2 = this.h2 ^ TK2[side] ^ DK2[d];
    const pi = this._probe(k1, k2, depth);
    let ttMove = -1;
    if (pi >= 0) {
      const v = this.val[pi], f = this.flg[pi];
      ttMove = this.mv[pi];
      if (f === EXACT) return v;
      if (f === LOWER && v >= beta) return v;
      if (f === UPPER && v <= alpha) return v;
    } else ttMove = this._ttMove(k1, k2);
    const pos = this.pos, e = opp(side);
    const n = genMoves(pos, side, d, this.bufs[ply]);
    if (n === 0) {
      // PASS：對手自選點數
      const v = 1 - this.freeNode(e, depth - 1, 1 - beta, 1 - alpha, ply + 1, 0);
      if (!this.abort) this._store(k1, k2, depth, EXACT, v, 0);
      return v;
    }
    if (depth >= 3) this._orderByTT(side, n, ply, ttMove); else this._order(side, n, ply, ttMove);
    const buf = this.bufs[ply];
    let best = -1, bestMove = buf[0], a = alpha;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      pos.makeMove(m, side); this._hashMove(m, side);
      let v = this._terminal(side);
      if (v < 0) v = 1 - this.chance(e, depth - 1, 1 - beta, 1 - a, ply + 1);
      pos.unmakeMove(m, side); this._hashMove(m, side);
      if (this.abort) return 0;
      if (v > best) { best = v; bestMove = m; if (v > a) a = v; }
      if (a >= beta) { this.hist[side][m & 63] += depth * depth; break; }
    }
    const flag = best <= alpha ? UPPER : best >= beta ? LOWER : EXACT;
    this._store(k1, k2, depth, flag, best, bestMove);
    return best;
  }

  /** 自選點數節點：side 可選任意點數與任意步。 */
  freeNode(side, depth, alpha, beta, ply, passes) {
    this._tick();
    if (this.abort) return 0;
    const pos = this.pos, e = opp(side);
    if (depth <= 0) { this.leaves++; const v = evalWin(pos, side) + 0.08; return v > 1 ? 1 : v; }
    const n = genMoves(pos, side, 0, this.bufs[ply]);
    if (n === 0) {
      if (passes >= 1) { this.leaves++; return evalWin(pos, side); }
      return 1 - this.freeNode(e, depth - 1, 1 - beta, 1 - alpha, ply + 1, passes + 1);
    }
    this._order(side, n, ply, -1);
    const buf = this.bufs[ply];
    let best = -1, a = alpha;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      pos.makeMove(m, side); this._hashMove(m, side);
      let v = this._terminal(side);
      if (v < 0) v = 1 - this.chance(e, depth - 1, 1 - beta, 1 - a, ply + 1);
      pos.unmakeMove(m, side); this._hashMove(m, side);
      if (this.abort) return 0;
      if (v > best) { best = v; if (v > a) a = v; }
      if (a >= beta) break;
    }
    return best;
  }

  /**
   * 根節點分析。
   * pos：Position（turn、free 已設定）。opts：
   *   maxDepth 迭代加深上限、timeMs 時間上限、die 只算某個點數（null = 全部 1..6；自選回合也是全部）、
   *   allMoves 為真時回傳每一步的精確勝率（提示、走法評價用，較慢）、
   *   fixedDepth 為真時每個深度都不被時間截斷（固定層數，棋力與機器快慢無關）。
   * 回傳 { value, depth, solved, nodes, perDie: [{ die, value, move, moves? }], mode }
   *   value：輪到的一方的勝率。roll 模式是六個點數的平均；free 模式是最佳點數的值。
   *   perDie[d-1].move：該點數的最佳步（編碼，見 core.js），沒有合法步時為 -1（= PASS）。
   */
  analyze(posIn, opts = {}) {
    const { maxDepth = 4, timeMs = 1000, die = null, allMoves = false, fixedDepth = false } = opts;
    this.pos.b.set(posIn.b); this.pos.w.set(posIn.w);
    this.pos.turn = posIn.turn; this.pos.free = posIn.free; this.pos.komi = posIn.komi;
    if (this.komiSeen !== posIn.komi) { this.clearTT(); this.komiSeen = posIn.komi; }
    this.lastBest = null;
    this._initHash();
    this.nodes = 0; this.abort = false;
    this.deadline = fixedDepth ? Infinity : Date.now() + timeMs;
    const side = posIn.turn, free = posIn.free;
    let result = null;
    for (let depth = 1; depth <= maxDepth; depth++) {
      this.leaves = 0;
      const res = free ? this._rootFree(side, depth, allMoves) : this._rootRoll(side, depth, die, allMoves);
      if (this.abort || !res) break;
      res.depth = depth; res.nodes = this.nodes; res.solved = this.leaves === 0;
      result = res;
      if (res.solved) break;
      if (Date.now() > this.deadline) break;
    }
    if (!result) { // 連第 1 層都沒完成：用靜態評估
      result = { value: evalWin(this.pos, side), perDie: [], depth: 0, nodes: this.nodes, solved: false, mode: free ? "free" : "roll" };
    }
    return result;
  }

  _rootMoves(side, d, depth, allMoves, prevBest) {
    const pos = this.pos, e = opp(side);
    const n = genMoves(pos, side, d, this.bufs[0]);
    if (n === 0) {
      const v = 1 - this.freeNode(e, depth - 1, 0, 1, 1, 0);
      return { value: v, move: -1, moves: [] };
    }
    this._order(side, n, 0, prevBest);
    const buf = this.bufs[0];
    const list = [];
    let best = -1, bestMove = buf[0], a = 0;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      list.push(m);
    }
    const moves = [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      pos.makeMove(m, side); this._hashMove(m, side);
      let v = this._terminal(side);
      if (v < 0) {
        // allMoves：每一步都要精確值，不能用 alpha 剪；否則只需要確認是否超過目前最佳
        v = 1 - this.chance(e, depth - 1, 0, allMoves ? 1 : 1 - a, 1);
      }
      pos.unmakeMove(m, side); this._hashMove(m, side);
      if (this.abort) return null;
      moves.push({ move: m, value: v });
      if (v > best) { best = v; bestMove = m; if (v > a) a = v; }
    }
    return { value: best, move: bestMove, moves: allMoves ? moves : undefined };
  }

  _rootRoll(side, depth, die, allMoves) {
    const perDie = [];
    let sum = 0, cnt = 0;
    const dice = die ? [die] : [1, 2, 3, 4, 5, 6];
    for (const d of dice) {
      const prev = this.lastBest ? this.lastBest[d] : -1;
      const r = this._rootMoves(side, d, depth, allMoves, prev);
      if (!r) return null;
      if (!this.lastBest) this.lastBest = {};
      this.lastBest[d] = r.move;
      perDie[d - 1] = { die: d, value: r.value, move: r.move, moves: r.moves };
      sum += r.value; cnt++;
    }
    return { value: sum / cnt, perDie, mode: "roll" };
  }

  _rootFree(side, depth, allMoves) {
    const pos = this.pos, e = opp(side);
    const n = genMoves(pos, side, 0, this.bufs[0]);
    if (n === 0) {
      const v = 1 - this.freeNode(e, depth - 1, 0, 1, 1, 1);
      return { value: v, perDie: [], mode: "free" };
    }
    this._order(side, n, 0, -1);
    const list = Array.from(this.bufs[0].subarray(0, n));
    const perDie = [];
    let best = -1;
    for (const m of list) {
      pos.makeMove(m, side); this._hashMove(m, side);
      let v = this._terminal(side);
      if (v < 0) v = 1 - this.chance(e, depth - 1, 0, 1, 1);
      pos.unmakeMove(m, side); this._hashMove(m, side);
      if (this.abort) return null;
      const d = mvDie(m);
      let pd = perDie[d - 1];
      if (!pd) pd = perDie[d - 1] = { die: d, value: -1, move: -1, moves: [] };
      pd.moves.push({ move: m, value: v });
      if (v > pd.value) { pd.value = v; pd.move = m; }
      if (v > best) best = v;
    }
    return { value: best, perDie, mode: "free" };
  }
}

export { mvTo, mvFrom, mvCap, mvDie };
