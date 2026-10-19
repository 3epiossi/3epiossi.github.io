/**
 * 🏅 走法評價：一步棋值得標記，是因為它帶來了「資訊」——改變了局勢，而且不是一看就知道的那種。
 *
 * 勝率一律用勝率條上的勝率（校準過，由呼叫端傳 toProb 進來），下棋者角度，分五級：
 *   勝定 ≥ 90%、優勢 65～90%、拉鋸 35～65%、劣勢 10～35%、敗定 ≤ 10%
 *   這步的等級 = 下完的勝率；局面的等級 = 最佳步下完的勝率；格子的勝率 = 那格配最好的那一組。
 *   「原本的局勢」= 對手下上一步之前，這一方的勝率（prevP）。
 * 各項門檻在 MARK_TUNE。
 *
 * 不標：只有一個格子可下；直接連成五；勝負已定（最佳步與這步都在勝定、或都在敗定）時不標失誤類與 !?。
 *
 * 失誤類（跟最佳步比；下在最佳的格子不算——現在的分析或下的當下提示顯示的最佳格，組別選得不同也一樣；
 * 原本就敗定、這一步也沒給到拉鋸以上的機會時不標）：
 *   ??  大漏著：掉兩級以上，而且少 80% 以上
 *   ?   失誤：掉一級以上，而且少 45% 以上（掉兩級但沒到 80% 也標這個）
 *   ?!  不精確：少 29% 以上
 *
 * 好手類（原本就勝定時不標；終盤剩 7 格以內只標 !!）：
 *   !!  反殺：往前連續 3 個局面（對手下之前、再之前…）勝率都很差（≤ 35%），這步翻成很好（≥ 75%），
 *       而且只有這步做得到（其他格子都差 25% 以上）。一直被壓著打、突然被一手翻盤；不要求難找。擋對手的五連不算。
 *   !   唯一手：下了最佳步，其他格子都差 10% 以上，局勢不比原本差（維持或更好），而且不是問應手：
 *       只看盤面（黑白棋靜態評估排在前 20%）就看得出來、往下搜 2 層（我下、對手應）就找得到、或是去擋對手的五連，
 *       都算是被對方逼出來的明顯應手，不標。
 *   !?  強迫手：不一定是最佳步（最多少 12%），但下完後對手只剩一個好格子，其他格子都比它差 20% 以上
 *       （對手至少有 3 格可下）。做出「四」逼對手擋不算（棋盤上已經畫出連線，很明顯）；對手的好選擇是直接連成五也不算。
 *
 * 校準（tests/mark-freq.js：3～7 級 CPU 互下 270 局 7504 步，v14 以 AI 教練的強度分析）：
 *   每 100 步 !! 0.3、! 1.2、!? 2.3、?! 2.3、? 1.4、?? 0.7（反殺改成「往前連續 3 個局面都很差」之後頻率沒變，仍是 0.3）。
 * 唯一手的「問應手」判斷用找到率比較過（tests/mark-findrate.js，在被標 ! 的局面各級實際下到那一步的比例）：
 *   只看盤面：3／4／5／6／7 級找到 28／35／62／84／99%（弱的也常找到 → 混了明顯的應手）；
 *   加上搜 2 層：3／4／5／6／7 級 3／3／38／65／97%（弱的找不到、強的找得到）。
 */

import { flipsFor, getLegalMoves, posToCoord } from "../core/rules.js";
import { completesFive, findThreatGroups, groupOf, GROUPS } from "../core/five-rules.js";
import { othelloEvalV13, searchV13 } from "./v13.js";

