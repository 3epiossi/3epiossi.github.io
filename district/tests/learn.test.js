import test from "node:test";
import assert from "node:assert/strict";
import { SHAPE_MAP } from "../src/core/shapes.js";
import { createBoardState, applyPlaceWall, calculateRegions, getLegalPlacements, cloneBoardState } from "../src/core/rules.js";
import {
  CRACK_MAP, CRACK_PIECES, CRACK_SOLUTION, CUT_MAP, CUT_PIECES, PACK_MAP, PACK_PIECES, PACK_SOLUTION,
  SANDBOX_MASK, SANDBOX_MAP, SANDBOX_PIECES, SPLIT_MAP, SPLIT_PIECES
} from "../learn/maps.js";
import { makeLessonEngine } from "../learn/lesson-engine.js";

/** 單人操作紅黨，依序下完指定牆塊後，紅藍各拿多少選舉人票（贏者全拿，平手平分） */
function outcome(map, state) {
  let red = 0;
  let blue = 0;
  for (const reg of calculateRegions(state)) {
    let r = 0;
    let b = 0;
    for (const [y, x] of reg.cells) { r += map[y][x][0]; b += map[y][x][1]; }
    if (r > b) red += r + b; else if (b > r) blue += r + b; else { red += (r + b) / 2; blue += (r + b) / 2; }
  }
  return { red, blue };
}

function allOutcomes(map, pieceIds) {
  const results = [];
  (function rec(state, i, seq) {
    if (i === pieceIds.length) { results.push({ seq, ...outcome(map, state) }); return; }
    const shape = SHAPE_MAP.get(pieceIds[i]);
    for (const p of getLegalPlacements(state, shape)) {
      const s = cloneBoardState(state);
      applyPlaceWall(s, shape, p.vr, p.vc, 0, i + 1);
      rec(s, i + 1, [...seq, [pieceIds[i], p.vr, p.vc]]);
    }
  })(createBoardState(map.length, null), 0, []);
  return results;
}

test("規則學院：第 2 課整張圖是一個選區時藍黨全拿，放牆後紅黨至少拿到一區", () => {
  const none = outcome(CUT_MAP, createBoardState(4, null));
  assert.equal(none.red, 0);
  assert.equal(none.blue, 1600);
  const all = allOutcomes(CUT_MAP, CUT_PIECES);
  assert.ok(all.length >= 2);
  assert.ok(all.every((o) => o.red > 0), "兩種放法紅黨都至少拿一區");
});

test("規則學院：第 4 課只有把藍黨票倉整列圍起來紅黨才贏", () => {
  const wins = allOutcomes(PACK_MAP, PACK_PIECES).filter((o) => o.red > o.blue);
  assert.equal(wins.length, 1);
  assert.deepEqual(wins[0].seq, PACK_SOLUTION);
  assert.equal(outcome(PACK_MAP, createBoardState(4, null)).red, 0);
});

test("規則學院：第 5 課紅黨普選票不到一半，只有一種放法能贏", () => {
  const red = CRACK_MAP.flat().reduce((s, c) => s + c[0], 0);
  const total = CRACK_MAP.flat().reduce((s, c) => s + c[0] + c[1], 0);
  assert.ok(red / total < 0.45);
  const all = allOutcomes(CRACK_MAP, CRACK_PIECES);
  const wins = all.filter((o) => o.red > o.blue);
  assert.equal(wins.length, 1, `72 種放法裡應只有 1 種會贏，實際 ${wins.length}/${all.length}`);
  assert.deepEqual(wins[0].seq, CRACK_SOLUTION);
});

test("規則學院：教學引擎用指定票數與牆塊順序開局", () => {
  const e = makeLessonEngine({ cells: CRACK_MAP, pieces: CRACK_PIECES });
  assert.equal(e.boardSize, 5);
  assert.equal(e.candidatePool[0].shapeId, "T4_U");
  assert.equal(e.map.cells[0][3].population, 100);
  assert.equal(e.map.cells[0][3].support[0], 90);
  for (const [id, vr, vc] of CRACK_SOLUTION) {
    assert.equal(e.candidatePool[0].shapeId, id);
    assert.equal(e.placeWall(0, vr, vc).success, true);
    e.currentPlayer = 0;
  }
  assert.equal(e.isGameOver, true, "牆塊用完就終局");
  const [red, blue] = e.getAnalyticsReport().partyStats.map((p) => p.electoralVotes);
  assert.ok(red > blue);
});

test("規則學院：沙盒地圖是六角形輪廓、第 6 課規則下有均分選區", () => {
  const e = makeLessonEngine({ cells: SANDBOX_MAP, mask: SANDBOX_MASK, pieces: SANDBOX_PIECES, rules: { handSize: 3 } });
  assert.equal(e.activeCellCount, 32);
  assert.equal(e.candidatePool.length, 3);
  const s = makeLessonEngine({ cells: SPLIT_MAP, pieces: SPLIT_PIECES, rules: { minDistrictSize: 2 } });
  assert.equal(s.rules.minDistrictSize, 2);
  assert.equal(s.boardSize, 5);
});
