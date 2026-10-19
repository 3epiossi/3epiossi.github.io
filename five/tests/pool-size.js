/**
 * 池子大小實驗：把袋子抽出的棋放進大小 N 的池子，輪到的人從池子挑一顆下，再從袋子補一顆。
 * 現行規則就是 N = 1（抽到什麼下什麼）。
 *
 * 兩種池子：
 *   shared   雙方共用一個池子（看得到對方能拿什麼）
 *   private  各自一手 N 顆，只從自己手上挑，下完從袋子補給自己
 *
 * 棋手（--a / --b，JSON）：
 *   {"kind":"grab"}             能一步連成五就下，否則隨機（池子裡的棋與位置都隨機）
 *   {"kind":"v8","depth":2}     池子裡每一顆都用 v8 搜尋 depth 層，挑分數最高的（棋＋位置）
 *   {"kind":"v8","depth":4,"pool":true}  同上，但搜尋懂池子（見 src/ai/v8/search.js 的 pickChance、chanceP）：
 *                               知道對手下一手能從池子挑哪些棋、之後每一手也是從 N 顆裡挑，終盤精確計算也照池子規則
 *   加上 "deep":false           只有對手的下一手照池子算，更深的仍當成隨機抽（實測與 deep: true 一樣強或略強，重測用這個）
 *
 * 沒加 pool 的 v8 假設未來的棋是隨機抽的（N = 1 的世界），沒有模擬「對手會從池子挑」。
 *
 *   node five/tests/pool-size.js --n 3 --a '{"kind":"v8","depth":2}' --b '{"kind":"v8","depth":2}' --games 100
 * 輸出一行 JSON（給 pool-report.js 彙整）。
 */
import { BLACK, WHITE } from "../src/core/constants.js";
import {
  createInitialBoard, remainingBag, getLegalMoves, applyMoveToBoard, isBoardFull, hasLegalMove
} from "../src/core/rules.js";
import { findFive } from "../src/core/five-rules.js";
import { searchV8 } from "../src/ai/v8.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const N = Number(args.n || 1);
const GAMES = Number(args.games || 100);
const SEED = Number(args.seed || 1000);
const MODE = args.mode || "shared";
const A = JSON.parse(args.a || '{"kind":"v8","depth":2}');
const B = JSON.parse(args.b || args.a || '{"kind":"v8","depth":2}');
const EXACT = Number(args.exact ?? 5); // 剩幾格以內做終盤精確計算（每一顆候選都要算，太大會很慢）

const other = (p) => (p === BLACK ? WHITE : BLACK);

/** 從袋子（盤上、池子都沒有的棋）隨機抽一顆 */
function draw(board, held, rng) {
  const used = new Set(held);
  const bag = remainingBag(board).filter(id => !used.has(id));
  if (!bag.length) return null;
  return bag[Math.floor(rng() * bag.length)];
}

/** 選步：回傳 { disc, r, c } */
function choose(policy, board, player, candidates, rng, ctx) {
  const moves = getLegalMoves(board, player);
  if (policy.kind === "grab") {
    for (const disc of candidates) {
      for (const m of moves) {
        if (findFive(applyMoveToBoard(board, m, disc, player), player)) return { disc, r: m.r, c: m.c };
      }
    }
    const m = moves[Math.floor(rng() * moves.length)];
    return { disc: candidates[Math.floor(rng() * candidates.length)], r: m.r, c: m.c };
  }
  let best = null;
  const seen = new Set();
  for (const disc of candidates) {
    if (seen.has(disc)) continue;
    seen.add(disc);
    let pool = null;
    if (policy.pool) {
      const rest = candidates.slice();
      rest.splice(rest.indexOf(disc), 1);
      pool = ctx.mode === "shared"
        ? { n: N, mode: "shared", rest, deep: policy.deep }
        : { n: N, mode: "private", rest, opp: ctx.pools[other(player)].slice(), deep: policy.deep };
    }
    const res = searchV8(board, player, disc, { timeMs: 60000, maxDepth: policy.depth, exactEmpties: EXACT, pool });
    const s = res.scores[0].score + rng() * 1e-9; // 同分時隨機
    if (!best || s > best.s) best = { s, disc, sq: res.bestSq };
  }
  return { disc: best.disc, r: best.sq >> 3, c: best.sq & 7 };
}