export const LEVEL_EDGES = [0.1, 0.35, 0.65, 0.9]; // 敗定｜劣勢｜拉鋸｜優勢｜勝定
/** 勝率 → 等級 0（敗定）～4（勝定） */
export const levelOf = (p) => (p >= 0.9 ? 4 : p >= 0.65 ? 3 : p >= 0.35 ? 2 : p > 0.1 ? 1 : 0);
export const WON = 4, LOST = 0;
export const MIN_LOSS = 0.05;      // 失誤類最少要損失這麼多（避免剛好卡在等級邊界的小差距）
// 各種標記的門檻（分析換成 v14 之後重新定義、校準，見檔案開頭）
export const MARK_TUNE = {
  // 失誤類
  dubious: 0.29,  // ?! ：損失這麼多
  mistake: 0.45,  // ?  ：掉一級以上，而且損失這麼多（不夠就看能不能標 ?!）
  blunder: 0.80,  // ?? ：掉兩級以上，而且損失這麼多（不夠就看能不能標 ?）
  // !! 反殺
  turnFrom: 0.35, // 往前 turnWindow 個局面，這一方的勝率都最多這麼多（一直被壓著打）
  turnWindow: 3,  // 往前看幾個局面（對手下之前、再之前…；每個局面都有分析才算進去，至少要有 1 個）
  turnTo: 0.75,   // 這步下完至少這麼多（很好）
  turnGap: 0.25,  // 其他格子都比這步至少差這麼多（只有這步能反殺）
  // ! 唯一手
  onlyGap: 0.10,      // 其他格子都比這步至少差這麼多
  onlyMinLevel: 2,    // 下完至少是這個等級（2 = 拉鋸）
  onlyDifficulty: 1,  // 難度至少這麼多分（difficultyOf；「看不出來」本身就算 1 分）
  obviousDepth: 2,    // 問應手的判斷：0 = 只看盤面（靜態評估排前 20% 就算明顯）；n = 往下搜 n 層就找得到也算明顯
  // !? 強迫手
  forceLoss: 0.12,    // 這步最多比最佳步少這麼多
  forceGap: 0.20,     // 下完後對手的最佳格比次佳格好這麼多
  forceMinSquares: 3, // 對手至少有這麼多格可下
  forceFour: false    // 做出「四」算不算強迫手
};
export const BEST_EPS = 0.01;      // 跟最佳步差這麼多以內，算下了最佳步
export const ENDGAME = 7;          // 剩這麼多格以內：不標好手類
export const THREAT_LINES = 3;     // 難度的「盤面有威脅」：要有「四」，或至少這麼多條連線威脅（三或四）

const CORNERS = [0, 7, 56, 63];
const X_CORNER = { 9: 0, 14: 7, 49: 56, 54: 63 };
const SYMBOLS = Array.from({ length: GROUPS }, (_, g) => g + 1); // 組別 1～4
const opp = (t) => 3 - t;
const coord = (sq) => posToCoord(sq >> 3, sq & 7);
const emptiesOf = (board) => board.reduce((n, row) => n + row.filter((d) => !d).length, 0);

/** 下在 sq 之後的棋盤（只看翻面與顏色；下的那顆棋的組別不影響盤面評估） */
function boardAfter(board, sq, turn, id = 0) {
  const r = sq >> 3, c = sq & 7;
  const nb = board.map((row) => row.map((d) => d && { ...d }));
  for (const [fr, fc] of flipsFor(board, r, c, turn)) nb[fr][fc].face = turn;
  nb[r][c] = { id, face: turn };
  return nb;
}

const cornersOpenTo = (board, t) => new Set(getLegalMoves(board, t).map((m) => m.r * 8 + m.c).filter((s) => CORNERS.includes(s)));
/** 下完之後，對手多了可以下的角 */
const givesCorner = (board, nb, turn) => {
  const before = cornersOpenTo(board, opp(turn));
  return [...cornersOpenTo(nb, opp(turn))].some((s) => !before.has(s));
};
/** 這一步直接連成五（下的那顆棋的組別） */
const makesFive = (board, sq, discId, turn) => completesFive(board, sq, groupOf(discId) + 1, turn);
/** 下完之後，對手下一手有地方可以直接連成五（不看那一組還有沒有剩） */
const allowsFive = (nb, turn) => {
  for (let s = 0; s < 64; s++) {
    if (nb[s >> 3][s & 7]) continue;
    if (SYMBOLS.some((v) => completesFive(nb, s, v, opp(turn)))) return true;
  }
  return false;
};

/** 每個走法與每個格子的勝率（格子取最好的那一組） */
function probsOf(scores, toProb, empties) {
  const P = (s) => (s >= 0.999 ? 1 : s <= -0.999 ? 0 : toProb(s, empties));
  const moves = scores.map((x) => ({ key: x.sq, sq: x.sq & 63, p: P(x.score) }));
  const bySq = new Map();
  for (const m of moves) if (!bySq.has(m.sq) || m.p > bySq.get(m.sq).p) bySq.set(m.sq, m);
  const squares = [...bySq.values()].sort((a, b) => b.p - a.p);
  return { moves, squares, best: squares.length ? squares[0] : null };
}

/**
 * @param {object} o
 * @param {{sq:number, score:number}[]} o.scores 上一個局面每個走法的引擎分數（sq = 棋 × 64 + 格）
 * @param {number} o.played 實際下的走法（棋 × 64 + 格）
 * @param {object[][]} o.board 下這步之前的棋盤
 * @param {number} o.turn 下這步的一方
 * @param {(score:number, empties:number) => number} o.toProb 分數 → 勝率條上的勝率
 * @param {{scores:{sq:number,score:number}[]}|null} [o.next] 下完之後（輪到對手）的分析，判斷「設陷阱」用；沒有就不判斷
 * @param {number|null} [o.prevP] 對手下上一步之前，這一方的勝率（勝率條上的勝率）；判斷終盤「逆轉」用
 * @param {number[]|null} [o.prevWin] 往前最多 turnWindow 個局面（對手下之前、再之前…）這一方的勝率；!! 反殺要求這幾個都很差，沒給就只看 prevP
 * @param {number|null} [o.bestAtMove] 下這步的當下，分析（提示）顯示的最佳格；下在這格就不標失誤類
 * @param {object} [o.tune] 各種標記的門檻（測試用，預設 MARK_TUNE）
 * @returns {{ sym: string|null, why: {key:string, p:object}|null, loss:number, best:number, played:number } | null}
 */
