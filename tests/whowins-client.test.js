import test from "node:test";
import assert from "node:assert/strict";
import { AiClient } from "../whowins/src/engine/ai-client.js";
import { createInitialBoard } from "../whowins/src/core/rules.js";
import { BLACK } from "../whowins/src/core/constants.js";
import { Searcher } from "../whowins/src/engine/search.js";
import { Position } from "../whowins/src/engine/core.js";
import { chooseMove, analyzePosition, decodeMove, encodeMove } from "../whowins/src/engine/service.js";
import { MAX_LEVEL } from "../whowins/src/engine/levels.js";

test("service: move encode/decode round trip", () => {
  const spawn = { cap: false, from: { r: 7, c: 7 }, to: { r: 7, c: 3 }, die: 4 };
  const d1 = decodeMove(encodeMove(spawn));
  assert.deepEqual([d1.cap, d1.to, d1.die], [false, spawn.to, 4]);
  const cap = { cap: true, from: { r: 5, c: 6 }, to: { r: 5, c: 2 }, die: 4 };
  const d2 = decodeMove(encodeMove(cap));
  assert.deepEqual([d2.cap, d2.from, d2.to, d2.die], [true, cap.from, cap.to, 4]);
  assert.equal(decodeMove(-1), null);
});

test("client without Worker: play and analyze run synchronously and cancel is harmless", async () => {
  const c = new AiClient({ useWorker: false });
  const board = createInitialBoard();
  const play = await c.play({ board, turn: BLACK, die: 3, level: 1, opts: { komi: 3.5 } });
  assert.ok(play.move && play.move.die === 3);
  const an = await c.analyze({ board, turn: BLACK, opts: { komi: 3.5, timeMs: 150, maxDepth: 12, allMoves: true } });
  assert.equal(an.perDie.length, 6);
  assert.ok(an.depth >= 1);
  assert.ok(an.value > 0 && an.value < 1);
  c.cancel();
  const again = await c.play({ board, turn: BLACK, die: 2, level: MAX_LEVEL, opts: { komi: 3.5, timeMs: 100 } });
  assert.ok(again.move);
});

test("search respects its time limit and keeps the last finished depth", () => {
  const s = new Searcher();
  const pos = new Position();
  const t0 = Date.now();
  const r = s.analyze(pos, { maxDepth: 20, timeMs: 300 });
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `took ${ms}ms`);
  assert.ok(r.depth >= 1 && r.perDie.length === 6);
});

test("PASS positions: a die with no legal move returns move -1 (pass) with a value", () => {
  // 黑棋只有 A1 旁邊（上、左都出界）：黑棋在 A1 沒有任何合法走法
  const b = Array.from({ length: 8 }, () => Array(8).fill(0));
  b[0][0] = BLACK; b[7][7] = 2;
  const r = analyzePosition(new Searcher(), b, BLACK, { maxDepth: 2, fixedDepth: true });
  assert.ok(r.perDie.every((pd) => pd && pd.move === null && pd.value > 0 && pd.value < 1));
  const cm = chooseMove(new Searcher(), b, BLACK, 3, MAX_LEVEL, { timeMs: 50 });
  assert.equal(cm.move, null);
});
