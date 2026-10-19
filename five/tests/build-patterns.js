/**
 * 把訓練好的棋型分數表（train-patterns.js 的 Float32 輸出）轉成網頁用的 src/ai/pattern-weights.js：
 *   每個分數量化成 8 位元整數（單位 1/8 顆棋子，±15.9 顆），連續的 0（大部分棋型組合沒出現過）只記長度，
 *   再用 base64 包成字串（GitHub Pages 會 gzip 壓縮 JS）。
 *
 *   node five/tests/build-patterns.js five/tests/results/patterns-c.bin
 */
import fs from "fs";
import { STAGES, STAGE_SIZE, W_BIAS, W_MOB } from "../src/ai/patterns.js";

const src = process.argv[2];
const buf = fs.readFileSync(src);
const w = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
// 每個階段的「常數」與「行動力」權重只有 16 個數、數值也比較大（行動力 0.6～3），另外存精確的小數，不跟棋型表一起量化
const extra = [];
for (let s = 0; s < STAGES; s++) extra.push(+w[s * STAGE_SIZE + W_BIAS].toFixed(4), +w[s * STAGE_SIZE + W_MOB].toFixed(4));
const table = Float32Array.from(w);
for (let s = 0; s < STAGES; s++) { table[s * STAGE_SIZE + W_BIAS] = 0; table[s * STAGE_SIZE + W_MOB] = 0; }
const bytes = [];
let clip = 0;
for (let i = 0; i < table.length;) {
  let v = Math.round(table[i] * 8);
  if (v === 0) {
    // 一串 0：0x80 再接長度（每 7 位元一組，最高位元 = 後面還有）
    let run = 0;
    while (i < table.length && Math.round(table[i] * 8) === 0) { run++; i++; }
    bytes.push(0x80);
    while (run >= 0x80) { bytes.push((run & 0x7f) | 0x80); run >>>= 7; }
    bytes.push(run);
    continue;
  }
  if (v > 127) { v = 127; clip++; } else if (v < -127) { v = -127; clip++; }
  bytes.push(v & 0xff);
  i++;
}
const b64 = Buffer.from(bytes).toString("base64");
const out = `/**
 * 黑白棋棋型評估的分數表（v14 用；tests/train-patterns.js 用 Edax 的評估訓練、tests/build-patterns.js 產生，不要手改）。
 * 棋型表 ${w.length} 個分數，量化成 8 位元整數（單位 1/8 顆棋子）；連續的 0 壓縮過。decodePatternWeights() 還原成 Int8Array
 * （比 Float32Array 小 4 倍，手機的快取放得下，搜尋比較快）。每個階段的常數與行動力權重另外存在 PATTERN_EXTRA（精確的小數，單位是顆棋子）。
 */
const DATA = "${b64}";

/** 每個階段兩個數：[常數, 行動力權重, …]（棋子差） */
export const PATTERN_EXTRA = ${JSON.stringify(extra)};

export function decodePatternWeights() {
  const bin = typeof atob === "function" ? atob(DATA) : Buffer.from(DATA, "base64").toString("latin1");
  const w = new Int8Array(${w.length});
  let i = 0;
  for (let p = 0; p < bin.length;) {
    const b = bin.charCodeAt(p++);
    if (b === 0x80) {
      let run = 0, shift = 0, x;
      do { x = bin.charCodeAt(p++); run += (x & 0x7f) * 2 ** shift; shift += 7; } while (x & 0x80);
      i += run;
    } else {
      w[i++] = b > 127 ? b - 256 : b;
    }
  }
  return w;
}
`;
fs.writeFileSync(new URL("../src/ai/pattern-weights.js", import.meta.url), out);
console.log(`${w.length} 個分數 → ${bytes.length} 位元組（base64 ${b64.length} 字），超出範圍 ${clip} 個`);
