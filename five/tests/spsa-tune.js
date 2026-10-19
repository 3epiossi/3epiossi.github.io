/**
 * 用自我對戰調整 v8 評估參數（五連模式）：SPSA（同時擾動隨機近似，Stockfish 等引擎的調參法）
 *
 * 每一輪：所有參數同時隨機 ±δ，得到 θ+ 與 θ−；兩者對戰 G 局（黑白各半、同一組亂數種子），
 * 依勝負差把 θ 往贏的那邊移一點。直接優化「實際對戰勝率」，不需要局面標記。
 *
 *   node five/tests/spsa-tune.js --iters 300 --games 8 --depth 3 --seed 1 --out /tmp/spsa.json
 */
import fs from "fs";
import { GameEngine } from "../src/core/game-engine.js";
import { searchV8 } from "../src/ai/v8.js";
import { V8_PLAIN_PARAMS } from "../src/ai/v8/search.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const ITERS = Number(args.iters || 300);
const G = Number(args.games || 8);
const DEPTH = Number(args.depth || 3);
const SEED = Number(args.seed || 1);
const OUT = args.out || "/tmp/spsa.json";

// 要調的參數：[名稱, 擾動幅度（原始單位）, 下限, 上限]
const SPEC = [
  ["alphaStart", 0.05, 0.05, 0.8],
  ["alphaGain", 0.05, 0, 0.8],
  ["edgeBonus", 0.04, 0, 0.5],
  ["mobEarly", 0.3, 0, 5],
  ["mobLate", 0.2, 0, 5],
  ["frontier", 0.1, 0, 3],
  ["corner", 0.6, 0, 15],
  ["xSquare", 0.6, 0, 15],
  ["cSquare", 0.3, 0, 8],
  ["parity", 0.3, 0, 6],
  ["valueScale", 40, 20, 1500],
  ["valueScaleLate", 6, 3, 300],
  ["oppFiveTrust", 0.08, 0.2, 1]
];
let theta = Object.fromEntries(SPEC.map(([n]) => [n, V8_PLAIN_PARAMS[n]]));
if (args.init) theta = { ...theta, ...JSON.parse(fs.readFileSync(args.init, "utf8")).theta };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const withTheta = (t) => ({ ...V8_PLAIN_PARAMS, ...t });

/** θA 對 θB 一局，回傳 θA 的結果（贏 1、平 0.5、輸 0） */
function playOne(pA, pB, aColor, seed) {
  const e = new GameEngine({ rng: mulberry32(seed) });
  while (!e.gameOver) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const p = e.currentTurn === aColor ? pA : pB;
    const r = searchV8(e.board, e.currentTurn, e.hand, { timeMs: 60000, maxDepth: DEPTH, params: p });
    e.executeMove(r.bestSq >> 3, r.bestSq & 7);
  }
  const w = e.settlementData.winner;
  return w === 0 ? 0.5 : w === aColor ? 1 : 0;
}

const rng = mulberry32(SEED * 31337);
const a0 = Number(args.a || 0.6), A = ITERS * 0.1, alpha = 0.602, gamma = 0.101;
const history = [];
const t0 = Date.now();
for (let k = 1; k <= ITERS; k++) {
  const ak = a0 / (k + A) ** alpha;
  const ck = 1 / k ** gamma;
  const delta = SPEC.map(() => (rng() < 0.5 ? -1 : 1));
  const plus = {}, minus = {};
  SPEC.forEach(([n, step, lo, hi], i) => {
    plus[n] = clamp(theta[n] + ck * step * delta[i], lo, hi);
    minus[n] = clamp(theta[n] - ck * step * delta[i], lo, hi);
  });
  let score = 0;
  for (let g = 0; g < G; g++) {
    const seed = SEED * 1e6 + k * 100 + Math.floor(g / 2);
    score += playOne(withTheta(plus), withTheta(minus), g % 2 === 0 ? 1 : 2, seed);
  }
  const r = (score / G) * 2 - 1; // θ+ 的淨勝率，[-1, 1]
  SPEC.forEach(([n, step, lo, hi], i) => {
    theta[n] = clamp(theta[n] + ak * r * step * delta[i] / ck, lo, hi);
  });
  if (k % 10 === 0 || k === ITERS) {
    history.push({ k, theta: { ...theta } });
    fs.writeFileSync(OUT, JSON.stringify({ k, theta, history }, null, 1));
    console.log(`第 ${k} 輪（${((Date.now() - t0) / 1000).toFixed(0)} 秒）：` + SPEC.map(([n]) => `${n}=${+theta[n].toFixed(3)}`).join(" "));
  }
}
