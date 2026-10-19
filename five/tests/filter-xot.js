/**
 * 現有的 XOT 開局用目前的分析引擎重新檢查：思考 --t1、--t2 毫秒各算一次，黑方勝率都在 50% ± --tol 以內才留下。
 * 輸出跟 gen-xot.js 一樣的 jsonl，可以再用 gen-xot.js --build 合併。
 *
 *   node five/tests/filter-xot.js --part 0/6 --out five/tests/results/xotf-0.jsonl
 */
import fs from "fs";
import { GameEngine } from "../src/core/game-engine.js";
import { searchEngine } from "../src/ai/ai-service.js";
import { displayWinProb } from "../src/ui/eval-bar.js";
import { XOT_OPENINGS, decodeXot } from "../src/core/xot-openings.js";
import { BLACK } from "../src/core/constants.js";
import { groupOf } from "../src/core/five-rules.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const [part, parts] = arg("part", "0/1").split("/").map(Number);
const T1 = Number(arg("t1", 1000)), T2 = Number(arg("t2", 2000)), TOL = Number(arg("tol", 0.05));
const OUT = arg("out", "/tmp/xotf.jsonl");

function blackProb(e, timeMs) {
  const r = searchEngine(e.board, e.currentTurn, e.pool, { timeMs });
  const s = r.scores[0].score, empties = e.board.flat().filter((d) => !d).length;
  const p = s >= 0.999 ? 1 : s <= -0.999 ? 0 : displayWinProb(s, empties);
  return e.currentTurn === BLACK ? p : 1 - p;
}

for (let i = part; i < XOT_OPENINGS.length; i += parts) {
  const o = decodeXot(XOT_OPENINGS[i]);
  const e = new GameEngine();
  e.resetGame(o);
  const p1 = blackProb(e, T1);
  if (Math.abs(p1 - 0.5) > TOL) continue;
  const p2 = blackProb(e, T2);
  if (Math.abs(p2 - 0.5) > TOL) continue;
  const key = e.currentTurn + ":" + e.board.map((r) => r.map((d) => (d ? `${groupOf(d.id)}${d.face}` : "..")).join("")).join("");
  fs.appendFileSync(OUT, JSON.stringify({ init: o.init, moves: o.moves, black: +p2.toFixed(4), black1: +p1.toFixed(4), key }) + "\n");
}
