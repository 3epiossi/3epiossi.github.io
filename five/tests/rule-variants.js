/**
 * 規則變體實驗：連線（三、四）會不會被輕易破壞、整局會不會退化成黑白棋。
 *
 *   node five/tests/rule-variants.js --variant four --mode breaker --games 40 --time 300 --seed 1 --out /tmp/x.jsonl
 *
 * --variant（規則，見 core/five-rules.js 開頭的規則變體）
 *   current      現行規則：五連（同色、共同符號），池子 4 顆
 *   four         四連獲勝（同色、共同符號），池子 4 顆
 *   group        64 顆分成四組（每組 16 顆），同一組、同色連成五獲勝，池子 4 顆
 *   group-pool2  同上，池子 2 顆
 * --mode
 *   breaker  「破壞者」對 v9，模仿「把遊戲變成黑白棋」的人類打法。雙方輪流執黑。
 *            選格子：純黑白棋引擎（v9 關掉連線：params.five = false，每顆 1 分，完全不管連線）
 *            選棋（能直接連成獲勝就連，否則依序比）：
 *              ① 跟周圍 8 格的棋有共同文字（分組規則：同一組）的越少越好
 *              ② 經過這格的最長連線（同一直線上連續、有共同文字的棋，不分顏色）越短越好
 *              ③ 下完後盤上的連線（三、四）越少越好
 *   cpu      v9 對 v9：看這個規則下連線多常出現、多少局以連線結束、先手勝率
 *
 * 每局輸出一列 JSON：勝方、是否連線獲勝、破壞者執哪一色、中盤平均的三／四（每手下完）。
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const VARIANTS = {
  current: { len: 5, match: "symbol", pool: 4 },
  four: { len: 4, match: "symbol", pool: 4 },
  group: { len: 5, match: "group", pool: 4 },
  "group-pool2": { len: 5, match: "group", pool: 2 }
};
const variant = VARIANTS[args.variant || "current"];
if (!variant) throw new Error(`沒有這個規則：${args.variant}`);
// 規則變體一定要在載入任何規則模組之前設定
globalThis.FIVE_RULES_VARIANT = variant;

const fs = await import("fs");
const { GameEngine } = await import("../src/core/game-engine.js");
const { searchPoolV9 } = await import("../src/ai/v9.js");
const { V9_PLAIN_PARAMS } = await import("../src/ai/v9/search.js");
const { findThreatGroups, findFive, numberMask } = await import("../src/core/five-rules.js");
const { applyMoveToBoard, getLegalMoves } = await import("../src/core/rules.js");
const { mulberry32 } = await import("./helpers.js");

const MODE = args.mode || "breaker";
const GAMES = Number(args.games || 20);
const T = Number(args.time || 300);
const SEED = Number(args.seed || 1);
const OUT = args.out || `/tmp/rule-variants-${args.variant}-${MODE}.jsonl`;

const lineScore = (b) => { let s = 0; for (const g of findThreatGroups(b)) s += g.kind === 4 ? 2 : 1; return s; };

/** v9：照搜尋選格子和棋 */
function cpuMove(e) {
  const r = searchPoolV9(e.board, e.currentTurn, e.pool, { timeMs: T });
  return r ? { sq: r.bestSq, disc: r.disc } : null;
}

const OTHELLO_ONLY = { ...V9_PLAIN_PARAMS, five: false };
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** 周圍 8 格裡，跟 disc 有共同文字（分組規則：同一組）的棋有幾顆 */
function sameNeighbors(board, sq, disc) {
  const r = sq >> 3, c = sq & 7, m = numberMask(disc);
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const d = board[r + dr]?.[c + dc];
    if (d && (numberMask(d.id) & m)) n++;
  }
  return n;
}

/** 把 disc 放在 sq：經過這格的最長連線（同一直線上連續、全部有共同文字的棋，不分顏色）有幾顆 */
function longestRun(board, sq, disc) {
  const r = sq >> 3, c = sq & 7;
  let best = 1;
  for (const [dr, dc] of DIRS) {
    // 往兩邊延伸：共同文字（遮罩的交集）不能變成空的
    let m = numberMask(disc), len = 1;
    for (const s of [1, -1]) {
      for (let k = 1; ; k++) {
        const d = board[r + s * k * dr]?.[c + s * k * dc];
        if (!d || !(m & numberMask(d.id))) break;
        m &= numberMask(d.id); len++;
      }
    }
    best = Math.max(best, len);
  }
  return best;
}

/** 破壞者：純黑白棋選格子，選棋盡量不跟鄰居配、讓連線短、讓連線少（能直接連成獲勝就連） */
function breakerMove(e) {
  const me = e.currentTurn;
  const r = searchPoolV9(e.board, me, e.pool, { timeMs: T, params: OTHELLO_ONLY });
  if (!r) return null;
  const sq = r.bestSq, mv = getLegalMoves(e.board, me).find(x => x.r * 8 + x.c === sq);
  let best = null;
  for (const d of e.pool) {
    const nb = applyMoveToBoard(e.board, mv, d, me);
    if (findFive(nb, me)) return { sq, disc: d };
    const key = [sameNeighbors(e.board, sq, d), longestRun(e.board, sq, d), lineScore(nb)];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) best = { disc: d, key };
  }
  return { sq, disc: best.disc };
}

for (let g = 0; g < GAMES; g++) {
  const e = new GameEngine({ rng: mulberry32(SEED * 1000 + g) });
  const breakerColor = MODE === "breaker" ? (g % 2 ? 2 : 1) : 0;
  let mid = { t3: 0, t4: 0, n: 0 }, moves = 0;
  while (!e.gameOver) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const m = e.currentTurn === breakerColor ? breakerMove(e) : cpuMove(e);
    e.executeMove(m.sq >> 3, m.sq & 7, m.disc);
    moves++;
    const empties = e.board.flat().filter(x => !x).length;
    if (empties <= 40 && empties > 15) {
      const gs = findThreatGroups(e.board);
      mid.t3 += gs.filter(x => x.kind === 3).length; mid.t4 += gs.filter(x => x.kind === 4).length; mid.n++;
    }
  }
  const s = e.settlementData;
  fs.appendFileSync(OUT, JSON.stringify({
    variant: args.variant, mode: MODE, g, winner: s.winner, byLine: !!s.byFive, breakerColor, moves,
    t3: mid.n ? mid.t3 / mid.n : 0, t4: mid.n ? mid.t4 / mid.n : 0
  }) + "\n");
}
