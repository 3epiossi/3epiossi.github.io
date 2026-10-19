/**
 * 🎯 v8 搜尋引擎：五連模式（左右數字棋）
 *
 * 規則見 core/five-rules.js：連續 5 顆己方的棋、每顆任選左或右能全部相同 → 直接獲勝；
 * 否則比分數：加權五連每顆 = 左 × 右（params.weighted = true），五連每顆 1 分（V8_PLAIN_PARAMS）。
 *
 * 由 v6（黑白棋）與五子棋引擎（參考 rapfi 的作法，不含其程式碼）改造：
 *
 * v6 的部分（匯入共用）
 *   位元棋盤、迭代加深 NegaScout、Zobrist 雜湊與置換表、fastest-first 排序、
 *   以穩定子／行動力／邊界子為主的局面評估（每顆棋的分數改成左 × 右，兩面相同）。
 *
 * 五子棋的部分
 *   - 成五檢查：落子後掃 96 個五連窗口，用位元遮罩一次判斷「五格是否都是己方」，
 *     再把五顆棋的數字集合做 AND，非零就是五連。
 *   - 威脅評估（rapfi 的活四／衝四／活三概念）：每個仍有共同數字的五連窗口，
 *     依己方已佔幾格給分；被對手佔住的格子在黑白棋裡還能翻回來，所以不是死路，只打折。
 *   - 走法排序（rapfi 的 movepick）：必勝步 → 可能成五的步 → 擋住對手「四缺一」的格子 → v6 的排序。
 *
 * 跟一般五子棋不同的兩點
 *   - 抽棋是機會節點：根節點手上的棋已知；搜尋深處落下的棋數字未知（以平均分數代入），
 *     「這一步能成五」只是機率 p（袋中能補上共同數字的棋所佔的比例）。
 *     這一步的價值 = p × 勝 + (1 − p) × 繼續下去的結果，搜尋視窗依此線性轉換。
 *     沒有「保證必勝」的連續衝四，所以不做 rapfi 的 VCF 搜尋。
 *   - 翻面也能成五：翻過來的棋可能剛好補齊另一條線，成五檢查掃整個棋盤而非只看落子點。
 */

import { RH, RL, mobility, flips, setBit, count, squaresOf } from "../v6/bitboard.js";
import { evaluate, finalDiff, PARAMS } from "../v6/eval.js";
import {
  Z1, Z2, H1, H2, SIDE1, SIDE2,
  TT_MASK, TT_K2, TT_DEPTH, TT_FLAG, TT_SCORE, TT_MOVE, EXACT, LOWER, UPPER,
  SQ_ORDER, keyAfter, insertionSort
} from "../v6/search.js";
import { leftOf, rightOf, valueOf, numberMask, FIVE_WINDOWS } from "../../core/five-rules.js";
import { extractFeatures, phaseOf, NF } from "./features.js";

const BLACK = 1, WHITE = 2;
export const V8_EXACT_EMPTIES = 7;

/**
 * 價值的單位（rapfi、AlphaZero 的作法）：這個遊戲只在乎輸贏，不在乎贏多少。
 *   winProb 模式（v8 預設）：價值 = 勝率尺度 [-1, 1]
 *     成五 = +1（越早成五越好：WIN − ply × 1e-4）；比分數的終局 = 贏 +1／輸 −1／平 0；
 *     搜尋到一半的局面 = tanh(評估值 ÷ valueScale)。
 *     「5% 機率直接成五」與「盤面領先帶來的勝率」因此能放在同一個尺度比較。
 *   分數模式（winProb = false，評測用的基準）：價值 = 預期分數差，成五 = WIN_SCORE。
 */
export const WIN = 1;
const WIN_SCORE = 100000;
let winValue = WIN;
const isWinScore = (v) => Math.abs(v) > winValue * 0.5;

