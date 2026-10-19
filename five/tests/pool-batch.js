/**
 * 池子大小實驗的批次執行：把每組設定拆成幾段（不同種子）平行跑 pool-size.js，結果寫成 JSONL。
 *
 *   node five/tests/pool-batch.js --plan main --out /tmp/pool.jsonl --jobs 8
 *
 * plan：
 *   main     v8 4 層自我對戰，共用池子，N = 1～8，各 400 局
 *   novice   只會抓五連的初學者自我對戰，N = 1～8，各 4000 局
 *   strong   v8 6 層自我對戰，N = 1～8，各 120 局
 *   gap      v8 4 層 對 v8 2 層（實力差），N = 1～8，各 300 局
 *   private  v8 4 層自我對戰，各自一手 N 顆，N = 1～8，各 300 局
 * 懂池子的搜尋（deep: false 版本，見 pool-size.js；--ns 3,4,5,6 可限定 N）：
 *   mainP    懂池子的 v8 4 層自我對戰，共用池子，各 400 局
 *   strongP  懂池子的 v8 6 層自我對戰，共用池子，各 120 局
 *   privateP 懂池子的 v8 4 層自我對戰，各自一手，各 300 局
 *   duelP    懂池子的 v8 4 層（A）對 不懂池子的 v8 4 層，共用池子，各 300 局
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const JOBS = Number(args.jobs || 8);
const OUT = args.out || "/tmp/pool.jsonl";
const here = path.dirname(fileURLToPath(import.meta.url));

const V = (d) => JSON.stringify({ kind: "v8", depth: d });
const VP = (d) => JSON.stringify({ kind: "v8", depth: d, pool: true, deep: false });
const GRAB = JSON.stringify({ kind: "grab" });
const PLANS = {
  main: { a: V(4), b: V(4), mode: "shared", games: 400, chunk: 50 },
  novice: { a: GRAB, b: GRAB, mode: "shared", games: 4000, chunk: 1000 },
  strong: { a: V(6), b: V(6), mode: "shared", games: 120, chunk: 20 },
  gap: { a: V(4), b: V(2), mode: "shared", games: 300, chunk: 50 },
  private: { a: V(4), b: V(4), mode: "private", games: 300, chunk: 50 },
  mainP: { a: VP(4), b: VP(4), mode: "shared", games: 400, chunk: 50 },
  strongP: { a: VP(6), b: VP(6), mode: "shared", games: 120, chunk: 20 },
  privateP: { a: VP(4), b: VP(4), mode: "private", games: 300, chunk: 50 },
  duelP: { a: VP(4), b: V(4), mode: "shared", games: 300, chunk: 50 }
};

const tasks = [];
for (const name of (args.plan || "main").split(",")) {
  const p = PLANS[name];
  const ns = args.ns ? args.ns.split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
  for (const n of ns) {
    for (let s = 0; s * p.chunk < p.games; s++) {
      tasks.push({ plan: name, n, args: ["--n", n, "--a", p.a, "--b", p.b, "--mode", p.mode, "--games", p.chunk, "--seed", 1000 + s * 17 + n] });
    }
  }
}
// 慢的（N 大）先跑，平行度比較好
tasks.sort((x, y) => y.n - x.n);

let next = 0, done = 0;
const t0 = Date.now();
function run() {
  if (next >= tasks.length) return;
  const t = tasks[next++];
  const p = spawn(process.execPath, [path.join(here, "pool-size.js"), ...t.args.map(String)]);
  let buf = "";
  p.stdout.on("data", (d) => { buf += d; });
  p.on("close", () => {
    const line = buf.trim().split("\n").pop();
    try {
      const r = JSON.parse(line);
      fs.appendFileSync(OUT, JSON.stringify({ plan: t.plan, ...r }) + "\n");
    } catch (e) {
      console.error("失敗：", t.plan, t.n, buf.slice(-300));
    }
    done++;
    if (done % 8 === 0 || done === tasks.length) console.log(`${done}/${tasks.length}　${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
    run();
  });
}
for (let i = 0; i < JOBS; i++) run();
