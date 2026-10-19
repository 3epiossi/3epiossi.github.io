/**
 * 難度階梯校準：相鄰兩級成對對戰（同一串骰子、交換黑白），報告上一級的勝率。
 * 用法：node whowins/tests/level-ladder.js [--pairs 100] [--timeMs 1000] [--from 1] [--to 6] [--threads 8]
 * 目標：上一級贏約 80%（±5%）。骰子遊戲運氣成分大，強的幾級可能到不了，照實記在 src/engine/levels.js。
 * 也可傳 --cfgA '{"depth":3}' --cfgB '{"depth":1}' 試任意設定。
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { LEVELS } from "../src/engine/levels.js";
import { pairedMatch, levelAgent, makeRng } from "./lib.js";

function work({ cfgA, cfgB, from, to, seed, timeMs }) {
  const rng = makeRng(seed);
  const A = () => levelAgent(cfgA, { rng, timeMs }), B = () => levelAgent(cfgB, { rng, timeMs });
  let wins = 0, games = 0;
  for (let i = from; i < to; i++) { wins += pairedMatch(A, B, 7000003 + i * 13, 3.5); games += 2; }
  return { wins, games };
}

async function duel(cfgA, cfgB, pairs, threads, timeMs, seed = 1) {
  const per = Math.ceil(pairs / threads);
  const jobs = [];
  for (let t = 0; t < threads; t++) {
    const from = t * per, to = Math.min(pairs, from + per);
    if (from >= to) continue;
    jobs.push(new Promise((res, rej) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { cfgA, cfgB, from, to, seed: seed * 17 + t, timeMs } });
      w.on("message", res); w.on("error", rej);
    }));
  }
  const rs = await Promise.all(jobs);
  const wins = rs.reduce((s, r) => s + r.wins, 0), games = rs.reduce((s, r) => s + r.games, 0);
  const p = wins / games;
  return { wins, games, p, ci: 1.96 * Math.sqrt(p * (1 - p) / games) };
}

if (isMainThread) {
  const a = { pairs: 100, timeMs: 1000, from: 1, to: LEVELS.length, threads: 8, cfgA: null, cfgB: null };
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i].replace(/^--/, "");
    a[k] = k.startsWith("cfg") ? JSON.parse(process.argv[i + 1]) : Number(process.argv[i + 1]);
  }
  if (a.cfgA) {
    const r = await duel(a.cfgA, a.cfgB, a.pairs, a.threads, a.timeMs);
    console.log(`${JSON.stringify(a.cfgA)} vs ${JSON.stringify(a.cfgB)}: ${r.wins}/${r.games} = ${(r.p * 100).toFixed(1)}% +-${(r.ci * 100).toFixed(1)}`);
  } else {
    for (let n = Math.max(2, a.from); n <= a.to; n++) {
      const t0 = Date.now();
      const r = await duel(n, n - 1, a.pairs, a.threads, a.timeMs);
      console.log(`level ${n} vs ${n - 1}: ${r.wins}/${r.games} = ${(r.p * 100).toFixed(1)}% +-${(r.ci * 100).toFixed(1)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
} else {
  parentPort.postMessage(work(workerData));
}
