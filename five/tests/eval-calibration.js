/**
 * 勝率條的校準資料：自我對戰，每個局面用「和網頁局面分析一樣的搜尋」算出最佳分數，
 * 記下（剩幾格、分數、下棋者最後有沒有贏），之後擬合「分數 → 實際勝率」。
 *
 * v8 的分數是 tanh(評估值 ÷ 係數)，中盤很保守（幾乎都在 0 附近），直接當勝率會一直停在 50% 左右。
 *
 *   node five/tests/eval-calibration.js gen --games 40 --seed 1 --out /tmp/cal1.jsonl
 *   node five/tests/eval-calibration.js fit /tmp/cal*.jsonl
 *
 * gen 的雙方是 6 級（4 層搜尋）加一點隨機（前 8 手 30% 隨機），讓局面多樣；分析用 searchPoolV8 每顆 125 ms。
 */
import fs from "fs";
import { GameEngine } from "../src/core/game-engine.js";
import { searchPoolV8 } from "../src/ai/v8.js";
import { searchLevel, LEVELS } from "../src/ai/levels.js";
import { mulberry32 } from "./helpers.js";

const [mode, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));

if (mode === "gen") {
  const GAMES = Number(args.games || 40), SEED = Number(args.seed || 1), OUT = args.out || "/tmp/cal.jsonl";
  const player = LEVELS[5]; // 6 級：4 層搜尋
  for (let g = 0; g < GAMES; g++) {
    const e = new GameEngine({ rng: mulberry32(SEED * 1000 + g) });
    const rng = mulberry32(SEED * 7777 + g);
    const rows = [];
    let ply = 0;
    while (!e.gameOver) {
      if (!e.legalMoves().length) { e.passTurn(); continue; }
      const a = searchPoolV8(e.board, e.currentTurn, e.pool, { timeMs: 500, multiPV: true });
      const empties = e.board.flat().filter(x => !x).length;
      rows.push({ empties, s: a.scores[0].score, mover: e.currentTurn });
      const r = ply < 8 && rng() < 0.3
        ? searchLevel(e.board, e.currentTurn, e.pool, { depth: 1, eps: 1 }, { rng })
        : searchLevel(e.board, e.currentTurn, e.pool, player, { rng });
      e.executeMove(r.bestSq >> 3, r.bestSq & 7, r.disc);
      ply++;
    }
    const w = e.settlementData.winner;
    const lines = rows.map(x => JSON.stringify({ empties: x.empties, s: +x.s.toFixed(5), y: w === 0 ? 0.5 : w === x.mover ? 1 : 0 }));
    fs.appendFileSync(OUT, lines.join("\n") + "\n");
  }
} else if (mode === "fit") {
  const data = rest.filter(f => !f.startsWith("--")).flatMap(f => fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)));
  // 已確定勝負的分數（±1）不參與擬合
  const live = data.filter(d => Math.abs(d.s) < 0.999);
  // 依剩餘空格分段，每段擬合 P(贏) = sigmoid(k × atanh(s))（atanh 把 tanh 還原成評估值的比例）
  const BUCKETS = [[46, 60], [36, 45], [26, 35], [16, 25], [8, 15], [0, 7]];
  const x = (s) => Math.atanh(Math.max(-0.999, Math.min(0.999, s)));
  const sig = (z) => 1 / (1 + Math.exp(-z));
  console.log(`局面 ${data.length}（已確定勝負的 ${data.length - live.length} 個不計）`);
  const fits = [];
  for (const [lo, hi] of BUCKETS) {
    const pts = live.filter(d => d.empties >= lo && d.empties <= hi);
    if (pts.length < 50) continue;
    // 一維 logistic regression（無截距：分數 0 = 50%），牛頓法
    let k = 1;
    for (let it = 0; it < 50; it++) {
      let g = 0, h = 0;
      for (const d of pts) { const xi = x(d.s), p = sig(k * xi); g += (d.y - p) * xi; h += p * (1 - p) * xi * xi; }
      if (h <= 0) break;
      k += g / h;
    }
    // 校準前後的 log loss 與「預測勝率」的平均偏離 50% 的程度
    let llRaw = 0, llCal = 0, spreadRaw = 0, spreadCal = 0;
    for (const d of pts) {
      const pr = (Math.max(-0.999, Math.min(0.999, d.s)) + 1) / 2, pc = sig(k * x(d.s));
      llRaw -= d.y * Math.log(pr) + (1 - d.y) * Math.log(1 - pr);
      llCal -= d.y * Math.log(pc) + (1 - d.y) * Math.log(1 - pc);
      spreadRaw += Math.abs(pr - 0.5); spreadCal += Math.abs(pc - 0.5);
    }
    const n = pts.length;
    fits.push({ lo, hi, k });
    console.log(`剩 ${lo}～${hi} 格：${n} 個局面　k = ${k.toFixed(2)}　log loss ${(llRaw / n).toFixed(3)} → ${(llCal / n).toFixed(3)}　平均偏離 50%：${(100 * spreadRaw / n).toFixed(1)}% → ${(100 * spreadCal / n).toFixed(1)}%`);
  }
  // 校準後的可靠度：分成 10 格，看預測勝率與實際勝率
  const kOf = (e) => (fits.find(f => e >= f.lo && e <= f.hi) || fits[fits.length - 1]).k;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const d of live) {
    const p = sig(kOf(d.empties) * x(d.s));
    const b = bins[Math.min(9, Math.floor(p * 10))];
    b.n++; b.p += p; b.y += d.y;
  }
  console.log("\n校準後：預測勝率 → 實際勝率（局面數）");
  for (const b of bins) if (b.n) console.log(`  ${(100 * b.p / b.n).toFixed(0).padStart(3)}% → ${(100 * b.y / b.n).toFixed(0).padStart(3)}%（${b.n}）`);
  console.log("\nCAL =", JSON.stringify(fits.map(f => ({ lo: f.lo, hi: f.hi, k: +f.k.toFixed(3) }))));
}
