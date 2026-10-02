/**
 * 🤖 演算法 v4：反擊型 (深度反擊 - 3 層 Expectiminimax 博弈樹)
 * 我方落子 ➔ 敵方 6 骰 Min ➔ 我方 6 骰最優反擊 Max ➔ 終葉局面
 * 克服 v3 地平線盲點與吃子反撲盲區，具備兌子換子風險預警與抓破綻反殺實力
 */

import { N } from "../core/constants.js";
import { opp, applyMoveToBoard, getAllLegalMoves } from "../core/rules.js";
import { countThreatsToSquare, evaluatePositionV3 } from "./evaluator.js";

function getTopCandidateSpawns(b, player, spawns, topN = 2) {
  if (spawns.length <= topN) return spawns;
  const scored = spawns.map(m => {
    const nextB = applyMoveToBoard(b, m, player);
    return { m, s: evaluatePositionV3(nextB, player) };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, topN).map(x => x.m);
}

export function evaluateMoveV4(b, m, player) {
  const enemy = opp(player);
  const postBoard = applyMoveToBoard(b, m, player);
  const fromR = m.from ? m.from.r : m.fromR;
  const fromC = m.from ? m.from.c : m.fromC;
  const toR = m.to ? m.to.r : m.toR;
  const toC = m.to ? m.to.c : m.toC;

  let escapeBonus = 0;
  if (m.type === "capture") {
    const originThreats = countThreatsToSquare(b, fromR, fromC, player);
    const targetThreats = countThreatsToSquare(postBoard, toR, toC, player);
    if (originThreats > 0 && targetThreats === 0) escapeBonus = 18;
  }

  let enemyPcs = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (postBoard[r][c] === enemy) enemyPcs++;
    }
  }
  if (enemyPcs === 0) {
    return { algo: "v4", score: 100000, expectedFuture: 100000, escapeBonus, forcedPassCount: 0 };
  }

  // 戰術陷阱預警：若吃子後該格有 >= 2 骰可反吃，施加換子風險懲罰
  let trapPenalty = 0;
  if (m.type === "capture") {
    const recapThreats = countThreatsToSquare(postBoard, toR, toC, player);
    if (recapThreats >= 2) {
      trapPenalty = (recapThreats / 6) * 32.0;
    }
  }

  let expectedSum = 0;
  let forcedPassCount = 0;

  for (let d1 = 1; d1 <= 6; d1++) {
    const oppLegals = getAllLegalMoves(postBoard, enemy, d1);
    const oppCaptures = oppLegals.captures;
    const oppSpawns = oppLegals.spawns;

    if (oppCaptures.length === 0 && oppSpawns.length === 0) {
      forcedPassCount++;
      let bestFP = -Infinity;
      for (let fd = 1; fd <= 6; fd++) {
        const myMoves = getAllLegalMoves(postBoard, player, fd);
        const myCands = myMoves.captures.length > 0 ? myMoves.captures : getTopCandidateSpawns(postBoard, player, myMoves.spawns, 2);
        for (const fm of myCands) {
          const s = applyMoveToBoard(postBoard, fm, player);
          const v = evaluatePositionV3(s, player);
          if (v > bestFP) bestFP = v;
        }
      }
      expectedSum += (bestFP !== -Infinity ? bestFP : (evaluatePositionV3(postBoard, player) + 38.0)) / 6;
      continue;
    }

    let minPlayerVal = Infinity;
    const enemyCands = oppCaptures.length > 0 ? oppCaptures : getTopCandidateSpawns(postBoard, enemy, oppSpawns, 2);

    for (const em of enemyCands) {
      const s2 = applyMoveToBoard(postBoard, em, enemy);

      // Ply 3: 我方面對 6 骰之反擊期望值
      let playerCounterAvg = 0;
      for (let d2 = 1; d2 <= 6; d2++) {
        const myLegals = getAllLegalMoves(s2, player, d2);
        if (myLegals.captures.length === 0 && myLegals.spawns.length === 0) {
          playerCounterAvg += (evaluatePositionV3(s2, player) - 35.0) / 6;
        } else {
          const myCands = myLegals.captures.length > 0 ? myLegals.captures : getTopCandidateSpawns(s2, player, myLegals.spawns, 2);
          let maxCounter = -Infinity;
          for (const mm of myCands) {
            const s3 = applyMoveToBoard(s2, mm, player);
            const val3 = evaluatePositionV3(s3, player);
            if (val3 > maxCounter) maxCounter = val3;
          }
          playerCounterAvg += maxCounter / 6;
        }
      }

      if (playerCounterAvg < minPlayerVal) {
        minPlayerVal = playerCounterAvg;
      }
    }

    expectedSum += minPlayerVal / 6;
  }

  const expectedFuture = Math.round(expectedSum * 10) / 10;
  const score = Math.round((expectedFuture + escapeBonus - trapPenalty) * 10) / 10;
  return { algo: "v4", score, expectedFuture, escapeBonus, forcedPassCount, trapPenalty };
}
