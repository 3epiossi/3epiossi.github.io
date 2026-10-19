/**
 * 勝率條（像 chess.com 棋盤旁那條）：黑方在下、白方在上，分界線依雙方勝率移動。
 * 並提供勝率的校準換算 displayWinProb（見下方說明）。
 */

import { tr } from "../i18n.js";

/**
 * 勝率校準。引擎搜尋回傳的是自己的勝率估計（期望搜尋 + 評估函數的 sigmoid），
 * 在不同局面階段（依盤上棋子數）會偏保守或偏自信，所以顯示前再校準：
 *   顯示勝率 = sigmoid(k × logit(引擎勝率))，k 依盤上棋子總數分段，段與段之間線性內插。
 * k 由 tests/eval-calibration.js 用自我對戰擬合（最小化「這一方最後有沒有贏」的 log loss），
 * 資料與結果寫在 CAL_NOTE。終局（0 或 1）不經過校準。
 */
export const CAL = [ // [盤上棋子總數（該段中點）, k]
  [7.9, 3.1], [17.9, 2.01], [25.6, 1.35], [33.7, 1.32], [42.3, 1.15], [51.1, 1.38]
];
/**
 * 資料：tests/eval-calibration.js，自我對戰 160 局（雙方各抽「1 層帶 15% 失誤、2 層、3 層」，固定層數）、19799 個局面，
 * 每個擲骰前的局面用固定 3 層分析。各段（盤上棋子數）的 k 與 log loss（校準後 / 未校準 k = 1）：
 *   0-13 子：3.10（0.651 / 0.666）　14-21：2.01（0.592 / 0.612）　22-29：1.35（0.552 / 0.557）
 *   30-37：1.32（0.450 / 0.457）　38-47：1.15（0.401 / 0.402）　48 子以上：1.38（0.252 / 0.260）
 * 開局幾手引擎的勝率非常保守（k 約 3），中後盤只差一點，所以勝率條在開局會比引擎原本的數字更有起伏。
 */
export const CAL_NOTE = "自我對戰 160 局 19799 個局面，依盤上棋子數分 6 段擬合 k";

function kAt(pieces) {
  if (pieces <= CAL[0][0]) return CAL[0][1];
  for (let i = 1; i < CAL.length; i++) {
    const [p2, k2] = CAL[i], [p1, k1] = CAL[i - 1];
    if (pieces <= p2) return k1 + (k2 - k1) * (pieces - p1) / (p2 - p1);
  }
  return CAL[CAL.length - 1][1];
}

/** 引擎的勝率（下棋者角度 [0,1]）→ 顯示用勝率 [0,1]；pieces = 盤上棋子總數 */
export function displayWinProb(p, pieces) {
  if (p >= 0.9995) return 1;
  if (p <= 0.0005) return 0;
  const logit = Math.log(p / (1 - p));
  return 1 / (1 + Math.exp(-kAt(pieces) * logit));
}

export class EvalBar {
  /** @param {HTMLElement} el #evalBar */
  constructor(el) {
    this.el = el;
    this.white = el?.querySelector(".evalWhite");
    this.blackNum = el?.querySelector(".evalNumBlack");
    this.whiteNum = el?.querySelector(".evalNumWhite");
  }

  /** @param {{ blackProb: number, pending?: boolean }} s blackProb：黑方勝率 [0, 1] */
  render({ blackProb, pending = false }) {
    if (!this.el) return;
    const b = Math.round(blackProb * 100), w = 100 - b;
    // 白方勝率：電腦版是上方白色區塊的高度、手機版（橫條）是白色區塊的寬度，交給 CSS（--white）
    this.el.style.setProperty("--white", `${w}%`);
    if (this.blackNum) this.blackNum.textContent = b >= w ? `${b}` : "";
    if (this.whiteNum) this.whiteNum.textContent = w > b ? `${w}` : "";
    this.el.classList.toggle("pending", pending);
    this.el.title = tr("evalTitle", { b, w });
    this.el.setAttribute("aria-label", tr("evalTitle", { b, w }));
  }
}
