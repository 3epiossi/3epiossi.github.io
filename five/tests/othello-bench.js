/**
 * 黑白棋實力測驗（比對戰穩定很多）：一批中盤盤面，Edax（深度 12）先替每一步打好分數存起來，
 * 再看引擎在限定時間內選的那步，比 Edax 的最佳步少幾顆（平均損失越小越好）。
 * 盤面的組別照 (r + 2c) mod 4 排，盤上的五格窗口幾乎都混了組別，連線因素很小，主要比黑白棋。
 *
 *   產生題目：node five/tests/othello-bench.js --make 400 --out five/tests/results/obench.json
 *   測引擎：  node five/tests/othello-bench.js --engine v14 --weights five/tests/results/patterns-b.bin --time 500 --part 0/4
 */
import fs from "fs";
import { Edax } from "./edax.js";
import { createInitialBoard, getLegalMoves, applyMoveToBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { groupOf } from "../src/core/five-rules.js";
import { mulberry32 } from "./helpers.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILE = arg("out", arg("bench", "five/tests/results/obench.json"));
const opp = (p) => (p === BLACK ? WHITE : BLACK);
const idAt = (r, c) => ((r + 2 * c) % 4) * 16 + ((r * 8 + c) % 16);

if (argv.includes("--make")) {
  const want = Number(arg("make", 400));
  const rng = mulberry32(424242);
  const edax = new Edax({ depth: 4 });
  const items = [];
  while (items.length < want) {
    let b = createInitialBoard(() => 0), p = BLACK;
    const stop = 14 + Math.floor(rng() * 30); // 第 14～43 手停下來出題（空格 46～17）
    let ok = true;
    for (let ply = 0; ply < stop; ply++) {
      let ms = getLegalMoves(b, p);
      if (!ms.length) { p = opp(p); ms = getLegalMoves(b, p); if (!ms.length) { ok = false; break; } }
      // 用 Edax 淺層＋隨機性下，盤面比較自然
      const hs = await edax.hints(b, p, 64, 4);
      const w = hs.map((h) => Math.exp((h.score - hs[0].score) / 2));
      let x = rng() * w.reduce((a, y) => a + y, 0), i = 0;
      while (x > w[i] && i < w.length - 1) x -= w[i++];
      b = applyMoveToBoard(b, ms.find((m) => m.r * 8 + m.c === hs[i].sq), 0, p);
      p = opp(p);
    }
    if (!ok || getLegalMoves(b, p).length < 2) continue;
    const hints = await edax.hints(b, p, 64, 12);
    let s = "";
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const d = b[r][c]; s += !d ? "-" : d.face === BLACK ? "B" : "W"; }
    items.push({ board: s, turn: p, hints });
    if (items.length % 20 === 0) console.log(items.length);
  }
  edax.close();
  fs.writeFileSync(FILE, JSON.stringify(items));
  process.exit(0);
}

const ENGINE = arg("engine", "v13"), TIME = Number(arg("time", 500));
const PARAMS = JSON.parse(arg("params", "{}"));
const [part, parts] = arg("part", "0/1").split("/").map(Number);
const mod = await import(`../src/ai/${ENGINE}.js`);
const search = mod.searchV13 || mod.searchV14;
if (mod.setPatternWeights && arg("weights")) {
  const buf = fs.readFileSync(arg("weights"));
  mod.setPatternWeights(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}
const items = JSON.parse(fs.readFileSync(FILE, "utf8")).filter((_, i) => i % parts === part);
let tot = 0, best = 0, depth = 0;
const byE = {};
for (const it of items) {
  const board = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
    const ch = it.board[r * 8 + c];
    return ch === "-" ? null : { id: idAt(r, c), face: ch === "B" ? BLACK : WHITE };
  }));
  const r = search(board, it.turn, groupOf, { timeMs: TIME, params: PARAMS });
  const h = it.hints.find((x) => x.sq === r.sq);
  const loss = it.hints[0].score - (h ? h.score : it.hints[it.hints.length - 1].score);
  tot += loss; best += loss === 0; depth += r.depth;
  const e = it.board.split("").filter((c) => c === "-").length, k = e >= 34 ? "34+" : e >= 26 ? "26-33" : "17-25";
  (byE[k] ||= []).push(loss);
}
const out = { engine: ENGINE, params: PARAMS, n: items.length, loss: tot, best, depth };
out.byE = Object.fromEntries(Object.entries(byE).map(([k, a]) => [k, [a.length, a.reduce((x, y) => x + y, 0)]]));
console.log(JSON.stringify(out));
