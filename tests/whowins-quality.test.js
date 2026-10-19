import test from "node:test";
import assert from "node:assert/strict";
import { classifyMove, luckOf, moveAccuracy, levelOf, MARK_TUNE } from "../whowins/src/engine/move-quality.js";
import { displayWinProb, CAL } from "../whowins/src/ui/eval-bar.js";

const id = (p) => p;
const mv = (key, sq, p) => ({ key, sq, p });

test("calibrated win rate is monotone, symmetric and keeps exact results", () => {
  for (const n of [5, 20, 35, 50, 60]) {
    let prev = -1;
    for (const p of [0.05, 0.2, 0.4, 0.5, 0.6, 0.8, 0.95]) {
      const q = displayWinProb(p, n);
      assert.ok(q > prev);
      prev = q;
      assert.ok(Math.abs(q + displayWinProb(1 - p, n) - 1) < 1e-9);
    }
    assert.equal(displayWinProb(1, n), 1);
    assert.equal(displayWinProb(0, n), 0);
    assert.ok(Math.abs(displayWinProb(0.5, n) - 0.5) < 1e-9);
  }
  assert.ok(CAL.length >= 3);
});

test("levels of win rate", () => {
  assert.deepEqual([0.05, 0.2, 0.5, 0.8, 0.95].map(levelOf), [0, 1, 2, 3, 4]);
});

test("mistake classes follow the loss against the best move with the same die", () => {
  const moves = [mv(1, 10, 0.6), mv(2, 11, 0.6 - 0.08), mv(3, 12, 0.6 - 0.14), mv(4, 13, 0.6 - 0.2), mv(5, 14, 0.5)];
  const sym = (key) => classifyMove({ moves, played: key, before: 0.5, toProb: id })?.sym;
  assert.equal(sym(1) === "?!" || sym(1) === "?" || sym(1) === "??", false, "best move is never a mistake");
  assert.equal(sym(2), "?!");
  assert.equal(sym(3), "?");
  assert.equal(sym(4), "??");
});

test("tiny differences and decided games are not marked", () => {
  const small = [mv(1, 10, 0.55), mv(2, 11, 0.54), mv(3, 12, 0.53)];
  assert.equal(classifyMove({ moves: small, played: 3, before: 0.5, toProb: id }).sym, null);
  const won = [mv(1, 10, 0.99), mv(2, 11, 0.93), mv(3, 12, 0.92)];
  assert.equal(classifyMove({ moves: won, played: 3, before: 0.9, toProb: id }).sym, null);
  const single = [mv(1, 10, 0.9)];
  assert.equal(classifyMove({ moves: single, played: 1, before: 0.5, toProb: id }).sym, null);
});

test("only move and turnaround", () => {
  const only = [mv(1, 10, 0.6), mv(2, 11, 0.45), mv(3, 12, 0.4)];
  assert.equal(classifyMove({ moves: only, played: 1, before: 0.7, toProb: id }).sym, "!");
  const turn = [mv(1, 10, 0.62), mv(2, 11, 0.3), mv(3, 12, 0.25)];
  assert.equal(classifyMove({ moves: turn, played: 1, before: 0.4, toProb: id }).sym, "!!");
  // 只有兩個落點不標好手
  assert.equal(classifyMove({ moves: [mv(1, 10, 0.62), mv(2, 11, 0.3)], played: 1, before: 0.4, toProb: id }).sym, null);
});

test("blocking move: opponent keeps a good result for only one of six dice", () => {
  const moves = [mv(1, 10, 0.55), mv(2, 11, 0.54), mv(3, 12, 0.53), mv(4, 13, 0.5)];
  const sym = classifyMove({ moves, played: 2, before: 0.5, nextBest: [0.3, 0.3, 0.6, 0.35, 0.3, 0.3], toProb: id }).sym;
  assert.equal(sym, "!?");
  const none = classifyMove({ moves, played: 2, before: 0.5, nextBest: [0.3, 0.3, 0.3, 0.35, 0.3, 0.3], toProb: id }).sym;
  assert.equal(none, null, "no dice left for the opponent means it was already winning, not informative");
});

test("luck and loss add up to the change in win rate", () => {
  const r = luckOf({ before: 0.5, best: 0.62, played: 0.58 });
  assert.ok(Math.abs(r.luck - 0.12) < 1e-9);
  assert.ok(Math.abs(r.loss - 0.04) < 1e-9);
  assert.ok(Math.abs(r.luck - r.loss - r.delta) < 1e-9);
  assert.equal(luckOf({ before: 0.5, best: 0.5, played: 0.6 }).loss, 0);
});

test("accuracy falls as loss grows", () => {
  assert.ok(moveAccuracy(0) > 99.9);
  assert.ok(moveAccuracy(5) < moveAccuracy(1));
  assert.ok(moveAccuracy(50) < moveAccuracy(10));
  assert.ok(moveAccuracy(1000) >= 0);
  assert.ok(MARK_TUNE.blunder > MARK_TUNE.mistake && MARK_TUNE.mistake > MARK_TUNE.dubious);
});
