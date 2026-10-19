import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllLegalMoves, applyMoveToBoard, canCaptureEver as oldCanCapture,
  fillTerritoryRule1Rule2, calculateSettlement, createInitialBoard
} from "../whowins/src/core/rules.js";
import { BLACK, WHITE } from "../whowins/src/core/constants.js";
import {
  Position, genMoves, canCaptureEver, fillTerritory, settleDiff, mvTo, mvFrom, mvCap, mvDie, POP
} from "../whowins/src/engine/core.js";

// 可重現的亂數
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 隨機局面：從開局隨機下若干手，或直接亂撒棋子 */
function randomBoard(rand) {
  if (rand() < 0.5) {
    let b = createInitialBoard(), turn = BLACK;
    const plies = Math.floor(rand() * 60);
    for (let i = 0; i < plies; i++) {
      const d = 1 + Math.floor(rand() * 6);
      const L = getAllLegalMoves(b, turn, d);
      const all = L.captures.concat(L.spawns);
      if (all.length) b = applyMoveToBoard(b, all[Math.floor(rand() * all.length)], turn);
      turn = turn === BLACK ? WHITE : BLACK;
      if (!oldCanCapture(b)) break;
    }
    return b;
  }
  const b = Array.from({ length: 8 }, () => Array(8).fill(0));
  const dens = rand() * 0.5;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const x = rand();
    if (x < dens / 2) b[r][c] = BLACK; else if (x < dens) b[r][c] = WHITE;
  }
  return b;
}

test("core: legal moves match rules.js for every side and die", () => {
  const rand = rng(1);
  const pos = new Position();
  const out = new Int32Array(512);
  for (let i = 0; i < 3000; i++) {
    const b = randomBoard(rand);
    for (const side of [BLACK, WHITE]) {
      pos.load(b, side);
      for (let d = 1; d <= 6; d++) {
        const old = getAllLegalMoves(b, side, d);
        const exp = new Set(old.captures.map(m => `c${m.fromR},${m.fromC}>${m.toR},${m.toC}`));
        for (const m of old.spawns) exp.add(`s${m.toR},${m.toC}`);
        const n = genMoves(pos, side, d, out);
        const got = new Set();
        for (let k = 0; k < n; k++) {
          const m = out[k], to = mvTo(m), fr = mvFrom(m);
          assert.equal(mvDie(m), d);
          got.add(mvCap(m) ? `c${fr >> 3},${fr & 7}>${to >> 3},${to & 7}` : `s${to >> 3},${to & 7}`);
        }
        assert.deepEqual([...got].sort(), [...exp].sort());
        assert.equal(n, got.size, "no duplicate moves");
      }
      // d = 0：一次產生 1..6 全部
      let total = 0;
      for (let d = 1; d <= 6; d++) total += genMoves(pos, side, d, out);
      assert.equal(genMoves(pos, side, 0, out), total);
    }
  }
});

test("core: make / unmake round trip and result equals applyMoveToBoard", () => {
  const rand = rng(2);
  const pos = new Position();
  const out = new Int32Array(512);
  for (let i = 0; i < 1000; i++) {
    const b = randomBoard(rand);
    const side = rand() < 0.5 ? BLACK : WHITE;
    pos.load(b, side);
    const n = genMoves(pos, side, 0, out);
    for (let k = 0; k < n; k++) {
      const m = out[k];
      const before = JSON.stringify(pos.toGrid());
      pos.makeMove(m, side);
      const to = mvTo(m), fr = mvFrom(m);
      const old = applyMoveToBoard(b, mvCap(m)
        ? { type: "capture", fromR: fr >> 3, fromC: fr & 7, toR: to >> 3, toC: to & 7 }
        : { type: "spawn", toR: to >> 3, toC: to & 7 }, side);
      assert.equal(JSON.stringify(pos.toGrid()), JSON.stringify(old));
      pos.unmakeMove(m, side);
      assert.equal(JSON.stringify(pos.toGrid()), before);
    }
  }
});

test("core: canCaptureEver, fill and settlement match rules.js", () => {
  const rand = rng(3);
  const pos = new Position();
  const ob = new Uint8Array(8), ow = new Uint8Array(8);
  let sawTrue = 0, sawFalse = 0;
  for (let i = 0; i < 4000; i++) {
    const b = randomBoard(rand);
    pos.load(b, BLACK);
    const exp = oldCanCapture(b);
    assert.equal(canCaptureEver(pos), exp);
    if (exp) sawTrue++; else sawFalse++;
    for (const first of [BLACK, WHITE]) {
      const f = fillTerritoryRule1Rule2(b, first).filledBoard;
      fillTerritory(pos, first, ob, ow);
      const s = calculateSettlement(f, 3.5);
      let bn = 0, wn = 0;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          assert.equal(!!(ob[r] & (1 << c)), f[r][c] === BLACK);
          assert.equal(!!(ow[r] & (1 << c)), f[r][c] === WHITE);
        }
        bn += POP[ob[r]]; wn += POP[ow[r]];
      }
      assert.equal(bn, s.bTotal);
      assert.equal(wn, s.wBoard);
      assert.equal(settleDiff(pos, first) > 0, s.winner === BLACK);
    }
  }
  assert.ok(sawTrue > 300 && sawFalse > 150, `coverage true=${sawTrue} false=${sawFalse}`);
});