export function classifyMove({ scores, played, board, turn, toProb, next = null, prevP = null, prevWin = null, bestAtMove = null, tune = MARK_TUNE }) {
  const empties = emptiesOf(board);
  const { moves, squares, best } = probsOf(scores, toProb, empties);
  const mine = moves.find((m) => m.key === played);
  if (!mine || !best) return null;
  const loss = best.p - mine.p, Lb = levelOf(best.p), Lm = levelOf(mine.p);
  const res = (sym, why = null) => ({ sym, why, loss, best: best.p, played: mine.p, bestSq: best.sq });
  const sq = played & 63, discId = played >> 6;

  if (squares.length <= 1) return res(null);
  if (makesFive(board, sq, discId, turn)) return res(null);
  // 勝負已定：最佳步與這步都在勝定（或都在敗定）。失誤類與設陷阱不標；
  // 好手類不受影響——它本來就要求其他格子比這步低一級，「只有這步能拿到勝定」代表勝負其實還沒定
  const decided = (Lb === WON && Lm === WON) || (Lb === LOST && Lm === LOST);
  // 原本的局勢：對手下上一步之前，這一方的勝率（不知道就用這個局面的最佳步）
  const before = prevP ?? best.p;
  // 原本就輸定、對手的錯也沒給到拉鋸以上的機會：從頭到尾都是輸棋，失誤也沒有資訊
  const hopeless = levelOf(before) === LOST && Lb <= 1;

  const nb = boardAfter(board, sq, turn, discId);

  // 下在最佳的格子（現在的分析，或下的當下提示顯示的最佳格）：已經下了最佳手，組別的差別或之後分析變了，都不算失誤
  const playedBest = sq === best.sq || sq === bestAtMove;
  // 失誤類：跟最佳步比，局勢掉了幾級
  if (!decided && !hopeless && !playedBest && loss >= MIN_LOSS) {
    const drop = Lb - Lm;
    const sym = drop >= 2 && loss >= tune.blunder ? "??" : drop >= 1 && loss >= tune.mistake ? "?" : loss >= tune.dubious ? "?!" : null;
    if (sym) {
      // 最佳步：格子＋組別（存那一組的棋，顯示時才換成目前的棋子文字）
      const at = coord(best.sq), disc = best.key >> 6;
      let why;
      if (best.p >= 0.999 && makesFive(board, best.sq, disc, turn)) why = { key: "whyMissedFive", p: { at, disc } };
      else if (allowsFive(nb, turn)) why = { key: "whyAllowsFive", p: { at, disc } };
      else if (givesCorner(board, nb, turn)) why = { key: "whyGivesCorner", p: { at, disc } };
      else if (sym !== "?!") why = { key: "whyDrop", p: { from: Lb, to: Lm, at, disc } };
      else why = { key: "whyLoose", p: { lvl: Lb, n: Math.round(loss * 100), at, disc } };
      return res(sym, why);
    }
  }

  // 好手類只在勝負難料時才有資訊。原本的局勢 = 對手下上一步之前，這一方的勝率（不知道就用這個局面的最佳步）
  const t = tune;
  const others = squares.filter((x) => x.sq !== sq);
  const second = others.length ? others[0].p : 0; // 其他格子裡最好的
  const isBest = loss < BEST_EPS && best.sq === sq;
  const o = opp(turn);
  const blocksFive = SYMBOLS.some((v) => completesFive(board, sq, v, o)); // 擋住對手下一手的五連：棋盤上已經畫出來了，很明顯

  // !!：反殺。往前幾個局面（turnWindow 個）自己都很差，這步翻成很好，而且只有這步做得到（其他格子都差很遠）
  const win = prevWin?.length ? prevWin : prevP != null ? [prevP] : null;
  const worst = win ? Math.max(...win) : null; // 那幾個局面裡最好的一個：連它都很差才算一直被壓著打
  if (isBest && !blocksFive && worst != null && worst <= t.turnFrom && mine.p >= t.turnTo && mine.p - second >= t.turnGap) {
    return res("!!", { key: "whyTurnaround", p: { from: levelOf(worst), to: Lm, k: win.length, n: Math.round(100 * (mine.p - second)) } });
  }
  if (levelOf(before) === WON) return res(null);   // 原本就贏定：守住或兌現，沒有資訊
  if (empties <= ENDGAME) return res(null);        // 終盤引擎已經算到底，只標反殺

  // !：唯一手。最佳步、其他格子都差很遠、局勢沒有比對手下之前差（維持或更好）；
  // 而且不是明顯的問應手：只看盤面看得出來（黑白棋靜態評估排在前 20%）、或是去擋對手的五連，都不算
  if (isBest && !blocksFive && mine.p - second >= t.onlyGap && Lm >= levelOf(before) && Lm >= t.onlyMinLevel) {
    const d = difficultyOf({ board, turn, sq, squares, moves });
    const obvious = !d.hidden || (t.obviousDepth > 0 && shallowBest(board, turn, t.obviousDepth) === sq);
    if (!obvious && d.score >= t.onlyDifficulty) {
      const four = completesFourFor(nb, sq, turn);
      return res("!", { key: four ? "whyOnlyFour" : "whyOnly", p: { from: levelOf(second), to: Lm } });
    }
  }

  // !?：強迫手。不一定是最佳步（最多少 forceLoss），但下完後對手只有一個好格子，其他格子都差很遠。
  // 做出「四」逼對手擋（棋盤上已經畫出連線，很明顯）預設不算
  if (!decided && loss <= t.forceLoss && next?.scores?.length && (t.forceFour || !allowsFive(nb, o))) {
    const op = probsOf(next.scores, toProb, emptiesOf(nb));
    if (op.best && op.best.p < 0.999 && op.squares.length >= t.forceMinSquares) {
      const gap = op.best.p - op.squares[1].p;
      if (gap >= t.forceGap) return res("!?", { key: "whyForce", p: { at: coord(op.best.sq), n: Math.round(100 * gap) } });
    }
  }
  return res(null);
}

