import test from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE } from "../src/core/constants.js";
import {
  createEmptyBoard, createDisc, discId, whiteWeight, blackWeight, weightOf, flipsFor, getLegalMoves,
  applyMoveToBoard, computeScores, calculateSettlement, remainingBag, isGameOver, createInitialBoard
} from "../src/core/rules.js";

test("64 顆棋剛好是 (白面, 黑面) 1～8 的所有組合，各一次", () => {
  const seen = new Set();
  for (let id = 0; id < 64; id++) {
    const w = whiteWeight(id), b = blackWeight(id);
    assert.ok(w >= 1 && w <= 8 && b >= 1 && b <= 8);
    assert.equal(discId(w, b), id);
    seen.add(`${w},${b}`);
  }
  assert.equal(seen.size, 64);
});

test("weightOf 依朝上顏色取對應面的權重", () => {
  const id = discId(3, 7); // 白面 3、黑面 7
  assert.equal(weightOf(id, WHITE), 3);
  assert.equal(weightOf(id, BLACK), 7);
});

test("夾住對手的棋才算合法，並翻出正確的棋", () => {
  const b = createEmptyBoard();
  b[3][3] = createDisc(0, WHITE);
  b[3][4] = createDisc(1, BLACK);
  assert.deepEqual(flipsFor(b, 3, 2, BLACK), [[3, 3]]);
  assert.deepEqual(flipsFor(b, 0, 0, BLACK), []);
  assert.deepEqual(flipsFor(b, 3, 3, BLACK), []); // 已有棋
});

test("落子後翻面，原棋盤不被修改", () => {
  const b = createEmptyBoard();
  b[3][3] = createDisc(discId(5, 2), WHITE);
  b[3][4] = createDisc(1, BLACK);
  const move = getLegalMoves(b, BLACK)[0];
  const nb = applyMoveToBoard(b, move, 40, BLACK);
  assert.equal(nb[3][3].face, BLACK);
  assert.equal(nb[3][2].id, 40);
  assert.equal(b[3][3].face, WHITE);
  assert.equal(b[3][2], null);
});

test("計分是各自朝上那面的權重總和，不是顆數", () => {
  const b = createEmptyBoard();
  b[0][0] = createDisc(discId(1, 8), BLACK); // 黑面朝上：+8
  b[0][1] = createDisc(discId(2, 1), BLACK); // +1
  b[0][2] = createDisc(discId(3, 1), WHITE); // 白面朝上：+3
  b[0][3] = createDisc(discId(4, 1), WHITE); // +4
  b[0][4] = createDisc(discId(5, 1), WHITE); // +5
  const s = computeScores(b);
  assert.equal(s.black, 9);
  assert.equal(s.white, 12);
  assert.equal(s.blackCount, 2);
  assert.equal(s.whiteCount, 3);
  assert.equal(calculateSettlement(b).winner, WHITE);
});

test("同分為平手", () => {
  const b = createEmptyBoard();
  b[0][0] = createDisc(discId(1, 5), BLACK);
  b[0][1] = createDisc(discId(5, 1), WHITE);
  assert.equal(calculateSettlement(b).winner, 0);
});

test("remainingBag 排除盤面與手上的棋", () => {
  const b = createEmptyBoard();
  b[0][0] = createDisc(10, BLACK);
  b[0][1] = createDisc(20, WHITE);
  const bag = remainingBag(b, 30);
  assert.equal(bag.length, 61);
  for (const id of [10, 20, 30]) assert.ok(!bag.includes(id));
});

test("開局四顆棋互不重複，且是標準黑白棋配置", () => {
  let next = 0;
  const b = createInitialBoard(() => next++);
  const faces = [b[3][3].face, b[3][4].face, b[4][3].face, b[4][4].face];
  assert.deepEqual(faces, [WHITE, BLACK, BLACK, WHITE]);
  assert.equal(isGameOver(b), false);
});
