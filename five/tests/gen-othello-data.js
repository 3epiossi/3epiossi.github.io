/**
 * 產生黑白棋評估（棋型表）的訓練資料：每一列「64 個字（X 輪到的一方、O 對手、- 空）、空格數、Edax 的分數（輪到的一方的棋子差）」。
 * 棋局：每一手 70% 用 Edax 淺層（深度 2）的分數做 softmax 抽樣（溫度每局隨機），30% 用 v13 短時間搜尋（組別隨機），
 * 這樣盤面同時像一般黑白棋、也像五連黑白棋 CPU 會下出來的樣子。不管五連（只當黑白棋下完）。
 *
 *   node five/tests/gen-othello-data.js --games 1000 --seed 1 --label-depth 6 --out five/tests/results/odata-1.txt
 */
import fs from "fs";
import { Edax } from "./edax.js";
import { createInitialBoard, getLegalMoves, applyMoveToBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { poolOf } from "../src/core/game-engine.js";
import { groupOf } from "../src/core/five-rules.js";
import { searchV13 } from "../src/ai/v13.js";
import { mulberry32 } from "./helpers.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const GAMES = Number(arg("games", 100)), SEED = Number(arg("seed", 1)), LD = Number(arg("label-depth", 6));
const OUT = arg("out", "/tmp/odata.txt");
const rng = mulberry32(SEED * 104729 + 7);
const edax = new Edax({ depth: 2 });
const opp = (p) => (p === BLACK ? WHITE : BLACK);

let lines = [];
for (let g = 0; g < GAMES; g++) {
  // 中間四顆的組別隨機
  const ids = [0, 16, 32, 48].sort(() => rng() - 0.5);
  let k = 0;
  let b = createInitialBoard(() => ids[k++]), p = BLACK;
  const tau = [0.7, 1.5, 3, 6][Math.floor(rng() * 4)];
  for (let ply = 0; ply < 64; ply++) {
    let ms = getLegalMoves(b, p);
    if (!ms.length) { p = opp(p); ms = getLegalMoves(b, p); if (!ms.length) break; }
    const empties = b.flat().filter((d) => !d).length;
    // 標記：Edax 深度 LD 的最佳分數
    const lab = await edax.hints(b, p, 1, LD);
    let s = "";
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const d = b[r][c]; s += !d ? "-" : d.face === p ? "X" : "O"; }
    lines.push(`${s} ${empties} ${lab[0].score}`);
    // 選下一手
    const pool = poolOf(b);
    let mv, id = pool[Math.floor(rng() * pool.length)];
    if (rng() < 0.3) {
      const r = searchV13(b, p, groupOf, { timeMs: 30, maxDepth: 3 });
      mv = ms.find((m) => m.r * 8 + m.c === r.sq);
      const gid = pool.find((x) => groupOf(x) === r.group);
      if (gid != null) id = gid;
    } else {
      const hs = await edax.hints(b, p, 64, 2);
      const best = hs[0].score;
      const w = hs.map((h) => Math.exp((h.score - best) / tau));
      let x = rng() * w.reduce((a, y) => a + y, 0), i = 0;
      while (x > w[i] && i < w.length - 1) x -= w[i++];
      mv = ms.find((m) => m.r * 8 + m.c === hs[i].sq);
    }
    if (!mv) mv = ms[0];
    b = applyMoveToBoard(b, mv, id, p);
    p = opp(p);
  }
  if (lines.length > 2000) { fs.appendFileSync(OUT, lines.join("\n") + "\n"); lines = []; }
}
if (lines.length) fs.appendFileSync(OUT, lines.join("\n") + "\n");
edax.close();
