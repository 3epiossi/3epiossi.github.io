import { tx } from "../src/i18n.js";
import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { BLACK, WHITE, MOVE_TYPE } from "../src/core/constants.js";

test("GameEngine initializes with correct initial state", () => {
  const engine = new GameEngine();
  const state = engine.getState();
  assert.equal(state.currentTurn, BLACK);
  assert.equal(state.board[0][0], WHITE);
  assert.equal(state.board[7][7], BLACK);
  assert.equal(state.gameOver, false);
});

test("canControlDice rejects on CPU turn", () => {
  const engine = new GameEngine({
    blackPlayerType: "cpu",
    whitePlayerType: "human"
  });
  assert.equal(engine.canControlDice(), false);
});

test("executeMove applies move and advances game tree", () => {
  const engine = new GameEngine({
    blackPlayerType: "human",
    whitePlayerType: "human"
  });

  engine.rollDice(1);
  const state1 = engine.getState();
  assert.equal(state1.diceValue, 1);

  // Black at (7,7) moves to (6,7)
  const success = engine.executeMove({
    from: { r: 7, c: 7 },
    to: { r: 6, c: 7 },
    fromR: 7,
    fromC: 7,
    toR: 6,
    toC: 7,
    type: MOVE_TYPE.SPAWN,
    path: [{ r: 7, c: 7 }, { r: 6, c: 7 }]
  });

  assert.equal(success, true);
  const state2 = engine.getState();
  assert.equal(state2.board[6][7], BLACK);
  assert.equal(state2.currentTurn, WHITE); // next turn is White

  const tree = engine.tree;
  assert.equal(tree.getCurrentNode().stepIdx, 1);
});

test("GameTree supports branching and compare", () => {
  const engine = new GameEngine();
  const rootNode = engine.tree.getCurrentNode();

  const branchInfo = engine.tree.createBranchFromNode(rootNode.id, "分支測試");
  assert.ok(branchInfo);
  assert.equal(branchInfo.name, "分支測試");

  const comparison = engine.tree.compareBranches("main", branchInfo.branchId);
  assert.ok(comparison);
  assert.equal(tx(comparison.branchA.name), "主線");
});
