/**
 * v5 vs v4 benchmark: runs N games and reports win rates
 * Usage: node tests/v5-benchmark.js [numGames]
 */

import { createInitialBoard, getAllLegalMoves, applyMoveToBoard, canCaptureEver, fillTerritoryRule1Rule2, calculateSettlement, opp } from "../src/core/rules.js";
import { BLACK, WHITE, N, EMPTY, DEFAULT_KOMI } from "../src/core/constants.js";
import { findBestMoveForCPU } from "../src/ai/ai-service.js";
import { clearTranspositionTable } from "../src/ai/evaluator.js";
import { clearV5TranspositionTable } from "../src/ai/v5.js";

const NUM_GAMES = parseInt(process.argv[2]) || 20;

function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function playGame(blackAlgo, whiteAlgo) {
  let board = createInitialBoard();
  let turn = BLACK;
  let moveCount = 0;
  const MAX_MOVES = 300;
  let consecutivePasses = 0;

  while (moveCount < MAX_MOVES) {
    const algo = turn === BLACK ? blackAlgo : whiteAlgo;
    const dice = rollDice();
    const legals = getAllLegalMoves(board, turn, dice);

    if (legals.captures.length === 0 && legals.spawns.length === 0) {
      consecutivePasses++;
      if (consecutivePasses >= 12) break;

      // Privilege: other player gets free pick
      const other = opp(turn);
      const otherAlgo = other === BLACK ? blackAlgo : whiteAlgo;
      const result = findBestMoveForCPU(board, other, null, otherAlgo);
      if (result && result.chosen) {
        board = applyMoveToBoard(board, result.chosen, other);
      }
      turn = other;
      moveCount++;
      continue;
    }

    consecutivePasses = 0;
    const result = findBestMoveForCPU(board, turn, dice, algo);
    if (result && result.chosen) {
      board = applyMoveToBoard(board, result.chosen, turn);
    }

    turn = opp(turn);
    moveCount++;

    if (!canCaptureEver(board)) break;
  }

  const { filledBoard } = fillTerritoryRule1Rule2(board, BLACK);
  const settlement = calculateSettlement(filledBoard, DEFAULT_KOMI);

  clearTranspositionTable();
  clearV5TranspositionTable();

  return { winner: settlement.winner, bTotal: settlement.bTotal, wFinal: settlement.wFinal, moves: moveCount };
}

console.log(`\n🏆 v5 vs v4 Benchmark: ${NUM_GAMES} games\n`);
console.log("=" .repeat(60));

// Round 1: v5 as Black, v4 as White
let v5WinsAsBlack = 0, v4WinsAsWhite = 0, drawsR1 = 0;
console.log(`\n📊 Round 1: ⚫ v5 (Black) vs ⚪ v4 (White) — ${NUM_GAMES / 2} games`);

for (let i = 0; i < NUM_GAMES / 2; i++) {
  const t0 = Date.now();
  const result = playGame("v5", "v4");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const tag = result.winner === BLACK ? "v5 WIN" : result.winner === WHITE ? "v4 WIN" : "DRAW";
  console.log(`  Game ${i + 1}: ${tag} (B:${result.bTotal} W:${result.wFinal}) ${result.moves} moves ${elapsed}s`);

  if (result.winner === BLACK) v5WinsAsBlack++;
  else if (result.winner === WHITE) v4WinsAsWhite++;
  else drawsR1++;
}

// Round 2: v4 as Black, v5 as White
let v5WinsAsWhite = 0, v4WinsAsBlack = 0, drawsR2 = 0;
console.log(`\n📊 Round 2: ⚫ v4 (Black) vs ⚪ v5 (White) — ${NUM_GAMES / 2} games`);

for (let i = 0; i < NUM_GAMES / 2; i++) {
  const t0 = Date.now();
  const result = playGame("v4", "v5");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const tag = result.winner === WHITE ? "v5 WIN" : result.winner === BLACK ? "v4 WIN" : "DRAW";
  console.log(`  Game ${i + 1}: ${tag} (B:${result.bTotal} W:${result.wFinal}) ${result.moves} moves ${elapsed}s`);

  if (result.winner === WHITE) v5WinsAsWhite++;
  else if (result.winner === BLACK) v4WinsAsBlack++;
  else drawsR2++;
}

const totalV5 = v5WinsAsBlack + v5WinsAsWhite;
const totalV4 = v4WinsAsWhite + v4WinsAsBlack;
const totalDraws = drawsR1 + drawsR2;

console.log("\n" + "=".repeat(60));
console.log(`\n🏆 FINAL RESULTS (${NUM_GAMES} games total):`);
console.log(`   v5 wins: ${totalV5} (${(totalV5 / NUM_GAMES * 100).toFixed(0)}%)`);
console.log(`   v4 wins: ${totalV4} (${(totalV4 / NUM_GAMES * 100).toFixed(0)}%)`);
console.log(`   draws:   ${totalDraws}`);
console.log(`   v5 as Black: ${v5WinsAsBlack}W / ${v4WinsAsWhite}L`);
console.log(`   v5 as White: ${v5WinsAsWhite}W / ${v4WinsAsBlack}L`);
console.log();
