/**
 * 🎯 v10 搜尋引擎：「2 組自選」規則專用（完全資訊、沒有運氣）。
 *
 * 規則：64 顆棋分成兩組（α、β），輪到的人自己選要下哪一組，下在黑白棋的合法位置；
 * 落子（含翻面）後，同一直線上連續 5 顆同色、同一組 → 立刻獲勝；否則照黑白棋比棋子數（每顆 1 分）。
 * 庫存有兩種模式：
 *   共用（shared）：兩組各 32 顆，雙方從同一份拿（庫存可以從盤面推算）
 *   各自持有（perPlayer）：黑方、白方各有 α、β 各 16 顆，只能用自己的（翻面後推算不出來，引擎自己記）
 *
 * 勝負規則（searchRootV10 的 rule，見 tests/g2-arena.js 的 --rule）：
 *   winLen      連成幾顆立刻獲勝（預設 5；6 = 六連才結束）
 *   instantWin  false = 連成也不會結束，一路下到終局
 *   countFives  true = 終局先比五連數量（每一段連續 5 格同色同組算一個：六連算 2 個、七連 3 個），一樣再比棋子數
 *
 * 沒有抽棋，所以不需要 v8 那些機率節點與期望值：純粹的雙人零和、完全資訊遊戲。
 *
 * 參考（只參考想法，沒有搬程式碼）：
 *   Zebra（黑白棋）：迭代加深 NegaScout、置換表、行動力／穩定子／角的評估（沿用 v6/eval.js）、終盤精確求解
 *   Rapfi（五子棋）：每個節點先看能不能直接連成五；葉節點若對手已有「下一手就連成五」的威脅，延伸搜尋去擋；
 *                     VCF（連續做四逼出五連）；後段著法減少深度（LMR）；以窗口型態估連線的價值
 *
 * 走法 = 格子 × 組別。「死格子」只試一種組別：經過這格的每個五連窗口，若已經同時有兩組的棋，永遠連不成五，
 * 選哪一組都一樣（只差在用掉哪一組的庫存：一律用自己剩比較多的那組）。
 *
 * 位元棋盤：P／O = 輪到的一方／對手（相對位置，黑白對稱，置換表可以共用），G = β 組的棋（α 組 = 有棋但不在 G）。
 * 庫存（各自持有模式）打包成一個整數 sup：P 的 α、β、O 的 α、β 各 6 位元；共用模式 sup = −1（從盤面推算）。
 * 分數單位 = 棋子數差；直接連成五 = ±WIN（減去步數：越快贏越好、越慢輸越好）。
 */
import { mobility, flips, count, popcount, RH, RL } from "../v6/bitboard.js";
import { evaluate, PARAMS as V6_PARAMS } from "../v6/eval.js";

export const WIN = 10000;
const ONES = new Float64Array(64).fill(1);

export const V10_PARAMS = {
  // 連線評估：窗口裡只有同一組的棋時，輪到的一方「還差 m 顆」的價值（m = 1、2、3…），對手同理
  lineTm: [0, 28, 9, 2.5, 0.4, 0.1],
  fiveNow: 0.5,        // 五連計數規則：盤上已經有的五連，評估時打這個折（之後還可能被翻掉）
  oppFactor: 0.4,      // 窗口裡每有一顆對手的棋，打這個折（翻得回來，不是死路）
  tempo: 1.4,          // 輪到自己：自己的威脅比較危險
  lineScale: 3,        // 實測：連線 ×3、黑白棋 ×0.3 對「連線狂」最好（見 README）
  othelloScale: 0.3,   // 黑白棋評估的倍率：這個規則幾乎都是連線分勝負，黑白棋主要管「有沒有合法位置去做四、擋四」
  othelloEval: true,   // false = 只看連線、不看黑白棋局勢（「連線狂」：精通五子棋、不擅長黑白棋的對手）
  lineEval: true,      // false = 只用黑白棋評估（對照實驗用）
  threatExt: 4,        // 葉節點遇到對手「下一手就連成五」時，最多再延伸幾層
  vcfDepth: 0,         // 葉節點的 VCF（連續做四逼出五連）最多幾步攻擊；0 = 不做。實測（每步 0.2 秒、100 局）開了反而變弱：
                       // 1 步 42%、2 步 40%、3 步 44%（對不開的 v10）——節點開頭的連五檢查＋威脅延伸已經看得到短的強制連線，VCF 只是吃掉搜尋深度
  vcfBudget: 60,       // 每次 VCF 最多搜幾個節點（避免拖慢整體搜尋）
  exactEmpties: 12,    // 剩這麼多格以內：精確算到終局
  deadMerge: true,     // 死格子只試一種組別（見檔案開頭）
  history: true,       // 歷史啟發式排序
  lmr: true,           // 後段著法減少深度：排在後面的著法先少搜一層，結果超出預期才用完整深度重算
  winCheck: true       // false = 不在節點開頭檢查直接連成五（對照實驗用；仍然會在落子後判勝）
};
let P = V10_PARAMS;

