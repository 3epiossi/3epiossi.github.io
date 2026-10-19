import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { AIPlayer, AI_LEVELS } from "../src/ai/ai-player.js";
import { AI_LEVEL_IDS, DEFAULT_AI_LEVEL, TWO_PARTY_K_PER_CELL, normalizeAiLevel, normalizeRules } from "../src/core/constants.js";
import { maskFromPreset, countActiveCells } from "../src/core/board-shapes.js";
import { normalizeSettings } from "../src/ui/settings.js";

test("電腦強度：每一級都有參數，預設級在範圍內", () => {
  assert.deepEqual(Object.keys(AI_LEVELS).map(Number), AI_LEVEL_IDS);
  assert.ok(AI_LEVEL_IDS.includes(DEFAULT_AI_LEVEL));
});

test("電腦強度：舊存檔的 easy / normal / hard 換成 2 / 3 / 4，不合法的值退回預設", () => {
  assert.equal(normalizeAiLevel("easy"), 2);
  assert.equal(normalizeAiLevel("normal"), 3);
  assert.equal(normalizeAiLevel("hard"), 4);
  assert.equal(normalizeAiLevel(1), 1);
  assert.equal(normalizeAiLevel("2"), 2);
  assert.equal(normalizeAiLevel(9), DEFAULT_AI_LEVEL);
  assert.equal(normalizeAiLevel(undefined), DEFAULT_AI_LEVEL);
  assert.equal(normalizeRules({ aiLevel: "hard" }).aiLevel, 4);
  const s = normalizeSettings({ parties: [{ name: "甲", type: "cpu", level: "easy" }, { name: "乙", type: "cpu", level: "hard" }] });
  assert.deepEqual(s.parties.map((p) => p.level), [2, 4]);
  assert.deepEqual(normalizeSettings(null).parties.map((p) => p.level), [DEFAULT_AI_LEVEL, DEFAULT_AI_LEVEL]);
});

test("電腦強度：每一級都能走出合法的一步，非同步版與同步版結果型態一致", async () => {
  for (const level of AI_LEVEL_IDS) {
    const engine = new GameEngine({ numPlayers: 2, seed: 11 });
    const ai = new AIPlayer(0, { level });
    const move = ai.decideMove(engine);
    assert.ok(move.action === "place" || move.action === "pass", `第 ${level} 級`);
    if (move.action === "place") assert.ok(engine.placeWall(move.poolIndex, move.vr, move.vc).success, `第 ${level} 級走出非法位置`);
    const engine2 = new GameEngine({ numPlayers: 2, seed: 11 });
    const asyncMove = await new AIPlayer(0, { level }).decideMoveAsync(engine2);
    assert.ok(asyncMove.action === "place" || asyncMove.action === "pass");
  }
});

test("電腦強度：1 級完全隨機，不看評估也能整盤下完", () => {
  const engine = new GameEngine({ numPlayers: 2, seed: 5 });
  const ais = [new AIPlayer(0, { level: 1 }), new AIPlayer(1, { level: 1 })];
  let guard = 0;
  while (!engine.isGameOver && guard++ < 400) {
    const m = ais[engine.currentPlayer].decideMove(engine);
    if (m.action === "place") assert.ok(engine.placeWall(m.poolIndex, m.vr, m.vc).success);
    else engine.pass();
  }
  assert.ok(engine.isGameOver);
});

test("先手補償：雙人自訂地圖依可用格數成比例（台灣 24x24 約 -96），其他人數沿用原本縮放", () => {
  const mask = maskFromPreset("taiwan", 24);
  const cells = countActiveCells(mask);
  const e2 = new GameEngine({ numPlayers: 2, boardSize: 24, mask, seed: 1 });
  assert.equal(e2.k, Math.round(TWO_PARTY_K_PER_CELL * cells));
  assert.ok(e2.k < -50, "補償要夠大，不能只有幾個人");
  const e3 = new GameEngine({ numPlayers: 3, boardSize: 24, mask, seed: 1 });
  assert.ok(e3.k < 0 && e3.k > -100);
});
