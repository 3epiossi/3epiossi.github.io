import test from "node:test";
import assert from "node:assert/strict";
import { generateMap, evaluateMapFairness } from "../src/core/map-generator.js";

test("每格支持度都一樣的地圖不合格", () => {
  const pops = Array(60).fill(100);
  const flat = pops.map(() => [34, 33, 33]);
  assert.equal(evaluateMapFairness(3, pops, flat).ok, false);
});

test("某黨完全沒有領先格的地圖不合格", () => {
  const pops = Array(60).fill(100);
  const lopsided = pops.map((_, i) => (i % 2 ? [60, 30, 10] : [10, 60, 30]));
  assert.equal(evaluateMapFairness(3, pops, lopsided).ok, false);
});

test("生成的地圖每黨都有劃區操作空間", () => {
  for (const players of [2, 3, 4]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const cells = generateMap(players, seed).cells.flat().filter((c) => c.active);
      const result = evaluateMapFairness(players, cells.map((c) => c.population), cells.map((c) => c.support));
      assert.ok(result.ok, `${players} 人 種子 ${seed}`);
    }
  }
});
