import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllLegalMoves, applyMoveToBoard, canCaptureEver as oldCan, fillTerritoryRule1Rule2,
  calculateSettlement, createInitialBoard
} from "../whowins/src/core/rules.js";
import { BLACK, WHITE } from "../whowins/src/core/constants.js";
import { Position, mvTo, mvFrom, mvCap } from "../whowins/src/engine/core.js";
import { Searcher } from "../whowins/src/engine/search.js";
import { evalWin } from "../whowins/src/engine/eval.js";

const opp = (s) => (s === BLACK ? WHITE : BLACK);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 舊規則（rules.js）寫的樸素 expectimax：不剪枝、不用置換表，當作搜尋的對照
const P = new Position();
function terminalFor(b, side, annihilated) {
  const f = fillTerritoryRule1Rule2(b, annihilated ? side : opp(side)).filledBoard;
  const s = calculateSettlement(f, 3.5);
  return s.winner === side ? 1 : 0;
}
function refMax(b, side, d, depth) {
  const L = getAllLegalMoves(b, side, d);
  const all = L.captures.concat(L.spawns);
  if (!all.length) return 1 - refFree(b, opp(side), depth - 1, 0);
  let best = -1;
  for (const m of all) best = Math.max(best, afterMove(b, side, m, depth));
  return best;
}
function afterMove(b, side, m, depth) {
  const nb = applyMoveToBoard(b, m, side);
  const e = opp(side);
  let en = 0;
  for (const r of nb) for (const v of r) if (v === e) en++;
  if (!en) return terminalFor(nb, side, true);
  if (!oldCan(nb)) return terminalFor(nb, side, false);
  return 1 - refChance(nb, e, depth - 1);
}
function refChance(b, side, depth) {
  if (depth <= 0) { P.load(b, side); return evalWin(P, side); }
  let s = 0;
  for (let d = 1; d <= 6; d++) s += refMax(b, side, d, depth);
  return s / 6;
}
function refFree(b, side, depth, passes) {
  if (depth <= 0) { P.load(b, side); return Math.min(1, evalWin(P, side) + 0.08); }
  let best = -1, any = false;
  for (let d = 1; d <= 6; d++) {
    const L = getAllLegalMoves(b, side, d);
    for (const m of L.captures.concat(L.spawns)) { any = true; best = Math.max(best, afterMove(b, side, m, depth)); }
  }
  if (!any) {
    if (passes >= 1) { P.load(b, side); return evalWin(P, side); }
    return 1 - refFree(b, opp(side), depth - 1, passes + 1);
  }
  return best;
}

function midgame(rand, plies) {
  let b = createInitialBoard(), turn = BLACK;
  for (let i = 0; i < plies; i++) {
    const L = getAllLegalMoves(b, turn, 1 + Math.floor(rand() * 6));
    const all = L.captures.concat(L.spawns);
    if (all.length) b = applyMoveToBoard(b, all[Math.floor(rand() * all.length)], turn);
    turn = opp(turn);
    if (!oldCan(b)) return null;
  }
  return { b, turn };
}

test("search: pruned expectimax equals naive reference (depth 1 and 2)", () => {
  const rand = rng(11);
  const s = new Searcher();
  let checked = 0;
  for (let i = 0; i < 40 && checked < 14; i++) {
    const g = midgame(rand, 4 + Math.floor(rand() * 14));
    if (!g) continue;
    const pos = new Position().load(g.b, g.turn);
    for (const depth of [1, 2]) {
      s.clearTT();
      const r = s.analyze(pos, { maxDepth: depth, fixedDepth: true });
      assert.equal(r.depth, depth);
      assert.ok(Math.abs(r.value - refChance(g.b, g.turn, depth)) < 1e-4, `depth ${depth}`);
      for (let d = 1; d <= 6; d++) assert.ok(Math.abs(r.perDie[d - 1].value - refMax(g.b, g.turn, d, depth)) < 1e-4);
    }
    checked++;
  }
  assert.ok(checked >= 10);
});

test("search: chosen move is legal for the rolled die, free pick covers all dice", () => {
  const rand = rng(12);
  const s = new Searcher();
  for (let i = 0; i < 20; i++) {
    const g = midgame(rand, 6 + Math.floor(rand() * 20));
    if (!g) continue;
    const pos = new Position().load(g.b, g.turn);
    const die = 1 + Math.floor(rand() * 6);
    const r = s.analyze(pos, { maxDepth: 2, fixedDepth: true, die });
    const pd = r.perDie[die - 1];
    const L = getAllLegalMoves(g.b, g.turn, die);
    if (pd.move < 0) { assert.equal(L.captures.length + L.spawns.length, 0); continue; }
    const to = mvTo(pd.move), fr = mvFrom(pd.move);
    const ok = mvCap(pd.move)
      ? L.captures.some(m => m.toR === (to >> 3) && m.toC === (to & 7) && m.fromR === (fr >> 3) && m.fromC === (fr & 7))
      : L.spawns.some(m => m.toR === (to >> 3) && m.toC === (to & 7));
    assert.ok(ok);
    pos.free = true;
    const f = s.analyze(pos, { maxDepth: 1, fixedDepth: true });
    assert.equal(f.mode, "free");
    assert.ok(Math.abs(f.value - Math.max(...f.perDie.filter(Boolean).map(p => p.value))) < 1e-9);
  }
});

test("search: terminal results are exact (annihilation and natural end)", () => {
  const s = new Searcher();
  // 黑 (4,3) 與白 (4,1) 同列，黑擲 2 可吃掉白棋 => 敵方全滅，勝率必為 1
  const a = Array.from({ length: 8 }, () => Array(8).fill(0));
  a[4][3] = BLACK; a[4][1] = WHITE;
  let r = s.analyze(new Position().load(a, BLACK), { maxDepth: 1, fixedDepth: true });
  assert.equal(r.perDie[1].value, 1);
  assert.equal(mvCap(r.perDie[1].move), 1);
  // 黑 (3,3)、白 (4,0)，白擲 1 生子到 (4,1)/(5,0) 後雙方仍無法互吃 => 自然終局，值由填滿結算決定（0 或 1）
  const b = Array.from({ length: 8 }, () => Array(8).fill(0));
  b[3][3] = BLACK; b[4][0] = WHITE;
  assert.equal(oldCan(b), false);
  // 這個局面本身已是終局，但引擎只在落子後檢查；用「落子後終局」的局面：黑 (3,3) 白 (3,0) 白先擲 3 吃黑
  const c = Array.from({ length: 8 }, () => Array(8).fill(0));
  c[3][3] = BLACK; c[3][0] = WHITE;
  r = s.analyze(new Position().load(c, WHITE), { maxDepth: 1, fixedDepth: true, die: 3 });
  assert.equal(r.perDie[2].value, 1);
});
