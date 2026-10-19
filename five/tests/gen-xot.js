/**
 * 產生 XOT 開局（src/core/xot-openings.js）：前幾手隨機（格子、組別都隨機），只留下雙方勝率接近的局面。
 *
 *   產生：node five/tests/gen-xot.js --count 200 --seed 1 --out five/tests/results/xot-1.jsonl
 *   合併成網頁用的檔案：node five/tests/gen-xot.js --build five/tests/results/xot-*.jsonl
 *
 * 每個候選：
 *   1. 中間四顆的組別隨機排；隨機下 --min～--max 手（預設 6～10 手），每手隨機挑合法位置、隨機挑還有剩的組別。
 *      途中有人連成五、或輪到的一方沒地方下 → 丟掉。
 *   2. 用網頁的分析引擎（v14；跟網頁的勝率條同一套換算，ui/eval-bar.js）：思考 --t1 毫秒、再 --t2 毫秒各算一次，
 *      兩次的黑方勝率都在 50% ± --tol（預設 5%）以內才留下（只算一次的話，深一點就可能跑出範圍）。
 *   3. 跟已經留下的開局重複（同一個盤面、同一方）就丟掉。
 */
import fs from "fs";
import { GameEngine } from "../src/core/game-engine.js";
import { searchEngine } from "../src/ai/ai-service.js";
import { displayWinProb } from "../src/ui/eval-bar.js";
import { groupOf } from "../src/core/five-rules.js";
import { BLACK } from "../src/core/constants.js";
import { mulberry32 } from "./helpers.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };

if (argv.includes("--build")) {
  const files = argv.slice(argv.indexOf("--build") + 1);
  const seen = new Set(), rows = [];
  for (const f of files) for (const l of fs.readFileSync(f, "utf8").trim().split("\n")) {
    const x = JSON.parse(l);
    if (seen.has(x.key)) continue;
    seen.add(x.key);
    rows.push(x);
  }
  // 一個開局一個字串：中間四顆的組別（4 個數字）＋每一手兩個字（格子用 base64 字母、組別用數字）
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const enc = (x) => x.init.join("") + x.moves.map(([sq, g]) => B64[sq] + g).join("");
  const lens = {};
  for (const x of rows) lens[x.moves.length] = (lens[x.moves.length] || 0) + 1;
  const avg = rows.reduce((t, x) => t + Math.abs(x.black - 0.5), 0) / rows.length;
  const out = `/**
 * XOT 開局（tests/gen-xot.js 產生，${rows.length} 個）：前幾手隨機、雙方勝率都在 50% ± 5% 以內的局面。
 * 一個字串一個開局：前 4 個數字是中間四顆的組別（D4、E4、D5、E5 的順序），之後每一手兩個字：
 * 格子（base64 字母，A = A1、B = B1 … / = H8）＋組別（0～3）。
 * 手數分布：${Object.entries(lens).map(([k, v]) => `${k} 手 ${v} 個`).join("、")}；黑方勝率跟 50% 平均差 ${(100 * avg).toFixed(1)}%。
 */
const B64 = "${B64}";
export const XOT_OPENINGS = [
${rows.map(x => `  "${enc(x)}"`).join(",\n")}
];

/** 第 i 個開局 → { init: [四顆的組別], moves: [[格, 組], …] }（給 GameEngine.resetGame） */
export function decodeXot(s) {
  const init = [...s.slice(0, 4)].map(Number);
  const moves = [];
  for (let i = 4; i + 1 < s.length; i += 2) moves.push([B64.indexOf(s[i]), Number(s[i + 1])]);
  return { init, moves };
}

/** 隨機挑一個 XOT 開局 */
export function randomXot(rng = Math.random) {
  return decodeXot(XOT_OPENINGS[Math.floor(rng() * XOT_OPENINGS.length)]);
}
`;
  fs.writeFileSync(new URL("../src/core/xot-openings.js", import.meta.url), out);
  console.log(`寫入 ${rows.length} 個開局；${Object.entries(lens).map(([k, v]) => `${k} 手 ${v}`).join("、")}；跟 50% 平均差 ${(100 * avg).toFixed(1)}%`);
  process.exit(0);
}

const COUNT = Number(arg("count", 100)), SEED = Number(arg("seed", 1));
const MIN = Number(arg("min", 6)), MAX = Number(arg("max", 10));
const T1 = Number(arg("t1", 1000)), T2 = Number(arg("t2", 2000)), TOL = Number(arg("tol", 0.05));
const OUT = arg("out", "/tmp/xot.jsonl");
const rng = mulberry32(SEED * 7907 + 3);

/** 輪到的一方的勝率 → 黑方勝率 */
function blackProb(e, timeMs) {
  const r = searchEngine(e.board, e.currentTurn, e.pool, { timeMs });
  const s = r.scores[0].score, empties = e.board.flat().filter(d => !d).length;
  const p = s >= 0.999 ? 1 : s <= -0.999 ? 0 : displayWinProb(s, empties);
  return e.currentTurn === BLACK ? p : 1 - p;
}

let kept = 0, tried = 0;
while (kept < COUNT) {
  tried++;
  const init = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [init[i], init[j]] = [init[j], init[i]]; }
  const e = new GameEngine({ rng });
  e.resetGame({ init, moves: [] });
  const n = MIN + Math.floor(rng() * (MAX - MIN + 1));
  const moves = [];
  let ok = true;
  for (let i = 0; i < n; i++) {
    const ms = e.legalMoves();
    if (!ms.length || e.gameOver) { ok = false; break; }
    const m = ms[Math.floor(rng() * ms.length)], d = e.pool[Math.floor(rng() * e.pool.length)];
    e.executeMove(m.r, m.c, d);
    moves.push([m.r * 8 + m.c, groupOf(d)]);
  }
  if (!ok || e.gameOver || !e.legalMoves().length) continue;
  const p1 = blackProb(e, T1);
  if (Math.abs(p1 - 0.5) > TOL) continue;
  const p2 = blackProb(e, T2);
  if (Math.abs(p2 - 0.5) > TOL) continue;
  const key = e.currentTurn + ":" + e.board.map(r => r.map(d => (d ? `${groupOf(d.id)}${d.face}` : "..")).join("")).join("");
  fs.appendFileSync(OUT, JSON.stringify({ init, moves, black: +p2.toFixed(4), black1: +p1.toFixed(4), key }) + "\n");
  kept++;
}
console.log(`試了 ${tried} 個、留下 ${kept} 個`);