export const V8_PARAMS = {
  ...PARAMS,
  mpc: false,          // MPC 的統計是在沒有「勝利分數」的情況下量的，v8 不用
  five: true,          // false = 只比分數的黑白棋（評測用的基準）
  threat: [0, 1, 6, 30, 160], // 五連窗口中己方已佔 0～4 格的威脅分（分數單位）
  oppFactor: 0.35,     // 窗口裡每有一顆對手的棋，威脅打這個折（可翻回來，不是死路）
  tempo: 1.6,          // 輪到自己下時，自己的「四缺一」更危險
  threatScale: 0,      // 靜態威脅評估：實測只會讓 v8 變弱（見 README），預設關閉，交給搜尋算成五機率
  winProb: true,       // 價值用勝率尺度（見上方說明）
  weighted: true,      // true：每顆棋 = 左 × 右（加權五連）；false：每顆 1 分（五連）
  valueScaleLate: null, // 終盤的勝率換算係數（null = 與 valueScale 相同）；依剩餘空格從 valueScale 線性過渡到這個值
  fiveTrust: 1,        // 搜尋中「可能成五」機率的折扣（1 = 不打折；一定成五不打折）
  oppFiveTrust: 1,     // 只對「對手」可能成五的機率再打折（實驗用：測試是否過度防守）
  model: null,         // 學習型評估（tests/train-eval.js 訓練的權重）；有值時取代人工評估與勝率換算
  terminalScale: 0,    // 比分數的終局：0 = 只看輸贏（±1）；> 0 = tanh(分數差 ÷ terminalScale)，偏好安全的大領先
  valueScale: 1500     // 評估值換算勝率：tanh(評估值 ÷ valueScale)（tests/v8-match.js 調得）
};

/** 五連模式（每顆 1 分）的參數：評估值約小 20 倍，勝率換算係數跟著縮小 */
export const V8_PLAIN_PARAMS = {
  ...V8_PARAMS,
  weighted: false,
  // 每顆 1 分時，比棋子數的終局佔一半以上：開局換算平緩（五連機會比較重要），終盤陡峭（棋子數的小差距就決定勝負）
  valueScale: 301,
  valueScaleLate: 29.4,
  // 搜尋假設對手也全力追五連，會為了防守而讓出棋子數；對手的成五機率打 7 折（tests/v8-arena.js 調得）
  oppFiveTrust: 0.72,
  // 以下由自我對戰調參（tests/spsa-tune.js：4 條 SPSA 鏈、各 800 輪 × 8 局、3 層搜尋，取平均）
  // 4 條鏈一致的方向：開局行動力降低（1.6 → 1.2）、角落加重（2.5 → 2.74）、X 格懲罰加重（4.0 → 4.31）
  alphaStart: 0.316,
  alphaGain: 0.209,
  edgeBonus: 0.078,
  mobEarly: 1.204,
  mobLate: 0.543,
  frontier: 0.41,
  corner: 2.741,
  xSquare: 4.309,
  cSquare: 1.248,
  parity: 1.455
};

// ===== 搜尋狀態 =====
const FV = new Float64Array(64);    // 每格棋子分數（左 × 右；搜尋中未知的棋 = 袋中平均）
const NM = new Uint8Array(64);      // 每格棋子的數字集合
const KNOWN = new Uint8Array(64);   // 這格的棋數字是否已知（搜尋中以平均棋代入的為 0）
const QTAB = new Float64Array(256); // 數字集合 V → 袋中一顆棋含有 V 中任一數字的機率
const Q1 = new Float64Array(9);     // 袋中一顆棋含有數字 v 的機率
let avgVal = 20.25;
// 池子規則（見 searchRootV8 的 pool 參數）：POOL_N = 每次可選幾顆；K1 = 根節點下一手（對手）確定看得到的棋（數字集合）
let POOL_N = 1;
let K1 = [];
let POOL_DEEP = true; // false = 只有根節點的下一手照池子算，更深的仍當成隨機抽（比較保守）
const discVal = (id) => (params.weighted ? valueOf(id) : 1);
let deadline = Infinity;
let nodes = 0;
let params = V8_PARAMS;
const ABORT = { abort: true };
const MAX_PLY = 70;
const MOVES = Array.from({ length: MAX_PLY }, () => new Int8Array(32));
const KEYS = Array.from({ length: MAX_PLY }, () => new Float64Array(32));
let NULL_EPS = 1e-4;
const sqBuf = [];

