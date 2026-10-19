import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { XOT_OPENINGS, decodeXot, randomXot } from "../src/core/xot-openings.js";
import { groupOf, findFive } from "../src/core/five-rules.js";
import { mulberry32 } from "./helpers.js";

test("XOT 開局：每一個都能照著下完（6～10 手、合法、那一組有棋），下完沒人連成五、輪到的一方有地方下", () => {
  assert.ok(XOT_OPENINGS.length >= 50);
  for (const s of XOT_OPENINGS) {
    const o = decodeXot(s);
    assert.deepEqual([...o.init].sort(), [0, 1, 2, 3]);
    assert.ok(o.moves.length >= 6 && o.moves.length <= 10, s);
    const e = new GameEngine({ rng: mulberry32(1) });
    e.resetGame(o);
    const line = e.tree.getBranchHistory();
    assert.equal(line.length, o.moves.length + 1, `沒下完：${s}`);
    // 中間四顆照 init 排（D4、E4、D5、E5）
    assert.deepEqual([line[0].board[3][3], line[0].board[3][4], line[0].board[4][3], line[0].board[4][4]].map(d => groupOf(d.id)), o.init);
    // 每一手下的是指定的組別、記成 XOT
    o.moves.forEach(([sq, g], i) => {
      const n = line[i + 1];
      assert.equal(n.actor, "xot");
      assert.equal(n.move.r * 8 + n.move.c, sq);
      assert.equal(groupOf(n.move.discId), g);
    });
    assert.equal(e.gameOver, false);
    assert.equal(findFive(e.board, 1) || findFive(e.board, 2), null);
    assert.ok(e.legalMoves().length > 0);
  }
});

test("XOT 開局：開新局只通知一次（不會每一手都播音效）；randomXot 每次挑一個", () => {
  const e = new GameEngine({ rng: mulberry32(2) });
  const events = [];
  e.subscribe((ev) => events.push(ev));
  e.resetGame(randomXot(mulberry32(5)));
  assert.deepEqual(events, ["GAME_RESET"]);
  const picks = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(randomXot(mulberry32(100 + i)))));
  assert.ok(picks.size > 5);
});
