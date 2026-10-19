/**
 * Multi-ProbCut 統計：比較同一局面「淺層」與「深層」全寬度搜尋的分數，
 * 得到 deep ≈ shallow − bias 的 bias 與誤差標準差 sigma（依開局 / 中盤 / 終盤分段）。
 * 結果貼回 src/ai/v6/search.js 的 MPC_STATS。
 *
 *   node five/tests/mpc-stats.js --games 12 --depths 3,4,5,6,7,8
 */
import { GameEngine } from "../src/core/game-engine.js";
import { findBestMoveForCPU } from "../src/ai/ai-service.js";
import { probeValue, MPC_SHALLOW } from "../src/ai/v6/search.js";
import { remainingBag } from "../src/core/rules.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const games = Number(args.games || 12);
const depths = (args.depths || "3,4,5,6,7,8").split(",").map(Number);
const seed = Number(args.seed || 77);

// 1) 蒐集局面：v6 自我對戰，每 3 手取一個（手上的棋已放回袋子，模擬搜尋樹內部的節點）
const positions = [];
for (let g = 0; g < games; g++) {
  const e = new GameEngine({ rng: mulberry32(seed + g) });
  let ply = 0;
  while (!e.gameOver) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const empties = e.board.flat().filter(x => !x).length;
    if (ply % 3 === g % 3 && empties >= 12) {
      positions.push({ board: e.board.map(r => r.map(d => d && { ...d })), player: e.currentTurn, bag: remainingBag(e.board, null), empties });
    }
    const r = findBestMoveForCPU(e.board, e.currentTurn, e.pool, { timeMs: 30 });
    e.executeMove(r.chosen.r, r.chosen.c, r.chosen.disc);
    ply++;
  }
}

// 2) 每個深度：deep 與 shallow 的分數差
const bucketOf = (empties) => (empties > 40 ? 0 : empties > 20 ? 1 : 2);
const out = {};
for (const d of depths) {
  const sh = MPC_SHALLOW[d];
  const diffs = [[], [], []];
  for (const p of positions) {
    if (p.empties <= d) continue; // 會搜到終局的局面不需要 MPC
    const deep = probeValue({ ...p, depth: d });
    const shallow = probeValue({ ...p, depth: sh });
    diffs[bucketOf(p.empties)].push(shallow - deep);
  }
  out[d] = diffs.map(arr => {
    if (arr.length < 5) return [0, 99];
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1));
    return [Math.round(mean * 100) / 100, Math.round(sd * 100) / 100];
  });
  console.error(`depth ${d} (shallow ${sh}): ${JSON.stringify(out[d])}  n=${diffs.map(a => a.length).join("/")}`);
}
console.log(JSON.stringify(out));
