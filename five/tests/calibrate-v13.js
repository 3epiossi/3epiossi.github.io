/**
 * 勝率條的校準（v13 或 v14〔--engine v14〕，4 組自選連五）：v13 自我對局，記下每個局面的分數與最後的勝負，
 * 再依剩餘空格分段擬合「勝率 = sigmoid(k × 分數 ÷ SCORE_SCALE)」的 k（寫進 src/ui/eval-bar.js 的 CAL）。
 *
 *   產生資料：node five/tests/calibrate-v13.js --games 40 --time 400 --seed 1 --out five/tests/results/v13-calib-1.jsonl
 *   擬合：    node five/tests/calibrate-v13.js --fit five/tests/results/v13-calib-*.jsonl
 *
 * 前 4 手隨機（格子、組別都隨機），之後雙方都是 v13（每步 --time 毫秒）。一定贏／一定輸（連成五、終盤算到底）的局面不算。
 */
import fs from "fs";
import { GameEngine } from "../src/core/game-engine.js";
import { searchV13, WIN } from "../src/ai/v13.js";
import { searchV14 } from "../src/ai/v14.js";
import { groupOf } from "../src/core/five-rules.js";
import { SCORE_SCALE as SCALE13, SCORE_SCALE_V14 } from "../src/ai/ai-service.js";
import { mulberry32 } from "./helpers.js";
import { BLACK } from "../src/core/constants.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
// --engine v14：用 v14 自我對局（分數是棋子差，換算係數 SCORE_SCALE_V14）
const ENGINE = arg("engine", "v13");
const SCORE_SCALE = ENGINE === "v14" ? SCORE_SCALE_V14 : SCALE13;
const search = ENGINE === "v14" ? searchV14 : searchV13;

if (argv.includes("--fit")) {
  const files = argv.slice(argv.indexOf("--fit") + 1).filter((f) => !f.startsWith("--") && f !== ENGINE);
  const rows = files.flatMap(f => fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)));
  // 剩餘空格分段（跟舊的校準一樣）
  const BUCKETS = [[47, 60], [35, 46], [26, 34], [16, 25], [8, 15], [0, 7]];
  const fitK = (xs) => {
    let best = null;
    for (let k = 0.1; k <= 40; k += 0.05) {
      let ll = 0;
      for (const { u, y } of xs) { const p = 1 / (1 + Math.exp(-k * u)); ll += y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)); }
      if (!best || ll > best.ll) best = { k, ll };
    }
    return best.k;
  };
  console.log(`局面 ${rows.length}`);
  for (const [lo, hi] of BUCKETS) {
    const xs = rows.filter(r => r.empties >= lo && r.empties <= hi).map(r => ({ u: r.v / SCORE_SCALE, y: r.y }));
    if (xs.length < 30) { console.log(`[${lo}, ${hi}] 樣本太少 ${xs.length}`); continue; }
    const k = fitK(xs);
    // 檢查：預測 60～90% 的局面實際贏多少
    const bins = [[0.6, 0.75], [0.75, 0.9]].map(([a, b]) => {
      const sel = xs.filter(x => { const p = 1 / (1 + Math.exp(-k * x.u)); return p >= a && p < b; });
      return sel.length ? `${a * 100}～${b * 100}% → ${(100 * sel.reduce((t, x) => t + x.y, 0) / sel.length).toFixed(0)}%（${sel.length}）` : "";
    });
    console.log(`[${(lo + hi) / 2}, ${k.toFixed(2)}],  // 剩 ${lo}～${hi} 格，${xs.length} 個局面；${bins.join("；")}`);
  }
  process.exit(0);
}

const GAMES = Number(arg("games", 20)), T = Number(arg("time", 400)), SEED = Number(arg("seed", 1));
const OUT = arg("out", "/tmp/v13-calib.jsonl");
for (let g = 0; g < GAMES; g++) {
  const rng = mulberry32(SEED * 10007 + g);
  const e = new GameEngine({ rng });
  const recs = [];
  let ply = 0;
  while (!e.gameOver) {
    const moves = e.legalMoves();
    if (!moves.length) { e.passTurn(); continue; }
    const turn = e.currentTurn;
    if (ply < 4) {
      const m = moves[Math.floor(rng() * moves.length)];
      e.executeMove(m.r, m.c, e.pool[Math.floor(rng() * e.pool.length)]);
    } else {
      const r = search(e.board, turn, groupOf, { timeMs: T });
      const empties = e.board.flat().filter(d => !d).length;
      if (Math.abs(r.score) < WIN / 2 && !r.exact) recs.push({ empties, v: r.score, turn });
      const disc = e.pool.find(id => groupOf(id) === r.group);
      e.executeMove(r.sq >> 3, r.sq & 7, disc);
    }
    ply++;
  }
  const w = e.settlementData.winner;
  for (const x of recs) fs.appendFileSync(OUT, JSON.stringify({ empties: x.empties, v: +x.v.toFixed(2), y: w === 0 ? 0.5 : (w === x.turn ? 1 : 0), byFive: !!e.settlementData.byFive }) + "\n");
}