// ===== 連線窗口（長度 L 的直線，橫、直、兩條斜線） =====
function buildWindows(L) {
  const wins = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = Array.from({ length: L }, (_, k) => [r + k * dr, c + k * dc]);
      if (cells.every(([y, x]) => y >= 0 && y < 8 && x >= 0 && x < 8)) wins.push(cells.map(([y, x]) => y * 8 + x));
    }
  }
  const n = wins.length, wh = new Int32Array(n), wl = new Int32Array(n);
  wins.forEach((sqs, w) => { for (const s of sqs) { if (s < 32) wl[w] |= 1 << s; else wh[w] |= 1 << (s - 32); } });
  const sqw = Array.from({ length: 64 }, () => []);
  wins.forEach((sqs, w) => { for (const s of sqs) sqw[s].push(w); });
  return { NW: n, WH: wh, WL: wl, SQW_ARR: sqw.map(a => Int16Array.from(a)), STAMP: new Int32Array(n) };
}
const W5 = buildWindows(5), W_CACHE = { 5: W5 };
// 目前規則的「立刻獲勝」窗口（長度 LEN）；五連計數永遠用 W5
let LEN = 5, NW = W5.NW, WH = W5.WH, WL = W5.WL, SQW_ARR = W5.SQW_ARR, STAMP = W5.STAMP;
let INSTANT = true, COUNT = false;
let stampId = 0;
/** 終局時一個五連值多少（比最大的棋子數差 64 還大：五連數量永遠優先） */
const FIVE_UNIT = 65;
let ruleKey = "";
function setRule(rule) {
  // 規則一換，置換表裡的分數就不能用了（key 沒有包含規則）
  const k = `${rule?.winLen ?? 5}|${rule?.instantWin !== false}|${!!rule?.countFives}`;
  if (k !== ruleKey) { ruleKey = k; clearTT(); }
  LEN = rule?.winLen ?? 5;
  const t = W_CACHE[LEN] || (W_CACHE[LEN] = buildWindows(LEN));
  NW = t.NW; WH = t.WH; WL = t.WL; SQW_ARR = t.SQW_ARR; STAMP = t.STAMP;
  INSTANT = rule?.instantWin !== false;
  COUNT = !!rule?.countFives;
}

/** X 盤上有幾個五連（每一段連續 5 格同色、同組算一個：六連 2 個、七連 3 個） */
function fiveCount(xH, xL, gH, gL) {
  let n = 0;
  for (let w = 0; w < W5.NW; w++) {
    const h = W5.WH[w], l = W5.WL[w];
    if ((xH & h) !== h || (xL & l) !== l) continue;
    const gh = gH & h, gl = gL & l;
    if ((gh === h && gl === l) || (gh === 0 && gl === 0)) n++;
  }
  return n;
}
/** 終局分數（輪到的一方角度）：五連計數規則先比五連數量，再比棋子數 */
function finalScore(pH, pL, oH, oL, gH, gL) {
  let d = count(pH, pL) - count(oH, oL);
  if (COUNT) d += FIVE_UNIT * (fiveCount(pH, pL, gH, gL) - fiveCount(oH, oL, gH, gL));
  return d;
}

const bitH = (s) => (s < 32 ? 0 : (1 << (s - 32)) | 0);
const bitL = (s) => (s < 32 ? (1 << s) | 0 : 0);
const hasBit = (h, l, s) => (s < 32 ? (l >>> s) & 1 : (h >>> (s - 32)) & 1);

/** P 剛下完（變動的格子 chH/chL = 落子 + 翻面）：有沒有連成五（同色、同一組） */
function fiveAfter(pH, pL, gH, gL, chH, chL) {
  const stamp = ++stampId;
  while (chH !== 0 || chL !== 0) {
    let q;
    if (chL !== 0) { const b = chL & -chL; q = 31 - Math.clz32(b); chL ^= b; }
    else { const b = chH & -chH; q = 63 - Math.clz32(b); chH ^= b; }
    const ws = SQW_ARR[q];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (STAMP[w] === stamp) continue;
      STAMP[w] = stamp;
      const h = WH[w], l = WL[w];
      if ((pH & h) !== h || (pL & l) !== l) continue;
      const gh = gH & h, gl = gL & l;
      if ((gh === h && gl === l) || (gh === 0 && gl === 0)) return true;
    }
  }
  return false;
}

