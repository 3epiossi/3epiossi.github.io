import test from "node:test";
import assert from "node:assert/strict";
import { createInitialBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { findBestMoveForCPU, rankCandidateMoves, evaluateSingleMove } from "../src/ai/ai-service.js";

test("v1 through v4 algorithms evaluate moves without crashing", () => {
  const b = createInitialBoard();
  for (const algo of ["v1", "v2", "v3", "v4"]) {
    const res = findBestMoveForCPU(b, BLACK, 2, algo);
    assert.ok(res, `algo ${algo} should find a move`);
    assert.ok(res.chosen, `algo ${algo} should select a chosen move`);
    assert.ok(typeof res.maxScore === "number", `algo ${algo} score should be a number`);
  }
});

test("rankCandidateMoves returns top candidates with rank badges and explanations", () => {
  const b = createInitialBoard();
  const candidates = rankCandidateMoves(b, BLACK, 2, "v4", 3);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].rankBadge, "👑 首選");
  assert.ok(candidates[0].explanation.summary.length > 0);
  assert.ok(Array.isArray(candidates[0].explanation.pros));
});
