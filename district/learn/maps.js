/**
 * 劃區爭霸規則學院：教學地圖（每格 [紅, 藍] 票數）與標準解。
 * tests/learn.test.js 會用正式規則驗證每一題的解。
 */

import { fromRedPercent } from "./lesson-engine.js";

/** 第 1 課、第 5 課：5x5，紅黨只有 43.6% 的普選票。 */
export const CRACK_MAP = fromRedPercent([
  [10, 30, 70, 90, 70],
  [30, 90, 30, 90, 10],
  [10, 10, 70, 10, 30],
  [70, 30, 10, 70, 10],
  [30, 30, 90, 10, 90]
]);
export const CRACK_PIECES = ["T4_U", "I4_V"];
/** 唯一能讓紅黨贏的放法：[牆塊, vr, vc]（共 72 種放法） */
export const CRACK_SOLUTION = [["T4_U", 0, 0], ["I4_V", 1, 2]];

/** 第 2 課：4x4，整張圖是一個選區時藍黨全拿；最右欄是藍黨的票倉。 */
export const CUT_MAP = [0, 1, 2, 3].map(() => [[55, 45], [55, 45], [55, 45], [10, 90]]);
export const CUT_PIECES = ["I4_V"];

/** 第 4 課：4x4，藍黨票倉在最下面一列（第 2 課轉個方向）。只有把票倉整列圍起來，紅黨才贏。 */
export const PACK_MAP = [
  [[55, 45], [55, 45], [55, 45], [55, 45]],
  [[55, 45], [55, 45], [55, 45], [55, 45]],
  [[55, 45], [55, 45], [55, 45], [55, 45]],
  [[10, 90], [10, 90], [10, 90], [10, 90]]
];
export const PACK_PIECES = ["I4_H"];
export const PACK_SOLUTION = [["I4_H", 3, 0]];

/** 第 3 課：6x6 六角形輪廓的沙盒 */
export const SANDBOX_MASK = [
  [0, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 0]
].map((row) => row.map(Boolean));
export const SANDBOX_MAP = fromRedPercent([
  [50, 40, 60, 70, 45, 50],
  [40, 55, 65, 35, 30, 55],
  [60, 45, 25, 50, 70, 65],
  [35, 60, 75, 45, 55, 40],
  [70, 30, 50, 65, 35, 60],
  [50, 55, 45, 30, 40, 50]
]);
export const SANDBOX_PIECES = [
  "T4_D", "I4_H", "S4_V_R", "I4_V", "T4_R", "S4_H_D", "T4_U", "I4_H", "S4_V_L", "T4_L", "I4_V", "S4_H_U"
];

/** 第 6 課：5x5，最小選區 2 格 */
export const SPLIT_MAP = fromRedPercent([
  [60, 30, 70, 40, 55],
  [35, 65, 25, 60, 45],
  [70, 40, 50, 30, 65],
  [30, 75, 55, 70, 35],
  [55, 45, 30, 50, 60]
]);
export const SPLIT_PIECES = [
  "I4_V", "T4_D", "I4_H", "S4_V_R", "T4_R", "I4_V", "S4_H_D", "T4_U", "I4_H", "T4_L"
];