// ===== 庫存 =====
/** 共用模式：兩組各 32 顆，扣掉盤上已有的（盤面就決定了） */
function sharedRem(pH, pL, oH, oL, gH, gL) {
  const occ = count(pH | oH, pL | oL), g1 = count(gH, gL);
  return [32 - (occ - g1), 32 - g1];
}
/** 輪到的一方（P）與對手（O）各自還能用的 [α, β] */
function remP(sup, pH, pL, oH, oL, gH, gL) { return sup < 0 ? sharedRem(pH, pL, oH, oL, gH, gL) : [sup & 63, (sup >>> 6) & 63]; }
function remO(sup, pH, pL, oH, oL, gH, gL) { return sup < 0 ? sharedRem(pH, pL, oH, oL, gH, gL) : [(sup >>> 12) & 63, (sup >>> 18) & 63]; }
/** P 下了第 g 組之後，換對手下：對手變成 P */
function childSup(sup, g) {
  if (sup < 0) return -1;
  const pa = sup & 63, pb = (sup >>> 6) & 63;
  return ((sup >>> 12) & 63) | (((sup >>> 18) & 63) << 6) | ((pa - (g === 0 ? 1 : 0)) << 12) | ((pb - (g === 1 ? 1 : 0)) << 18);
}
/** PASS：換對手下，庫存不變 */
function swapSup(sup) {
  if (sup < 0) return -1;
  return ((sup >>> 12) & 63) | (((sup >>> 18) & 63) << 6) | ((sup & 63) << 12) | (((sup >>> 6) & 63) << 18);
}
const packSup = (rp, ro) => rp[0] | (rp[1] << 6) | (ro[0] << 12) | (ro[1] << 18);

// ===== 搜尋狀態 =====
let nodes = 0, deadline = Infinity;
let EXACT_RUN = false; // 正在精確算到終局：不能減少深度（LMR），每條分支都要算到底
const ABORT = { abort: true };
const MAX_PLY = 80;
const MOVEBUF = Array.from({ length: MAX_PLY }, () => new Int16Array(64)); // 走法 = 格 × 2 + 組
const KEYBUF = Array.from({ length: MAX_PLY }, () => new Float64Array(64));
const HISTORY = new Int32Array(128);
const KILLER = new Int16Array(MAX_PLY * 2).fill(-1);
const SQ_ORDER = new Int8Array([
  9, 2, 6, 5, 5, 6, 2, 9,
  2, 0, 3, 3, 3, 3, 0, 2,
  6, 3, 4, 4, 4, 4, 3, 6,
  5, 3, 4, 0, 0, 4, 3, 5,
  5, 3, 4, 0, 0, 4, 3, 5,
  6, 3, 4, 4, 4, 4, 3, 6,
  2, 0, 3, 3, 3, 3, 0, 2,
  9, 2, 6, 5, 5, 6, 2, 9
]);