/**
 * 這一步有多難找（0～4 分，每項 1 分）。用 3／5 級 CPU 的失誤驗證過：在「好選擇數量」相同的局面裡，
 * 每一項成立時失誤率都明顯比較高（72 局 2100 個局面；例如最佳步看不出來 21% → 39%、盤面有三條以上威脅 21% → 38%）。
 *   hidden：只看盤面（v13 的黑白棋靜態評估，不往下算），這一格不在所有可下格子的前 20%
 *   threats：盤面上有「四」，或至少 THREAT_LINES 條連線威脅（4 組自選幾乎每個局面都有三，只要有就算的話等於白送一分）
 *   discMatters：這一格配不同的組別，勝率差 2% 以上（除了選格子還要選對組別）
 *   many：可下的格子 7 個以上
 */
export function difficultyOf({ board, turn, sq, squares, moves }) {
  const evals = squares.map((s) => ({ sq: s.sq, v: othelloEvalV13(boardAfter(board, s.sq, turn), turn, groupOf) }))
    .sort((a, b) => b.v - a.v);
  const rank = evals.findIndex((e) => e.sq === sq) / Math.max(1, evals.length - 1);
  const hidden = rank > 0.2;
  const gs = findThreatGroups(board).filter((g) => g.kind < 5); // 花五很少見，不改變已經量好的標記頻率
  const threats = gs.some((g) => g.kind === 4) || gs.length >= THREAT_LINES;
  const atSq = moves.filter((m) => m.sq === sq).map((m) => m.p);
  const discMatters = atSq.length > 1 && Math.max(...atSq) - Math.min(...atSq) >= 0.02;
  const many = squares.length >= 7;
  return { score: hidden + threats + discMatters + many, hidden, threats, discMatters, many };
}

/** 淺層搜尋（v13，固定 depth 層）會選的格子：連這樣都找得到的唯一手，是被逼出來的問應手 */
function shallowBest(board, turn, depth) {
  const r = searchV13(board, turn, groupOf, { timeMs: 1e9, maxDepth: depth });
  return r ? r.sq : -1;
}

/** 下完之後，經過這格有沒有替自己做出「四」（同色、同一組、再補一顆就連成五） */
function completesFourFor(nb, sq, turn) {
  for (let s = 0; s < 64; s++) {
    if (nb[s >> 3][s & 7]) continue;
    for (const v of SYMBOLS) {
      if (!completesFive(nb, s, v, turn)) continue;
      // 這個五連窗口要經過剛下的那格
      const dr = (s >> 3) - (sq >> 3), dc = (s & 7) - (sq & 7);
      if (Math.max(Math.abs(dr), Math.abs(dc)) <= 4 && (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return true;
    }
  }
  return false;
}

/**
 * 單步準確度（0～100）：損失（勝率百分點）換算。公式與 whowins/src/engine/move-quality.js 的 moveAccuracy 相同，
 * 讓兩個遊戲的終局總結用同一把尺。
 */
export function moveAccuracy(lossPct) {
  const a = 103.1668 * Math.exp(-0.04354 * lossPct) - 3.1669;
  return Math.max(0, Math.min(100, a));
}
