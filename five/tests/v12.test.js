import test from "node:test";
import assert from "node:assert/strict";
// v12 跟著規則變體走：4 組連五（id 0～15 第 0 組、16～31 第 1 組…）。要在載入之前設定
globalThis.FIVE_RULES_VARIANT = { len: 5, match: "group", groups: 4 };
const { searchV12 } = await import("../src/ai/v12.js");
const { groupOf } = await import("../src/core/five-rules.js");
import { createEmptyBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";

const disc = (g, face, k = 0) => ({ id: g * 16 + k, face });

test("v12（4 組）：能直接連成五就連，而且挑對組別", () => {
  const b = createEmptyBoard();
  // 第 4 列 A～D：四顆黑、第 2 組；黑下 E4 翻 F4，連成五（只有第 2 組才算）
  for (let c = 0; c < 4; c++) b[3][c] = disc(2, BLACK, c);
  b[3][5] = disc(0, WHITE); b[3][6] = disc(0, BLACK, 5);
  b[6][1] = disc(1, WHITE, 6); b[7][2] = disc(3, BLACK, 7);
  const r = searchV12(b, BLACK, [0, 16, 42, 48], { timeMs: 200 }); // 每一組一顆代表棋
  assert.equal(r.sq, 3 * 8 + 4);
  assert.equal(groupOf(r.disc), 2);
  assert.equal(r.stage, "win");
});

test("v12（4 組）：連線的組別不對就不算（混組不會被當成連五）", () => {
  const b = createEmptyBoard();
  for (let c = 0; c < 4; c++) b[3][c] = disc(c % 2 ? 1 : 2, BLACK, c); // 混組
  b[3][5] = disc(0, WHITE); b[3][6] = disc(0, BLACK, 5);
  b[6][1] = disc(1, WHITE, 6); b[7][2] = disc(3, BLACK, 7);
  const r = searchV12(b, BLACK, [0, 16, 42, 48], { timeMs: 100 });
  assert.notEqual(r.stage, "win");
});
