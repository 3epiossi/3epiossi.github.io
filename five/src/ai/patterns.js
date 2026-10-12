/**
 * 黑白棋棋型評估（v14 用）：盤面拆成 46 個棋型（邊、角、斜線…），每種棋型一張分數表（3^格數 個分數），
 * 依空格數分 STAGES 個階段，相鄰兩個階段內插。分數單位是「輪到的一方的棋子差」（跟 Edax 一樣）。
 * 分數表由 tests/train-patterns.js 用 Edax 的評估訓練出來（tests/gen-othello-data.js 產生資料）。
 *
 * 格子編號 r × 8 + c（A1 = 0、H8 = 63）。每格的狀態：0 空、1 自己、2 對手。
 */

/** 基本棋型（再用 8 種對稱展開；格子集合相同的只留一個） */
const BASE = [
  ["hv2", [8, 9, 10, 11, 12, 13, 14, 15]],
  ["hv3", [16, 17, 18, 19, 20, 21, 22, 23]],
  ["hv4", [24, 25, 26, 27, 28, 29, 30, 31]],
  ["d8", [0, 9, 18, 27, 36, 45, 54, 63]],
  ["d7", [1, 10, 19, 28, 37, 46, 55]],
  ["d6", [2, 11, 20, 29, 38, 47]],
  ["d5", [3, 12, 21, 30, 39]],
  ["d4", [4, 13, 22, 31]],
  ["edge", [9, 0, 1, 2, 3, 4, 5, 6, 7, 14]],
  ["c33", [0, 1, 2, 8, 9, 10, 16, 17, 18]],
  ["c25", [0, 1, 2, 3, 4, 8, 9, 10, 11, 12]]
];

const SYM = [
  (r, c) => [r, c], (r, c) => [r, 7 - c], (r, c) => [7 - r, c], (r, c) => [7 - r, 7 - c],
  (r, c) => [c, r], (r, c) => [c, 7 - r], (r, c) => [7 - c, r], (r, c) => [7 - c, 7 - r]
];

/** 棋型種類：{ name, size（格數）, offset（在分數表裡的起點） } */
export const TYPES = [];
/** 每個棋型的實例：{ type（種類編號）, cells（格子，照基本棋型的順序） } */
export const INSTANCES = [];
let off = 0;
for (const [name, cells] of BASE) {
  const t = TYPES.length;
  TYPES.push({ name, size: cells.length, offset: off });
  off += 3 ** cells.length;
  const seen = new Set();
  for (const f of SYM) {
    const cs = cells.map((s) => { const [r, c] = f(s >> 3, s & 7); return r * 8 + c; });
    const key = [...cs].sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    INSTANCES.push({ type: t, cells: cs });
  }
}
/** 一個階段的分數表大小（所有棋型的表接在一起），再加上：常數、行動力差 */
export const TABLE_SIZE = off;
export const W_BIAS = off, W_MOB = off + 1;
export const STAGE_SIZE = off + 2;
export const STAGES = 8;

/** 空格數 → [階段, 下一個階段的比重]（空格 60 → 階段 0，空格 0 → 最後一個階段） */
export function stageOf(empties) {
  const x = ((60 - Math.min(60, Math.max(0, empties))) / 60) * (STAGES - 1);
  const s = Math.min(STAGES - 2, Math.floor(x));
  return [s, x - s];
}

/** 盤面（每格 0 空、1 自己、2 對手）→ 每個實例在分數表裡的位置（已經加上 offset） */
export function patternIndices(cells, out = new Int32Array(INSTANCES.length)) {
  for (let i = 0; i < INSTANCES.length; i++) {
    const inst = INSTANCES[i], cs = inst.cells;
    let idx = 0;
    for (let k = 0; k < cs.length; k++) idx = idx * 3 + cells[cs[k]];
    out[i] = TYPES[inst.type].offset + idx;
  }
  return out;
}
