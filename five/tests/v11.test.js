import test from "node:test";
import assert from "node:assert/strict";
// v11 的中盤用 v9，v9 的連線長度跟著規則變體：要在載入之前設定
globalThis.FIVE_RULES_VARIANT = { len: 6, match: "group", groups: 2 };
const { searchV11 } = await import("../src/ai/v11.js");
const { searchV10, WIN } = await import("../src/ai/v10.js");
import { createEmptyBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";

// 2 組自選：id 0～31 是第 0 組、32～63 是第 1 組
const groupOf = (id) => id >> 5;
const disc = (g, face, k = 0) => ({ id: g * 32 + k, face });

test("v11：能直接連成六就連（找到那一格和那一組，分數是勝）", () => {
  const b = createEmptyBoard();
  // 第 4 列 A～E：五顆黑、第 1 組；F4 空著，G4 白、H4 黑 → 黑下 F4 翻 G4，連成六
  for (let c = 0; c < 5; c++) b[3][c] = disc(1, BLACK, c);
  b[3][6] = disc(0, WHITE); b[3][7] = disc(0, BLACK, 5);
  b[6][1] = disc(0, WHITE, 6); b[7][2] = disc(0, BLACK, 7);
  const r = searchV11(b, BLACK, groupOf, { timeMs: 200, reps: [10, 40] });
  assert.equal(r.sq, 3 * 8 + 5);
  assert.equal(r.group, 1);
  assert.equal(r.stage, "win");
});

test("v11（v10 核心，六連規則）：五連不算贏（六連規則），搜尋分數不會是勝", () => {
  const b = createEmptyBoard();
  // 第 4 列 A～D：四顆黑、第 1 組；黑下 E4 只連成五，右邊 F4 是白、G4 黑 → 連不到六
  for (let c = 0; c < 4; c++) b[3][c] = disc(1, BLACK, c);
  b[3][5] = disc(0, WHITE); b[3][6] = disc(0, BLACK, 5);
  b[6][1] = disc(0, WHITE, 6); b[7][2] = disc(0, BLACK, 7);
  const r = searchV10(b, BLACK, groupOf, { timeMs: 200, maxDepth: 1, rule: { winLen: 6 } });
  assert.ok(r.score < WIN / 2, `五連被當成勝了：${r.score}`);
});
