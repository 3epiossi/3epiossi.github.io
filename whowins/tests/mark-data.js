/**
 * 走法評價校準的資料：CPU 互下（雙方各抽 3~6 級），每個局面用教練強度（固定 3 層、每一步都算精確勝率）分析，
 * 存下每一手：下之前的局面分析（同一個點數下每個走法的引擎勝率）、下完之後對手六個點數的最佳勝率。
 * 用法：node whowins/tests/mark-data.js [--games 120] [--depth 3] [--threads 8] [--out results/mark-data.json]
 * 再用 mark-freq.js 套用門檻、算每 100 步各種評價出現幾次。
 */
import fs from "node:fs";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { Position, mvTo } from "../src/engine/core.js";
import { Searcher } from "../src/engine/search.js";
import { playGame, levelAgent, makeRng } from "./lib.js";

const r4 = (x) => Math.round(x * 1e4) / 1e4;

function work({ games, depth, seed }) {
  const rng = makeRng(seed * 31 + 7);
  const an = new Searcher();
  const out = [];
  for (let g = 0; g < games; g++) {
    const lv = () => 3 + Math.floor(rng() * 4);
    const res = playGame({ black: levelAgent(lv(), { rng }), white: levelAgent(lv(), { rng }), diceSeed: seed * 100003 + g, record: true });
    const pos = new Position();
    const A = [];
    const snaps = [];
    for (const m of res.moves) {
      pos.turn = m.side; pos.free = m.free;
      const r = an.analyze(pos, { maxDepth: depth, fixedDepth: true, allMoves: true });
      snaps.push({ n: pos.count(1) + pos.count(2), turn: m.side });
      A.push(r);
      if (m.move >= 0) pos.makeMove(m.move, m.side);
    }
    for (let i = 0; i < res.moves.length; i++) {
      const m = res.moves[i], a = A[i], next = A[i + 1] || null;
      const dice = m.free ? [1, 2, 3, 4, 5, 6] : [m.die];
      const moves = [];
      for (const d of dice) for (const x of a.perDie[d - 1]?.moves || []) moves.push([x.move, mvTo(x.move), r4(x.value)]);
      out.push({
        n: snaps[i].n, die: m.die, free: m.free, played: m.move, value: r4(a.value), moves,
        passBest: m.move < 0 ? r4(a.perDie[m.die - 1]?.value ?? a.value) : null,
        nextBest: next && next.mode === "roll" ? next.perDie.map((pd) => (pd ? r4(pd.value) : null)) : null
      });
    }
  }
  return out;
}

if (isMainThread) {
  const a = { games: 120, depth: 3, threads: 8, out: "results/mark-data.json" };
  for (let i = 2; i < process.argv.length; i += 2) { const k = process.argv[i].replace(/^--/, ""); a[k] = k === "out" ? process.argv[i + 1] : Number(process.argv[i + 1]); }
  const per = Math.ceil(a.games / a.threads);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: a.threads }, (_, i) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { games: per, depth: a.depth, seed: 80 + i } });
    w.on("message", res); w.on("error", rej);
  })));
  const all = parts.flat();
  fs.writeFileSync(a.out, JSON.stringify({ games: per * a.threads, depth: a.depth, plies: all.length, data: all }));
  console.log(`games ${per * a.threads}, plies ${all.length}, ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${a.out}`);
} else {
  parentPort.postMessage(work(workerData));
}
