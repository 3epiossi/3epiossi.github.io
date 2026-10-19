/**
 * 訓練 v8 的學習型評估（五連模式）：每個階段一個邏輯回歸，預測「輪到下棋的一方」最後獲勝的機率。
 *
 *   node five/tests/train-eval.js --train a.jsonl,b.jsonl,c.jsonl --valid d.jsonl --out five/src/ai/v8/model-plain.js
 *
 * 資料由 tests/gen-selfplay.js 產生。驗證集請用不同的棋局（不同檔案），避免同一局的局面同時出現在兩邊。
 * 輸出：模型權重檔，以及驗證集上的對數損失、準確率，並與兩個對照比較：
 *   常數模型（只猜每個階段的平均勝率）、只看棋子數差的模型。
 */
import fs from "fs";
import { FEATURE_NAMES, NF, PHASES, phaseOf } from "../src/ai/v8/features.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const EPOCHS = Number(args.epochs || 30);
const L2 = Number(args.l2 || 1e-4);
const LR = Number(args.lr || 0.02);
// --exclude：不使用的特徵（逗號分隔的名稱），權重固定為 0
const EXCLUDE = new Set((args.exclude || "").split(",").filter(Boolean));

function load(files) {
  const byPhase = Array.from({ length: PHASES }, () => ({ X: [], y: [] }));
  for (const f of files.split(",")) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line);
      const p = phaseOf(row[0]);
      byPhase[p].y.push(row[1]);
      byPhase[p].X.push(row.slice(2));
    }
  }
  return byPhase;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const clampP = (p) => Math.min(1 - 1e-7, Math.max(1e-7, p));
const logloss = (p, y) => -(y * Math.log(clampP(p)) + (1 - y) * Math.log(1 - clampP(p)));

/** 邏輯回歸（Adam，特徵先標準化），回傳原始尺度的權重 */
function fit(X, y, featureIdx) {
  const k = featureIdx.length, n = X.length;
  const mean = new Float64Array(k), sd = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    if (featureIdx[j] === 0) { mean[j] = 0; sd[j] = 1; continue; } // bias
    let m = 0; for (let i = 0; i < n; i++) m += X[i][featureIdx[j]];
    m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (X[i][featureIdx[j]] - m) ** 2;
    mean[j] = m; sd[j] = Math.sqrt(v / n) || 1;
  }
  const w = new Float64Array(k), mW = new Float64Array(k), vW = new Float64Array(k);
  const order = Array.from({ length: n }, (_, i) => i);
  const B = 256;
  let t = 0;
  const xs = new Float64Array(k), g = new Float64Array(k);
  for (let ep = 0; ep < EPOCHS; ep++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let s = 0; s < n; s += B) {
      g.fill(0);
      const e = Math.min(n, s + B);
      for (let ii = s; ii < e; ii++) {
        const i = order[ii];
        let z = 0;
        for (let j = 0; j < k; j++) { xs[j] = (X[i][featureIdx[j]] - mean[j]) / sd[j]; z += w[j] * xs[j]; }
        const err = sigmoid(z) - y[i];
        for (let j = 0; j < k; j++) g[j] += err * xs[j];
      }
      t++;
      for (let j = 0; j < k; j++) {
        const gj = g[j] / (e - s) + (featureIdx[j] === 0 ? 0 : L2 * w[j]);
        mW[j] = 0.9 * mW[j] + 0.1 * gj;
        vW[j] = 0.999 * vW[j] + 0.001 * gj * gj;
        w[j] -= LR * (mW[j] / (1 - 0.9 ** t)) / (Math.sqrt(vW[j] / (1 - 0.999 ** t)) + 1e-8);
      }
    }
  }
  // 換回原始尺度：z = Σ w_j (x_j − m_j)/s_j = Σ (w_j/s_j) x_j − Σ w_j m_j / s_j
  const raw = new Float64Array(NF);
  let biasAdj = 0;
  for (let j = 0; j < k; j++) {
    const f = featureIdx[j];
    if (f === 0) { raw[0] += w[j]; continue; }
    raw[f] = w[j] / sd[j];
    biasAdj -= w[j] * mean[j] / sd[j];
  }
  raw[0] += biasAdj;
  return raw;
}