// ===== 五連窗口 =====
const NW = FIVE_WINDOWS.length;
const WSQ = new Int8Array(NW * 5);      // 每個窗口的 5 格
const WH = new Int32Array(NW), WL = new Int32Array(NW); // 每個窗口的位元遮罩
FIVE_WINDOWS.forEach((cells, w) => {
  let h = 0, l = 0;
  cells.forEach(([r, c], k) => {
    const s = r * 8 + c;
    WSQ[w * 5 + k] = s;
    if (s < 32) l |= 1 << s; else h |= 1 << (s - 32);
  });
  WH[w] = h; WL[w] = l;
});
// 每一格屬於哪些窗口（成五檢查只看有變動的格子所在的窗口）
const SQ_WINS = Array.from({ length: 64 }, () => []);
for (let w = 0; w < NW; w++) for (let k = 0; k < 5; k++) SQ_WINS[WSQ[w * 5 + k]].push(w);
const SQ_WIN_ARR = SQ_WINS.map(a => Int16Array.from(a));
const STAMP = new Int32Array(NW);
let stampId = 0;
const PCACHE = Array.from({ length: 70 }, () => new Float64Array(64)); // 排序時算好的成五機率，下棋時重用

const popcount = (x) => {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24);
};

/**
 * 落子（或翻面）後，下棋者 P 連成五的機率。
 * 搜尋中以平均棋代入的落子數字未知（KNOWN = 0）：
 *   一條五連裡未知的棋有 u 顆，成五機率 ≈ 已知棋子共同數字中，最好的 v 的 Q1[v]^u
 *   （只有一顆未知時，用「含共同數字中任一個」的精確機率 QTAB）。
 * 回傳 1 = 一定成五；0 = 不會成五；介於之間 = 機率（多個窗口取最大值）。
 *
 * 只看這一步「新形成」的五連（prevH/prevL = 落子前的己方位元）：
 * 已經全是己方、卻因為未知棋子沒成五的窗口，搜尋走的是「沒成五」那一支，之後不能再算一次。
 */
function fiveChance(pH, pL, prevH, prevL, ply = 2) {
  // 新形成的五連一定包含這一步有變動的格子（落子 + 翻面）
  let ch = pH & ~prevH, cl = pL & ~prevL;
  const stamp = ++stampId;
  let best = 0;
  while (ch !== 0 || cl !== 0) {
    let q;
    if (cl !== 0) { const bb = cl & -cl; q = 31 - Math.clz32(bb); cl ^= bb; }
    else { const bb = ch & -ch; q = 63 - Math.clz32(bb); ch ^= bb; }
    const ws = SQ_WIN_ARR[q];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (STAMP[w] === stamp) continue;
      STAMP[w] = stamp;
      if ((pH & WH[w]) !== WH[w] || (pL & WL[w]) !== WL[w]) continue;
      const b = w * 5;
      let m = 0xFF, u = 0;
      for (let k = 0; k < 5; k++) {
        const sq = WSQ[b + k];
        if (KNOWN[sq]) m &= NM[sq]; else u++;
      }
      if (!m) continue;
      if (u === 0) return 1;
      let p;
      if (u === 1) p = pickChance(m, ply);
      else {
        p = 0;
        // 只有這一步的棋是「挑過」的；之前以平均棋代入的 u − 1 顆仍是隨機的（沒有為這條線挑）
        for (let v = 1; v <= 8; v++) if (m & (1 << (v - 1))) p = Math.max(p, pickChance(1 << (v - 1), ply) * Q1[v] ** (u - 1));
      }
      if (p > best) best = p;
    }
  }
  return best;
}

