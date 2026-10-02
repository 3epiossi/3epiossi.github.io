/**
 * 🤖 演算法 v2：戰術型 (戰術進階大局)
 * 考量邊際拓地、敵方壓制、落子危險性防禦、脫險獎勵與防被罰 PASS
 */

import { N, EMPTY } from "../core/constants.js";
import { opp, cloneBoard, getLegalMovesForPiece } from "../core/rules.js";
import {
  countReachableCells,
  countTeamReachableCells,
  countThreatsToSquare
} from "./evaluator.js";

export function evaluateMoveV2(b, m, player) {
  const enemy = opp(player);
  const fromR = m.from ? m.from.r : m.fromR;
  const fromC = m.from ? m.from.c : m.fromC;
  const toR = m.to ? m.to.r : m.toR;
  const toC = m.to ? m.to.c : m.toC;

  // 1. 模擬落子後棋盤
  const postBoard = cloneBoard(b);
  if (m.type === "capture") {
    postBoard[fromR][fromC] = EMPTY;
    postBoard[toR][toC] = player;
  } else {
    postBoard[toR][toC] = player;
  }

  // 2. 邊際全隊新拓地力
  const myTeamBefore = countTeamReachableCells(b, player);
  const myTeamAfter = countTeamReachableCells(postBoard, player);
  const marginalGain = Math.max(0, myTeamAfter - myTeamBefore);

  // 3. 對手動脈壓制值
  const oppTeamBefore = countTeamReachableCells(b, enemy);
  const oppTeamAfter = countTeamReachableCells(postBoard, enemy);
  const suppression = Math.max(0, oppTeamBefore - oppTeamAfter);

  // 4. 吃子價值
  let captureScore = 0;
  let targetOppPower = 0;
  if (m.type === "capture") {
    targetOppPower = countReachableCells(b, toR, toC, enemy);
    captureScore = 25 + Math.round(targetOppPower * 0.5);
  }

  // 5. 直線吃子威脅防禦 (落子安全性)
  const targetThreats = countThreatsToSquare(postBoard, toR, toC, player);
  let dangerPenalty = 0;
  if (targetThreats === 1) {
    dangerPenalty = 22; // 下回合敵方有 1/6 機率直接吃掉
  } else if (targetThreats >= 2) {
    dangerPenalty = 45; // 雙重交叉射線，重大送子失誤
  }

  // 6. 出發地脫險獎勵 (若原先被瞄準，藉吃子逃脫)
  let escapeBonus = 0;
  if (m.type === "capture") {
    const originThreats = countThreatsToSquare(b, fromR, fromC, player);
    if (originThreats > 0 && targetThreats === 0) {
      escapeBonus = 16;
    }
  }

  // 7. 靈活性維護 (防 PASS 懲罰)
  let safeDiceCount = 0;
  for (let d = 1; d <= 6; d++) {
    let hasMove = false;
    for (let r = 0; r < N && !hasMove; r++) {
      for (let c = 0; c < N && !hasMove; c++) {
        if (postBoard[r][c] === player) {
          const legals = getLegalMovesForPiece(postBoard, r, c, player, d);
          if (legals.spawns.length > 0 || legals.captures.length > 0) {
            hasMove = true;
          }
        }
      }
    }
    if (hasMove) safeDiceCount++;
  }

  let mobilityBonus = 0;
  if (safeDiceCount === 6) mobilityBonus = 6;
  else if (safeDiceCount === 5) mobilityBonus = 2;
  else if (safeDiceCount <= 2) mobilityBonus = -25;
  else if (safeDiceCount <= 3) mobilityBonus = -12;

  // 基礎單點錨定
  const localTargetPower = countReachableCells(postBoard, toR, toC, player);
  const localBonus = Math.round(Math.min(localTargetPower, 10) * 0.25 * 10) / 10;

  const score = Math.round((
    marginalGain * 1.5 +
    suppression * 1.8 +
    captureScore -
    dangerPenalty +
    escapeBonus +
    mobilityBonus +
    localBonus
  ) * 10) / 10;

  return {
    algo: "v2",
    score,
    marginalGain,
    suppression,
    captureScore,
    dangerPenalty,
    escapeBonus,
    mobilityBonus,
    targetThreats,
    safeDiceCount
  };
}
