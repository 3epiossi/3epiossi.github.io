import test from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE } from "../src/core/constants.js";
import { getLegalMoves } from "../src/core/rules.js";
import { findFive } from "../src/core/five-rules.js";
import {
  FIVE_POSITIONS, playMove, winningMoves, playoutDemo, PASS_DEMO_SEED
} from "../learn/positions.js";

test("規則學院：第 4 課只有選對組別補在缺口才連成五", () => {
  const b = FIVE_POSITIONS.fiveByPlacing;
  const wins = winningMoves(b, BLACK);
  assert.deepEqual(wins, [{ r: 3, c: 3, group: 2 }]);
  const wrong = playMove(b, 3, 3, 0, BLACK);
  assert.ok(wrong, "選別組補在缺口仍是合法落子");
  assert.equal(wrong.five, null, "不同組不算五連");
});

test("規則學院：第 5 課靠翻面連成五，下錯組別則不算", () => {
  const b = FIVE_POSITIONS.fiveByFlipping;
  assert.deepEqual(winningMoves(b, BLACK), [{ r: 5, c: 4, group: 1 }]);
  assert.equal(playMove(b, 5, 4, 2, BLACK).five, null);
  assert.equal(playMove(b, 5, 4, 1, BLACK).flips.length, 2);
});

test("規則學院：第 6 課白棋有一手致勝，黑棋只有一個合法位置擋得住", () => {
  const b = FIVE_POSITIONS.defend;
  assert.deepEqual(winningMoves(b, WHITE), [{ r: 2, c: 4, group: 0 }]);
  assert.deepEqual(winningMoves(b, BLACK), []);
  const blockers = [];
  for (const m of getLegalMoves(b, BLACK)) {
    const res = playMove(b, m.r, m.c, 0, BLACK);
    if (res && winningMoves(res.board, WHITE).length === 0) blockers.push(`${m.r},${m.c}`);
  }
  assert.deepEqual(blockers, ["5,4"]);
});

test("規則學院：第 8 課黑棋自己有五連可連，白棋同時有威脅", () => {
  const b = FIVE_POSITIONS.raceToFive;
  assert.equal(winningMoves(b, BLACK).length, 1);
  assert.equal(winningMoves(b, WHITE).length, 1);
});

test("規則學院：所有教學局面開局時都沒有現成的五連", () => {
  for (const [name, b] of Object.entries(FIVE_POSITIONS)) {
    assert.equal(findFive(b, BLACK), null, name);
    assert.equal(findFive(b, WHITE), null, name);
  }
});

test("規則學院：第 7 課示範局有人 PASS、沒有五連、棋子數不同", () => {
  const demo = playoutDemo(PASS_DEMO_SEED);
  assert.ok(demo, "固定種子要能產生有效示範局");
  assert.equal(getLegalMoves(demo.passBoard, demo.passPlayer).length, 0);
  assert.notEqual(demo.counts.black, demo.counts.white);
  assert.equal(findFive(demo.finalBoard, BLACK), null);
  assert.equal(findFive(demo.finalBoard, WHITE), null);
  assert.deepEqual(playoutDemo(PASS_DEMO_SEED).counts, demo.counts, "固定種子結果要一致");
});
