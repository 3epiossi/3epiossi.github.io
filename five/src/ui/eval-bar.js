/**
 * 📊 勝率條（像 chess.com 棋盤左側那條）：黑方在下、白方在上，分界線依雙方勝率移動。
 */

import { tr } from "../i18n.js";

/**
 * 勝率條上的勝率換算。引擎搜尋本身仍用原本的分數；提示的百分比、走法評價（ai/move-quality.js 的五個等級）用這個換算。
 *
 * 分數 = tanh(v14 的分數〔棋子差〕÷ SCORE_SCALE_V14)（見 ai/ai-service.js），直接當勝率太保守。
 * 這裡用自我對戰的實際結果校準：勝率 = sigmoid(k × atanh(分數))，k 依剩餘空格變化。
 * 資料：v14 自我對戰 240 局（每步 0.4 秒、前 4 手隨機）、7338 個局面（tests/calibrate-v13.js --engine v14，原始資料在 tests/results/v14-calib-*.jsonl）。
 * 剩 10 格以內會算到底（分數就是 ±1 或 0），用不到這裡；8～15 格那段擬合出 15，但樣本少（391 個），保守用 10，最後一段沿用。
 */
const CAL = [ // [剩餘空格（該段中點）, k]
  [53.5, 1.80], [40.5, 2.45], [30, 3.15], [20.5, 4.25], [11.5, 10], [3.5, 10]
];

function kAt(empties) {
  if (empties >= CAL[0][0]) return CAL[0][1];
  for (let i = 1; i < CAL.length; i++) {
    const [e1, k1] = CAL[i - 1], [e2, k2] = CAL[i];
    if (empties >= e2) return k2 + (k1 - k2) * (empties - e2) / (e1 - e2);
  }
  return CAL[CAL.length - 1][1];
}

/**
 * @param {number} score 引擎的分數（下棋者角度，[-1, 1]，見 ai/ai-service.js 的 toUnit）
 * @param {number} empties 剩幾格
 * @returns {number} 下棋者的勝率 [0, 1]
 */
export function displayWinProb(score, empties) {
  if (score >= 0.999) return 1;
  if (score <= -0.999) return 0;
  return 1 / (1 + Math.exp(-kAt(empties) * Math.atanh(score)));
}

export class EvalBar {
  /** @param {HTMLElement} el #evalBar */
  constructor(el) {
    this.el = el;
    this.white = el?.querySelector(".evalWhite");
    this.blackNum = el?.querySelector(".evalNumBlack");
    this.whiteNum = el?.querySelector(".evalNumWhite");
  }

  /**
   * @param {{ blackProb: number, pending?: boolean }} s blackProb：黑方勝率 [0, 1]
   */
  render({ blackProb, pending = false }) {
    if (!this.el) return;
    const b = Math.round(blackProb * 100), w = 100 - b;
    // 白方勝率：電腦版是上方白色區塊的高度、手機版（橫條）是右邊白色區塊的寬度，交給 CSS（見 five.css 的 --white）。
    // 不能直接設 style.height：手機版的橫條會被設成很矮的一條
    this.el.style.setProperty("--white", `${w}%`);
    // 數字寫在占比較大的那一邊
    if (this.blackNum) this.blackNum.textContent = b >= w ? `${b}` : "";
    if (this.whiteNum) this.whiteNum.textContent = w > b ? `${w}` : "";
    this.el.classList.toggle("pending", pending);
    this.el.title = tr("evalTitle", { b, w });
    this.el.setAttribute("aria-label", tr("evalTitle", { b, w }));
  }
}
