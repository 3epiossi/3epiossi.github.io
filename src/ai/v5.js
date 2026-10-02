/**
 * v5 演算法：宗師型 (Strategic Master)
 * 二階段搜尋：v4 depth-3 篩選所有候選 → 前 3 名以 depth-4 重新評估
 * depth-4：在 my-counter 之後再多看一層 opponent-response
 */

import { N } from "../core/constants.js";
import { opp, applyMoveToBoard, getAllLegalMoves } from "../core/rules.js";
import { evaluatePositionV3, countThreatsToSquare } from "./evaluator.js";

export function clearV5TranspositionTable() {}

function getTopCandidateSpawns(b, player, spawns, topN) {
  if (spawns.length <= topN) return spawns;
  const scored = spawns.map(m => {
    const nb = applyMoveToBoard(b, m, player);
    return { m, s: evaluatePositionV3(nb, player) };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, topN).map(x => x.m);
}

function depth4Leaf(s3, player) {
  const enemy = opp(player);
  let expSum = 0;
  for (let d3 = 1; d3 <= 6; d3++) {
    const oL = getAllLegalMoves(s3, enemy, d3);
    if (oL.captures.length === 0 && oL.spawns.length === 0) {
      expSum += evaluatePositionV3(s3, player) / 6;
      continue;
    }
    const cands = oL.captures.length > 0
      ? oL.captures
      : getTopCandidateSpawns(s3, enemy, oL.spawns, 1);
    let worst = Infinity;
    for (const oe of cands) {
      const s4 = applyMoveToBoard(s3, oe, enemy);
      const v = evaluatePositionV3(s4, player);
      if (v < worst) worst = v;
    }
    expSum += worst / 6;
  }
  return Math.round(expSum * 10) / 10;
}

export function evaluateMoveV5(b, m, player) {
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
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (postBoard[r][c] === enemy) enemyPcs++;
  if (enemyPcs === 0)
    return { algo: "v5", score: 100000, expectedFuture: 100000, escapeBonus, forcedPassCount: 0 };

  let trapPenalty = 0;
  if (m.type === "capture") {
    const recapThreats = countThreatsToSquare(postBoard, toR, toC, player);
    if (recapThreats >= 2) trapPenalty = (recapThreats / 6) * 32.0;
  }

  let expectedSum = 0;
  let forcedPassCount = 0;

  for (let d1 = 1; d1 <= 6; d1++) {
    const oppLegals = getAllLegalMoves(postBoard, enemy, d1);

    if (oppLegals.captures.length === 0 && oppLegals.spawns.length === 0) {
      forcedPassCount++;
      let bestFP = -Infinity;
      for (let fd = 1; fd <= 6; fd++) {
        const fpMoves = getAllLegalMoves(postBoard, player, fd);
        const fpCands = fpMoves.captures.length > 0
          ? fpMoves.captures
          : getTopCandidateSpawns(postBoard, player, fpMoves.spawns, 2);
        for (const fm of fpCands) {
          const sf = applyMoveToBoard(postBoard, fm, player);
          const v = depth4Leaf(sf, player);
          if (v > bestFP) bestFP = v;
        }
      }
      expectedSum += (bestFP !== -Infinity ? bestFP : (evaluatePositionV3(postBoard, player) + 38.0)) / 6;
      continue;
    }

    let minPlayerVal = Infinity;
    const enemyCands = oppLegals.captures.length > 0
      ? oppLegals.captures
      : getTopCandidateSpawns(postBoard, enemy, oppLegals.spawns, 2);

    for (const em of enemyCands) {
      const s2 = applyMoveToBoard(postBoard, em, enemy);

      let playerCounterAvg = 0;
      for (let d2 = 1; d2 <= 6; d2++) {
        const myLegals = getAllLegalMoves(s2, player, d2);
        if (myLegals.captures.length === 0 && myLegals.spawns.length === 0) {
          playerCounterAvg += (evaluatePositionV3(s2, player) - 35.0) / 6;
        } else {
          const myCands = myLegals.captures.length > 0
            ? myLegals.captures
            : getTopCandidateSpawns(s2, player, myLegals.spawns, 2);
          let maxCounter = -Infinity;
          for (const mm of myCands) {
            const s3 = applyMoveToBoard(s2, mm, player);
            const val3 = depth4Leaf(s3, player);
            if (val3 > maxCounter) maxCounter = val3;
          }
          playerCounterAvg += maxCounter / 6;
        }
      }

      if (playerCounterAvg < minPlayerVal) minPlayerVal = playerCounterAvg;
    }

    expectedSum += minPlayerVal / 6;
  }

  const expectedFuture = Math.round(expectedSum * 10) / 10;
  const score = Math.round((expectedFuture + escapeBonus - trapPenalty) * 10) / 10;
  return { algo: "v5", score, expectedFuture, escapeBonus, forcedPassCount, trapPenalty };
}
