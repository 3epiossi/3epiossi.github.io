/**
 * 走法評價：一步棋值得標記，是因為它帶來了資訊。比較的對象是「同一個點數下」的最佳步，
 * 所以骰子好壞完全不算進評價（骰運另外算，見 luckOf）。
 *
 * 勝率一律是勝率條上的勝率（校準過，由呼叫端傳 toProb 進來），下棋者角度，分五級：
 *   勝定 >= 90%、優勢 65~90%、拉鋸 35~65%、劣勢 10~35%、敗定 <= 10%
 *
 * 失誤類（跟最佳步比；下在最佳的格子不算；勝負已定、原本就敗定時不標）：
 *   ??  大漏著：比最佳步少 blunder 以上
 *   ?   失誤：少 mistake 以上
 *   ?!  不精確：少 dubious 以上（三個門檻由 tests/mark-freq.js 依 CPU 互下的損失分布定）
 * 好手類（至少有 3 個可下的格子，勝負未定）：
 *   !!  扭轉：下了最佳步、其他格子都差 turnGap 以上、這步下完 >= turnTo，而且擲骰前的勝率 <= turnBefore（局勢原本不好）
 *   !   唯一手：下了最佳步，其他格子都差 onlyGap 以上，下完至少拉鋸
 *   !?  封鎖手：幾乎最佳（少 forceLoss 以內），下完後對手六個點數裡，能讓他保持勝率 >= 50% 的恰好只有 1 到 forceDice 個（0 個代表本來就贏定，不算）
 *
 * 校準（tests/mark-freq.js：CPU 互下，每 100 步各種評價出現幾次）見 MARK_CAL_NOTE。
 */

export const LEVEL_EDGES = [0.1, 0.35, 0.65, 0.9];
export const levelOf = (p) => (p >= 0.9 ? 4 : p >= 0.65 ? 3 : p >= 0.35 ? 2 : p > 0.1 ? 1 : 0);
export const WON = 4, LOST = 0;
export const MIN_LOSS = 0.05;
export const BEST_EPS = 0.01;

export const MARK_TUNE = {
  dubious: 0.07,
  mistake: 0.12,
  blunder: 0.175,
  turnGap: 0.12,
  turnTo: 0.5,
  turnBefore: 0.65,
  onlyGap: 0.09,
  onlyMinLevel: 2,
  minSquares: 3,
  forceLoss: 0.05,
  forceDice: 1,
  forceBefore: 0.65
};
/**
 * 校準資料：tests/mark-data.js，CPU 互下 80 局（雙方各抽 1 層帶 35% 失誤、1 層帶 15% 失誤、2 層、完整引擎 1 秒）、
 * 10347 手，每個局面用固定 3 層分析每一步的精確勝率，勝率用 ui/eval-bar.js 校準過的；tests/mark-freq.js 套用上面的門檻：
 *   每 100 手：!! 0.41、! 1.33、!? 1.99、?! 2.39、? 1.47、?? 0.67
 * 目標是和五連黑白棋同一個量級（每 100 步 ?? 約 0.7、! 約 1.2、!? 2.3、?! 2.3、? 1.4、!! 0.3）。
 * 損失（最佳步與實際走法的勝率差）的分布：第 90 百分位 3.6%、97.7 百分位 12.2%、99.3 百分位 18.0%，門檻照這個分布定。
 * 注意頻率隨下棋的人而變：越弱的棋手失誤類越多，越強越少。
 */
export const MARK_CAL_NOTE = "CPU 互下 80 局 10347 手，每 100 手 !! 0.41、! 1.33、!? 1.99、?! 2.39、? 1.47、?? 0.67";

/**
 * 骰運與棋力損失（以勝率 0~1 計，下棋者角度）：
 *   luck = 這個點數下最佳步的勝率 - 擲骰前六個點數平均的勝率（正 = 擲出好點數）
 *   loss = 這個點數下最佳步 - 實際走法的勝率（>= 0）
 * 兩者相加 = 實際走完之後的勝率 - 擲骰前的勝率。
 */
