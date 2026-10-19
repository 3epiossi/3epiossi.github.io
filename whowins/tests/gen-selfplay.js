/**
 * 自我對戰產生評估訓練資料。用法：
 *   node whowins/tests/gen-selfplay.js --games 2000 --depth 2 --eps 0.15 --out /path/data.f32 [--threads 8] [--seed 1]
 * 每個機率節點（擲骰前、非自選）記錄一筆局面（棋盤）與終局淨勝分(mover 角度)；特徵在訓練時才抽取，改特徵不必重跑。
 * eps 是每步隨機走的機率上限（每盤在 0~eps 抽一個），增加局面多樣性。
 */
import fs from "node:fs";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { BLACK } from "../src/engine/core.js";
import { playGame, searchAgent, makeRng } from "./lib.js";

// 每筆 20 位元組：黑 8 列、白 8 列、mover 顏色(0 黑 1 白)、(保留)、終局淨勝分(mover 角度, int16 x2)
const STRIDE = 20;

function parseArgs() {
  const a = { games: 1000, depth: 2, eps: 0.15, out: "selfplay.f32", threads: 8, seed: 1 };
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i].replace(/^--/, "");
    a[k] = k === "out" ? process.argv[i + 1] : Number(process.argv[i + 1]);
  }
  return a;
}

function work({ games, depth, eps, seed }) {
  const rng = makeRng(seed * 7919 + 13);
  const chunks = [];
  for (let g = 0; g < games; g++) {
    const e = rng() * eps;
    const rows = [];
    const mk = () => searchAgent({ depth, fixedDepth: true, eps: e, rng });
    const res = playGame({
      black: mk(), white: mk(), diceSeed: seed * 100003 + g,
      onSample: (pos, mover) => {
        const row = new Uint8Array(STRIDE);
        row.set(pos.b, 0); row.set(pos.w, 8); row[16] = mover === BLACK ? 0 : 1;
        rows.push(row);
      }
    });
    for (const row of rows) {
      const t = Math.round((row[16] === 0 ? res.diff : -res.diff) * 2); // 半格精度
      row[18] = t & 255; row[19] = (t >> 8) & 255;
      chunks.push(row);
    }
  }
  const out = new Uint8Array(chunks.length * STRIDE);
  chunks.forEach((r, i) => out.set(r, i * STRIDE));
  return out;
}

if (isMainThread) {
  const a = parseArgs();
  const per = Math.ceil(a.games / a.threads);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: a.threads }, (_, i) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { games: per, depth: a.depth, eps: a.eps, seed: a.seed * 1000 + i } });
    w.on("message", res); w.on("error", rej);
  })));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.length; }
  fs.writeFileSync(a.out, all);
  console.log(`games ${per * a.threads}, samples ${total / STRIDE}, ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${a.out}`);
} else {
  parentPort.postMessage(work(workerData));
}
