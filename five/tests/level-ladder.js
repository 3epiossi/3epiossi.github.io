/**
 * 難度分級的校準：任兩級（或自訂設定）對戰，黑白各半、同一組亂數種子。
 *
 *   node five/tests/level-ladder.js --a 2 --b 1 --games 100
 *   node five/tests/level-ladder.js --a '{"depth":2}' --b '{"kind":"grab"}' --games 100
 *   --time 毫秒：沒有 depth 的設定（最高級）每步的思考時間，預設 200
 *   --opening N：前 N 手隨機（格子、組別都隨機；固定層數的等級沒有隨機性，不然每一對局面都一樣），預設 4
 * 每兩局用同一個開局、交換顏色（成對開局）。
 */
import { GameEngine } from "../src/core/game-engine.js";
import { LEVELS, searchLevel } from "../src/ai/levels.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const GAMES = Number(args.games || 100);
const TIME = Number(args.time || 200);
const SEED = Number(args.seed || 7000);
const OPENING = Number(args.opening ?? 4);
const cfgOf = (s) => (String(s).trim().startsWith("{") ? JSON.parse(s) : LEVELS[Number(s) - 1]);
const A = cfgOf(args.a), B = cfgOf(args.b);
if (!A || !B) { console.error("--a / --b 要是等級編號或 JSON 設定"); process.exit(1); }

let aWins = 0, draws = 0, byFive = 0, aFive = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const aColor = g % 2 === 0 ? 1 : 2;
  const e = new GameEngine({ rng: mulberry32(SEED + Math.floor(g / 2)) });
  const rngA = mulberry32(SEED * 7 + g), rngB = mulberry32(SEED * 13 + g), rngO = mulberry32(SEED * 31 + Math.floor(g / 2));
  let ply = 0;
  while (!e.gameOver) {
    const moves = e.legalMoves();
    if (!moves.length) { e.passTurn(); continue; }
    if (ply++ < OPENING) {
      const m = moves[Math.floor(rngO() * moves.length)];
      e.executeMove(m.r, m.c, e.pool[Math.floor(rngO() * e.pool.length)]);
      continue;
    }
    const mine = e.currentTurn === aColor;
    const r = searchLevel(e.board, e.currentTurn, e.pool, mine ? A : B, { timeMs: TIME, rng: mine ? rngA : rngB });
    e.executeMove(r.bestSq >> 3, r.bestSq & 7, r.disc);
  }
  const s = e.settlementData;
  if (s.byFive) { byFive++; if (s.winner === aColor) aFive++; }
  if (s.winner === aColor) aWins++; else if (s.winner === 0) draws++;
}
const rate = (aWins + draws / 2) / GAMES;
const se = Math.sqrt(rate * (1 - rate) / GAMES);
console.log(`${JSON.stringify(A)} vs ${JSON.stringify(B)} | ${GAMES} 局：A 勝率 ${(100 * rate).toFixed(0)}% ±${(100 * se).toFixed(0)}；五連結束 ${(100 * byFive / GAMES).toFixed(0)}%；${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
