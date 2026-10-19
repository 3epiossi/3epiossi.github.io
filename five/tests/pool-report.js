/**
 * 彙整 pool-batch.js 的結果：同一組設定、同一個 N 的各段合併成一列。
 *
 *   node five/tests/pool-report.js /tmp/pool.jsonl            # 表格
 *   node five/tests/pool-report.js /tmp/pool.jsonl --json     # 合併後的 JSON
 */
import fs from "fs";

const file = process.argv[2] || "/tmp/pool.jsonl";
const asJson = process.argv.includes("--json");
const rows = fs.readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l));

const groups = new Map();
for (const r of rows) {
  const k = `${r.plan}|${r.n}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const merged = [];
for (const [k, list] of groups) {
  const [plan, n] = k.split("|");
  const G = list.reduce((s, r) => s + r.games, 0);
  const w = (f) => list.reduce((s, r) => s + f(r) * r.games, 0) / G;
  const fiveGames = list.reduce((s, r) => s + r.fiveRate * r.games, 0);
  const scoreGames = G - fiveGames;
  const fivePly = fiveGames ? list.reduce((s, r) => s + (r.avgFivePly || 0) * r.fiveRate * r.games, 0) / fiveGames : null;
  const margin = scoreGames ? list.reduce((s, r) => s + (r.avgMargin || 0) * (1 - r.fiveRate) * r.games, 0) / scoreGames : null;
  const hist = {};
  for (const r of list) for (const [b, c] of Object.entries(r.fivePlyHist)) hist[b] = (hist[b] || 0) + c;
  const fiveRate = fiveGames / G;
  merged.push({
    plan, n: Number(n), games: G,
    fiveRate, fiveCI: 1.96 * Math.sqrt(fiveRate * (1 - fiveRate) / G),
    fiveByBlack: w(r => r.fiveByBlack), fiveByA: w(r => r.fiveByA),
    blackWin: w(r => r.blackWin), whiteWin: w(r => r.whiteWin), draw: w(r => r.draw), aWin: w(r => r.aWin),
    avgPly: w(r => r.avgPly), avgFivePly: fivePly, avgMargin: margin, avgPasses: w(r => r.avgPasses),
    fivePlyHist: hist, msPerGame: list.reduce((s, r) => s + r.ms, 0) / G
  });
}
merged.sort((a, b) => (a.plan < b.plan ? -1 : a.plan > b.plan ? 1 : a.n - b.n));

if (asJson) { console.log(JSON.stringify(merged, null, 1)); process.exit(0); }

const pct = (x) => (x == null ? "  -  " : `${(100 * x).toFixed(1).padStart(5)}%`);
const num = (x, d = 1) => (x == null ? "  -  " : x.toFixed(d).padStart(5));
let plan = null;
for (const m of merged) {
  if (m.plan !== plan) {
    plan = m.plan;
    console.log(`\n=== ${plan} ===`);
    console.log("  N   局數   五連結束(±95%)  黑成五  黑勝    白勝    和局    A勝率   手數   成五手數  比子數分差  每局ms");
  }
  console.log(`  ${m.n}  ${String(m.games).padStart(5)}  ${pct(m.fiveRate)} ±${(100 * m.fiveCI).toFixed(1)}%   ${pct(m.fiveByBlack)} ${pct(m.blackWin)} ${pct(m.whiteWin)} ${pct(m.draw)} ${pct(m.aWin)}  ${num(m.avgPly)}  ${num(m.avgFivePly)}     ${num(m.avgMargin)}     ${num(m.msPerGame, 0)}`);
}
