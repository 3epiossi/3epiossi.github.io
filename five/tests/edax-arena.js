/**
 * CPU（v13）對「人＋黑白棋引擎」的模擬對手：
 *   對手用 Edax 排出黑白棋最好的幾步，從最好的開始試，跳過「下完 CPU 就能連成五（含幾手內逼出五連）」的走法；
 *   組別：盤上有「三」或「四」的組別優先拿來在別處消耗（下完不能讓連線威脅變多），其次挑下完威脅最少的那組。
 * 每局用 XOT 開局，成對交換顏色。
 *
 *   node five/tests/edax-arena.js --games 20 --seed 1 --time 500 --out five/tests/results/edax-base-1.jsonl
 *   --params '{"lineScale":0.05}'   CPU 的參數
 *   --engine v13 | v14              CPU 用的引擎（預設 v13）
 *   --weights five/tests/results/patterns.bin   v14 的棋型分數表
 *   --edax-depth 10                 對手（Edax）的深度
 *
 * 每局輸出一列 JSON：cpu 執哪色、勝方（cpu / opp / draw）、是否五連結束、比數、
 * 連線威脅消失（沒有任何一組還能連成五）是第幾手、那時 Edax 對 CPU 的評估，
 * CPU 每一手照 Edax 看損失幾顆（cpuLoss：[空格數, 損失, 連線還活著嗎]）。
 */
import fs from "fs";
import { GameEngine } from "../src/core/game-engine.js";
import { decodeXot, XOT_OPENINGS } from "../src/core/xot-openings.js";
import { groupOf, GROUPS, GROUP_SIZE, FIVE_WINDOWS, findThreatGroups } from "../src/core/five-rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { Edax } from "./edax.js";
import { mulberry32 } from "./helpers.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const GAMES = Number(arg("games", 10)), SEED = Number(arg("seed", 1)), TIME = Number(arg("time", 500));
const PARAMS = JSON.parse(arg("params", "{}"));
const ENGINE = arg("engine", "v13");
const EDAX_DEPTH = Number(arg("edax-depth", 10));
const OUT = arg("out", "/tmp/edax-arena.jsonl");