/**
 * 下棋者能拿到一顆「含 m 中任一數字」的棋的機率。
 *   沒有池子（N = 1）：抽到的那顆剛好符合 = QTAB[m]
 *   池子 N 顆、可以挑：至少一顆符合 = 1 − (1 − q)^N
 *   根節點的下一手（對手）：池子裡有幾顆是已知的（K1），其中有符合的就一定拿得到，其餘位置才是隨機
 */
function pickChance(m, ply) {
  const q = QTAB[m];
  if (POOL_N <= 1) return q;
  if (ply === 1) {
    for (let i = 0; i < K1.length; i++) if (K1[i] & m) return 1;
    return 1 - (1 - q) ** (POOL_N - K1.length);
  }
  if (!POOL_DEEP) return q;
  return 1 - (1 - q) ** POOL_N;
}

/**
 * 五連威脅評估（下棋者角度）。
 * 每個仍有共同數字的窗口：己方佔 k 格、對手佔 j 格 → 己方威脅 threat[k] × oppFactor^j，對手同理。
 * 窗口裡同時有雙方的棋時，兩邊各自打折（之後翻來翻去都有可能）。
 */
function threatEval(pH, pL, oH, oL) {
  const T = params.threat, f = params.oppFactor;
  let mine = 0, theirs = 0;
  for (let w = 0; w < NW; w++) {
    const b = w * 5;
    let m = 0xFF, unknown = 0;
    for (let k = 0; k < 5; k++) {
      const q = WSQ[b + k];
      const occupied = q < 32 ? ((pL | oL) >>> q) & 1 : ((pH | oH) >>> (q - 32)) & 1;
      if (!occupied) continue;
      if (KNOWN[q]) m &= NM[q]; else unknown++;
    }
    if (!m) continue;
    const a = popcount(pH & WH[w]) + popcount(pL & WL[w]);
    const o = popcount(oH & WH[w]) + popcount(oL & WL[w]);
    // 數字未知的棋不一定含共同數字：每顆打 UNKNOWN_FACTOR 折
    const uf = unknown ? UNKNOWN_FACTOR ** unknown : 1;
    if (a >= 5 || o >= 5) continue; // 五格全滿卻沒成五：這個窗口已經沒有機會
    if (a) mine += T[a] * (o ? f ** o : 1) * uf;
    if (o) theirs += T[o] * (a ? f ** a : 1) * uf;
  }
  return (mine * params.tempo - theirs) * params.threatScale;
}

const UNKNOWN_FACTOR = 0.3;

/** 對手「四缺一」窗口的空格：落子在這裡可以擋住（排序用） */
function blockSquares(pH, pL, oH, oL) {
  let bh = 0, bl = 0;
  const eH = ~(pH | oH), eL = ~(pL | oL);
  for (let w = 0; w < NW; w++) {
    const o = popcount(oH & WH[w]) + popcount(oL & WL[w]);
    if (o !== 4) continue;
    const emH = eH & WH[w], emL = eL & WL[w];
    if (popcount(emH) + popcount(emL) !== 1) continue;
    const b = w * 5;
    let m = 0xFF;
    for (let k = 0; k < 5; k++) {
      const q = WSQ[b + k];
      const isEmpty = q < 32 ? (emL >>> q) & 1 : (emH >>> (q - 32)) & 1;
      if (!isEmpty && KNOWN[q]) m &= NM[q];
    }
    if (m) { bh |= emH; bl |= emL; }
  }
  RH_B = bh; RL_B = bl;
}
let RH_B = 0, RL_B = 0;

const FEAT = new Float64Array(NF);

