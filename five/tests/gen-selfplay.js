/**
 * 自我對戰產生訓練資料（五連模式，每顆 1 分）
 *
 * 每一步記錄「輪到下棋的一方」看到的局面特徵（src/ai/v8/features.js），
 * 整局結束後依勝負標記：贏 1、輸 0、平手 0.5。輸出 JSON Lines：[剩餘空格, 標記, 特徵…]
 *
 *   node five/tests/gen-selfplay.js --games 800 --seed 1 --out /tmp/data1.jsonl
 *   node five/tests/gen-selfplay.js --games 800 --seed 1 --out /tmp/data2.jsonl --model five/src/ai/v8/model-plain.js
 *
 * 走步：機率 eps 隨機（增加局面多樣性），其餘用 v8 淺層搜尋（--depth，預設 2）。
 * --model：用學習型評估的 v8 下棋（第二輪以後的自我對戰）。
 */
import fs from "fs";
import path from "path";
import { GameEngine } from "../src/core/game-engine.js";
import { searchV8 } from "../src/ai/v8.js";
import { V8_PLAIN_PARAMS } from "../src/ai/v8/search.js";
import { featuresFromBoard } from "../src/ai/v8/features.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const GAMES = Number(args.games || 200);
const SEED = Number(args.seed || 1);
const DEPTH = Number(args.depth || 2);
const EPS = Number(args.eps ?? 0.1);
const OUT = args.out || "/tmp/selfplay.jsonl";

let params = V8_PLAIN_PARAMS;
if (args.model) {
  const { PLAIN_MODEL } = await import(path.resolve(args.model));
  params = { ...V8_PLAIN_PARAMS, model: PLAIN_MODEL };
}

const rng = mulberry32(SEED * 7919);
const lines = [];
let byFive = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const e = new GameEngine({ rng: mulberry32(SEED * 100000 + g) });
  const recs = [];
  while (!e.gameOver) {
    const legal = e.legalMoves();
    if (!legal.length) { e.passTurn(); continue; }
    const { empties, features } = featuresFromBoard(e.board, e.currentTurn);
    recs.push({ empties, player: e.currentTurn, f: Array.from(features, v => Math.round(v * 1000) / 1000) });
    let m;
    if (rng() < EPS) m = legal[Math.floor(rng() * legal.length)];
    else {
      const r = searchV8(e.board, e.currentTurn, e.hand, { timeMs: 60000, maxDepth: DEPTH, params });
      m = { r: r.bestSq >> 3, c: r.bestSq & 7 };
    }
    e.executeMove(m.r, m.c);
  }
  const w = e.settlementData.winner;
  if (e.settlementData.byFive) byFive++;
  for (const r of recs) {
    const label = w === 0 ? 0.5 : w === r.player ? 1 : 0;
    lines.push(JSON.stringify([r.empties, label, ...r.f]));
  }
}
fs.writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`${GAMES} 局（由五連結束 ${(100 * byFive / GAMES).toFixed(0)}%），${lines.length} 個局面 → ${OUT}，${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
