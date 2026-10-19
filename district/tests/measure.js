/**
 * 劃區爭霸 (District) - 對局平衡與 AI 表現量測腳本 (CPU vs CPU)
 */

import { GameEngine } from "../src/core/game-engine.js";
import { AIPlayer } from "../src/ai/ai-player.js";

/** 計算「每格各自多數決」的得勝者（無任何劃區阻隔，每格第一名拿走該格的選舉人票） */
export function calculateCellByCellWinner(map, numPlayers) {
  const votes = Array(numPlayers).fill(0);
  const size = map.boardSize;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = map.cells[r][c];
      const support = cell.trueSupport;
      const cellEv = cell.electoralVotes ?? 100;
      let maxVal = -1;
      let winners = [];
      for (let p = 0; p < numPlayers; p++) {
        if (support[p] > maxVal) {
          maxVal = support[p];
          winners = [p];
        } else if (support[p] === maxVal) {
          winners.push(p);
        }
      }
      const split = cellEv / winners.length;
      for (const w of winners) votes[w] += split;
    }
  }

  let maxV = -1;
  let topPlayer = null;
  let tie = false;
  for (let p = 0; p < numPlayers; p++) {
    if (votes[p] > maxV) {
      maxV = votes[p];
      topPlayer = p;
      tie = false;
    } else if (votes[p] === maxV) {
      tie = true;
    }
  }

  return tie ? null : topPlayer;
}

/** 執行單盤 CPU 對 CPU 模擬 */
export function simulateOneGame(numPlayers, seed, k = null) {
  const engine = new GameEngine({ numPlayers, seed, k });
  const ais = Array.from({ length: numPlayers }, (_, i) => new AIPlayer(i));

  let turns = 0;
  const maxTurns = 80;

  while (!engine.isGameOver && turns++ < maxTurns) {
    const ai = ais[engine.currentPlayer];
    const move = ai.decideMove(engine);

    if (move.action === "place") {
      const res = engine.placeWall(move.poolIndex, move.vr, move.vc);
      if (!res.success) {
        engine.pass();
      }
    } else {
      engine.pass();
    }
  }

  const final = engine.finalResults;
  const pollWinner = final.pollResults.winner;
  const trueWinner = final.winner;
  const isDraw = final.isGameTie;

  // 民調翻盤判定：暫定勝者與真實勝者不同，或至少有 1 個選區發生翻盤
  const isPollFlipped = pollWinner !== trueWinner;
  const flippedDistricts = final.electionNightOrder.filter(r => r.isFlipped).length;

  // 區域統計
  const regions = final.electionNightOrder;
  const singleCellRegions = regions.filter(r => r.size === 1).length;
  const totalRegions = regions.length;

  // 每格多數決比較
  const cellByCellWinner = calculateCellByCellWinner(engine.map, numPlayers);
  const matchCellByCell = trueWinner !== null && trueWinner === cellByCellWinner;

  return {
    turns: engine.turnCount,
    wallsPlaced: engine.boardState.placedWalls.length,
    trueWinner,
    pollWinner,
    isDraw,
    isPollFlipped,
    flippedDistricts,
    singleCellRegions,
    totalRegions,
    matchCellByCell
  };
}

/** 批次量測指定人數多盤 */
export function runMeasurement(numPlayers, gameCount = 50, k = null) {
  const seatWins = Array(numPlayers).fill(0);
  let draws = 0;
  let pollFlippedGames = 0;
  let totalFlippedDistricts = 0;
  let totalSingleCellRegions = 0;
  let totalRegionsAllGames = 0;
  let matchedCellByCellCount = 0;
  let totalWalls = 0;
  let totalTurns = 0;

  for (let i = 0; i < gameCount; i++) {
    const seed = 1000 + i * 17;
    const res = simulateOneGame(numPlayers, seed, k);

    if (res.isDraw) {
      draws++;
    } else if (res.trueWinner !== null) {
      seatWins[res.trueWinner]++;
    }

    if (res.isPollFlipped) pollFlippedGames++;
    totalFlippedDistricts += res.flippedDistricts;
    totalSingleCellRegions += res.singleCellRegions;
    totalRegionsAllGames += res.totalRegions;
    if (res.matchCellByCell) matchedCellByCellCount++;
    totalWalls += res.wallsPlaced;
    totalTurns += res.turns;
  }

  const decidedGames = gameCount - draws;
  const winRates = seatWins.map(w => decidedGames > 0 ? (w / gameCount) : 0);
  const tieRate = draws / gameCount;
  const flipRate = pollFlippedGames / gameCount;
  const avgDistricts = totalRegionsAllGames / gameCount;
  const singleCellRatio = totalRegionsAllGames > 0 ? (totalSingleCellRegions / totalRegionsAllGames) : 0;
  const cellByCellMatchRate = gameCount > 0 ? (matchedCellByCellCount / gameCount) : 0;
  const avgWalls = totalWalls / gameCount;
  const avgTurns = totalTurns / gameCount;

  return {
    numPlayers,
    gameCount,
    seatWins,
    winRates,
    tieRate,
    flipRate,
    avgDistricts,
    avgFlippedDistricts: totalFlippedDistricts / gameCount,
    singleCellRatio,
    cellByCellMatchRate,
    avgWalls,
    avgTurns
  };
}

/** CLI 執行入口 */
if (process.argv[1]?.endsWith("measure.js")) {
  const args = process.argv.slice(2);
  let games = 20;
  const gamesIdx = args.indexOf("--games");
  if (gamesIdx !== -1 && args[gamesIdx + 1]) {
    games = parseInt(args[gamesIdx + 1], 10);
  }

  console.log(`\n========================================================`);
  console.log(`🎯 劃區爭霸 (District) - 量測報告 (每模式 ${games} 盤)`);
  console.log(`========================================================\n`);

  for (const n of [2, 3, 4]) {
    console.log(`正在量測 ${n} 人局 (共 ${games} 盤)...`);
    const t0 = Date.now();
    const rep = runMeasurement(n, games);
    const cost = ((Date.now() - t0) / 1000).toFixed(2);

    console.log(`\n--- ${n} 人局量測結果 (${games} 盤，耗時 ${cost} 秒) ---`);
    console.log(`座位勝率: ${rep.winRates.map((r, i) => `P${i}: ${(r * 100).toFixed(1)}%`).join(" | ")}`);
    console.log(`平手率: ${(rep.tieRate * 100).toFixed(1)}% (目標: ≤ 10%)`);
    console.log(`大選總結果翻盤率: ${(rep.flipRate * 100).toFixed(1)}% | 平均每局翻盤選區數: ${rep.avgFlippedDistricts.toFixed(2)} 區`);
    console.log(`平均切出選區數: ${rep.avgDistricts.toFixed(1)} 區 | 單格區域占比: ${(rep.singleCellRatio * 100).toFixed(1)}%`);
    console.log(`與每格多數決相同率: ${(rep.cellByCellMatchRate * 100).toFixed(1)}%`);
    console.log(`平均放牆數: ${rep.avgWalls.toFixed(1)} 塊 | 平均手數: ${rep.avgTurns.toFixed(1)} 手\n`);
  }
}
