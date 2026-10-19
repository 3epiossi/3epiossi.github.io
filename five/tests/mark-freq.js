/**
 * 走法評價的頻率（4 組自選、v13）：CPU 互下，每個局面用 AI 教練的強度分析（multiPV），
 * 再照網頁的方式（app.js 的 updateMark）判斷每一步的標記，統計每 100 步各種標記出現幾次。
 *
 *   產生資料：node five/tests/mark-freq.js --games 20 --seed 1 --out five/tests/results/mark-freq-1.jsonl
 *             （--levels 3,4,5,6：參加的等級，每局隨機挑兩個；--think 500：最高級 CPU 每步的時間；--coach 1000：分析的時間）
 *   統計：    node five/tests/mark-freq.js --sum five/tests/results/mark-freq-*.jsonl
 *
 * 每一局寫一列：每個局面（含 PASS）的盤面、輪到誰、分析（棋 × 64 + 格 → 分數）、下的棋、誰下的（等級），以及最後的勝負。
 */
import fs from "fs";
import { GameEngine } from "../src/core/game-engine.js";
import { searchEngine } from "../src/ai/ai-service.js";
import { searchLevel, LEVELS } from "../src/ai/levels.js";
import { classifyMove, levelOf, MARK_TUNE } from "../src/ai/move-quality.js";
import { displayWinProb } from "../src/ui/eval-bar.js";
import { mulberry32 } from "./helpers.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SYMS = ["!!", "!", "!?", "?!", "?", "??"];
// 統計時：--tune '{"dubious":0.1,"onlyGap":0.2}' 換標記的門檻（沒給的照 MARK_TUNE）；--only 3,4,5,6 只算這些等級下的步
const TUNE = arg("tune") ? { ...MARK_TUNE, ...JSON.parse(arg("tune")) } : null;
const ONLY = arg("only") ? new Set(arg("only").split(",").map(Number)) : null;
const emptiesOf = (b) => b.flat().filter(d => !d).length;

/** 照 app.js 的 updateMark：上一個局面（這步的選擇）、下完的局面（設陷阱）、上上個局面（對手下之前的勝率） */
function marksOf(game) {
  const P = game.positions, out = [];
  for (let i = 0; i < P.length; i++) {
    const pos = P[i];
    if (pos.played == null || !pos.scores?.length) continue;
    const nextPos = P[i + 1];
    const next = nextPos && !nextPos.gameOver && nextPos.scores?.length ? { scores: nextPos.scores.map(([sq, score]) => ({ sq, score })) } : null;
    let prevP = null;
    const gp = P[i - 1];
    if (gp?.scores?.length) {
      const best = Math.max(...gp.scores.map(x => x[1]));
      const p = best >= 0.999 ? 1 : best <= -0.999 ? 0 : displayWinProb(best, emptiesOf(gp.board));
      prevP = gp.turn === pos.turn ? p : 1 - p;
    }
    // 往前 turnWindow 個局面（對手下之前、再之前…）這一方的勝率（!! 反殺用）
    const prevWin = [];
    for (let k = 1; k <= (TUNE || MARK_TUNE).turnWindow && i - k >= 0; k++) {
      const q = P[i - k];
      if (!q?.scores?.length) continue;
      const best = Math.max(...q.scores.map(x => x[1]));
      const p = best >= 0.999 ? 1 : best <= -0.999 ? 0 : displayWinProb(best, emptiesOf(q.board));
      prevWin.push(q.turn === pos.turn ? p : 1 - p);
    }
    const m = classifyMove({
      scores: pos.scores.map(([sq, score]) => ({ sq, score })), played: pos.played,
      board: pos.board, turn: pos.turn, toProb: displayWinProb, next, prevP, prevWin, ...(TUNE ? { tune: TUNE } : {})
    });
    out.push({ sym: m?.sym || null, lvl: pos.lvl, turn: pos.turn, decided: m && levelOf(m.best) === levelOf(m.played) && (levelOf(m.best) === 4 || levelOf(m.best) === 0) });
  }
  return out;
}

if (argv.includes("--sum")) {
  const files = argv.slice(argv.indexOf("--sum") + 1).filter((f) => f.endsWith(".jsonl"));
  const games = files.flatMap(f => fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)));
  const all = {}, byLvl = {};
  let moves = 0, decided = 0;
  const found = { strong: { n: 0, score: 0 }, weak: { n: 0, score: 0 } };
  for (const g of games) {
    for (const m of marksOf(g)) {
      if (ONLY && !ONLY.has(m.lvl)) continue;
      moves++; if (m.decided) decided++;
      const L = (byLvl[m.lvl] ||= { n: 0 });
      L.n++;
      if (!m.sym) continue;
      all[m.sym] = (all[m.sym] || 0) + 1;
      L[m.sym] = (L[m.sym] || 0) + 1;
    }
  }
  const per = (c, n) => (100 * (c || 0) / n).toFixed(1);
  console.log(`${games.length} 局、${moves} 步；每 100 步：${SYMS.map(s => `${s} ${per(all[s], moves)}`).join("　")}；勝負已定（最佳步與這步都在勝定或都在敗定）${per(decided, moves)}%`);
  for (const [l, L] of Object.entries(byLvl).sort((a, b) => a[0] - b[0])) {
    console.log(`  ${l} 級（${L.n} 步）：${SYMS.map(s => `${s} ${per(L[s], L.n)}`).join("　")}`);
  }
  process.exit(0);
}

const GAMES = Number(arg("games", 10)), SEED = Number(arg("seed", 1));
const THINK = Number(arg("think", 500)), COACH = Number(arg("coach", 1000));
const LV = arg("levels", "3,4,5,6").split(",").map(Number);
const OUT = arg("out", "/tmp/mark-freq.jsonl");
for (let g = 0; g < GAMES; g++) {
  const rng = mulberry32(SEED * 1009 + g);
  const e = new GameEngine({ rng });
  const lv = { 1: LV[Math.floor(rng() * LV.length)], 2: LV[Math.floor(rng() * LV.length)] };
  const positions = [];
  while (!e.gameOver) {
    const pos = { board: e.board.map(r => r.map(d => d && [d.id, d.face])), turn: e.currentTurn };
    positions.push(pos);
    if (!e.legalMoves().length) { pos.scores = []; e.passTurn(); continue; }
    const a = searchEngine(e.board, e.currentTurn, e.pool, { timeMs: COACH, multiPV: true });
    pos.scores = a.scores.map(x => [x.key, +x.score.toFixed(5)]);
    const r = searchLevel(e.board, e.currentTurn, e.pool, LEVELS[lv[e.currentTurn] - 1], { timeMs: THINK, rng });
    pos.played = r.disc * 64 + r.bestSq;
    pos.lvl = lv[e.currentTurn];
    e.executeMove(r.bestSq >> 3, r.bestSq & 7, r.disc);
  }
  positions.push({ board: e.board.map(r => r.map(d => d && [d.id, d.face])), turn: e.currentTurn, gameOver: true });
  // 盤面存成 [id, face]，判斷時換回 { id, face }
  for (const p of positions) p.board = p.board.map(r => r.map(d => d && { id: d[0], face: d[1] }));
  fs.appendFileSync(OUT, JSON.stringify({ levels: lv, winner: e.settlementData.winner, byFive: !!e.settlementData.byFive, positions }) + "\n");
}
