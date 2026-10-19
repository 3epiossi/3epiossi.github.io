import test from "node:test";
import assert from "node:assert/strict";
import { classifyMove, levelOf, MARK_TUNE } from "../src/ai/move-quality.js";
import { createEmptyBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";

// 測試用：分數直接當勝率（score = 2p − 1），走法 key = 格子（棋 0）
const toProb = (s) => (s + 1) / 2;
const sc = (obj) => Object.entries(obj).map(([sq, p]) => ({ sq: Number(sq), score: 2 * p - 1 }));
/** 開局盤面（中間四顆），剩 60 格 */
function opening() {
  const b = createEmptyBoard();
  b[3][3] = { id: 9, face: WHITE }; b[4][4] = { id: 18, face: WHITE };
  b[3][4] = { id: 27, face: BLACK }; b[4][3] = { id: 36, face: BLACK };
  return b;
}
/** 終盤盤面：只剩 6 格空著 */
function endgame() {
  const b = createEmptyBoard();
  for (let s = 0; s < 64; s++) b[s >> 3][s & 7] = { id: s, face: (s * 7) % 3 ? BLACK : WHITE };
  for (const s of [20, 21, 22, 29, 30, 38]) b[s >> 3][s & 7] = null;
  return b;
}
const mark = (scores, played, extra = {}) => classifyMove({ scores: sc(scores), played, board: opening(), turn: BLACK, toProb, ...extra });
/** 開局盤面再加一條「四」（最下面一排 A8～D8 都是第 1 組 α，E8 空著）：盤面上有威脅 */
function withFour() {
  const b = opening();
  for (let c = 0; c < 4; c++) b[7][c] = { id: c, face: BLACK };
  return b;
}
/**
 * 有難度的局面：可下的格子 7 個以上（多 5 個很差的格子）＋ 這一格換一顆棋勝率差 3%（選棋有差）＝ 2 分
 * withFour 的盤面再加 1 分（威脅）＝ 3 分
 */
const hard = (scores, played) => [
  ...sc(scores),
  ...sc({ 40: 0.05, 41: 0.05, 42: 0.05, 43: 0.05, 44: 0.05 }),
  { sq: 64 + played, score: 2 * (scores[played] - 0.03) - 1 }
];
const markHard = (scores, played, extra = {}) => classifyMove({ scores: hard(scores, played), played, board: opening(), turn: BLACK, toProb, ...extra });

test("局勢等級：敗定 ≤10%、劣勢、拉鋸 35～65%、優勢、勝定 ≥90%", () => {
  assert.deepEqual([0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1].map(levelOf), [0, 0, 1, 2, 2, 3, 3, 4, 4]);
});

test("不標：只有一個格子、勝負已定（雙方都在勝定或都在敗定）", () => {
  assert.equal(mark({ 19: 0.6 }, 19).sym, null);
  assert.equal(mark({ 19: 0.97, 26: 0.92, 37: 0.5 }, 26).sym, null);   // 勝定 → 勝定
  assert.equal(mark({ 19: 0.08, 26: 0.02, 37: 0.01 }, 26).sym, null);  // 敗定 → 敗定
});

test("失誤類：?? 掉兩級而且損失 ≥ 80%、? 掉一級而且損失 ≥ 45%、?! 損失 ≥ 29%；不夠就降一類或不標", () => {
  assert.equal(mark({ 19: 0.95, 26: 0.1, 37: 0.05 }, 26).sym, "??");  // 勝定 → 敗定，少 85%
  assert.equal(mark({ 19: 0.75, 26: 0.25, 37: 0.2 }, 26).sym, "?");   // 掉兩級，但只少 50% → ?
  assert.equal(mark({ 19: 0.85, 26: 0.36, 37: 0.2 }, 26).sym, "?");   // 優勢 → 拉鋸，少 49%
  assert.equal(mark({ 19: 0.7, 26: 0.38, 37: 0.2 }, 26).sym, "?!");   // 優勢 → 拉鋸，只少 32% → ?!
  assert.equal(mark({ 19: 0.64, 26: 0.34, 37: 0.2 }, 26).sym, "?!");  // 少 30%
  assert.equal(mark({ 19: 0.62, 26: 0.36, 37: 0.2 }, 26).sym, null);  // 拉鋸裡讓掉 26%：不標
  assert.equal(mark({ 19: 0.66, 26: 0.62, 37: 0.2 }, 26).sym, null);  // 優勢 → 拉鋸，但只少 4%
  const m = mark({ 19: 0.85, 26: 0.36, 37: 0.2 }, 26);
  assert.equal(m.why.key, "whyDrop");
  assert.deepEqual([m.why.p.from, m.why.p.to, m.why.p.at, m.why.p.disc], [3, 2, "D3", 0]); // 最佳步：D3 配第 0 顆棋
  assert.equal(mark({ 19: 0.7, 26: 0.38, 37: 0.2 }, 26).why.key, "whyLoose");
});

test("難度的「盤面有威脅」：只有一條三不算，要有四或至少三條", async () => {
  const { difficultyOf } = await import("../src/ai/move-quality.js");
  const one = opening();
  for (let c = 0; c < 3; c++) one[7][c] = { id: c, face: BLACK };      // 一條三
  const args = { turn: BLACK, sq: 19, squares: [{ sq: 19, p: 0.6 }], moves: [{ sq: 19, p: 0.6 }] };
  assert.equal(difficultyOf({ board: one, ...args }).threats, false);
  assert.equal(difficultyOf({ board: withFour(), ...args }).threats, true);
});

test("很好找的關鍵一手不標：選擇很少、每格只有一種棋、盤面沒有威脅（難度不到 2 分）", () => {
  assert.equal(mark({ 19: 0.7, 26: 0.5, 37: 0.4 }, 19).sym, null);
  assert.equal(mark({ 0: 0.7, 26: 0.3, 37: 0.2 }, 0).sym, null);         // 佔角
});

test("很明顯的關鍵一手不標：佔角、只有兩個格子可下", () => {
  assert.equal(mark({ 0: 0.7, 26: 0.3, 37: 0.2 }, 0).sym, null);
  assert.equal(mark({ 19: 0.7, 26: 0.3 }, 19).sym, null);
});

// 好手類的測試：門檻都從 MARK_TUNE 算，調參數不用改測試；「問應手」只用靜態評估判斷（obviousDepth 0，不跑搜尋）
const T = { ...MARK_TUNE, obviousDepth: 0 };
const good = (scores, played, extra = {}) => classifyMove({ scores: hard(scores, played), played, board: opening(), turn: BLACK, toProb, tune: T, ...extra });

test("!! 反殺：往前連續 turnWindow 個局面勝率都很差（≤ turnFrom），這步翻成很好（≥ turnTo），其他格子都差 turnGap 以上", () => {
  const hi = T.turnTo + 0.05, lo = hi - T.turnGap - 0.05, bad = T.turnFrom - 0.05;
  const run = (prevWin, extra = {}) => good({ 9: hi, 26: lo, 37: 0.1 }, 9, { prevWin, ...extra });
  const m = run([bad, bad, bad]);
  assert.equal(m.sym, "!!");
  assert.equal(m.why.key, "whyTurnaround");
  assert.equal(m.why.p.k, 3);
  // 其中一個局面不算差（中間有過機會）：不是一直被壓著打
  assert.notEqual(run([bad, T.turnFrom + 0.2, bad]).sym, "!!");
  assert.notEqual(run([T.turnFrom + 0.1, bad, bad]).sym, "!!");
  // 只有前面部分局面有分析：用有的那幾個判斷（至少 1 個）
  assert.equal(run([bad]).sym, "!!");
  // 沒有任何歷史：退回只看 prevP
  assert.equal(run(null, { prevP: bad }).sym, "!!");
  assert.notEqual(run(null, { prevP: T.turnFrom + 0.2 }).sym, "!!");
  // 翻得不夠好
  assert.notEqual(good({ 9: T.turnTo - 0.1, 26: 0.1, 37: 0.1 }, 9, { prevWin: [0.1, 0.1, 0.1] }).sym, "!!");
  // 其他格子也差不多好：不是只有這步能反殺
  assert.notEqual(good({ 9: hi, 26: hi - 0.05, 37: 0.1 }, 9, { prevWin: [0.1, 0.1, 0.1] }).sym, "!!");
  // 終盤也照常標
  const board = endgame();
  const end = classifyMove({ scores: sc({ 20: 0.95, 21: 0.2, 22: 0.1 }), played: 20, board, turn: BLACK, toProb, prevWin: [0.1, 0.1, 0.1], tune: T });
  assert.equal(end.sym, "!!");
});

test("! 唯一手：最佳步、其他格子都差 onlyGap 以上、局勢不比對手下之前差，而且只看盤面看不出來", () => {
  const p = 0.6, q = p - T.onlyGap - 0.03;
  // B2（X 格）只看盤面很差，其實是唯一的好步
  const m = good({ 9: p, 26: q, 37: 0.2 }, 9, { prevP: 0.55 });
  assert.equal(m.sym, "!");
  assert.equal(m.why.key, "whyOnly");
  // 其他格子差不到 onlyGap
  assert.equal(good({ 9: p, 26: p - T.onlyGap + 0.03, 37: 0.2 }, 9, { prevP: 0.55 }).sym, null);
  // 局勢比對手下之前差（原本優勢，這步只能保住拉鋸）：是被逼的，不標
  assert.equal(good({ 9: p, 26: q, 37: 0.2 }, 9, { prevP: 0.8 }).sym, null);
  // 原本已經勝定：不標
  assert.equal(good({ 9: 0.97, 26: 0.5, 37: 0.2 }, 9, { prevP: 0.95 }).sym, null);
  // 只看盤面就看得出來（佔角）：問應手，不標
  assert.equal(good({ 0: p, 26: q, 37: 0.2 }, 0, { prevP: 0.55 }).sym, null);
  // 終盤（剩 7 格以內）不標唯一手
  const board = endgame();
  assert.equal(classifyMove({ scores: sc({ 20: 0.6, 21: 0.2, 22: 0.1 }), played: 20, board, turn: BLACK, toProb, prevP: 0.55, tune: T }).sym, null);
});

test("! 唯一手：擋住對手下一手的五連是問應手，不標", () => {
  // 白棋第 1 組 4 顆（A8～D8），E8 空著：黑下 E8 是去擋
  const b = opening();
  for (let c = 0; c < 4; c++) b[7][c] = { id: c, face: WHITE };
  b[6][3] = { id: 40, face: BLACK }; b[5][2] = { id: 41, face: WHITE }; // 白下 E8 可以翻 D7（合法），才算真的威脅
  const m = classifyMove({ scores: hard({ 60: 0.6, 26: 0.3, 37: 0.2 }, 60), played: 60, board: b, turn: BLACK, toProb, prevP: 0.55, tune: T });
  assert.equal(m.sym, null);
});

test("!? 強迫手：損失不超過 forceLoss，下完後對手只有一個好格子，其他都差 forceGap 以上", () => {
  const forced = { scores: sc({ 10: 0.5, 11: 0.5 - T.forceGap - 0.05, 12: 0.1, 13: 0.1 }) };
  const m = mark({ 19: 0.5, 26: 0.5 - T.forceLoss + 0.02, 37: 0.2 }, 26, { next: forced, tune: T });
  assert.equal(m.sym, "!?");
  assert.equal(m.why.key, "whyForce");
  assert.equal(m.why.p.at, "C2"); // 對手唯一的好選擇：格子 10
  // 對手還有第二個不錯的選擇：不是強迫手
  const two = { scores: sc({ 10: 0.5, 11: 0.45, 12: 0.1, 13: 0.1 }) };
  assert.equal(mark({ 19: 0.5, 26: 0.48, 37: 0.2 }, 26, { next: two, tune: T }).sym, null);
  // 這步本身就少太多：不算
  assert.equal(mark({ 19: 0.5, 26: 0.5 - T.forceLoss - 0.05, 37: 0.2 }, 26, { next: forced, tune: T }).sym, null);
  // 對手的最佳步是直接連成五：那是對手的機會，不算
  const five = { scores: sc({ 10: 1, 11: 0.1, 12: 0.1, 13: 0.1 }) };
  assert.equal(mark({ 19: 0.5, 26: 0.48, 37: 0.2 }, 26, { next: five, tune: T }).sym, null);
  // 對手可下的格子太少
  const few = { scores: sc({ 10: 0.5, 11: 0.1 }) };
  assert.equal(mark({ 19: 0.5, 26: 0.48, 37: 0.2 }, 26, { next: few, tune: T }).sym, T.forceMinSquares <= 2 ? "!?" : null);
});

test("下在最佳的格子不標失誤：組別選得不同、或下的當下提示顯示的最佳格（之後分析變了）都一樣", () => {
  // 格子 19 配第 0 顆棋 90%（最好），配第 1 顆棋（key 64 + 19）只有 30%：格子對了，不標
  const scores = [...sc({ 19: 0.9, 26: 0.4, 37: 0.2 }), { sq: 64 + 19, score: 2 * 0.3 - 1 }];
  assert.equal(classifyMove({ scores, played: 64 + 19, board: opening(), turn: BLACK, toProb }).sym, null);
  // 下的時候提示說 26 最好（bestAtMove），後來分析變深發現 19 好很多：下 26 不標
  assert.equal(mark({ 19: 0.9, 26: 0.4, 37: 0.2 }, 26, { bestAtMove: 26 }).sym, null);
  // 提示的最佳格是 26，卻下了 37：照常標
  assert.equal(mark({ 19: 0.9, 26: 0.4, 37: 0.2 }, 37, { bestAtMove: 26 }).sym, "?");
});

test("找不到這一步的分數時回傳 null", () => {
  assert.equal(mark({ 19: 0.6, 26: 0.4 }, 7), null);
});

test("勝率條的換算：0 分 = 50%、單調遞增、±1 = 0%／100%；中盤領先 10 顆（v14 的分數）約八、九成", async () => {
  const { displayWinProb } = await import("../src/ui/eval-bar.js");
  for (const empties of [58, 40, 30, 20, 10, 3]) {
    assert.equal(displayWinProb(0, empties), 0.5);
    assert.equal(displayWinProb(1, empties), 1);
    assert.equal(displayWinProb(-1, empties), 0);
    let prev = 0;
    for (let s = -0.95; s <= 0.95; s += 0.05) {
      const p = displayWinProb(s, empties);
      assert.ok(p >= prev);
      prev = p;
    }
  }
  // v14 中盤（剩 30 格）領先 10 顆：校準後約 87%（自我對戰的實際勝率）
  const { toUnit } = await import("../src/ai/ai-service.js");
  const p = displayWinProb(toUnit(10), 30);
  assert.ok(p > 0.7 && p < 0.9, `${p}`);
});

test("棋盤上的評價標記：六種評價都有樣式與提示文字（少了會讓畫面更新出錯、CPU 卡住）", async () => {
  const { MARK_CLASS, MARK_TIP } = await import("../src/ui/board-view.js");
  for (const sym of ["!!", "!", "!?", "?!", "?", "??"]) {
    assert.ok(MARK_CLASS[sym], sym);
    assert.ok(MARK_TIP[sym], sym);
  }
});
