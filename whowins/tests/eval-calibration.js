/**
 * 勝率條校準：自我對戰（雙方各抽「1 層帶 15% 失誤、2 層、3 層」其中一種，固定層數，結果不受電腦快慢影響），每個擲骰前的局面用教練強度（固定 3 層）分析，
 * 記錄「輪到的一方的引擎勝率」與「這一方最後有沒有贏」，再依盤上棋子數分段擬合 顯示勝率 = sigmoid(k * logit(引擎勝率))
 * （最小化 log loss）。用法：node whowins/tests/eval-calibration.js [--games 300] [--depth 3] [--threads 8] [--out results/eval-calib.json]
 * 結果寫進 src/ui/eval-bar.js 的 CAL 與 CAL_NOTE。
 */
import fs from "node:fs";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { BLACK } from "../src/engine/core.js";
import { Searcher } from "../src/engine/search.js";
import { playGame, levelAgent, makeRng, opp } from "./lib.js";

function work({ games, depth, seed }) {
  const rng = makeRng(seed * 977 + 5);
  const an = new Searcher();
  const out = [];
  for (let g = 0; g < games; g++) {
    const cfgs = [{ depth: 1, eps: 0.15 }, { depth: 2 }, { depth: 2 }, { depth: 3 }];
    const mk = () => levelAgent(cfgs[Math.floor(rng() * cfgs.length)], { rng });
    const rows = [];
    const res = playGame({
      black: mk(), white: mk(), diceSeed: seed * 100003 + g,
      onSample: (pos, mover) => {
        const r = an.analyze(pos, { maxDepth: depth, fixedDepth: true });
        rows.push([r.value, pos.count(1) + pos.count(2), mover]);
      }
    });
    for (const [v, n, mover] of rows) out.push([Math.round(v * 1e4) / 1e4, n, (mover === BLACK ? res.winner === BLACK : res.winner !== BLACK) ? 1 : 0]);
  }
  return out;
}

function fitK(samples) {
  let bestK = 1, bestL = Infinity;
  for (let k = 0.3; k <= 6; k *= 1.02) {
    let L = 0;
    for (const [p, , w] of samples) {
      const lg = Math.log(Math.min(0.9995, Math.max(0.0005, p)) / (1 - Math.min(0.9995, Math.max(0.0005, p))));
      const q = Math.min(1 - 1e-6, Math.max(1e-6, 1 / (1 + Math.exp(-k * lg))));
      L -= w ? Math.log(q) : Math.log(1 - q);
    }
    L /= samples.length;
    if (L < bestL) { bestL = L; bestK = k; }
  }
  return { k: bestK, loss: bestL };
}

if (isMainThread) {
  const a = { games: 300, depth: 3, threads: 8, out: "results/eval-calib.json" };
  for (let i = 2; i < process.argv.length; i += 2) { const k = process.argv[i].replace(/^--/, ""); a[k] = k === "out" ? process.argv[i + 1] : Number(process.argv[i + 1]); }
  const per = Math.ceil(a.games / a.threads);
  const parts = await Promise.all(Array.from({ length: a.threads }, (_, i) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { games: per, depth: a.depth, seed: 50 + i } });
    w.on("message", res); w.on("error", rej);
  })));
  const all = parts.flat();
  const edges = [0, 14, 22, 30, 38, 48, 65];
  const rows = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const s = all.filter(([, n]) => n >= edges[i] && n < edges[i + 1]);
    if (s.length < 200) continue;
    const mid = s.reduce((t, x) => t + x[1], 0) / s.length;
    const { k, loss } = fitK(s);
    const base = fitK(s.map(([p, n, w]) => [p, n, w])).loss;
    // 未校準（k = 1）的 log loss，比較用
    let L1 = 0;
    for (const [p, , w] of s) { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); L1 -= w ? Math.log(q) : Math.log(1 - q); }
    rows.push({ range: `${edges[i]}-${edges[i + 1] - 1}`, n: s.length, mid: +mid.toFixed(1), k: +k.toFixed(2), logloss: +loss.toFixed(4), logloss_k1: +(L1 / s.length).toFixed(4) });
  }
  console.log(`samples ${all.length}`);
  console.table(rows);
  fs.writeFileSync(a.out, JSON.stringify({ games: per * a.threads, depth: a.depth, samples: all.length, rows }, null, 1));
  console.log("CAL =", JSON.stringify(rows.map((r) => [r.mid, r.k])));
} else {
  parentPort.postMessage(work(workerData));
}
