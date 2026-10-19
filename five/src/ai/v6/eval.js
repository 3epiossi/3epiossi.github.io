/**
 * 🧮 v6 局面評估
 *
 * Zebra 的評估是「盤型 (pattern) 權重表 + 行動力」，權重表靠大量棋譜訓練。
 * 我們沒有棋譜，而且每顆棋兩面權重不同，所以改用可解釋的特徵：
 *
 * 1. 權重材料（核心差異）：
 *    最終分數 = 每顆棋最後歸誰、就算誰那面的權重。
 *    - 穩定子（不可能再被翻）：直接算它現在主人那面的權重。
 *    - 不穩定的棋：還會被翻來翻去，以「留在現在主人手上」的機率 α 估期望值：
 *        我方的棋  α·我方面 − (1−α)·對方面
 *        對方的棋 −α·對方面 + (1−α)·我方面
 *      α 從開局 0.5 隨空格減少往上升。α = 0.5 時翻一顆不穩定的棋在材料上不賺不賠，
 *      這正是黑白棋「中盤吃子沒有意義」的道理；穩定子才是真正入袋的分數。
 * 2. 行動力（雙方可下位置數差）與潛在行動力（邊界子），Zebra 中盤最重要的訊號。
 * 3. 角落、X 格、C 格：角落旁還空著時佔 X/C 格等於把角送給對手。
 * 4. 奇偶性：終盤剩奇數格時，下棋者通常能拿到最後一手。
 */

import { count, mobility, neighbors, RH, RL } from "./bitboard.js";

export const PARAMS = {
  alphaStart: 0.3,     // 開局不穩定子的保留機率
  alphaGain: 0.2,      // 終局前增加的幅度（× 進度平方）
  edgeBonus: 0.08,     // 邊上不穩定子的保留機率加成
  mobEarly: 1.6,       // 開局行動力係數（每多一個可下位置）
  mobLate: 0.6,
  frontier: 0.45,      // 每少一個邊界空格
  corner: 2.5,         // 角落額外價值（穩定子本身已算入權重）
  xSquare: 4.0,        // 角落空著時，佔 X 格的懲罰（開局）
  cSquare: 1.2,        // 角落空著時，佔 C 格的懲罰
  parity: 1.5,
  // 搜尋選項（放在同一個物件，方便用 --params 做對照實驗）
  mpc: true,           // Multi-ProbCut 選擇性剪枝
  mpcT: 1.5,           // 剪枝門檻：幾個標準差
  history: false       // 歷史啟發式走法排序
};

const BLACK = 1;

// ===== 穩定子 =====
// 四個軸：橫、直、主對角、副對角。每格記錄它在各軸上的兩個鄰居（-1 = 棋盤外）與所屬的線。
const AX_DR = [[0, 0], [-1, 1], [-1, 1], [-1, 1]];
const AX_DC = [[-1, 1], [0, 0], [-1, 1], [1, -1]];
const NB = new Int8Array(64 * 8);
const LINE_OF = new Int16Array(64 * 4);
const LINES = [];
{
  const lineIndex = new Map();
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, c = s & 7;
    for (let a = 0; a < 4; a++) {
      for (let side = 0; side < 2; side++) {
        const nr = r + AX_DR[a][side], nc = c + AX_DC[a][side];
        NB[s * 8 + a * 2 + side] = nr >= 0 && nr < 8 && nc >= 0 && nc < 8 ? nr * 8 + nc : -1;
      }
      const key = a === 0 ? `r${r}` : a === 1 ? `c${c}` : a === 2 ? `d${r - c}` : `a${r + c}`;
      if (!lineIndex.has(key)) { lineIndex.set(key, LINES.length); LINES.push([]); }
      const id = lineIndex.get(key);
      LINES[id].push(s);
      LINE_OF[s * 4 + a] = id;
    }
  }
}
const lineFull = new Uint8Array(LINES.length);
const owner = new Int8Array(64);   // 1 = 下棋者, -1 = 對手, 0 = 空
const stable = new Uint8Array(64);

function fillOwner(pH, pL, oH, oL) {
  for (let s = 0; s < 32; s++) {
    const b = 1 << s;
    owner[s] = pL & b ? 1 : oL & b ? -1 : 0;
    owner[s + 32] = pH & b ? 1 : oH & b ? -1 : 0;
  }
}