// ===== 置換表（相對 P/O，黑白對稱；各自持有模式把庫存也算進去） =====
const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const TT_K2 = new Int32Array(TT_SIZE), TT_DEPTH = new Int8Array(TT_SIZE).fill(-1), TT_FLAG = new Uint8Array(TT_SIZE);
const TT_SCORE = new Float32Array(TT_SIZE), TT_MOVE = new Int16Array(TT_SIZE);
const EXACT = 0, LOWER = 1, UPPER = 2;
function mix(h, x) { h = Math.imul(h ^ x, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return h ^ (h >>> 16); }
function key1(pH, pL, oH, oL, gH, gL, sup) { return mix(mix(mix(mix(mix(mix(mix(0x9e3779b9, pL), pH), oL), oH), gL), gH), sup); }
function key2(pH, pL, oH, oL, gH, gL, sup) { return mix(mix(mix(mix(mix(mix(mix(0x7f4a7c15, gH), oL), sup), pH), gL), oH), pL); }
export function clearTT() { TT_DEPTH.fill(-1); }

/**
 * 找輪到的一方（P）能直接連成（立刻獲勝）的走法；沒有回傳 -1。rem = P 的庫存。
 * 只有兩種窗口可能：差 1 格、同一組、空的那格是 P 的合法位置；或全滿、同一組（等著被翻成同色）。
 */
function findWin(pH, pL, oH, oL, gH, gL, mH, mL, rem) {
  if (!INSTANT) return -1;
  const occH = pH | oH, occL = pL | oL;
  for (let w = 0; w < NW; w++) {
    const h = WH[w], l = WL[w];
    const oh = occH & h, ol = occL & l;
    const n = popcount(oh) + popcount(ol);
    if (n < LEN - 1) continue;
    const gh = gH & h, gl = gL & l;
    let grp;
    if (gh === 0 && gl === 0) grp = 0; else if (gh === oh && gl === ol) grp = 1; else continue; // 混組：不可能
    if (n === LEN - 1) {
      const eh = h & ~oh, el = l & ~ol;
      if (!((eh & mH) | (el & mL))) continue; // 空格不是合法位置
      if (!rem[grp]) continue;
      const s = el ? 31 - Math.clz32(el) : 63 - Math.clz32(eh);
      if (tryWin(pH, pL, oH, oL, gH, gL, s, grp)) return s * 2 + grp;
    } else {
      // 5 格都有棋：要有某一步把裡面對手的棋全翻過來（下在窗口外）
      let mh = mH, ml = mL;
      while (mh !== 0 || ml !== 0) {
        let s;
        if (ml !== 0) { const b = ml & -ml; s = 31 - Math.clz32(b); ml ^= b; } else { const b = mh & -mh; s = 63 - Math.clz32(b); mh ^= b; }
        for (let g = 0; g < 2; g++) if (rem[g] && tryWin(pH, pL, oH, oL, gH, gL, s, g)) return s * 2 + g;
      }
    }
  }
  return -1;
}
function tryWin(pH, pL, oH, oL, gH, gL, s, g) {
  flips(pH, pL, oH, oL, s);
  const fH = RH, fL = RL, bh = bitH(s), bl = bitL(s);
  return fiveAfter(pH | fH | bh, pL | fL | bl, g ? gH | bh : gH, g ? gL | bl : gL, fH | bh, fL | bl);
}
/** P（庫存 rem）現在能直接連成五嗎 */
function canWinNow(pH, pL, oH, oL, gH, gL, rem) {
  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  if (!(mH | mL)) return false;
  return findWin(pH, pL, oH, oL, gH, gL, mH, mL, rem) >= 0;
}

// ===== VCF：連續做「四」（下一手就能連成五的威脅），對手只能擋，逼出五連（參考 Rapfi 的 vcfsearch／vcfdefend） =====
let vcfNodes = 0;
const VCF_FAIL = { fail: true };
const ATTACKS = Array.from({ length: 24 }, () => []);
const pushUnique = (out, mv) => { if (!out.includes(mv)) out.push(mv); };

/**
 * VCF 的攻擊步候選（之後再逐一確認是不是真的做出四）。四 = 某個窗口 4 格同一組、全是 P 的顏色、剩 1 格空著。
 *   ① 窗口已有 3 格有棋、同一組：下在空格（用那一組），裡面對手的棋可能被這一步翻過來
 *   ② 窗口已有 4 格有棋、同一組、但還有對手的棋：下一步把它們翻過來（下在窗口外）
 */
function vcfAttacks(pH, pL, oH, oL, gH, gL, mH, mL, rem, out) {
  out.length = 0;
  const occH = pH | oH, occL = pL | oL;
  let flipH = 0, flipL = 0; // ② 要翻掉的對手棋
  for (let w = 0; w < NW; w++) {
    const h = WH[w], l = WL[w];
    const oh = occH & h, ol = occL & l;
    const n = popcount(oh) + popcount(ol);
    if (n < LEN - 2 || n > LEN - 1) continue;
    const gh = gH & h, gl = gL & l;
    let grp;
    if (gh === 0 && gl === 0) grp = 0; else if (gh === oh && gl === ol) grp = 1; else continue;
    if (n === LEN - 2) {
      if (!rem[grp]) continue;
      let eh = h & ~oh & mH, el = l & ~ol & mL;
      while (el !== 0) { const b = el & -el; pushUnique(out, (31 - Math.clz32(b)) * 2 + grp); el ^= b; }
      while (eh !== 0) { const b = eh & -eh; pushUnique(out, (63 - Math.clz32(b)) * 2 + grp); eh ^= b; }
    } else if ((oH & h) | (oL & l)) { flipH |= oH & h; flipL |= oL & l; }
  }
  if (flipH | flipL) {
    const g = rem[0] >= rem[1] ? 0 : 1; // 下在窗口外：用哪一組都一樣，用剩比較多的
    let ml = mL, mh = mH;
    while (ml !== 0 || mh !== 0) {
      let s;
      if (ml !== 0) { const b = ml & -ml; s = 31 - Math.clz32(b); ml ^= b; } else { const b = mh & -mh; s = 63 - Math.clz32(b); mh ^= b; }
      flips(pH, pL, oH, oL, s);
      if ((RH & flipH) | (RL & flipL)) pushUnique(out, s * 2 + g);
    }
  }
  return out;
}

/**
 * P 能不能靠連續的四逼出五連。對手的每一種應對（格子 × 組別）都要試：只要有一種能擋住、之後 P 也逼不出來，
 * 或對手自己能直接連成五、或擋的同時做出自己的四，這條路就不算。
 */
function vcf(pH, pL, oH, oL, gH, gL, sup, left, ply) {
  if (++vcfNodes > P.vcfBudget) throw VCF_FAIL;
  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  if (!(mH | mL)) return false;
  const rp = remP(sup, pH, pL, oH, oL, gH, gL), ro = remO(sup, pH, pL, oH, oL, gH, gL);
  if (findWin(pH, pL, oH, oL, gH, gL, mH, mL, rp) >= 0) return true;
  if (left <= 0) return false;
  const att = vcfAttacks(pH, pL, oH, oL, gH, gL, mH, mL, rp, ATTACKS[ply % 24]).slice();
  for (let i = 0; i < att.length; i++) {
    const s = att[i] >> 1, g = att[i] & 1;
    if (!rp[g]) continue;
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL, bh = bitH(s), bl = bitL(s);
    const aPH = pH | fH | bh, aPL = pL | fL | bl, aOH = oH & ~fH, aOL = oL & ~fL;
    const aGH = g ? gH | bh : gH, aGL = g ? gL | bl : gL;
    const supA = childSup(sup, g); // 換對手下
    const rpA = remO(supA, aOH, aOL, aPH, aPL, aGH, aGL), roA = remP(supA, aOH, aOL, aPH, aPL, aGH, aGL);
    if (!canWinNow(aPH, aPL, aOH, aOL, aGH, aGL, rpA)) continue;     // 不是四
    if (canWinNow(aOH, aOL, aPH, aPL, aGH, aGL, roA)) continue;      // 對手自己能直接連成五
    mobility(aOH, aOL, aPH, aPL);
    let dH = RH, dL = RL;
    if (!(dH | dL)) return true;                                       // 對手沒得下：P 接著連成五
    let refuted = false;
    while (!refuted && (dL !== 0 || dH !== 0)) {
      let d;
      if (dL !== 0) { const b = dL & -dL; d = 31 - Math.clz32(b); dL ^= b; } else { const b = dH & -dH; d = 63 - Math.clz32(b); dH ^= b; }
      flips(aOH, aOL, aPH, aPL, d);
      const xH = RH, xL = RL, dbh = bitH(d), dbl = bitL(d);
      const bOH = aOH | xH | dbh, bOL = aOL | xL | dbl, bPH = aPH & ~xH, bPL = aPL & ~xL;
      // 兩種組別都要試：對手的棋下進 P 的窗口後，P 可能把它翻過來，這時組別決定 P 還能不能連成五
      for (let og = 0; og < 2 && !refuted; og++) {
        if (!roA[og]) continue;
        const bGH = og ? aGH | dbh : aGH, bGL = og ? aGL | dbl : aGL;
        const supB = childSup(supA, og); // 換回 P 下
        const rpB = remP(supB, bPH, bPL, bOH, bOL, bGH, bGL), roB = remO(supB, bPH, bPL, bOH, bOL, bGH, bGL);
        if (canWinNow(bPH, bPL, bOH, bOL, bGH, bGL, rpB)) continue;  // 沒擋住
        // 擋住了：對手如果也做出了四，P 得先擋 → 不算；否則 P 要繼續用 VCF 逼
        if (canWinNow(bOH, bOL, bPH, bPL, bGH, bGL, roB) || !vcf(bPH, bPL, bOH, bOL, bGH, bGL, supB, left - 1, ply + 2)) refuted = true;
      }
    }
    if (!refuted) return true;
  }
  return false;
}

/**
 * 活的窗口（有棋的格子都同一組、還補得滿）經過的格子：只有這些格子選哪一組才有差。結果寫進 LIVE_H/L。
 * 五連計數規則另外看五格窗口（立刻獲勝的窗口不是五格時，例如六連獲勝＋五連計數）。
 */
let LIVE_H = 0, LIVE_L = 0;
function liveOver(t, pH, pL, oH, oL, gH, gL, rp, ro) {
  const occH = pH | oH, occL = pL | oL;
  let lh = 0, ll = 0;
  for (let w = 0; w < t.NW; w++) {
    const h = t.WH[w], l = t.WL[w];
    const oh = occH & h, ol = occL & l, gh = gH & h, gl = gL & l;
    const full = oh === h && ol === l;
    if (gh === 0 && gl === 0) { if (!full && (oh | ol) && !rp[0] && !ro[0]) continue; }
    else if (gh === oh && gl === ol) { if (!full && !rp[1] && !ro[1]) continue; }
    else continue;
    lh |= h; ll |= l;
  }
  LIVE_H |= lh; LIVE_L |= ll;
}
function scanLive(pH, pL, oH, oL, gH, gL, rp, ro) {
  LIVE_H = 0; LIVE_L = 0;
  liveOver({ NW, WH, WL }, pH, pL, oH, oL, gH, gL, rp, ro);
  if (COUNT && LEN !== 5) liveOver(W5, pH, pL, oH, oL, gH, gL, rp, ro);
}

/** 連線評估（輪到的一方角度）：只看還沒混組、還補得滿的窗口 */
function lineEval(pH, pL, oH, oL, gH, gL, rp, ro) {
  const TM = P.lineTm, f = P.oppFactor;
  const occH = pH | oH, occL = pL | oL;
  let mine = 0, theirs = 0;
  for (let w = 0; w < NW; w++) {
    const h = WH[w], l = WL[w];
    const oh = occH & h, ol = occL & l;
    if (!(oh | ol)) continue;
    const gh = gH & h, gl = gL & l;
    let grp;
    if (gh === 0 && gl === 0) grp = 0; else if (gh === oh && gl === ol) grp = 1; else continue;
    const a = popcount(pH & h) + popcount(pL & l), o = popcount(oH & h) + popcount(oL & l);
    if (a && rp[grp]) mine += (TM[LEN - a] || 0) * (o ? f ** o : 1);
    if (o && ro[grp]) theirs += (TM[LEN - o] || 0) * (a ? f ** a : 1);
  }
  return (mine * P.tempo - theirs) * P.lineScale;
}

function leafEval(pH, pL, oH, oL, gH, gL, rp, ro) {
  let v = P.othelloEval === false ? 0 : P.othelloScale * evaluate(pH, pL, oH, oL, 1, ONES, ONES, V6_PARAMS);
  if (P.lineEval) v += lineEval(pH, pL, oH, oL, gH, gL, rp, ro);
  if (COUNT) v += P.fiveNow * FIVE_UNIT * (fiveCount(pH, pL, gH, gL) - fiveCount(oH, oL, gH, gL)); // 盤上已有的五連
  return v;
}

/** 產生走法：格子 × 組別（死格子只試一種組別，用自己剩比較多的那組） */
function genMoves(mH, mL, rp, liveH, liveL, out) {
  let n = 0, ml = mL, mh = mH;
  while (ml !== 0 || mh !== 0) {
    let s;
    if (ml !== 0) { const b = ml & -ml; s = 31 - Math.clz32(b); ml ^= b; } else { const b = mh & -mh; s = 63 - Math.clz32(b); mh ^= b; }
    const live = hasBit(liveH, liveL, s);
    for (let g = 0; g < 2; g++) {
      if (!rp[g]) continue;
      if (!live && rp[1 - g] && (rp[1 - g] > rp[g] || (rp[1 - g] === rp[g] && g === 1))) continue;
      out[n++] = s * 2 + g;
    }
  }
  return n;
}

/**
 * NegaScout。depth ≤ 0 是葉節點：對手有「下一手就連成五」的威脅時延伸（ext 層以內），否則看 VCF、再靜態評估。
 * passed：上一手是 PASS（再 PASS 就終局）。
 */
function nega(pH, pL, oH, oL, gH, gL, sup, depth, alpha, beta, ply, ext, passed) {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) throw ABORT;
  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  if (!(mH | mL)) {
    mobility(oH, oL, pH, pL);
    if (passed || !(RH | RL)) return finalScore(pH, pL, oH, oL, gH, gL); // 雙方都沒得下：終局
    return -nega(oH, oL, pH, pL, gH, gL, swapSup(sup), depth, -beta, -alpha, ply + 1, ext, true);
  }
  const rp = remP(sup, pH, pL, oH, oL, gH, gL), ro = remO(sup, pH, pL, oH, oL, gH, gL);
  if (!rp[0] && !rp[1]) return finalScore(pH, pL, oH, oL, gH, gL); // 自己沒棋了（各自持有模式）：終局
  // 1. 能直接連成五：贏
  if (INSTANT && P.winCheck && findWin(pH, pL, oH, oL, gH, gL, mH, mL, rp) >= 0) return WIN - ply;

  // 2. 葉節點：對手下一手就能連成五 → 延伸（逼我們去擋）；否則看 VCF、再靜態評估
  if (depth <= 0) {
    let threat = false;
    if (INSTANT && ext < P.threatExt) {
      mobility(oH, oL, pH, pL);
      threat = findWin(oH, oL, pH, pL, gH, gL, RH, RL, ro) >= 0;
    }
    if (!threat) {
      if (INSTANT && P.vcfDepth) {
        vcfNodes = 0;
        try { if (vcf(pH, pL, oH, oL, gH, gL, sup, P.vcfDepth, ply)) return WIN - ply - 2 * P.vcfDepth; } catch (e) { if (e !== VCF_FAIL) throw e; }
      }
      return leafEval(pH, pL, oH, oL, gH, gL, rp, ro);
    }
    depth = 1; ext++;
  }

  // 3. 置換表
  const k1 = key1(pH, pL, oH, oL, gH, gL, sup), k2 = key2(pH, pL, oH, oL, gH, gL, sup);
  const idx = k1 & TT_MASK;
  let ttMove = -1;
  const alphaOrig = alpha;
  if (TT_K2[idx] === k2 && TT_DEPTH[idx] >= 0) {
    ttMove = TT_MOVE[idx];
    if (TT_DEPTH[idx] >= depth) {
      const sc = TT_SCORE[idx], fl = TT_FLAG[idx];
      if (fl === EXACT) return sc;
      if (fl === LOWER && sc > alpha) alpha = sc;
      else if (fl === UPPER && sc < beta) beta = sc;
      if (alpha >= beta) return sc;
    }
  }

  // 4. 走法與排序
  const moves = MOVEBUF[ply], keys = KEYBUF[ply];
  let liveH = -1, liveL = -1;
  if (P.deadMerge) { scanLive(pH, pL, oH, oL, gH, gL, rp, ro); liveH = LIVE_H; liveL = LIVE_L; }
  const n = genMoves(mH, mL, rp, liveH, liveL, moves);
  const k0 = KILLER[ply * 2], k1m = KILLER[ply * 2 + 1];
  for (let i = 0; i < n; i++) {
    const mv = moves[i];
    keys[i] = mv === ttMove ? 1e9 : (mv === k0 || mv === k1m ? 1e6 : 0) + (P.history ? HISTORY[mv] : 0) + SQ_ORDER[mv >> 1] * 50;
  }
  for (let i = 1; i < n; i++) {
    const m = moves[i], k = keys[i];
    let j = i - 1;
    while (j >= 0 && keys[j] < k) { moves[j + 1] = moves[j]; keys[j + 1] = keys[j]; j--; }
    moves[j + 1] = m; keys[j + 1] = k;
  }

  let best = -Infinity, bestMove = -1;
  for (let i = 0; i < n; i++) {
    const mv = moves[i], s = mv >> 1, g = mv & 1;
    flips(pH, pL, oH, oL, s);
    const fH = RH, fL = RL, bh = bitH(s), bl = bitL(s);
    const nPH = pH | fH | bh, nPL = pL | fL | bl, nOH = oH & ~fH, nOL = oL & ~fL;
    const nGH = g ? gH | bh : gH, nGL = g ? gL | bl : gL;
    const cs = childSup(sup, g);
    let v;
    if (INSTANT && fiveAfter(nPH, nPL, nGH, nGL, fH | bh, fL | bl)) v = WIN - ply - 1;
    else if (i === 0) v = -nega(nOH, nOL, nPH, nPL, nGH, nGL, cs, depth - 1, -beta, -alpha, ply + 1, ext, false);
    else {
      // LMR：第 4 個以後、深度夠、不是殺手著法的，先少搜一層；超出預期（> alpha）才用完整深度重算
      const reduce = P.lmr && !EXACT_RUN && depth >= 3 && i >= 3 && mv !== k0 && mv !== k1m ? 1 : 0;
      v = -nega(nOH, nOL, nPH, nPL, nGH, nGL, cs, depth - 1 - reduce, -alpha - 1e-3, -alpha, ply + 1, ext, false);
      if (reduce && v > alpha) v = -nega(nOH, nOL, nPH, nPL, nGH, nGL, cs, depth - 1, -alpha - 1e-3, -alpha, ply + 1, ext, false);
      if (v > alpha && v < beta) v = -nega(nOH, nOL, nPH, nPL, nGH, nGL, cs, depth - 1, -beta, -alpha, ply + 1, ext, false);
    }
    if (v > best) { best = v; bestMove = mv; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) {
      if (P.history) HISTORY[mv] += depth * depth;
      if (KILLER[ply * 2] !== mv) { KILLER[ply * 2 + 1] = KILLER[ply * 2]; KILLER[ply * 2] = mv; }
      break;
    }
  }

  TT_K2[idx] = k2; TT_DEPTH[idx] = Math.min(127, depth); TT_SCORE[idx] = best; TT_MOVE[idx] = bestMove;
  TT_FLAG[idx] = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
  return best;
}

