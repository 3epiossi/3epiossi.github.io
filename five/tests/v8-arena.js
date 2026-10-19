/**
 * 五連類模式的引擎對戰場：任兩個引擎對戰，黑白各半、同一組亂數種子。
 *
 * 引擎：
 *   v8           v8 預設（黑白棋局勢＋搜尋中的成五機率，勝率目標）
 *   othello      純黑白棋：v6 式搜尋只追求分數，完全不管五連（連眼前的勝機都不抓）
 *   othelloGrab  純黑白棋＋能一步連成五時會抓住
 *   gomoku       五子棋派（參考 rapfi 的思路）：搜尋看得到成五，局面評估只看五連威脅，不管黑白棋局勢
 *   gomokuMix    五子棋＋黑白棋混合：v8 再加上 rapfi 式的五連威脅評估（同時看威脅與黑白棋局勢）
 *   v8learn      v8＋學習型評估（自我對戰訓練的權重，src/ai/v8/model-plain.js；--model 可指定其他權重檔）
 *
 *   node five/tests/v8-arena.js --a v8 --b gomoku --games 100 --depth 5
 *   node five/tests/v8-arena.js --a v8 --b othello --games 100 --depth 5
 *   node five/tests/v8-arena.js --a v8 --b othelloGrab --params '{"fiveTrust":0.6}'   # --params 只套用在 A 方
 */
import { GameEngine } from "../src/core/game-engine.js";
import { applyMoveToBoard } from "../src/core/rules.js";
import { findFive, fiveScores } from "../src/core/five-rules.js";
import { searchV8 } from "../src/ai/v8.js";
import { V8_PLAIN_PARAMS } from "../src/ai/v8/search.js";
import { PARAMS as V6_EVAL_PARAMS } from "../src/ai/v6/eval.js";
import { mulberry32 } from "./helpers.js";
import { PLAIN_MODEL } from "../src/ai/v8/model-plain.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const GAMES = Number(args.games || 100);
const DEPTH = args.depth ? Number(args.depth) : undefined;
const TIME = Number(args.time || 200);
const SEED = Number(args.seed || 5200);
const D = V8_PLAIN_PARAMS;
// v6 評估的原始參數（只取評估相關的鍵，用來還原調參前的版本）
const V6_PARAMS = Object.fromEntries(["alphaStart", "alphaGain", "edgeBonus", "mobEarly", "mobLate", "frontier", "corner", "xSquare", "cSquare", "parity"].map(k => [k, V6_EVAL_PARAMS[k]]));

const ENGINES = {
  v8: { params: D, grab: false },
  v8base: { params: D, grab: false },   // 與 v8 相同，但不受 --params 影響（比較改進前後用）
  // 學習型評估的 v8（--model 指定其他權重檔時以那份為準）
  v8learn: { params: { ...D, model: PLAIN_MODEL }, grab: false },
  // 改進前的五連模式 v8（每顆 1 分，固定勝率換算 100、不打折對手的成五機率、v6 原始評估參數）
  v8old: { params: { ...D, ...V6_PARAMS, valueScale: 100, valueScaleLate: null, oppFiveTrust: 1 }, grab: false },
  // 自我對戰調參前的五連模式 v8（勝率換算 300 → 30、對手成五打 7 折、v6 原始評估參數）
  v8preSpsa: { params: { ...D, ...V6_PARAMS, valueScale: 300, valueScaleLate: 30, oppFiveTrust: 0.7 }, grab: false },
  othello: { params: { ...D, five: false, winProb: false }, grab: false },
  othelloGrab: { params: { ...D, five: false, winProb: false }, grab: true },
  gomoku: { params: { ...D, othelloEval: false, threatScale: 1, valueScale: 200 }, grab: false },
  gomokuMix: { params: { ...D, threatScale: 1 }, grab: false }
};
if (args.model) {
  const { PLAIN_MODEL: M } = await import(new URL(args.model, `file://${process.cwd()}/`).href);
  ENGINES.v8learn = { params: { ...D, model: M }, grab: false };
}
const A = args.a || "v8", B = args.b || "othello";
// --params：只套用在 A 方（調參用），JSON 格式；--paramsFile：讀 tests/spsa-tune.js 的輸出檔（取 theta）
if (args.params) ENGINES[A] = { ...ENGINES[A], params: { ...ENGINES[A].params, ...JSON.parse(args.params) } };
if (args.paramsFile) {
  const { theta } = JSON.parse((await import("fs")).readFileSync(args.paramsFile, "utf8"));
  ENGINES[A] = { ...ENGINES[A], params: { ...ENGINES[A].params, ...theta } };
}
if (!ENGINES[A] || !ENGINES[B]) { console.error("引擎只能是 " + Object.keys(ENGINES).join(" / ")); process.exit(1); }

function move(e, name) {
  const eng = ENGINES[name];
  if (eng.grab) {
    for (const m of e.legalMoves()) {
      if (findFive(applyMoveToBoard(e.board, m, e.hand, e.currentTurn), e.currentTurn)) return m;
    }
  }
  const r = searchV8(e.board, e.currentTurn, e.hand, { timeMs: DEPTH ? 60000 : TIME, maxDepth: DEPTH, params: eng.params });
  return { r: r.bestSq >> 3, c: r.bestSq & 7 };
}

let aWins = 0, draws = 0, byFive = 0, aFive = 0, bFive = 0, aScoreWins = 0, scoreGames = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const aColor = g % 2 === 0 ? 1 : 2;
  const e = new GameEngine({ rng: mulberry32(SEED + Math.floor(g / 2)) });
  let winner = null;
  while (!e.gameOver) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const mover = e.currentTurn;
    const m = move(e, mover === aColor ? A : B);
    e.executeMove(m.r, m.c);
  }
  const s = e.settlementData;
  winner = s.winner;
  if (s.byFive) { byFive++; if (winner === aColor) aFive++; else bFive++; }
  else { scoreGames++; if (winner === aColor) aScoreWins++; }
  if (winner === aColor) aWins++; else if (winner === 0) draws++;
}
const pct = (x, n = GAMES) => (n ? (100 * x / n).toFixed(0) : "-") + "%";
console.log(`[五連｜${A} vs ${B}｜${DEPTH ? DEPTH + " 層" : TIME + "ms/步"}${args.params ? "｜" + args.params : ""}${args.paramsFile ? "｜" + args.paramsFile.split("/").pop() : ""}] ${GAMES} 局：${A} 勝率 ${pct(aWins + draws / 2)}；` +
  `由五連結束 ${pct(byFive)}（${A} ${pct(aFive)}、${B} ${pct(bFive)}）；比分數的 ${scoreGames} 局中 ${A} 贏 ${pct(aScoreWins, scoreGames)}；${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
