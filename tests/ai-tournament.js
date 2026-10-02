/**
 * AI 循環賽：讓 v1~v5 兩兩對戰（含自己對自己），統計勝率、得分差、速度等數據。
 *
 * 用法：
 *   node tests/ai-tournament.js [選項]
 *
 * 選項：
 *   --games N      每個「黑方演算法 × 白方演算法」組合的對局數（預設 10）
 *   --algos a,b,c  參賽演算法（預設 v1,v2,v3,v4,v5）
 *   --komi K       貼目（預設與遊戲相同）
 *   --workers W    平行工作數（預設 CPU 核心數 - 1）
 *   --seed S       隨機種子，相同參數可重現結果（預設 1）
 *   --out PATH     每打完一局就追加一行 JSON 到此檔（中途中斷也不會丟資料）
 *   --resume       搭配 --out：讀取已完成的局數，只補打剩下的
 *
 * 對局流程與實際遊戲一致：每回合擲骰、無合法走法即 PASS、對手享免擲骰自選點數、
 * 一方全滅或雙方不可能互吃時終局，並以規則一、二填滿勢力後計分（含貼目）。
 */

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createInitialBoard, getAllLegalMoves, applyMoveToBoard, canCaptureEver,
  fillTerritoryRule1Rule2, calculateSettlement, opp
} from "../src/core/rules.js";
import { BLACK, WHITE, N, EMPTY, DEFAULT_KOMI } from "../src/core/constants.js";
import { findBestMoveForCPU } from "../src/ai/ai-service.js";
import { clearTranspositionTable } from "../src/ai/evaluator.js";

const MAX_TURNS = 400;
const MAX_CONSECUTIVE_PASSES = 12;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countPieces(board, who) {
  let n = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board[r][c] === who) n++;
  return n;
}

/** 與 app.js 的 CPU 免擲骰特權選點邏輯一致：在 1~6 中挑評分最高的點數 */
function pickFreeDice(board, player, algo) {
  let best = null, bestScore = -Infinity;
  for (let d = 1; d <= 6; d++) {
    const res = findBestMoveForCPU(board, player, d, algo);
    if (res && res.chosen && res.maxScore > bestScore) {
      bestScore = res.maxScore;
      best = d;
    }
  }
  return best;
}

function playGame(blackAlgo, whiteAlgo, komi, seed) {
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    let board = createInitialBoard();
    let turn = BLACK;
    let free = false;
    let turns = 0, passes = 0, consecutivePasses = 0;
    let endReason = "cap";
    const time = { [BLACK]: 0, [WHITE]: 0 };
    const decisions = { [BLACK]: 0, [WHITE]: 0 };
    let endTurn = turn;

    while (turns < MAX_TURNS) {
      const algo = turn === BLACK ? blackAlgo : whiteAlgo;
      const t0 = performance.now();
      const dice = free ? pickFreeDice(board, turn, algo) : Math.floor(Math.random() * 6) + 1;
      const legals = dice == null ? { spawns: [], captures: [] } : getAllLegalMoves(board, turn, dice);
      turns++;

      if (legals.spawns.length === 0 && legals.captures.length === 0) {
        time[turn] += performance.now() - t0;
        passes++;
        consecutivePasses++;
        if (consecutivePasses >= MAX_CONSECUTIVE_PASSES) { endReason = "stalemate"; break; }
        turn = opp(turn);
        free = true;
        if (!canCaptureEver(board)) { endReason = "natural"; endTurn = turn; break; }
        continue;
      }

      const res = findBestMoveForCPU(board, turn, dice, algo);
      time[turn] += performance.now() - t0;
      decisions[turn]++;
      consecutivePasses = 0;
      board = applyMoveToBoard(board, res.chosen, turn);

      if (countPieces(board, opp(turn)) === 0) { endReason = "annihilation"; endTurn = turn; break; }
      turn = opp(turn);
      free = false;
      if (!canCaptureEver(board)) { endReason = "natural"; endTurn = turn; break; }
    }

    const { filledBoard } = fillTerritoryRule1Rule2(board, endReason === "cap" ? turn : endTurn);
    const s = calculateSettlement(filledBoard, komi);
    clearTranspositionTable();
    return {
      winner: s.winner, black: s.bTotal, white: s.wFinal, margin: s.bTotal - s.wFinal,
      turns, passes, endReason,
      msBlack: time[BLACK], msWhite: time[WHITE],
      decBlack: decisions[BLACK], decWhite: decisions[WHITE]
    };
  } finally {
    Math.random = realRandom;
  }
}

