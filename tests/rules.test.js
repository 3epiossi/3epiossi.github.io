import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialBoard,
  getLegalMovesForPiece,
  getAllLegalMoves,
  applyMoveToBoard,
  canCaptureEver,
  fillTerritoryRule1Rule2,
  calculateSettlement,
  opp,
  posToCoord,
  coordToPos
} from "../src/core/rules.js";
import { BLACK, WHITE, EMPTY, MOVE_TYPE } from "../src/core/constants.js";

test("opp returns correct opposite player", () => {
  assert.equal(opp(BLACK), WHITE);
  assert.equal(opp(WHITE), BLACK);
});

test("coord conversions", () => {
  assert.equal(posToCoord(0, 0), "A1");
  assert.equal(posToCoord(7, 7), "H8");
  assert.deepEqual(coordToPos("A1"), { r: 0, c: 0 });
  assert.deepEqual(coordToPos("H8"), { r: 7, c: 7 });
});

test("initial board has White at A1 and Black at H8", () => {
  const b = createInitialBoard();
  assert.equal(b[0][0], WHITE);
  assert.equal(b[7][7], BLACK);
  assert.equal(b[0][1], EMPTY);
});

test("Black moves left or up; White moves right or down", () => {
  const b = createInitialBoard();
  // Black at H8 (7,7) with dice 1
  const bMoves = getLegalMovesForPiece(b, 7, 7, BLACK, 1);
  assert.equal(bMoves.spawns.length, 2); // (6,7) and (7,6)
  assert.equal(bMoves.captures.length, 0);

  // White at A1 (0,0) with dice 1
  const wMoves = getLegalMovesForPiece(b, 0, 0, WHITE, 1);
  assert.equal(wMoves.spawns.length, 2); // (1,0) and (0,1)
  assert.equal(wMoves.captures.length, 0);
});

test("Straight line capture rule works", () => {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  b[2][4] = BLACK;
  b[2][1] = WHITE; // 3 steps to the left of (2,4)

  // Black with dice 3
  const moves = getLegalMovesForPiece(b, 2, 4, BLACK, 3);
  assert.equal(moves.captures.length, 1);
  assert.equal(moves.captures[0].toR, 2);
  assert.equal(moves.captures[0].toC, 1);
  assert.equal(moves.captures[0].type, MOVE_TYPE.CAPTURE);

  // Applying capture move
  const postBoard = applyMoveToBoard(b, moves.captures[0], BLACK);
  assert.equal(postBoard[2][4], EMPTY); // origin cleared
  assert.equal(postBoard[2][1], BLACK); // target replaced
});

test("Friendly piece passes through; enemy piece blocks", () => {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  b[7][7] = BLACK;
  b[7][6] = BLACK; // Friendly in between

  // Black at (7,7) moving left 2 steps: should pass through (7,6) to reach (7,5)
  const moves = getLegalMovesForPiece(b, 7, 7, BLACK, 2);
  const reached = moves.spawns.some(m => m.toR === 7 && m.toC === 5);
  assert.equal(reached, true);

  // If (7,6) is enemy White, it blocks completely
  b[7][6] = WHITE;
  const blockedMoves = getLegalMovesForPiece(b, 7, 7, BLACK, 2);
  const reachedBlocked = blockedMoves.spawns.some(m => m.toR === 7 && m.toC === 5);
  assert.equal(reachedBlocked, false);
});

test("canCaptureEver detects geometric separation", () => {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  // White already past Black: White at bottom right (7,7), Black at top left (0,0)
  b[7][7] = WHITE;
  b[0][0] = BLACK;
  assert.equal(canCaptureEver(b), false);

  // Standard initial board can capture
  const bInit = createInitialBoard();
  assert.equal(canCaptureEver(bInit), true);
});

test("calculateSettlement computes score with Komi correctly", () => {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  b[0][0] = WHITE;
  b[0][1] = WHITE; // 2 White
  b[7][7] = BLACK;
  b[7][6] = BLACK;
  b[7][5] = BLACK; // 3 Black

  // With Komi +3.5: White total = 2 + 3.5 = 5.5. Black = 3. White wins!
  const res = calculateSettlement(b, 3.5);
  assert.equal(res.bTotal, 3);
  assert.equal(res.wBoard, 2);
  assert.equal(res.wFinal, 5.5);
  assert.equal(res.winner, WHITE);
  assert.equal(res.margin, 2.5);
});
