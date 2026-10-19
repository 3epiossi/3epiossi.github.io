/**
 * 「先湊出就獲勝」規則的模擬
 *
 * 棋子：左、右數字（各 1～8，64 種組合各一顆，兩面相同）；一顆棋的分數 = 左 × 右。
 * 落子後，若下棋者在同一直線（橫、直、斜）上有連續 3 顆己方的棋，
 * 且每顆任選左或右的數字能組成「三條」或「依序順子」（3-4-5、6-5-4），比賽立刻結束、由他獲勝。
 * 整局都沒人湊出 → 比分數總和。
 *
 * 規則 A：三連必須包含剛落下的那顆棋
 * 規則 B：盤上任何一條己方三連都算（含翻面造成的）
 *
 *   node five/tests/lr-gomoku.js --games 500
 */
import { GameEngine } from "../src/core/game-engine.js";
import { findBestMoveForCPU } from "../src/ai/ai-service.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const GAMES = Number(args.games || 500);
const ENGINE_GAMES = Number(args["engine-games"] || 200);
const LEN = Number(args.len || 3); // 幾連（3 = 三條／三張順子；4 = 四條／四張順子…）
const KIND_ONLY = args.kind === "1"; // 只看「條」，順子不算

const L = (id) => (id & 7) + 1;
const R = (id) => (id >> 3) + 1;
const SCORE = (id) => L(id) * R(id);

/** LEN 顆棋（依直線順序）任選左右數字，能否全部相同（N 條）或依序連號（順子） */
function winningLine(ids) {
  const opts = ids.map(id => [L(id), R(id)]);
  // 全部相同：存在 v 讓每顆都有 v
  for (let v = 1; v <= 8; v++) if (opts.every(o => o[0] === v || o[1] === v)) return "trips";
  if (KIND_ONLY) return null;
  // 依序連號：起點 v、方向 ±1，第 k 顆要有 v + k·d
  for (const d of [1, -1]) for (let v = 1; v <= 8; v++) {
    if (opts.every((o, k) => o[0] === v + k * d || o[1] === v + k * d)) return "straight";
  }
  return null;
}

const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];
function tripleAt(board, cells, player) {
  const ds = [];
  for (const [y, x] of cells) {
    if (y < 0 || y > 7 || x < 0 || x > 7) return null;
    const d = board[y][x];
    if (!d || d.face !== player) return null;
    ds.push(d.id);
  }
  return winningLine(ds);
}

/** 規則 A：經過 (r, c) 的三連 */
function winsThrough(board, r, c, player) {
  const idx = Array.from({ length: LEN }, (_, k) => k);
  for (const [dr, dc] of AXES) for (let st = -(LEN - 1); st <= 0; st++) {
    const t = tripleAt(board, idx.map(k => [r + (st + k) * dr, c + (st + k) * dc]), player);
    if (t) return t;
  }
  return null;
}
/** 規則 B：經過剛落下或剛翻面的任何一格的三連（其他三連在上一手之前就不成立） */
function winsAnywhere(board, move, player) {
  const changed = [[move.r, move.c], ...move.flips];
  for (const [r, c] of changed) {
    const t = winsThrough(board, r, c, player);
    if (t) return t;
  }
  return null;
}

/** 試下：回傳這步是否立刻獲勝 */
function isWinningMove(e, m, rule) {
  const player = e.currentTurn;
  const save = e.board[m.r][m.c];
  const old = m.flips.map(([y, x]) => e.board[y][x].face);
  e.board[m.r][m.c] = { id: e.hand, face: player };
  for (const [y, x] of m.flips) e.board[y][x].face = player;
  const w = rule === "A" ? winsThrough(e.board, m.r, m.c, player) : winsAnywhere(e.board, m, player);
  m.flips.forEach(([y, x], i) => { e.board[y][x].face = old[i]; });
  e.board[m.r][m.c] = save;
  return w;
}

function play({ seed, rule, policy }) {
  const rng = mulberry32(seed);
  const e = new GameEngine({ rng });
  let ply = 0;
  while (!e.gameOver) {
    const legal = e.legalMoves();
    if (!legal.length) { e.passTurn(); continue; }
    const player = e.currentTurn;
    let pick = null;
    if (policy !== "random") pick = legal.find(m => isWinningMove(e, m, rule)) || null;
    if (!pick) {
      if (policy === "engine") pick = findBestMoveForCPU(e.board, player, e.hand, { timeMs: 20 }).chosen;
      else pick = legal[Math.floor(rng() * legal.length)];
    }
    e.executeMove(pick.r, pick.c);
    ply++;
    const w = rule === "A" ? winsThrough(e.board, pick.r, pick.c, player) : winsAnywhere(e.board, { r: pick.r, c: pick.c, flips: e.lastMove.flips }, player);
    if (w) return { byPattern: true, type: w, winner: player, ply };
  }
  // 比分數：左 × 右
  let b = 0, wsum = 0;
  for (const row of e.board) for (const d of row) if (d) { if (d.face === 1) b += SCORE(d.id); else wsum += SCORE(d.id); }
  return { byPattern: false, winner: b === wsum ? 0 : b > wsum ? 1 : 2, ply, margin: Math.abs(b - wsum) };
}

const pct = (x) => (100 * x).toFixed(1) + "%";
function run(label, rule, policy, games) {
  let byPattern = 0, trips = 0, straight = 0, blackWins = 0, draws = 0, plySum = 0, byScoreMargin = 0;
  const plies = [];
  for (let g = 0; g < games; g++) {
    const r = play({ seed: 9100 + g, rule, policy });
    if (r.byPattern) { byPattern++; plies.push(r.ply); if (r.type === "trips") trips++; else straight++; }
    else byScoreMargin += r.margin;
    if (r.winner === 1) blackWins++;
    if (r.winner === 0) draws++;
    plySum += r.ply;
  }
  plies.sort((a, b) => a - b);
  const q = (p) => plies.length ? plies[Math.floor(p * (plies.length - 1))] : "-";
  console.log(`[${LEN} 連${KIND_ONLY ? "・只看條" : ""}｜規則 ${rule}｜${label}] ${games} 局：由牌型結束 ${pct(byPattern / games)}（三條 ${pct(trips / games)}、順子 ${pct(straight / games)}），` +
    `比分數 ${pct((games - byPattern) / games)}；牌型結束在第 ${q(0.25)}／${q(0.5)}／${q(0.75)} 手（25/50/75 百分位）；` +
    `黑方（先手）勝率 ${pct((blackWins + draws / 2) / games)}`);
}

{
  const rng = mulberry32(42), N = 1_000_000;
  let hit = 0;
  const ids = Array.from({ length: 64 }, (_, i) => i);
  for (let t = 0; t < N; t++) {
    for (let k = 0; k < LEN; k++) { const j = k + Math.floor(rng() * (64 - k)); [ids[k], ids[j]] = [ids[j], ids[k]]; }
    if (winningLine(ids.slice(0, LEN))) hit++;
  }
  console.log(`[${LEN} 連${KIND_ONLY ? "・只看條" : ""}｜理論] 任取 ${LEN} 顆棋排成一線，能組成牌型的機率 ${(100 * hit / N).toFixed(3)}%（蒙地卡羅 ${N.toLocaleString()} 次）`);
}
for (const rule of (args.rules || "A,B").split(",")) {
  run("隨機下", rule, "random", GAMES);
  run("會抓勝機", rule, "grab", GAMES);
  run("v6＋抓勝機", rule, "engine", ENGINE_GAMES);
}
