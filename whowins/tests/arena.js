/**
 * 成對對戰：node whowins/tests/arena.js --a new:d2 --b old:v5 --pairs 100 [--threads 8] [--seed 1] [--komi 3.5]
 * 代理人規格：
 *   rand                隨機合法步
 *   old:v1..v5          舊引擎
 *   new:dN              新引擎固定 N 層；可加 :epsX（隨機失誤率）、:exactN 保留給之後；
 *   new:tMS             新引擎按時間（毫秒），迭代加深（最多 12 層）
 * 每一對 = 同一串骰子，A 執黑一次、執白一次；輸出 A 的勝率與 95% 信賴區間。
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { playGame, pairedMatch, searchAgent, randomAgent, makeRng } from "./lib.js";
import { oldAgent } from "./v5-agent.js";

export function makeAgentFactory(spec, rng) {
  const p = spec.split(":");
  if (p[0] === "rand") return () => randomAgent(rng);
  if (p[0] === "old") return () => oldAgent(p[1] || "v5");
  const opts = { rng };
  let sharedSearcher = null;
  for (const t of p.slice(1)) {
    if (t[0] === "d") { opts.depth = Number(t.slice(1)); opts.fixedDepth = true; }
    else if (t[0] === "t") { opts.depth = 12; opts.timeMs = Number(t.slice(1)); opts.fixedDepth = false; }
    else if (t.startsWith("eps")) opts.eps = Number(t.slice(3));
  }
  return () => searchAgent(opts);
}

function work({ a, b, from, to, komi, seed }) {
  const rng = makeRng(seed);
  const fa = makeAgentFactory(a, rng), fb = makeAgentFactory(b, rng);
  let wins = 0, games = 0;
  for (let i = from; i < to; i++) {
    wins += pairedMatch(fa, fb, 1000003 * seed + i, komi);
    games += 2;
  }
  return { wins, games };
}

if (isMainThread) {
  const args = { a: "new:d2", b: "rand", pairs: 50, threads: 8, seed: 1, komi: 3.5 };
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = ["a", "b"].includes(k) ? process.argv[i + 1] : Number(process.argv[i + 1]);
  }
  const t0 = Date.now();
  const per = Math.ceil(args.pairs / args.threads);
  const jobs = [];
  for (let t = 0; t < args.threads; t++) {
    const from = t * per, to = Math.min(args.pairs, from + per);
    if (from >= to) continue;
    jobs.push(new Promise((res, rej) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { a: args.a, b: args.b, from, to, komi: args.komi, seed: args.seed * 31 + t } });
      w.on("message", res); w.on("error", rej);
    }));
  }
  const rs = await Promise.all(jobs);
  const wins = rs.reduce((s, r) => s + r.wins, 0), games = rs.reduce((s, r) => s + r.games, 0);
  const p = wins / games, ci = 1.96 * Math.sqrt(p * (1 - p) / games);
  console.log(`${args.a} vs ${args.b}: ${wins}/${games} = ${(p * 100).toFixed(1)}% +-${(ci * 100).toFixed(1)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
} else {
  parentPort.postMessage(work(workerData));
}