if (!isMainThread) {
  parentPort.on("message", (job) => {
    if (job === "exit") process.exit(0);
    const r = playGame(job.black, job.white, workerData.komi, job.seed);
    parentPort.postMessage({ ...r, id: job.id, black: job.black, white: job.white, blackScore: r.black, whiteScore: r.white });
  });
} else {
  main();
}

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { games: 10, algos: ["v1", "v2", "v3", "v4", "v5"], komi: DEFAULT_KOMI, workers: Math.max(1, os.cpus().length - 1), seed: 1, out: null, resume: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i], v = a[i + 1];
    if (k === "--games") { o.games = parseInt(v); i++; }
    else if (k === "--algos") { o.algos = v.split(",").map(s => s.trim()).filter(Boolean); i++; }
    else if (k === "--komi") { o.komi = parseFloat(v); i++; }
    else if (k === "--workers") { o.workers = parseInt(v); i++; }
    else if (k === "--seed") { o.seed = parseInt(v); i++; }
    else if (k === "--out") { o.out = v; i++; }
    else if (k === "--resume") { o.resume = true; }
    else if (k === "-h" || k === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]); process.exit(0); }
  }
  return o;
}

function wilson(wins, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = wins / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

const pct = (x) => (x * 100).toFixed(1).padStart(5) + "%";
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

async function main() {
  const o = parseArgs();
  const { algos, games } = o;
  const jobs = [];
  let id = 0;
  for (const b of algos) for (const w of algos) for (let g = 0; g < games; g++) {
    jobs.push({ id, black: b, white: w, seed: o.seed * 1000003 + id });
    id++;
  }
  const results = [];
  if (o.out && o.resume && fs.existsSync(o.out)) {
    for (const line of fs.readFileSync(o.out, "utf8").split("\n")) {
      if (line.trim()) { try { results.push(JSON.parse(line)); } catch (e) {} }
    }
    const doneIds = new Set(results.map(r => r.id));
    for (let i = jobs.length - 1; i >= 0; i--) if (doneIds.has(jobs[i].id)) jobs.splice(i, 1);
    console.log(`續跑：已有 ${results.length} 局，還需 ${jobs.length} 局`);
  } else if (o.out) {
    fs.writeFileSync(o.out, "");
  }
  const totalJobs = jobs.length + results.length;
  console.log(`\n🏆 AI 循環賽  演算法：${algos.join(" ")}  每組合 ${games} 局  共 ${totalJobs} 局  貼目 ${o.komi}  種子 ${o.seed}  平行 ${o.workers}\n`);

  const t0 = Date.now();
  if (jobs.length === 0) { /* 全部已完成 */ }
  else await new Promise((resolve) => {
    let next = 0, done = 0;
    const pool = [];
    const feed = (w) => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
      else { w.postMessage("exit"); }
    };
    const n = Math.min(o.workers, jobs.length);
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { komi: o.komi } });
      pool.push(w);
      w.on("message", (r) => {
        results.push(r);
        if (o.out) fs.appendFileSync(o.out, JSON.stringify(r) + "\n");
        done++;
        if (done % 10 === 0 || done === jobs.length) {
          const el = (Date.now() - t0) / 1000;
          process.stderr.write(`\r  進度 ${done}/${jobs.length}  已用 ${el.toFixed(0)}s  預估剩餘 ${(el / done * (jobs.length - done)).toFixed(0)}s   `);
        }
        if (done === jobs.length) { process.stderr.write("\n"); resolve(); }
        else feed(w);
      });
      w.on("error", (e) => { console.error(e); process.exit(1); });
      feed(w);
    }
  });
  console.log(`總耗時 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  // ── 彙整 ──
  const score = (r, side) => (r.winner === EMPTY ? 0.5 : (r.winner === side ? 1 : 0));
  const stat = {};
  for (const a of algos) stat[a] = { n: 0, pts: 0, w: 0, l: 0, d: 0, asB: [0, 0], asW: [0, 0], margin: 0, ms: 0, dec: 0 };
  const pair = {};
  for (const a of algos) { pair[a] = {}; for (const b of algos) pair[a][b] = { pts: 0, n: 0 }; }
  const self = {};

  for (const r of results) {
    if (r.black === r.white) {
      const s = self[r.black] || (self[r.black] = { n: 0, b: 0, w: 0, d: 0, margin: 0, turns: 0, passes: 0, end: {} });
      s.n++; s.margin += r.margin; s.turns += r.turns; s.passes += r.passes;
      if (r.winner === BLACK) s.b++; else if (r.winner === WHITE) s.w++; else s.d++;
      s.end[r.endReason] = (s.end[r.endReason] || 0) + 1;
      stat[r.black].ms += r.msBlack + r.msWhite;
      stat[r.black].dec += r.decBlack + r.decWhite;
      continue;
    }
    for (const [algo, side, opp_] of [[r.black, BLACK, r.white], [r.white, WHITE, r.black]]) {
      const s = stat[algo];
      const sc = score(r, side);
      s.n++; s.pts += sc;
      if (sc === 1) s.w++; else if (sc === 0) s.l++; else s.d++;
      (side === BLACK ? s.asB : s.asW)[0] += sc;
      (side === BLACK ? s.asB : s.asW)[1] += 1;
      s.margin += side === BLACK ? r.margin : -r.margin;
      s.ms += side === BLACK ? r.msBlack : r.msWhite;
      s.dec += side === BLACK ? r.decBlack : r.decWhite;
      pair[algo][opp_].pts += sc;
      pair[algo][opp_].n++;
    }
  }

  // 1. 總排名（不含自打）
  console.log("═".repeat(92));
  console.log("【1】總排名（只計對戰「其他演算法」的對局；勝率含平手半分，95% 信賴區間為 Wilson）");
  console.log("═".repeat(92));
  console.log("演算法  勝率    95%區間          勝/負/平      黑方勝率  白方勝率  平均得分差  Elo差   毫秒/步");
  const ranked = [...algos].sort((a, b) => (stat[b].pts / (stat[b].n || 1)) - (stat[a].pts / (stat[a].n || 1)));
  for (const a of ranked) {
    const s = stat[a];
    if (!s.n) continue;
    const p = s.pts / s.n;
    const [lo, hi] = wilson(s.pts, s.n);
    const elo = p <= 0 ? -Infinity : p >= 1 ? Infinity : -400 * Math.log10(1 / p - 1);
    const signed = (x) => (x >= 0 ? "+" : "") + f1(x);
    const eloStr = isFinite(elo) ? (elo >= 0 ? "+" : "") + elo.toFixed(0) : (elo > 0 ? "+∞" : "-∞");
    console.log(
      `${a.padEnd(6)} ${pct(p)}  [${pct(lo)}~${pct(hi)}]  ${`${s.w}/${s.l}/${s.d}`.padEnd(12)}` +
      `${pct(s.asB[1] ? s.asB[0] / s.asB[1] : 0).padStart(8)}  ${pct(s.asW[1] ? s.asW[0] / s.asW[1] : 0).padStart(8)}` +
      `${signed(s.margin / s.n).padStart(11)}  ${eloStr.padStart(5)}  ${(s.dec ? s.ms / s.dec : 0).toFixed(1).padStart(8)}`
    );
  }

  // 2. 對戰矩陣
  console.log("\n" + "═".repeat(92));
  console.log("【2】兩兩對戰矩陣：列 vs 欄 的勝率（黑白兩種執色合併計算；* = 勝率與 50% 差異顯著）");
  console.log("═".repeat(92));
  console.log("        " + algos.map(a => a.padStart(8)).join(""));
  for (const a of algos) {
    let line = a.padEnd(8);
    for (const b of algos) {
      if (a === b) { line += "     ——  "; continue; }
      const c = pair[a][b];
      const [lo, hi] = wilson(c.pts, c.n);
      const sig = lo > 0.5 || hi < 0.5 ? "*" : " ";
      line += (pct(c.pts / c.n).trim() + sig).padStart(8) + " ";
    }
    console.log(line);
  }

  // 3. 黑白分色（含自打）
  console.log("\n" + "═".repeat(92));
  console.log("【3】自己打自己：先手（黑）與貼目是否平衡？（黑方勝率偏離 50% 代表先手/貼目有偏差）");
  console.log("═".repeat(92));
  console.log("演算法  局數  黑勝  白勝  平   黑方勝率   平均黑減白  平均手數  PASS/局  終局原因");
  for (const a of algos) {
    const s = self[a];
    if (!s) continue;
    const ends = Object.entries(s.end).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`${a.padEnd(6)}  ${String(s.n).padStart(3)}  ${String(s.b).padStart(4)}  ${String(s.w).padStart(4)}  ${String(s.d).padStart(2)}  ${pct((s.b + s.d / 2) / s.n)}   ${((s.margin / s.n >= 0 ? "+" : "") + f1(s.margin / s.n)).padStart(7)}    ${f1(s.turns / s.n).padStart(6)}   ${f1(s.passes / s.n).padStart(5)}   ${ends}`);
  }

  // 4. 全對局合計
  const all = results;
  const bw = all.filter(r => r.winner === BLACK).length, ww = all.filter(r => r.winner === WHITE).length;
  console.log("\n" + "═".repeat(92));
  console.log("【4】全部對局合計");
  console.log("═".repeat(92));
  console.log(`總局數 ${all.length}  黑勝 ${bw} (${pct(bw / all.length).trim()})  白勝 ${ww} (${pct(ww / all.length).trim()})  平 ${all.length - bw - ww}`);
  console.log(`平均手數 ${f1(all.reduce((s, r) => s + r.turns, 0) / all.length)}  平均 PASS ${f1(all.reduce((s, r) => s + r.passes, 0) / all.length)}`);
  const ends = {};
  for (const r of all) ends[r.endReason] = (ends[r.endReason] || 0) + 1;
  console.log("終局原因：" + Object.entries(ends).map(([k, v]) => `${k} ${v}`).join("  "));
  console.log("（natural＝雙方不可能互吃；annihilation＝一方全滅；cap/stalemate＝觸發保護上限，應該很少）\n");

  if (o.out) console.log(`逐局紀錄在 ${o.out}（可用 --resume 續跑）\n`);
  process.exit(0);
}