function leafEval(pH, pL, oH, oL, color) {
  if (params.model) {
    // 學習型評估：勝率 = sigmoid(Σ 權重 × 特徵)，換成 [-1, 1] 的價值 = tanh(z / 2)
    const empties = extractFeatures(pH, pL, oH, oL, NM, KNOWN, FEAT);
    const w = params.model[phaseOf(empties)];
    let z = 0;
    for (let f = 0; f < NF; f++) z += w[f] * FEAT[f];
    return Math.tanh(z / 2);
  }
  // othelloEval = false：不看黑白棋局勢，只看五連威脅（評測用的「五子棋派」對手）
  let ev = params.othelloEval === false ? 0 : evaluate(pH, pL, oH, oL, color, FV, FV, params);
  if (params.five && params.threatScale) ev += threatEval(pH, pL, oH, oL);
  if (!params.winProb) return ev;
  // 勝率換算：開局平緩（五連機會比較重要）→ 終盤陡峭（棋子數的小差距就決定勝負）
  let scale = params.valueScale;
  if (params.valueScaleLate != null) {
    const empties = 64 - count(pH | oH, pL | oL);
    scale = params.valueScaleLate + (params.valueScale - params.valueScaleLate) * (empties / 60);
  }
  return Math.tanh(ev / scale);
}

/** 雙方都沒得下：比分數 */
function terminal(pH, pL, oH, oL, color) {
  const d = finalDiff(pH, pL, oH, oL, color, FV, FV);
  if (!params.winProb) return d;
  // 搜尋深處的棋子分數是平均值估計，「只贏一點」很可能其實會輸：偏好領先較多的終局
  return params.terminalScale > 0 ? Math.tanh(d / params.terminalScale) : Math.sign(d);
}

// ===== 中盤搜尋 =====

