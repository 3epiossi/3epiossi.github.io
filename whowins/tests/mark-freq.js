/**
 * 走法評價頻率：讀 mark-data.js 的資料，套用 src/engine/move-quality.js 的門檻（可用 --tune '{"blunder":0.4}' 覆寫），
 * 印出每 100 步各種評價出現幾次。五連黑白棋的參考頻率：每 100 步 ?? 約 0.7、! 約 1.2。
 * 用法：node whowins/tests/mark-freq.js [--in results/mark-data.json] [--tune '{...}']
 */
import fs from "node:fs";
import { classifyMove, MARK_TUNE } from "../src/engine/move-quality.js";
import { displayWinProb } from "../src/ui/eval-bar.js";

const a = { in: "results/mark-data.json", tune: "{}" };
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const { data, games } = JSON.parse(fs.readFileSync(a.in, "utf8"));
const tune = { ...MARK_TUNE, ...JSON.parse(a.tune) };
const counts = { "!!": 0, "!": 0, "!?": 0, "?!": 0, "?": 0, "??": 0 };
let n = 0, judged = 0;
for (const r of data) {
  n++;
  if (r.played < 0) continue;
  const toProb = (p) => displayWinProb(p, r.n);
  const res = classifyMove({
    moves: r.moves.map(([key, sq, p]) => ({ key, sq, p })), played: r.played, before: toProb(r.value),
    nextBest: r.nextBest ? r.nextBest.map((p) => (p == null ? null : toProb(p))) : null, toProb, tune
  });
  if (!res) continue;
  judged++;
  if (res.sym) counts[res.sym]++;
}
console.log(`games ${games}, plies ${n} (moves judged ${judged})`);
const per100 = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(100 * v / n).toFixed(2)]));
console.log("per 100 plies:", JSON.stringify(per100));
