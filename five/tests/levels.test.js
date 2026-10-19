import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { LEVELS, MAX_LEVEL, clampLevel, searchLevel } from "../src/ai/levels.js";
import { mulberry32 } from "./helpers.js";

test("每一級都只會選合法位置，沒有合法位置時回傳 null", () => {
  for (const cfg of LEVELS) {
    const e = new GameEngine({ rng: mulberry32(10 + cfg.id) });
    const r = searchLevel(e.board, e.currentTurn, e.pool, cfg, { timeMs: 50, rng: mulberry32(cfg.id) });
    assert.ok(e.findLegalMove(r.bestSq >> 3, r.bestSq & 7), `第 ${cfg.id} 級`);
    assert.ok(e.pool.includes(r.disc), `第 ${cfg.id} 級的棋要在池子裡`);
    const empty = e.board.map(row => row.map(() => null));
    assert.equal(searchLevel(empty, 1, e.pool, cfg, { timeMs: 50 }), null);
  }
});

test("第 1 級：池子裡任何一顆能一步連成五就一定下，否則隨機", () => {
  let sawFive = 0;
  for (let g = 0; g < 30; g++) {
    const e = new GameEngine({ rng: mulberry32(300 + g) });
    const rng = mulberry32(g);
    while (!e.gameOver) {
      if (!e.legalMoves().length) { e.passTurn(); continue; }
      const r = searchLevel(e.board, e.currentTurn, e.pool, LEVELS[0], { rng });
      e.executeMove(r.bestSq >> 3, r.bestSq & 7, r.disc);
    }
    if (e.settlementData.byFive) sawFive++;
  }
  assert.ok(sawFive > 0);
});

test("clampLevel 把輸入限制在 1～最高級，亂填就用最高級", () => {
  assert.equal(clampLevel(0), MAX_LEVEL); // 0 視為沒填
  assert.equal(clampLevel(-3), 1);
  assert.equal(clampLevel(99), MAX_LEVEL);
  assert.equal(clampLevel("3"), 3);
  assert.equal(clampLevel(undefined), MAX_LEVEL);
});

test("7 個等級：第 6 級是完整的 v13、第 7 級是完整的 v14，只有這兩級按時間搜尋", async () => {
  const { LEVELS, isTimedLevel, MAX_LEVEL } = await import("../src/ai/levels.js");
  assert.equal(MAX_LEVEL, 7);
  assert.equal(LEVELS[5].engine, "v13");
  assert.equal(LEVELS[6].engine, "v14");
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(isTimedLevel), [false, false, false, false, false, true, true]);
});

test("舊存檔選的是最強（第 6 級）→ 換成新的最強第 7 級，只換一次；之後改回 6 級會留著", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const { Storage } = await import("../src/storage/storage.js");
    Storage.saveSettings({ blackLevel: 6, whiteLevel: 3, timeV2: true, symbolsV2: true });
    let s = Storage.getSettings();
    assert.equal(s.blackLevel, 7); assert.equal(s.whiteLevel, 3);
    s.blackLevel = 6; Storage.saveSettings(s);
    assert.equal(Storage.getSettings().blackLevel, 6);
  } finally {
    delete globalThis.localStorage;
  }
});