/**
 * NegaScout。走一步的價值 v = a + b × (−子節點)：
 *   一定成五：v = 勝（不再往下搜）
 *   可能成五（機率 p）：a = p × 勝，b = 1 − p
 *   不會成五：a = 0，b = 1
 * 子節點的搜尋視窗依此線性轉換。
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
    if ((RH | RL) === 0) return terminal(pH, pL, oH, oL, color);
    return -nega(oH, oL, pH, pL, other, depth, -beta, -alpha, k1 ^ SIDE1, k2 ^ SIDE2, ply + 1);
  }
  if (depth <= 0) return leafEval(pH, pL, oH, oL, color);

  // 走法排序：必勝步 → 可能成五 → 擋對手四缺一 → v6 的排序
  const moves = MOVES[ply], keys = KEYS[ply];
  squaresOf(mH, mL, sqBuf);
  const n = sqBuf.length;
  let bH = 0, bL = 0;
  if (params.five && depth >= 2) { blockSquares(pH, pL, oH, oL); bH = RH_B; bL = RL_B; }
  const pc = PCACHE[ply];
  for (let i = 0; i < n; i++) {
    const s = sqBuf[i];
    moves[i] = s;
    let key = SQ_ORDER[s];
    if (s === ttMove) key += 1000;
    // 深度 1 的節點常常第一步就剪枝：成五機率留到真的要下時才算（NaN = 尚未計算）
    const preFive = params.five && depth >= 2;
    pc[s] = NaN;
    if (preFive || depth >= 3) {
      flips(pH, pL, oH, oL, s);
      const fH = RH, fL = RL;
      setBit(s);
      const nPH = pH | fH | RH, nPL = pL | fL | RL;
      if (preFive) {
        KNOWN[s] = 0;
        const p = fiveChance(nPH, nPL, pH, pL, ply);
        pc[s] = p;
        key += p * 3000;
        if (s < 32 ? (bL >>> s) & 1 : (bH >>> (s - 32)) & 1) key += 400;
      }
      if (depth >= 3 && s !== ttMove) {
        mobility(oH & ~fH, oL & ~fL, nPH, nPL);
        key -= 2 * count(RH, RL);
      }
    }
    keys[i] = key;
  }
  insertionSort(moves, keys, n);

  const winScore = winValue - ply * (params.winProb ? 1e-4 : 1);
  let best = -Infinity, bestMove = -1;
  for (let i = 0; i < n; i++) {
    const s = moves[i];
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL;
    setBit(s);
    const nPH = pH | fH | RH, nPL = pL | fL | RL;
    const nOH = oH & ~fH, nOL = oL & ~fL;
    FV[s] = avgVal; KNOWN[s] = 0;

    let v;
    let p = 0;
    if (params.five) {
      p = pc[s];
      if (p !== p) p = fiveChance(nPH, nPL, pH, pL, ply);
      if (p < 1) p *= params.fiveTrust * (ply % 2 === 1 ? params.oppFiveTrust : 1); // 奇數層 = 對手落子
    }
    if (p >= 1) {
      v = winScore;
    } else {
      const c1 = keyAfter(k1, Z1, color, s, fH, fL) ^ SIDE1;
      const c2 = keyAfter(k2, Z2, color, s, fH, fL) ^ SIDE2;
      const a = p * winScore, b = 1 - p;
      // v = a − b × nega(...)：子節點視窗 (−(β−a)/b, −(α−a)/b)
      const lo = -(beta - a) / b, hi = -(alpha - a) / b;
      if (i === 0) {
        v = a - b * nega(nOH, nOL, nPH, nPL, other, depth - 1, lo, hi, c1, c2, ply + 1);
      } else {
        v = a - b * nega(nOH, nOL, nPH, nPL, other, depth - 1, hi - NULL_EPS, hi, c1, c2, ply + 1);
        if (v > alpha && v < beta) v = a - b * nega(nOH, nOL, nPH, nPL, other, depth - 1, lo, hi, c1, c2, ply + 1);
      }
    }
    if (v > best) { best = v; bestMove = s; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }

  TT_K2[idx] = k2;
  TT_DEPTH[idx] = depth;
  TT_SCORE[idx] = best;
  TT_MOVE[idx] = bestMove;
  TT_FLAG[idx] = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
  return best;
}

// ===== 終盤：逐一展開抽棋的精確期望值（含成五） =====

function chance(pH, pL, oH, oL, color, bag, n, ply) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw ABORT;
  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  const other = color === BLACK ? WHITE : BLACK;
  if ((mH | mL) === 0) {
    mobility(oH, oL, pH, pL);
    if ((RH | RL) === 0) return terminal(pH, pL, oH, oL, color);
    return -chance(oH, oL, pH, pL, other, bag, n, ply + 1);
  }
  const moves = squaresOf(mH, mL, []);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const id = bag[i];
    bag[i] = bag[n - 1]; bag[n - 1] = id;
    sum += placeBest(pH, pL, oH, oL, color, moves, id, bag, n - 1, ply);
    bag[n - 1] = bag[i]; bag[i] = id;
  }
  return sum / n;
}

function placeBest(pH, pL, oH, oL, color, moves, id, bag, n, ply) {
  const other = color === BLACK ? WHITE : BLACK;
  let best = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const s = moves[i];
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL;
    setBit(s);
    const nPH = pH | fH | RH, nPL = pL | fL | RL;
    FV[s] = discVal(id); NM[s] = numberMask(id); KNOWN[s] = 1;
    let v;
    if (params.five && fiveChance(nPH, nPL, pH, pL) >= 1) v = winValue - ply * (params.winProb ? 1e-4 : 1);
    else v = -chance(oH & ~fH, oL & ~fL, nPH, nPL, other, bag, n, ply + 1);
    if (v > best) best = v;
    if (isWinScore(best) && best > 0) break; // 已找到必勝，不必再比
  }
  return best;
}

// ===== 終盤（池子規則）：下棋者從自己的池子挑棋與位置，下完從袋子補一顆（補哪顆是機會節點） =====

/**
 * pools：共用池子 { S: [...] }；各自一手 { 1: [...], 2: [...] }。棋子 id 的陣列。
 * 數字集合相同的棋效果一樣（五連每顆 1 分），只試一次。
 */
