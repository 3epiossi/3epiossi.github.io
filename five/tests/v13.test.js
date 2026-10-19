import test from "node:test";
import assert from "node:assert/strict";
import { searchV13, WIN, V13_PARAMS } from "../src/ai/v13.js";
import { createEmptyBoard, getLegalMoves, applyMoveToBoard, createInitialBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { mulberry32 } from "./helpers.js";

// 4 組自選：id 0～15 第 0 組、16～31 第 1 組、32～47 第 2 組、48～63 第 3 組（v13 不看規則變體，測試直接傳 groupOf）
const groupOf = (id) => id >> 4;
const opp = (t) => (t === BLACK ? WHITE : BLACK);
const disc = (g, face, k = 0) => ({ id: g * 16 + k, face });

/** 照規則判斷：face 有沒有同色、同組的五連 */
function hasFive(board, face) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let g = null, ok = true;
      for (let k = 0; k < 5; k++) {
        const d = board[r + k * dr]?.[c + k * dc];
        if (!d || d.face !== face) { ok = false; break; }
        if (g == null) g = groupOf(d.id); else if (g !== groupOf(d.id)) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}
/** 盤上每組剩幾顆（共用，每組 16 顆） */
function supplyOf(board) {
  const rem = [16, 16, 16, 16];
  for (const row of board) for (const d of row) if (d) rem[groupOf(d.id)]--;
  return rem;
}
const nextId = (board, g) => { const used = new Set(board.flat().filter(Boolean).map(d => d.id)); for (let k = 0; k < 16; k++) if (!used.has(g * 16 + k)) return g * 16 + k; return -1; };

/** 隨機下到剩 target 格（沒人連成五），回傳局面與輪到誰；不行回傳 null */
function randomPosition(rng, target, groupBias = null) {
  let b = createInitialBoard((() => { let k = 0; return () => [0, 16, 32, 48][k++]; })());
  let turn = BLACK;
  while (b.flat().filter(x => !x).length > target) {
    const ms = getLegalMoves(b, turn);
    if (!ms.length) { if (!getLegalMoves(b, opp(turn)).length) return null; turn = opp(turn); continue; }
    const m = ms[Math.floor(rng() * ms.length)];
    const sup = supplyOf(b), gs = [0, 1, 2, 3].filter(g => sup[g] > 0);
    const g = groupBias != null && sup[groupBias] > 0 && rng() < 0.5 ? groupBias : gs[Math.floor(rng() * gs.length)];
    b = applyMoveToBoard(b, m, nextId(b, g), turn);
    if (hasFive(b, turn)) return null;
    turn = opp(turn);
  }
  if (!getLegalMoves(b, turn).length) return null;
  return { b, turn };
}

/** 窮舉：輪到 turn 的分數（棋子數差；連成五 = WIN − 手數，跟 v13 一樣越快越好） */
function bruteForce(board, turn, ply = 0, passed = false) {
  const moves = getLegalMoves(board, turn);
  if (!moves.length) {
    if (passed || !getLegalMoves(board, opp(turn)).length) {
      let a = 0, o = 0;
      for (const row of board) for (const d of row) if (d) d.face === turn ? a++ : o++;
      return a - o;
    }
    return -bruteForce(board, opp(turn), ply + 1, true);
  }
  const sup = supplyOf(board);
  let best = -Infinity;
  for (const m of moves) for (let g = 0; g < 4; g++) {
    if (!sup[g]) continue;
    const nb = applyMoveToBoard(board, m, nextId(board, g), turn);
    const v = hasFive(nb, turn) ? WIN - ply - 1 : -bruteForce(nb, opp(turn), ply + 1, false);
    if (v > best) best = v;
  }
  return best;
}

test("v13：能直接連成五就連，而且挑對組別", () => {
  const b = createEmptyBoard();
  for (let c = 0; c < 4; c++) b[3][c] = disc(2, BLACK, c);
  b[3][5] = disc(0, WHITE); b[3][6] = disc(0, BLACK, 5);
  b[6][1] = disc(1, WHITE, 6); b[7][2] = disc(3, BLACK, 7);
  const r = searchV13(b, BLACK, groupOf, { timeMs: 200 });
  assert.equal(r.sq, 3 * 8 + 4);
  assert.equal(r.group, 2);
  assert.ok(r.score > WIN / 2);
});

test("v13：混組的連線不算五連", () => {
  const b = createEmptyBoard();
  for (let c = 0; c < 4; c++) b[3][c] = disc(c % 2 ? 1 : 2, BLACK, c);
  b[3][5] = disc(0, WHITE); b[3][6] = disc(0, BLACK, 5);
  b[6][1] = disc(1, WHITE, 6); b[7][2] = disc(3, BLACK, 7);
  const r = searchV13(b, BLACK, groupOf, { timeMs: 100, maxDepth: 1 });
  assert.ok(r.score < WIN / 2);
});

test("v13：選的格子一定合法（隨機局面，跟遊戲規則比）", () => {
  const rng = mulberry32(5);
  let checked = 0;
  for (let i = 0; i < 300 && checked < 60; i++) {
    const p = randomPosition(rng, 8 + Math.floor(rng() * 50));
    if (!p) continue;
    const r = searchV13(p.b, p.turn, groupOf, { timeMs: 20, maxDepth: 2 });
    const legal = getLegalMoves(p.b, p.turn).map(m => m.r * 8 + m.c);
    assert.ok(legal.includes(r.sq), `不合法：${r.sq}`);
    assert.ok(supplyOf(p.b)[r.group] > 0, "選了用完的組別");
    checked++;
  }
  assert.ok(checked >= 40);
});

test("v13：對手下一手就要連成五 → 一定擋（或自己先連成）", () => {
  const rng = mulberry32(9);
  let checked = 0;
  const oppWins = (bb, t) => getLegalMoves(bb, t).some(m => supplyOf(bb).some((s, g) => s > 0 && hasFive(applyMoveToBoard(bb, m, nextId(bb, g), t), t)));
  for (let i = 0; i < 3000 && checked < 8; i++) {
    const p = randomPosition(rng, 20 + Math.floor(rng() * 25), 1);
    if (!p || !oppWins(p.b, opp(p.turn))) continue;
    const ms = getLegalMoves(p.b, p.turn), sup = supplyOf(p.b);
    const canBlock = ms.some(m => sup.some((s, g) => s > 0 && !oppWins(applyMoveToBoard(p.b, m, nextId(p.b, g), p.turn), opp(p.turn))));
    if (!canBlock) continue;
    const r = searchV13(p.b, p.turn, groupOf, { timeMs: 300 });
    const mv = ms.find(m => m.r * 8 + m.c === r.sq), after = applyMoveToBoard(p.b, mv, nextId(p.b, r.group), p.turn);
    assert.ok(hasFive(after, p.turn) || !oppWins(after, opp(p.turn)), "沒擋住");
    checked++;
  }
  assert.ok(checked >= 4, `找到的測試局面太少：${checked}`);
});

test("v13：終盤精確求解跟窮舉一模一樣（每一組都展開；剩 6～7 格的隨機局面）", () => {
  const rng = mulberry32(13);
  let checked = 0;
  for (let i = 0; i < 400 && checked < 10; i++) {
    const p = randomPosition(rng, 6 + Math.floor(rng() * 2), 2);
    if (!p) continue;
    const truth = bruteForce(p.b, p.turn);
    const r = searchV13(p.b, p.turn, groupOf, { timeMs: 30000, params: { ...V13_PARAMS, merge: false } });
    assert.ok(r.exact, "應該精確算完");
    const same = Math.abs(truth) > WIN / 2 ? Math.sign(r.score) === Math.sign(truth) && Math.abs(r.score) > WIN / 2 : r.score === truth;
    assert.ok(same, `v13 ${r.score}，窮舉 ${truth}`);
    checked++;
  }
  assert.ok(checked >= 6, `找到的測試局面太少：${checked}`);
});
