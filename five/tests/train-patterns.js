/**
 * 訓練棋型評估（src/ai/patterns.js）：用 gen-othello-data.js 產生的資料（盤面 + Edax 分數）做線性迴歸。
 * 每個樣本的預測 = (1 − a) × 階段 s 的分數 + a × 階段 s+1 的分數（各階段：46 個棋型 + 常數 + 行動力差）。
 * 用 Adagrad（棋型表很稀疏，常出現的格子學得快、少見的慢慢學）＋ L2 正則化。留 5% 驗證。
 *
 *   node five/tests/train-patterns.js --epochs 12 --out five/tests/results/patterns.bin five/tests/results/odata-*.txt
 *
 * 輸出：Float32 二進位（STAGES × STAGE_SIZE）。
 */
import fs from "fs";
import { INSTANCES, TYPES, STAGE_SIZE, STAGES, W_BIAS, W_MOB, stageOf, patternIndices } from "../src/ai/patterns.js";
import { mulberry32 } from "./helpers.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const EPOCHS = Number(arg("epochs", 12)), LR = Number(arg("lr", 0.5)), L2 = Number(arg("l2", 1e-4));
const OUT = arg("out", "/tmp/patterns.bin");
// 實驗用：不用某些棋型（逗號分隔的名稱，例如 c25,edge）
const EXCLUDE = new Set((arg("exclude", "") || "").split(",").filter(Boolean));
const files = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function mobility(cells, me) {
  const op = 3 - me;
  let n = 0;
  for (let s = 0; s < 64; s++) {
    if (cells[s]) continue;
    const r = s >> 3, c = s & 7;
    for (const [dr, dc] of DIRS) {
      let y = r + dr, x = c + dc, k = 0;
      while (y >= 0 && y < 8 && x >= 0 && x < 8 && cells[y * 8 + x] === op) { y += dr; x += dc; k++; }
      if (k && y >= 0 && y < 8 && x >= 0 && x < 8 && cells[y * 8 + x] === me) { n++; break; }
    }
  }
  return n;
}

// ===== 讀資料 =====
const NI = INSTANCES.length;
const rows = [];
for (const f of files) for (const l of fs.readFileSync(f, "utf8").split("\n")) if (l) rows.push(l);
const n = rows.length;
const DEAD = -1; // 被排除的實例：預測、訓練都跳過
const IDX = new Int32Array(n * NI), EMP = new Uint8Array(n), Y = new Float32Array(n), MOB = new Float32Array(n);
const cells = new Uint8Array(64), tmp = new Int32Array(NI);
for (let i = 0; i < n; i++) {
  const [s, e, y] = rows[i].split(" ");
  for (let k = 0; k < 64; k++) cells[k] = s[k] === "X" ? 1 : s[k] === "O" ? 2 : 0;
  patternIndices(cells, tmp);
  for (let k = 0; k < NI; k++) if (EXCLUDE.has(TYPES[INSTANCES[k].type].name)) tmp[k] = DEAD;
  IDX.set(tmp, i * NI);
  EMP[i] = Number(e); Y[i] = Number(y);
  MOB[i] = mobility(cells, 1) - mobility(cells, 2);
}
rows.length = 0;
console.log(`樣本 ${n}`);

const rng = mulberry32(12345);
const order = Array.from({ length: n }, (_, i) => i);
for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const nVal = Math.floor(n * 0.05), val = order.slice(0, nVal), train = order.slice(nVal);

const W = new Float32Array(STAGES * STAGE_SIZE), G = new Float32Array(STAGES * STAGE_SIZE).fill(1e-2);
function predict(i) {
  const [s, a] = stageOf(EMP[i]);
  const b0 = s * STAGE_SIZE, b1 = b0 + STAGE_SIZE;
  let v0 = W[b0 + W_BIAS] + W[b0 + W_MOB] * MOB[i], v1 = W[b1 + W_BIAS] + W[b1 + W_MOB] * MOB[i];
  const o = i * NI;
  for (let k = 0; k < NI; k++) { const w = IDX[o + k]; if (w < 0) continue; v0 += W[b0 + w]; v1 += W[b1 + w]; }
  return (1 - a) * v0 + a * v1;
}
function step(w, g) {
  G[w] += g * g;
  W[w] -= LR * (g + L2 * W[w]) / Math.sqrt(G[w]);
}
function evalSet(set) {
  const byStage = Array.from({ length: 7 }, () => [0, 0]);
  let se = 0;
  for (const i of set) {
    const d = predict(i) - Y[i];
    se += d * d;
    const b = Math.min(6, Math.floor((60 - EMP[i]) / 10));
    byStage[b][0] += Math.abs(d); byStage[b][1]++;
  }
  return { rmse: Math.sqrt(se / set.length), mae: byStage.map(([a, c]) => (c ? (a / c).toFixed(2) : "-")).join(" ") };
}

for (let ep = 0; ep < EPOCHS; ep++) {
  for (let i = train.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [train[i], train[j]] = [train[j], train[i]]; }
  for (const i of train) {
    const err = predict(i) - Y[i];
    const [s, a] = stageOf(EMP[i]);
    const b0 = s * STAGE_SIZE, b1 = b0 + STAGE_SIZE, g0 = (1 - a) * err, g1 = a * err, o = i * NI;
    step(b0 + W_BIAS, g0); step(b1 + W_BIAS, g1);
    step(b0 + W_MOB, g0 * MOB[i]); step(b1 + W_MOB, g1 * MOB[i]);
    for (let k = 0; k < NI; k++) { const w = IDX[o + k]; if (w < 0) continue; step(b0 + w, g0); if (g1) step(b1 + w, g1); }
  }
  const tr = evalSet(train.slice(0, 50000)), va = evalSet(val);
  console.log(`epoch ${ep + 1}: train RMSE ${tr.rmse.toFixed(2)}  val RMSE ${va.rmse.toFixed(2)}  val MAE（每 10 手）${va.mae}`);
}
fs.writeFileSync(OUT, Buffer.from(W.buffer));
console.log(`寫入 ${OUT}（${W.length} 個分數）`);
