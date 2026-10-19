import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { remainingBag } from "../src/core/rules.js";
import { mulberry32, playGame } from "./helpers.js";

const newEngine = (seed = 7) => new GameEngine({ rng: mulberry32(seed) });

test("開局：黑先手、池子是 4 組各一顆、盤上 4 顆、每組剩 15 顆", () => {
  const e = newEngine();
  assert.equal(e.currentTurn, BLACK);
  assert.equal(e.pool.length, 4);
  assert.equal(e.hand, e.pool[0]);
  assert.deepEqual(e.groupCounts(), [15, 15, 15, 15]);
  assert.equal(e.board.flat().filter(Boolean).length, 4);
});

test("選擇池子裡的棋會改變 hand；不在池子裡的棋不能下也不能選", () => {
  const e = newEngine();
  const m = e.legalMoves()[0];
  const outside = 63; // 第 4 組的最後一顆，開局時不在池子裡
  assert.ok(!e.pool.includes(outside));
  assert.equal(e.executeMove(m.r, m.c, outside), false);
  assert.equal(e.selectDisc(outside), false);
  assert.ok(e.selectDisc(e.pool[3]));
  assert.equal(e.hand, e.pool[3]);
  assert.ok(e.executeMove(m.r, m.c));
  assert.equal(e.board[m.r][m.c].face, BLACK);
});

test("落子時手上的棋以下棋者的顏色朝上，換到對手，那一組換下一顆", () => {
  const e = newEngine();
  const m = e.legalMoves()[0];
  const handBefore = e.hand;
  assert.ok(e.executeMove(m.r, m.c));
  assert.equal(e.board[m.r][m.c].id, handBefore);
  assert.equal(e.board[m.r][m.c].face, BLACK);
  assert.equal(e.currentTurn, WHITE);
  assert.notEqual(e.hand, handBefore);
});

test("非法位置不會改變狀態", () => {
  const e = newEngine();
  const before = JSON.stringify(e.board);
  assert.equal(e.executeMove(0, 0), false);
  assert.equal(JSON.stringify(e.board), before);
});

test("自動對局可以打完：棋盤與歷史一致、64 顆棋不重複", () => {
  const e = playGame({ seed: 3 });
  assert.ok(e.gameOver);
  const ids = e.board.flat().filter(Boolean).map(d => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(remainingBag(e.board, null).length + ids.length, 64);
  assert.ok(e.settlementData);
  const tip = e.tree.getBranchTipNode();
  assert.equal(tip.gameOver, true);
});

test("PASS：池子不變，輪到對手", () => {
  const e = newEngine();
  e.board = e.board.map(row => row.map(() => null)); // 清空後沒有任何合法步
  e.currentTurn = BLACK;
  assert.equal(e.legalMoves().length, 0);
  const poolBefore = [...e.pool];
  e.passTurn();
  assert.equal(e.gameOver, true); // 雙方都沒有合法位置 → 終局
  assert.deepEqual(e.pool, poolBefore);
});

test("時光機：跳回歷史節點可還原棋盤、輪次與池子", () => {
  const e = newEngine(11);
  const root = e.tree.getCurrentNode();
  const rootBoard = JSON.stringify(e.board);
  const rootPool = [...e.pool];
  const rootHand = e.hand;
  const m = e.legalMoves()[0];
  e.executeMove(m.r, m.c);
  assert.ok(e.jumpToNode(root.id));
  assert.equal(JSON.stringify(e.board), rootBoard);
  assert.equal(e.hand, rootHand);
  assert.deepEqual(e.pool, rootPool);
  assert.equal(e.currentTurn, BLACK);
});

test("歷史局面不能直接落子；從這裡開始下會建立新分支並保留原路線", () => {
  const e = newEngine(5);
  const root = e.tree.getCurrentNode();
  const m = e.legalMoves()[0];
  e.executeMove(m.r, m.c);
  const mainLen = e.tree.getBranchHistory().length;

  e.jumpToNode(root.id);
  const m2 = e.legalMoves()[0];
  assert.equal(e.executeMove(m2.r, m2.c), false); // 非端點

  e.startFromHere(root.id);
  assert.equal(e.tree.branches.size, 2);
  assert.ok(e.executeMove(m2.r, m2.c));
  e.tree.switchBranch("main");
  assert.equal(e.tree.getBranchHistory().length, mainLen);
});

test("歷史某一步直接下棋會開分支；退回分岔那一步或更早，分支消失回到主線", () => {
  const e = newEngine(13);
  for (let i = 0; i < 6; i++) { const m = e.legalMoves()[0]; e.executeMove(m.r, m.c); }
  const mainLen = e.tree.getBranchHistory().length; // 7（#0～#6）
  assert.ok(e.goToStep(3));
  // 在第 3 步改下別的
  const alt = e.legalMoves().at(-1);
  assert.ok(e.playMove(alt.r, alt.c, e.pool[1]));
  assert.equal(e.tree.branches.size, 2);
  assert.equal(e.tree.getBranchHistory().length, 5); // #0～#3 + 新的一步
  // 主線還在
  assert.equal(e.tree.getBranchHistory("main").length, mainLen);
  // 在分支裡退到分岔點之後（第 4 步）不會消失
  assert.ok(e.goToStep(4));
  assert.equal(e.tree.branches.size, 2);
  // 退回分岔那一步：分支消失、回到主線
  assert.ok(e.goToStep(3));
  assert.equal(e.tree.branches.size, 1);
  assert.equal(e.tree.activeBranchId, "main");
  assert.equal(e.tree.getBranchHistory().length, mainLen);
});

test("分支裡的歷史某一步改下：後面的分支內容換掉，不會多開分支", () => {
  const e = newEngine(14);
  for (let i = 0; i < 4; i++) { const m = e.legalMoves()[0]; e.executeMove(m.r, m.c); }
  e.goToStep(2);
  let m = e.legalMoves().at(-1); e.playMove(m.r, m.c);
  for (let i = 0; i < 3; i++) { m = e.legalMoves()[0]; e.playMove(m.r, m.c); }
  const branchId = e.tree.activeBranchId;
  assert.equal(e.tree.getBranchHistory().length, 7); // #0～#2 + 4 步
  e.goToStep(4);
  m = e.legalMoves().at(-1);
  assert.ok(e.playMove(m.r, m.c));
  assert.equal(e.tree.activeBranchId, branchId);
  assert.equal(e.tree.branches.size, 2);
  assert.equal(e.tree.getBranchHistory().length, 6); // #0～#4 + 新的一步
  // 刪掉的節點不留在對局樹裡
  for (const node of e.tree.nodes.values()) if (node.parentId) assert.ok(e.tree.nodes.has(node.parentId));
});
