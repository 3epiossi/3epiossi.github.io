/**
 * 由自我對戰資料訓練評估權重。用法：
 *   node whowins/tests/train-eval.js data1.f32 [data2.f32 ...] [--write]
 * 每個 (phase, mover 顏色) 一組線性迴歸（ridge）到終局淨勝分；再對每個 phase 擬合 sigmoid 的 scale
 * （最小化對「mover 是否獲勝」的 log loss）。加 --write 才覆寫 src/engine/weights.js。
 */
import fs from "node:fs";
import { NF, NPHASE, FEATURE_NAMES } from "../src/engine/eval.js";

import { Position, BLACK } from "../src/engine/core.js";
import { extractFeatures } from "../src/engine/eval.js";

const STRIDE = 20; // gen-selfplay.js 的每筆位元組數
const files = process.argv.slice(2).filter(a => !a.startsWith("--"));
const write = process.argv.includes("--write");
// 展開成特徵列（Float32，每列 2*NF + phase + color + target）
const K = 2 * NF;
const R = [];
{
  const pos = new Position(); const f = new Float64Array(K);
  for (const file of files) {
    const b = fs.readFileSync(file);
    for (let o = 0; o + STRIDE <= b.length; o += STRIDE) {
      pos.b.set(b.subarray(o, o + 8)); pos.w.set(b.subarray(o + 8, o + 16));
      const col = b[o + 16];
      const mover = col === 0 ? BLACK : 2;
      const ph = extractFeatures(pos, mover, f);
      let t = b[o + 18] | (b[o + 19] << 8); if (t > 32767) t -= 65536; t /= 2;
      const row = new Float32Array(K + 3);
      for (let i = 0; i < K; i++) row[i] = f[i];
      row[K] = ph; row[K + 1] = col; row[K + 2] = t;
      R.push(row);
    }
  }
}
console.log("samples", R.length);

function solve(A, y, k, lambda) {
  // 正規方程式 (A^T A + lambda I) w = A^T y，高斯消去
  const M = Array.from({ length: k }, () => new Float64Array(k + 1));
  return { M, add(x, t) { for (let i = 0; i < k; i++) { const xi = x[i]; if (!xi) continue; for (let j = 0; j < k; j++) M[i][j] += xi * x[j]; M[i][k] += xi * t; } },
    finish() {
      for (let i = 1; i < k; i++) M[i][i] += lambda * (M[i][i] || 1); // 不懲罰 bias
      for (let i = 0; i < k; i++) {
        let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        [M[i], M[p]] = [M[p], M[i]];
        const d = M[i][i] || 1e-9;
        for (let r = 0; r < k; r++) { if (r === i) continue; const f = M[r][i] / d; if (!f) continue; for (let c = i; c <= k; c++) M[r][c] -= f * M[i][c]; }
      }
      return M.map((row, i) => row[k] / (row[i] || 1e-9));
    } };
}

const groups = [];
for (let g = 0; g < 2 * NPHASE; g++) groups.push(solve(null, null, K, 1e-6));
for (const r of R) groups[r[K] + (r[K + 1] === 0 ? 0 : NPHASE)].add(r, r[K + 2]);
const W = groups.map(g => g.finish());

// 殘差與 scale
const stat = Array.from({ length: NPHASE }, () => ({ n: 0, se: 0 }));
const preds = [];
for (const r of R) {
  const ph = r[K], col = r[K + 1], t = r[K + 2];
  const w = W[ph + (col === 0 ? 0 : NPHASE)];
  let p = 0; for (let j = 0; j < K; j++) p += w[j] * r[j];
  stat[ph].n++; stat[ph].se += (p - t) ** 2;
  preds.push(p, t, ph);
}
const scale = [];
const overall = { n: 0, se: 0 };
for (let ph = 0; ph < NPHASE; ph++) {
  let bestS = 4, bestL = Infinity;
  for (let s = 0.5; s <= 30; s *= 1.06) {
    let L = 0, c = 0;
    for (let i = 0; i < preds.length; i += 3) {
      if (preds[i + 2] !== ph) continue;
      const q = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(-preds[i] / s))));
      L -= preds[i + 1] > 0 ? Math.log(q) : Math.log(1 - q); c++;
    }
    L /= c || 1;
    if (L < bestL) { bestL = L; bestS = s; }
  }
  scale.push(+bestS.toFixed(3));
  overall.n += stat[ph].n; overall.se += stat[ph].se;
  console.log(`phase ${ph}: n ${stat[ph].n} rmse ${Math.sqrt(stat[ph].se / stat[ph].n).toFixed(2)} scale ${bestS.toFixed(2)} logloss ${bestL.toFixed(4)}`);
}
console.log("overall rmse", Math.sqrt(overall.se / overall.n).toFixed(3));
for (let g = 0; g < 2 * NPHASE; g++) {
  console.log(`group ${g}`, FEATURE_NAMES.map((nm, i) => `${nm}:${W[g][i].toFixed(2)}`).join(" "), "|", FEATURE_NAMES.map((nm, i) => `${nm}:${W[g][NF + i].toFixed(2)}`).join(" "));
}
if (write) {
  const arr = W.map(w => w.map(x => +x.toFixed(5)));
  const js = `/** 由 whowins/tests/train-eval.js 自我對戰迴歸產生（見該檔說明）。 */\nexport const WEIGHTS = Object.assign(${JSON.stringify(arr)}, ${JSON.stringify({ scale })});\n`;
  fs.writeFileSync(new URL("../src/engine/weights.js", import.meta.url), js);
  console.log("wrote weights.js");
}