/**
 * 根節點：迭代加深。剩 exactEmpties 格以內先試著精確算到終局（深度 = 空格數），時間不夠就改回一般的迭代加深。
 * @param {object} o
 * @param {{pH,pL,oH,oL,gH,gL}} o.pos 輪到的一方角度的位元棋盤
 * @param {{mine:number[], theirs:number[]}|null} [o.supply] 各自持有模式：雙方剩的 [α, β]；null = 共用模式
 * @returns {{ best:number, scores:{mv:number, score:number}[], depth:number, exact:boolean, nodes:number, ms:number } | null}
 *   mv = 格 × 2 + 組；scores 依分數排好（multiPV 時每一步都是精確分數，否則只有最佳步準）
 */
export function searchRootV10({ pos, supply = null, rule = null, timeMs = 1000, maxDepth = 60, multiPV = false, params = V10_PARAMS }) {
  P = params;
  setRule(rule);
  const t0 = Date.now();
  nodes = 0;
  const { pH, pL, oH, oL, gH, gL } = pos;
  const sup = supply ? packSup(supply.mine, supply.theirs) : -1;
  mobility(pH, pL, oH, oL);
  const mH = RH, mL = RL;
  if (!(mH | mL)) return null;
  const rp = remP(sup, pH, pL, oH, oL, gH, gL), ro = remO(sup, pH, pL, oH, oL, gH, gL);
  if (!rp[0] && !rp[1]) return null;
  const empties = 64 - count(pH | oH, pL | oL);

  let liveH = -1, liveL = -1;
  if (P.deadMerge) { scanLive(pH, pL, oH, oL, gH, gL, rp, ro); liveH = LIVE_H; liveL = LIVE_L; }
  const buf = new Int16Array(64);
  const root = Array.from(buf.subarray(0, genMoves(mH, mL, rp, liveH, liveL, buf)), mv => ({ mv, score: 0 }));
  // 直接連成（立刻獲勝）
  for (const r of root) {
    if (INSTANT && tryWin(pH, pL, oH, oL, gH, gL, r.mv >> 1, r.mv & 1)) {
      return { best: r.mv, scores: [{ mv: r.mv, score: WIN }, ...root.filter(x => x !== r).map(x => ({ mv: x.mv, score: -Infinity }))], depth: 0, exact: true, nodes, ms: Date.now() - t0 };
    }
  }
  HISTORY.fill(0);
  KILLER.fill(-1);

  let done = null, depthDone = 0, exact = false;
  const iterate = (from, to, until) => {
    deadline = until;
    for (let depth = from; depth <= to; depth++) {
      try {
        let alpha = -Infinity;
        const scored = [];
        for (let i = 0; i < root.length; i++) {
          const mv = root[i].mv, s = mv >> 1, g = mv & 1;
          flips(pH, pL, oH, oL, s);
          const fH = RH, fL = RL, bh = bitH(s), bl = bitL(s);
          const nPH = pH | fH | bh, nPL = pL | fL | bl, nOH = oH & ~fH, nOL = oL & ~fL;
          const nGH = g ? gH | bh : gH, nGL = g ? gL | bl : gL;
          const cs = childSup(sup, g);
          let v;
          if (multiPV || i === 0) v = -nega(nOH, nOL, nPH, nPL, nGH, nGL, cs, depth - 1, -Infinity, Infinity, 1, 0, false);
          else {
            v = -nega(nOH, nOL, nPH, nPL, nGH, nGL, cs, depth - 1, -alpha - 1e-3, -alpha, 1, 0, false);
            if (v > alpha) v = -nega(nOH, nOL, nPH, nPL, nGH, nGL, cs, depth - 1, -Infinity, -alpha, 1, 0, false);
          }
          scored.push({ mv, score: v });
          if (v > alpha) alpha = v;
        }
        scored.sort((a, b) => b.score - a.score);
        root.sort((a, b) => scored.findIndex(x => x.mv === a.mv) - scored.findIndex(x => x.mv === b.mv)); // 下一層先試最好的
        done = scored; depthDone = depth;
        if (Math.abs(scored[0].score) > WIN / 2) return true; // 已經算出勝負
        if (Date.now() - t0 > timeMs * 0.5 && depth < to) return false;
      } catch (e) {
        if (e !== ABORT) throw e;
        return false;
      }
    }
    return true;
  };
  if (empties <= P.exactEmpties && maxDepth >= empties) {
    EXACT_RUN = true;
    try { exact = iterate(empties, empties, t0 + timeMs * 2); } finally { EXACT_RUN = false; } // 精確算到終局（時間給寬一點）
  }
  if (!exact) iterate(1, Math.min(maxDepth, empties), t0 + timeMs);
  if (!done) done = root.map((r, i) => ({ mv: r.mv, score: i === 0 ? 0 : -1 })); // 連第一層都沒算完
  return { best: done[0].mv, scores: done, depth: depthDone, exact: exact && depthDone === empties, nodes, ms: Date.now() - t0 };
}

/** 測試用：輪到的一方（pos）能不能靠連續做四逼出五連；預算用完回傳 null（不確定） */
export function vcfProbe(pos, depth = 3, budget = 5000, supply = null) {
  const saved = P; P = { ...V10_PARAMS, vcfBudget: budget };
  vcfNodes = 0;
  try { return vcf(pos.pH, pos.pL, pos.oH, pos.oL, pos.gH, pos.gL, supply ? packSup(supply.mine, supply.theirs) : -1, depth, 0); }
  catch (e) { if (e === VCF_FAIL) return null; throw e; }
  finally { P = saved; }
}
