import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { findBestMoveForCPU } from "../src/ai/ai-service.js";
import { mulberry32 } from "./helpers.js";

test("只會選合法位置", () => {
  const e = new GameEngine({ rng: mulberry32(21) });
  const res = findBestMoveForCPU(e.board, e.currentTurn, e.pool, { timeMs: 100 });
  assert.ok(res.chosen);
  assert.ok(e.findLegalMove(res.chosen.r, res.chosen.c));
  assert.ok(e.pool.includes(res.chosen.disc));
});

test("無合法位置時回傳 chosen = null", () => {
  const e = new GameEngine({ rng: mulberry32(1) });
  e.board = e.board.map(row => row.map(() => null));
  const res = findBestMoveForCPU(e.board, 1, e.pool, { timeMs: 50 });
  assert.equal(res.chosen, null);
});