function chanceP(pH, pL, oH, oL, color, pools, bag, ply) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw ABORT;
  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  const other = color === BLACK ? WHITE : BLACK;
  const key = pools.S ? "S" : color;
  const mine = pools[key];
  if ((mH | mL) === 0 || mine.length === 0) {
    mobility(oH, oL, pH, pL);
    if ((RH | RL) === 0) return terminal(pH, pL, oH, oL, color);
    return -chanceP(oH, oL, pH, pL, other, pools, bag, ply + 1);
  }
  const moves = squaresOf(mH, mL, []);
  const win = winValue - ply * (params.winProb ? 1e-4 : 1);
  let best = -Infinity;
  const tried = new Set();
  for (let di = 0; di < mine.length; di++) {
    const id = mine[di];
    const nm = numberMask(id);
    if (tried.has(nm)) continue;
    tried.add(nm);
    const rest = mine.slice(0, di).concat(mine.slice(di + 1));
    for (let i = 0; i < moves.length; i++) {
      const s = moves[i];
      flips(pH, pL, oH, oL, s);
      const fH = RH, fL = RL;
      setBit(s);
      const nPH = pH | fH | RH, nPL = pL | fL | RL;
      const nOH = oH & ~fH, nOL = oL & ~fL;
      FV[s] = discVal(id); NM[s] = nm; KNOWN[s] = 1;
      let v;
      if (params.five && fiveChance(nPH, nPL, pH, pL) >= 1) v = win;
      else if (bag.length === 0) {
        v = -chanceP(nOH, nOL, nPH, nPL, other, { ...pools, [key]: rest }, bag, ply + 1);
      } else {
        let sum = 0;
        for (let b = 0; b < bag.length; b++) {
          const nb = bag.slice(0, b).concat(bag.slice(b + 1));
          // 遞迴會改寫這一格的 NM／KNOWN，回來後補回（還在盤上）
          sum += -chanceP(nOH, nOL, nPH, nPL, other, { ...pools, [key]: rest.concat(bag[b]) }, nb, ply + 1);
          FV[s] = discVal(id); NM[s] = nm; KNOWN[s] = 1;
        }
        v = sum / bag.length;
      }
      if (v > best) best = v;
      if (isWinScore(best) && best > 0) return best;
    }
  }
  return best;
}

function setBagStats(bag) {
  avgVal = params.weighted ? 20.25 : 1;
  QTAB.fill(0); Q1.fill(0);
  if (!bag.length) return;
  let sum = 0;
  const masks = bag.map(numberMask);
  for (const id of bag) sum += discVal(id);
  avgVal = sum / bag.length;
  for (let V = 1; V < 256; V++) {
    let hit = 0;
    for (const m of masks) if (m & V) hit++;
    QTAB[V] = hit / bag.length;
  }
  for (let v = 1; v <= 8; v++) Q1[v] = QTAB[1 << (v - 1)];
}

// ===== 根節點 =====

/**
 * @returns {{ bestSq, scores:{sq, score}[], depth, exact, chanceExact?, win?: boolean, nodes, ms } | null}
 *   score 為下棋者角度：winProb 模式下是勝率尺度 [-1, 1]（±1 = 必勝／必敗）；分數模式下是預期分數差。
 */