function computeStable() {
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i];
    let full = 1;
    for (let k = 0; k < line.length; k++) if (owner[line[k]] === 0) { full = 0; break; }
    lineFull[i] = full;
  }
  stable.fill(0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let s = 0; s < 64; s++) {
      const o = owner[s];
      if (o === 0 || stable[s]) continue;
      let ok = true;
      for (let a = 0; a < 4 && ok; a++) {
        if (lineFull[LINE_OF[s * 4 + a]]) continue;
        const n1 = NB[s * 8 + a * 2], n2 = NB[s * 8 + a * 2 + 1];
        if (n1 < 0 || (stable[n1] && owner[n1] === o)) continue;
        if (n2 < 0 || (stable[n2] && owner[n2] === o)) continue;
        ok = false;
      }
      if (ok) { stable[s] = 1; changed = true; }
    }
  }
}

const CORNERS = [0, 7, 56, 63];
// 角落 → X 格、兩個 C 格
const X_OF = { 0: 9, 7: 14, 56: 49, 63: 54 };
const C_OF = { 0: [1, 8], 7: [6, 15], 56: [48, 57], 63: [55, 62] };
const EDGE = new Uint8Array(64);
for (let s = 0; s < 64; s++) { const r = s >> 3, c = s & 7; EDGE[s] = r === 0 || r === 7 || c === 0 || c === 7 ? 1 : 0; }

/**
 * 從下棋者（P，顏色 color）的角度評估。FB / FW 是每格黑面、白面的權重。
 */
export function evaluate(pH, pL, oH, oL, color, FB, FW, P = PARAMS) {
  const own = color === BLACK ? FB : FW;   // 下棋者那面
  const oth = color === BLACK ? FW : FB;   // 對手那面

  fillOwner(pH, pL, oH, oL);
  computeStable();

  const empties = 64 - count(pH | oH, pL | oL);
  const t = 1 - empties / 60;               // 0 開局 → 1 終局
  const alpha = P.alphaStart + P.alphaGain * t * t;

  let mat = 0;
  for (let s = 0; s < 64; s++) {
    const o = owner[s];
    if (o === 0) continue;
    if (stable[s]) {
      mat += o === 1 ? own[s] : -oth[s];
    } else {
      const a = EDGE[s] ? alpha + P.edgeBonus : alpha;
      mat += o === 1 ? a * own[s] - (1 - a) * oth[s] : (1 - a) * own[s] - a * oth[s];
    }
  }

  mobility(pH, pL, oH, oL);
  const mP = count(RH, RL);
  mobility(oH, oL, pH, pL);
  const mO = count(RH, RL);
  const mob = (mP - mO) * (P.mobEarly + (P.mobLate - P.mobEarly) * t);

  const eH = ~(pH | oH), eL = ~(pL | oL);
  neighbors(pH, pL);
  const fP = count(RH & eH, RL & eL);
  neighbors(oH, oL);
  const fO = count(RH & eH, RL & eL);
  const front = (fO - fP) * P.frontier * (1 - t * 0.6);

  let pos = 0;
  for (let i = 0; i < 4; i++) {
    const cs = CORNERS[i];
    const co = owner[cs];
    if (co !== 0) { pos += co * P.corner; continue; }
    pos -= owner[X_OF[cs]] * P.xSquare * (1 - t * 0.5);
    const cc = C_OF[cs];
    pos -= (owner[cc[0]] + owner[cc[1]]) * P.cSquare * (1 - t * 0.5);
  }

  const par = empties > 0 && empties <= 20 ? (empties & 1 ? 1 : -1) * P.parity * t : 0;

  return mat + mob + front + pos + par;
}

/** 終局實際分差（下棋者角度） */
export function finalDiff(pH, pL, oH, oL, color, FB, FW) {
  const own = color === BLACK ? FB : FW;
  const oth = color === BLACK ? FW : FB;
  let d = 0;
  for (let s = 0; s < 32; s++) {
    const b = 1 << s;
    if (pL & b) d += own[s]; else if (oL & b) d -= oth[s];
    if (pH & b) d += own[s + 32]; else if (oH & b) d -= oth[s + 32];
  }
  return d;
}

/** 雙方穩定子數量（供 v8 的學習型評估使用；不影響 v6 本身） */
export function stableCounts(pH, pL, oH, oL) {
  fillOwner(pH, pL, oH, oL);
  computeStable();
  let mine = 0, theirs = 0;
  for (let s = 0; s < 64; s++) {
    if (!stable[s]) continue;
    if (owner[s] === 1) mine++; else if (owner[s] === -1) theirs++;
  }
  return { mine, theirs };
}