const cpuMod = await import(`../src/ai/${ENGINE}.js`);
const cpuSearch = cpuMod.searchV13 || cpuMod.searchV14;
if (cpuMod.setPatternWeights && arg("weights")) {
  const buf = fs.readFileSync(arg("weights"));
  cpuMod.setPatternWeights(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}
// 對手檢查連線安全用另一份 v13（不跟 CPU 共用置換表）
const { searchV13: safeSearch, WIN } = await import("../src/ai/v13.js?opp");

const opp = (p) => (p === BLACK ? WHITE : BLACK);
const sqOf = (m) => m.r * 8 + m.c;

function after(board, move, id, face) {
  const nb = board.map((row) => row.slice());
  nb[move.r][move.c] = { id, face };
  for (const [r, c] of move.flips) nb[r][c] = { ...nb[r][c], face };
  return nb;
}
function supplies(board) {
  const left = Array(GROUPS).fill(GROUP_SIZE);
  for (const row of board) for (const d of row) if (d) left[groupOf(d.id)]--;
  return left;
}
/** 還有沒有任何一組能在某個窗口連成五（不管顏色） */
function linesAlive(board) {
  const left = supplies(board);
  for (const cells of FIVE_WINDOWS) {
    let g = -1, ok = true, filled = 0;
    for (const [r, c] of cells) {
      const d = board[r][c];
      if (!d) continue;
      filled++;
      const dg = groupOf(d.id);
      if (g < 0) g = dg; else if (g !== dg) { ok = false; break; }
    }
    if (!ok) continue;
    if (g < 0) { if (left.some((x) => x >= 5)) return true; continue; }
    if (5 - filled <= left[g]) return true;
  }
  return false;
}
const threatWeight = (board) => {
  const per = Array(GROUPS).fill(0);
  let tot = 0;
  for (const t of findThreatGroups(board)) { const w = t.kind === 5 ? 6 : t.kind === 4 ? 3 : 1; per[t.v - 1] += w; tot += w; }
  return { tot, per };
};

/** 對手下完後，CPU 能不能（幾手內）逼出五連 */
function unsafe(nb, cpu) {
  const r = safeSearch(nb, cpu, groupOf, { timeMs: 60, maxDepth: 3 });
  return r ? r.score : -Infinity;
}

async function oppMove(e, edax) {
  const turn = e.currentTurn, cpu = opp(turn);
  const legal = e.legalMoves();
  const hints = await edax.hints(e.board, turn);
  const bySq = new Map(legal.map((m) => [sqOf(m), m]));
  const before = threatWeight(e.board);
  let fallback = null;
  for (const h of hints) {
    const m = bySq.get(h.sq);
    if (!m) continue;
    const cands = e.pool.map((id) => {
      const nb = after(e.board, m, id, turn);
      return { id, nb, t: threatWeight(nb).tot, drain: before.per[groupOf(id)] };
    }).sort((a, b) => (a.t > before.tot) - (b.t > before.tot) || b.drain - a.drain || a.t - b.t);
    for (const c of cands) {
      const s = unsafe(c.nb, cpu);
      if (s < WIN / 2) return { m, id: c.id, edaxBest: hints[0].score, edaxChosen: h.score };
      if (!fallback || s < fallback.s) fallback = { m, id: c.id, s, edaxChosen: h.score };
    }
  }
  return { m: fallback.m, id: fallback.id, edaxBest: hints[0].score, edaxChosen: fallback.edaxChosen, forced: true };
}

const rng = mulberry32(SEED * 7919 + 11);
const edax = new Edax({ depth: EDAX_DEPTH });
for (let gi = 0; gi < GAMES; gi++) {
  const pair = Math.floor(gi / 2);
  const opening = decodeXot(XOT_OPENINGS[Math.floor(mulberry32(SEED * 1000 + pair)() * XOT_OPENINGS.length)]);
  const cpuColor = gi % 2 === 0 ? BLACK : WHITE;
  const e = new GameEngine({ rng });
  e.resetGame(opening);
  const rec = { cpu: cpuColor === BLACK ? "black" : "white", seed: SEED, game: gi, cpuLoss: [], oppLoss: [], deadAt: null, deadEval: null, forced: 0 };
  let ply = 0;
  const t0 = Date.now();
  while (!e.gameOver) {
    const legal = e.legalMoves();
    if (!legal.length) { e.passTurn(); continue; }
    const empties = e.board.flat().filter((d) => !d).length;
    const alive = linesAlive(e.board);
    if (!alive && rec.deadAt == null) {
      rec.deadAt = 60 - empties;
      const h = await edax.hints(e.board, e.currentTurn, 1);
      rec.deadEval = e.currentTurn === cpuColor ? h[0].score : -h[0].score;
    }
    if (e.currentTurn === cpuColor) {
      const r = cpuSearch(e.board, e.currentTurn, groupOf, { timeMs: TIME, params: PARAMS });
      const hints = await edax.hints(e.board, e.currentTurn);
      const chosen = hints.find((h) => h.sq === r.sq);
      if (chosen) rec.cpuLoss.push([empties, hints[0].score - chosen.score, alive ? 1 : 0, r.depth]);
      // 大虧手（照 Edax 少 4 顆以上）：存下盤面，之後分析原因（tests/edax-bigloss.js）
      if (chosen && hints[0].score - chosen.score >= 4) {
        (rec.big ||= []).push({ board: e.board.map((row) => row.map((d) => (d ? [d.id, d.face] : 0))), turn: e.currentTurn, sq: r.sq, group: r.group, best: hints[0].sq, loss: hints[0].score - chosen.score, score: r.score });
      }
      const id = e.pool.find((x) => groupOf(x) === r.group) ?? e.pool[0];
      e.executeMove(r.sq >> 3, r.sq & 7, id);
    } else {
      const o = await oppMove(e, edax);
      rec.oppLoss.push([empties, o.edaxBest - o.edaxChosen, alive ? 1 : 0]);
      if (o.forced) rec.forced++;
      e.executeMove(o.m.r, o.m.c, o.id);
    }
    ply++;
  }
  const sd = e.settlementData;
  rec.byFive = !!sd.byFive;
  rec.winner = sd.winner === 0 ? "draw" : sd.winner === cpuColor ? "cpu" : "opp";
  rec.cpuDiscs = cpuColor === BLACK ? sd.black : sd.white;
  rec.oppDiscs = cpuColor === BLACK ? sd.white : sd.black;
  rec.plies = ply;
  rec.sec = Math.round((Date.now() - t0) / 1000);
  fs.appendFileSync(OUT, JSON.stringify(rec) + "\n");
  console.log(`game ${gi}: cpu ${rec.cpu} ${rec.winner}${rec.byFive ? " (five)" : ""} ${rec.cpuDiscs}-${rec.oppDiscs} dead@${rec.deadAt} eval ${rec.deadEval} ${rec.sec}s`);
}
edax.close();