export function searchRootV8({
  board, player, handId, bag, timeMs = 1000, maxDepth = 60, multiPV = false,
  params: p = V8_PARAMS, exactEmpties = V8_EXACT_EMPTIES, pool = null, statBag = null
}) {
  const t0 = Date.now();
  params = p;
  nodes = 0;
  winValue = params.winProb ? WIN : WIN_SCORE;
  NULL_EPS = params.winProb ? 1e-4 : 0.01;

  let pH = 0, pL = 0, oH = 0, oL = 0;
  for (let s = 0; s < 64; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    FV[s] = discVal(d.id); NM[s] = numberMask(d.id); KNOWN[s] = 1;
    const mine = d.face === player;
    if (s < 32) { if (mine) pL |= 1 << s; else oL |= 1 << s; }
    else if (mine) pH |= 1 << (s - 32); else oH |= 1 << (s - 32);
  }
  setBagStats(statBag || bag);
  // 池子規則：pool = { n, mode: "shared"|"private", rest: 下棋者池子裡剩下的棋, opp: 對手手上的棋（private） }
  // bag 必須已經扣掉池子裡的棋（只剩真正隨機的，終盤精確計算用）；statBag = 機率統計用的棋（含池子）
  POOL_N = pool ? pool.n : 1;
  K1 = !pool ? [] : (pool.mode === "private" ? pool.opp : pool.rest).map(numberMask);
  POOL_DEEP = !pool || pool.deep !== false;

  mobility(pH, pL, oH, oL);
  const rootMoves = squaresOf(RH, RL, []);
  if (rootMoves.length === 0) return null;

  const other = player === BLACK ? WHITE : BLACK;
  const empties = 64 - count(pH | oH, pL | oL);
  const child = (s) => {
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL;
    setBit(s);
    FV[s] = discVal(handId); NM[s] = numberMask(handId); KNOWN[s] = 1;
    return { s, fH, fL, nPH: pH | fH | RH, nPL: pL | fL | RL, nOH: oH & ~fH, nOL: oL & ~fL };
  };

  // 0) 手上的棋能直接成五：立刻獲勝，不必搜尋
  if (params.five) {
    for (const s of rootMoves) {
      const c = child(s);
      if (fiveChance(c.nPH, c.nPL, pH, pL) >= 1) {
        const scores = [{ sq: s, score: winValue }, ...rootMoves.filter(x => x !== s).map(x => ({ sq: x, score: -Infinity }))];
        return { bestSq: s, scores, depth: 0, exact: true, win: true, nodes, ms: Date.now() - t0 };
      }
    }
  }

  // 1) 終盤精確求解
  if (empties <= exactEmpties) {
    deadline = t0 + Math.max(timeMs, 300) * 2;
    const bagArr = bag.slice();
    try {
      const scores = rootMoves.map(s => {
        const c = child(s);
        if (!pool) return { sq: s, score: -chance(c.nOH, c.nOL, c.nPH, c.nPL, other, bagArr, bagArr.length, 1) };
        // 池子規則：下完這顆，下棋者的池子從袋子補一顆（袋子空了就不補）
        const after = (refill) => (pool.mode === "private"
          ? { [player]: refill == null ? pool.rest : pool.rest.concat(refill), [other]: pool.opp }
          : { S: refill == null ? pool.rest : pool.rest.concat(refill) });
        if (!bagArr.length) return { sq: s, score: -chanceP(c.nOH, c.nOL, c.nPH, c.nPL, other, after(null), [], 1) };
        let sum = 0;
        for (let b = 0; b < bagArr.length; b++) {
          const nb = bagArr.slice(0, b).concat(bagArr.slice(b + 1));
          sum += -chanceP(c.nOH, c.nOL, c.nPH, c.nPL, other, after(bagArr[b]), nb, 1);
          child(s); // 遞迴改寫了根節點這一格，補回
        }
        return { sq: s, score: sum / bagArr.length };
      });
      scores.sort((a, b) => b.score - a.score);
      return { bestSq: scores[0].sq, scores, depth: empties, exact: true, chanceExact: true, nodes, ms: Date.now() - t0 };
    } catch (e) {
      if (e !== ABORT) throw e;
      for (let s = 0; s < 64; s++) {
        const d = board[s >> 3][s & 7];
        if (d) { FV[s] = discVal(d.id); NM[s] = numberMask(d.id); KNOWN[s] = 1; }
      }
    }
  }

  // 2) 迭代加深 NegaScout
  TT_DEPTH.fill(-1);
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
    if (isWinScore(results[0].score) && results[0].score > 0) break; // 已找到必勝
    if (Date.now() - t0 > timeMs * 0.45) break;
  }

  if (!completed) completed = order;
  return { bestSq: completed[0].sq, scores: completed, depth: completedDepth, exact: completedDepth >= empties, nodes, ms: Date.now() - t0 };
}

export { leftOf, rightOf };
