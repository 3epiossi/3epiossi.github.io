/**
 * 🤖 演算法 v3：預判型 (Expectiminimax 深度 2 機率推演)
 * 機率節點 (1~6 骰全域窮舉) + 對手最佳極小化反應 (Minimizer) + PASS 特權感知
 */

import { N } from "../core/constants.js";
import { opp, applyMoveToBoard, getAllLegalMoves } from "../core/rules.js";
import { countThreatsToSquare, evaluatePositionV3 } from "./evaluator.js";

export function evaluateMoveV3(b, m, player) {
  const enemy = opp(player);
  const postBoard = applyMoveToBoard(b, m, player);
  const fromR = m.from ? m.from.r : m.fromR;
  const fromC = m.from ? m.from.c : m.fromC;
  const toR = m.to ? m.to.r : m.toR;
  const toC = m.to ? m.to.c : m.toC;

  // 1. 脫險獎勵
  let escapeBonus = 0;
  if (m.type === "capture") {
    const originThreats = countThreatsToSquare(b, fromR, fromC, player);
    const targetThreats = countThreatsToSquare(postBoard, toR, toC, player);
    if (originThreats > 0 && targetThreats === 0) {
      escapeBonus = 18;
    }
  }

  // 2. 殲滅即勝檢驗
  let enemyPcs = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (postBoard[r][c] === enemy) enemyPcs++;
    }
  }
  if (enemyPcs === 0) {
    return {
      algo: "v3",
      score: 100000,
      expectedFuture: 100000,
      escapeBonus,
      forcedPassCount: 0
    };
  }

  // 3. Expectiminimax 機率推演：窮舉對手下回合 6 種隨機骰值 (各 1/6 權重)
  let expectedSum = 0;
  let forcedPassCount = 0;

  for (let d = 1; d <= 6; d++) {
    const oppLegals = getAllLegalMoves(postBoard, enemy, d);
    const oppCaptures = oppLegals.captures;
    const oppSpawns = oppLegals.spawns;

    if (oppCaptures.length === 0 && oppSpawns.length === 0) {
      // 對手無路可走被迫 PASS，送我方免骰自選特權 (Free Pick)
      forcedPassCount++;
      const passVal = evaluatePositionV3(postBoard, player) + 35.0;
      expectedSum += passVal / 6;
      continue;
    }

    let minPlayerVal = Infinity;

    // 走法排序：優先評估吃子
    if (oppCaptures.length > 0) {
      for (const cm of oppCaptures) {
        const s2 = applyMoveToBoard(postBoard, cm, enemy);
        const val = evaluatePositionV3(s2, player);
        if (val < minPlayerVal) minPlayerVal = val;
      }
    } else {
      // 採樣評估最多 4 種代表性生子走法
      const candSpawns = oppSpawns.length > 4 ? oppSpawns.slice(0, 4) : oppSpawns;
      for (const sm of candSpawns) {
        const s2 = applyMoveToBoard(postBoard, sm, enemy);
        const val = evaluatePositionV3(s2, player);
        if (val < minPlayerVal) minPlayerVal = val;
      }
    }

    expectedSum += minPlayerVal / 6;
  }

  const expectedFuture = Math.round(expectedSum * 10) / 10;
  const score = Math.round((expectedFuture + escapeBonus) * 10) / 10;

  return {
    algo: "v3",
    score,
    expectedFuture,
    escapeBonus,
    forcedPassCount
  };
}
