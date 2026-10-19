/** edax-arena.js 的結果整理：node five/tests/edax-report.js five/tests/results/edax-base-*.jsonl */
import fs from "fs";
const L = process.argv.slice(2).flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const c = (f) => L.filter(f).length;
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(0)}%` : "-");
console.log(`共 ${L.length} 局：CPU 勝 ${c((x) => x.winner === "cpu")}（五連 ${c((x) => x.winner === "cpu" && x.byFive)}、比子數 ${c((x) => x.winner === "cpu" && !x.byFive)}）、對手勝 ${c((x) => x.winner === "opp")}（五連 ${c((x) => x.winner === "opp" && x.byFive)}）、和 ${c((x) => x.winner === "draw")}`);
const nf = L.filter((x) => !x.byFive);
console.log(`沒有五連的局 ${nf.length}：CPU 勝 ${c((x) => !x.byFive && x.winner === "cpu")}（${pct(c((x) => !x.byFive && x.winner === "cpu"), nf.length)}）、平均比數 CPU ${(nf.reduce((a, x) => a + x.cpuDiscs, 0) / nf.length).toFixed(1)} : ${(nf.reduce((a, x) => a + x.oppDiscs, 0) / nf.length).toFixed(1)}`);
const de = L.filter((x) => x.deadEval != null);
console.log(`連線威脅消失：平均第 ${(de.reduce((a, x) => a + x.deadAt, 0) / de.length).toFixed(1)} 手，那時 Edax 評估 CPU 平均 ${(de.reduce((a, x) => a + x.deadEval, 0) / de.length).toFixed(1)}，CPU 領先（>0）的局 ${c((x) => x.deadEval > 0)}／${de.length}，其中最後 CPU 贏 ${c((x) => x.deadEval > 0 && x.winner === "cpu")}`);
const loss = (k, f) => { const a = L.flatMap((x) => x[k]).filter(f); return `${(a.reduce((s, y) => s + y[1], 0) / Math.max(1, a.length)).toFixed(2)}（${a.length} 手）`; };
console.log(`CPU 每手平均損失（Edax 棋子數）：連線還活著 ${loss("cpuLoss", (y) => y[2])}、連線已死 ${loss("cpuLoss", (y) => !y[2])}`);
const dep = (f) => { const a = L.flatMap((x) => x.cpuLoss).filter((y) => y[3] != null && f(y)); return a.length ? (a.reduce((s, y) => s + y[3], 0) / a.length).toFixed(1) : "-"; };
for (const [lo, hi] of [[40, 61], [30, 40], [20, 30], [14, 20], [0, 14]]) console.log(`  空格 ${lo}～${hi - 1}：${loss("cpuLoss", (y) => y[0] >= lo && y[0] < hi)}，平均深度 ${dep((y) => y[0] >= lo && y[0] < hi)}`);
console.log(`對手每手平均損失 ${loss("oppLoss", () => true)}；被迫下危險步 ${L.reduce((a, x) => a + x.forced, 0)} 次`);