function playGame(g) {
  const rng = mulberry32(SEED * 7919 + g);
  const aColor = g % 2 === 0 ? BLACK : WHITE; // 黑白輪流
  const taken = new Set();
  const board = createInitialBoard(() => {
    let id;
    do { id = Math.floor(rng() * 64); } while (taken.has(id));
    taken.add(id);
    return id;
  });
  let b = board;
  // 池子：shared 是一個陣列；private 是 { 1: [...], 2: [...] }
  const pools = MODE === "shared" ? { shared: [] } : { [BLACK]: [], [WHITE]: [] };
  const heldAll = () => (MODE === "shared" ? pools.shared : [...pools[BLACK], ...pools[WHITE]]);
  const fill = (key) => {
    while (pools[key].length < N) {
      const id = draw(b, heldAll(), rng);
      if (id == null) break;
      pools[key].push(id);
    }
  };
  if (MODE === "shared") fill("shared"); else { fill(BLACK); fill(WHITE); }

  let player = BLACK, ply = 0, passes = 0;
  const st = { five: null, fivePly: null, winner: 0, ply: 0, passes: 0, black: 0, white: 0 };
  for (;;) {
    if (isBoardFull(b) || (!hasLegalMove(b, BLACK) && !hasLegalMove(b, WHITE))) break;
    if (!hasLegalMove(b, player)) { passes++; player = other(player); continue; }
    const key = MODE === "shared" ? "shared" : player;
    const pool = pools[key];
    if (!pool.length) break; // 袋子與池子都空（不會發生：64 顆剛好填滿 64 格）
    const policy = player === aColor ? A : B;
    const pick = choose(policy, b, player, pool, rng, { mode: MODE, pools });
    const move = getLegalMoves(b, player).find(m => m.r === pick.r && m.c === pick.c);
    b = applyMoveToBoard(b, move, pick.disc, player);
    pool.splice(pool.indexOf(pick.disc), 1);
    fill(key);
    ply++;
    if (findFive(b, player)) { st.five = player; st.fivePly = ply; st.winner = player; break; }
    player = other(player);
  }
  let black = 0, white = 0;
  for (const row of b) for (const d of row) if (d) { if (d.face === BLACK) black++; else white++; }
  st.black = black; st.white = white; st.ply = ply; st.passes = passes;
  if (!st.five) st.winner = black === white ? 0 : black > white ? BLACK : WHITE;
  st.aColor = aColor;
  return st;
}

const t0 = Date.now();
const games = [];
for (let g = 0; g < GAMES; g++) games.push(playGame(g));

const n = games.length;
const five = games.filter(x => x.five);
const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
const scoreGames = games.filter(x => !x.five);
const out = {
  n: N, mode: MODE, a: A, b: B, games: n, ms: Date.now() - t0,
  fiveRate: five.length / n,
  fiveByBlack: five.filter(x => x.five === BLACK).length / n,
  fiveByA: five.filter(x => x.five === x.aColor).length / n,
  blackWin: games.filter(x => x.winner === BLACK).length / n,
  whiteWin: games.filter(x => x.winner === WHITE).length / n,
  draw: games.filter(x => x.winner === 0).length / n,
  aWin: (games.filter(x => x.winner === x.aColor).length + games.filter(x => x.winner === 0).length / 2) / n,
  avgPly: avg(games, x => x.ply),
  avgFivePly: avg(five, x => x.fivePly),
  fivePlyHist: five.reduce((h, x) => { const k = Math.floor(x.fivePly / 10) * 10; h[k] = (h[k] || 0) + 1; return h; }, {}),
  avgMargin: avg(scoreGames, x => Math.abs(x.black - x.white)),
  avgPasses: avg(games, x => x.passes)
};
console.log(JSON.stringify(out));