export function luckOf({ before, best, played }) {
  return { luck: best - before, loss: Math.max(0, best - played), delta: played - before };
}

/** 單步準確度（0~100）：由損失（勝率百分點）換算，損失越大越低 */
export function moveAccuracy(lossPct) {
  const a = 103.1668 * Math.exp(-0.04354 * lossPct) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

/**
 * @param {object} o
 * @param {{key:number, sq:number, p:number}[]} o.moves 這個點數下每個走法（key = 走法編碼、sq = 目標格）的引擎勝率（下棋者角度）
 * @param {number} o.played 實際下的走法 key
 * @param {number} o.before 擲骰前（六個點數平均）的勝率，顯示用勝率
 * @param {number[]|null} [o.nextBest] 下完之後對手六個點數各自的最佳勝率（對手角度，顯示用勝率）
 * @param {(p:number) => number} o.toProb 引擎勝率 -> 顯示用勝率
 * @param {object} [o.tune]
 * @returns {{ sym: string|null, why: {key:string, p:object}|null, loss:number, best:number, played:number, bestKey:number } | null}
 */
export function classifyMove({ moves, played, before, nextBest = null, toProb, tune = MARK_TUNE, coord = (sq) => String(sq) }) {
  const list = moves.map(m => ({ key: m.key, sq: m.sq, p: toProb(m.p) }));
  const mine = list.find(m => m.key === played);
  if (!mine || !list.length) return null;
  const bySq = new Map();
  for (const m of list) if (!bySq.has(m.sq) || m.p > bySq.get(m.sq).p) bySq.set(m.sq, m);
  const squares = [...bySq.values()].sort((a, b) => b.p - a.p);
  const best = squares[0];
  const loss = best.p - mine.p;
  const Lb = levelOf(best.p), Lm = levelOf(mine.p);
  const res = (sym, why = null) => ({ sym, why, loss, best: best.p, played: mine.p, bestKey: best.key });
  if (squares.length <= 1) return res(null);

  const decided = (Lb === WON && Lm === WON) || (Lb === LOST && Lm === LOST);
  const hopeless = levelOf(before) === LOST && Lb <= 1;
  const playedBest = mine.sq === best.sq || loss < BEST_EPS;

  if (!decided && !hopeless && !playedBest && loss >= MIN_LOSS) {
    const drop = Lb - Lm;
    const sym = loss >= tune.blunder ? "??" : loss >= tune.mistake ? "?" : loss >= tune.dubious ? "?!" : null;
    if (sym) {
      const at = coord(best.sq);
      const bestIsCap = best.key >> 12 & 1;
      const playedIsCap = mine.key >> 12 & 1;
      let why;
      if (bestIsCap && !playedIsCap) why = { key: "whyMissedCapture", p: { at } };
      else if (sym !== "?!") why = { key: "whyDrop", p: { from: Lb, to: Lm, at } };
      else why = { key: "whyLoose", p: { lvl: Lb, n: Math.round(loss * 100), at } };
      return res(sym, why);
    }
  }

  if (decided || squares.length < tune.minSquares) return res(null);
  const others = squares.filter(x => x.sq !== mine.sq);
  const second = others.length ? others[0].p : 0;
  const isBest = loss < BEST_EPS;

  if (isBest && mine.p - second >= tune.turnGap && mine.p >= tune.turnTo && before <= tune.turnBefore) {
    return res("!!", { key: "whyTurnaround", p: { n: Math.round(100 * (mine.p - second)), from: levelOf(before), to: Lm } });
  }
  if (isBest && mine.p - second >= tune.onlyGap && Lm >= tune.onlyMinLevel) {
    return res("!", { key: "whyOnly", p: { from: levelOf(second), to: Lm } });
  }
  if (loss <= tune.forceLoss && nextBest && before <= tune.forceBefore && Lm >= tune.onlyMinLevel) {
    const alive = nextBest.filter(x => x != null && x >= 0.5).length;
    if (alive >= 1 && alive <= tune.forceDice) return res("!?", { key: "whyBlock", p: { n: alive } });
  }
  return res(null);
}
