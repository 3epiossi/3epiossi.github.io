/**
 * 五連模式評測：v8 對基準「v6＋抓勝機」（只比分數的黑白棋搜尋，能一步成五時才會抓）。
 *
 *   node five/tests/v8-match.js --games 100 --depth 5
 *   node five/tests/v8-match.js --games 100 --time 200
 *   node five/tests/v8-match.js --games 40 --depth 5 --control 1   # 對照組：兩邊都是基準
 *   node five/tests/v8-match.js --games 100 --depth 5 --params '{"threatScale":2}'
 *   node five/tests/v8-match.js --games 100 --depth 5
 */
import { GameEngine } from "../src/core/game-engine.js";
import { applyMoveToBoard } from "../src/core/rules.js";
import { findFive, fiveScores } from "../src/core/five-rules.js";
import { searchV8 } from "../src/ai/v8.js";
import { V8_PLAIN_PARAMS } from "../src/ai/v8/search.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const GAMES = Number(args.games || 40);
const TIME = Number(args.time || 200);
const DEPTH = args.depth ? Number(args.depth) : undefined;
const CONTROL = args.control === "1";
const SEED = Number(args.seed || 4400);
const DEFAULTS = V8_PLAIN_PARAMS;
const P8 = { ...DEFAULTS, ...(args.params ? JSON.parse(args.params) : {}) };
const BASE = { ...DEFAULTS, five: false, winProb: false }; // 基準：只比分數的黑白棋（分數差為目標）

function engineMove(e, params) {
  const r = searchV8(e.board, e.currentTurn, e.hand, { timeMs: DEPTH ? 60000 : TIME, maxDepth: DEPTH, params });
  return { r: r.bestSq >> 3, c: r.bestSq & 7 };
}
/** 基準：能一步成五就下，否則照只比分數的黑白棋搜尋 */
function baseMove(e) {
  for (const m of e.legalMoves()) {
    const nb = applyMoveToBoard(e.board, m, e.hand, e.currentTurn);
    if (findFive(nb, e.currentTurn)) return m;
  }
  return engineMove(e, BASE);
}

let v8Wins = 0, draws = 0, byFive = 0, v8Fives = 0, plies = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const v8Color = g % 2 === 0 ? 1 : 2;
  const e = new GameEngine({ rng: mulberry32(SEED + Math.floor(g / 2)) });
  let winner = null, ply = 0;
  while (!e.gameOver) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const mover = e.currentTurn;
    const useV8 = mover === v8Color && !CONTROL;
    const m = useV8 ? engineMove(e, P8) : baseMove(e);
    e.executeMove(m.r, m.c);
    ply++;
    if (findFive(e.board, mover)) { winner = mover; byFive++; if (mover === v8Color) v8Fives++; break; }
  }
  if (winner == null) {
    const s = fiveScores(e.board, false);
    winner = s.black === s.white ? 0 : s.black > s.white ? 1 : 2;
  }
  plies += ply;
  if (winner === v8Color) v8Wins++; else if (winner === 0) draws++;
}
const pct = (x) => (100 * x / GAMES).toFixed(0) + "%";
console.log(`[五連｜${CONTROL ? "對照組：基準 vs 基準" : "v8 vs 基準"}｜${DEPTH ? DEPTH + " 層" : TIME + "ms/步"}${args.params ? "｜" + args.params : ""}] ${GAMES} 局：` +
  `v8 方勝率 ${pct(v8Wins + draws / 2)}；由五連結束 ${pct(byFive)}（v8 方成五 ${pct(v8Fives)}）；平均 ${(plies / GAMES).toFixed(1)} 手；${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