function evaluate(model, set) {
  let loss = 0, correct = 0, n = 0;
  for (let p = 0; p < PHASES; p++) {
    const { X, y } = set[p];
    for (let i = 0; i < X.length; i++) {
      let z = 0;
      for (let f = 0; f < NF; f++) z += model[p][f] * X[i][f];
      const pr = sigmoid(z);
      loss += logloss(pr, y[i]);
      if (y[i] !== 0.5) { if ((pr > 0.5) === (y[i] === 1)) correct++; n++; }
    }
  }
  const total = set.reduce((a, s) => a + s.y.length, 0);
  return { loss: loss / total, acc: correct / n };
}

const train = load(args.train);
const valid = load(args.valid);
console.log("訓練局面（各階段）:", train.map(s => s.y.length).join(" / "), "；驗證局面:", valid.map(s => s.y.length).join(" / "));

const ALL = Array.from({ length: NF }, (_, i) => i).filter(i => !EXCLUDE.has(FEATURE_NAMES[i]));
if (EXCLUDE.size) console.log("不使用的特徵:", [...EXCLUDE].join(", "));
const model = train.map(s => fit(s.X, s.y, ALL));
const discOnly = train.map(s => fit(s.X, s.y, [0, 1]));
const constant = train.map(s => fit(s.X, s.y, [0]));

const r = { full: evaluate(model, valid), disc: evaluate(discOnly, valid), cons: evaluate(constant, valid) };
console.log(`驗證集對數損失（越低越好）：常數 ${r.cons.loss.toFixed(4)}、只看棋子數 ${r.disc.loss.toFixed(4)}、完整特徵 ${r.full.loss.toFixed(4)}`);
console.log(`驗證集勝負預測準確率：常數 ${(100 * r.cons.acc).toFixed(1)}%、只看棋子數 ${(100 * r.disc.acc).toFixed(1)}%、完整特徵 ${(100 * r.full.acc).toFixed(1)}%`);
// 各階段的準確率
for (let p = 0; p < PHASES; p++) {
  const one = (m) => evaluate(m.map((w, i) => (i === p ? w : new Float64Array(NF))), valid.map((s, i) => (i === p ? s : { X: [], y: [] })));
  console.log(`  階段 ${p}（空格 ${60 - p * 10}～${Math.max(1, 51 - p * 10)}）：只看棋子數 ${(100 * one(discOnly).acc).toFixed(1)}%、完整特徵 ${(100 * one(model).acc).toFixed(1)}%`);
}

if (args.out) {
  const fmt = (w) => "[" + Array.from(w, v => +v.toFixed(5)).join(", ") + "]";
  const src = `/**
 * v8 學習型評估的權重（五連模式，每顆 1 分）——由 tests/train-eval.js 自動產生，請勿手動修改。
 * 每個階段（依剩餘空格，見 features.js 的 phaseOf）一組邏輯回歸權重：勝率 = sigmoid(Σ 權重 × 特徵)。
 * 訓練資料：${args.train.split(",").length} 個檔案、${train.reduce((a, s) => a + s.y.length, 0)} 個自我對戰局面。
 * 驗證集：對數損失 ${r.full.loss.toFixed(4)}（常數模型 ${r.cons.loss.toFixed(4)}），勝負預測準確率 ${(100 * r.full.acc).toFixed(1)}%。
 * 特徵：${FEATURE_NAMES.join(", ")}${EXCLUDE.size ? "（不使用：" + [...EXCLUDE].join(", ") + "）" : ""}
 */
export const PLAIN_MODEL = [
${model.map(fmt).map(s => "  " + s).join(",\n")}
];
`;
  fs.writeFileSync(args.out, src);
  console.log("模型已寫入", args.out);
  for (let p = 0; p < PHASES; p++) {
    console.log(`  階段 ${p}:`, FEATURE_NAMES.map((n, f) => `${n}=${model[p][f].toFixed(3)}`).join(" "));
  }
}
