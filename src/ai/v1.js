/**
 * 🤖 演算法 v1：入門型 (經典地力純貪心)
 * 著重立即可獲得的棋盤地力與吃子收益
 */

import { EMPTY } from "../core/constants.js";
import { opp, cloneBoard } from "../core/rules.js";
import { countReachableCells } from "./evaluator.js";

export function evaluateMoveV1(b, m, player) {
  const enemy = opp(player);
  const fromR = m.from ? m.from.r : m.fromR;
  const fromC = m.from ? m.from.c : m.fromC;
  const toR = m.to ? m.to.r : m.toR;
  const toC = m.to ? m.to.c : m.toC;

  const fromMyPower = countReachableCells(b, fromR, fromC, player);

  const tempGrid = cloneBoard(b);
  if (m.type === "capture") {
    tempGrid[fromR][fromC] = EMPTY;
    tempGrid[toR][toC] = EMPTY;
  } else {
    tempGrid[toR][toC] = EMPTY;
  }

  const targetMyPower = countReachableCells(tempGrid, toR, toC, player);
  const targetOppPower = countReachableCells(tempGrid, toR, toC, enemy);

  let score = 0;
  if (m.type === "spawn") {
    score = targetMyPower + targetOppPower;
  } else {
    score = targetMyPower + targetOppPower + targetOppPower - fromMyPower;
  }

  return {
    algo: "v1",
    score,
    targetMyPower,
    targetOppPower,
    fromMyPower
  };
}
