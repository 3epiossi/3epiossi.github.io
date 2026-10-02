/**
 * 🎲 骰子黑白棋 (Dice Othello) - 局面特徵評估器 (Position Evaluator & Feature Extractor)
 * 提供地力計算、威脅射線檢測、吃子潛能與轉置表靜態評估
 */

import { N, EMPTY, BLACK, WHITE } from "../core/constants.js";
import { opp } from "../core/rules.js";

export const v3TranspositionTable = new Map();

export function clearTranspositionTable() {
  v3TranspositionTable.clear();
}

/**
 * 地力計算演算法：計算單顆棋子所能覆蓋抵達的空格數
 */
export function countReachableCells(grid, r0, c0, pieceColor) {
  const R = N, C = N;
  const reachable = Array.from({ length: R }, () => Array(C).fill(false));
  const friendly = pieceColor;
  const enemy = opp(pieceColor);

  if (pieceColor === BLACK) {
    const passUp = Array.from({ length: R }, () => Array(C).fill(false));
    const passLeft = Array.from({ length: R }, () => Array(C).fill(false));

    if (r0 - 1 >= 0) passUp[r0 - 1][c0] = true;
    if (c0 - 1 >= 0) passLeft[r0][c0 - 1] = true;

    for (let r = r0; r >= 0; r--) {
      for (let c = c0; c >= 0; c--) {
        if (r === r0 && c === c0) continue;
        const cell = grid[r][c];
        if (cell === enemy) {
          continue; // 敵棋阻斷
        } else if (cell === friendly) {
          if (passUp[r][c] && r - 1 >= 0) passUp[r - 1][c] = true;
          if (passLeft[r][c] && c - 1 >= 0) passLeft[r][c - 1] = true;
        } else if (cell === EMPTY) {
          if (passUp[r][c] || passLeft[r][c]) {
            reachable[r][c] = true;
            if (r - 1 >= 0) passUp[r - 1][c] = true;
            if (c - 1 >= 0) passLeft[r][c - 1] = true;
          }
        }
      }
    }
  } else {
    const passDown = Array.from({ length: R }, () => Array(C).fill(false));
    const passRight = Array.from({ length: R }, () => Array(C).fill(false));

    if (r0 + 1 < R) passDown[r0 + 1][c0] = true;
    if (c0 + 1 < C) passRight[r0][c0 + 1] = true;

    for (let r = r0; r < R; r++) {
      for (let c = c0; c < C; c++) {
        if (r === r0 && c === c0) continue;
        const cell = grid[r][c];
        if (cell === enemy) {
          continue; // 敵棋阻斷
        } else if (cell === friendly) {
          if (passDown[r][c] && r + 1 < R) passDown[r + 1][c] = true;
          if (passRight[r][c] && c + 1 < C) passRight[r][c + 1] = true;
        } else if (cell === EMPTY) {
          if (passDown[r][c] || passRight[r][c]) {
            reachable[r][c] = true;
            if (r + 1 < R) passDown[r + 1][c] = true;
            if (c + 1 < C) passRight[r][c + 1] = true;
          }
        }
      }
    }
  }

  let count = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (reachable[r][c]) count++;
    }
  }
  return count;
}

/**
 * 全隊覆蓋聯集計算：計算全隊共同開拓的勢力範圍聯集
 */
export function countTeamReachableCells(grid, player) {
  const R = N, C = N;
  const reachable = Array.from({ length: R }, () => Array(C).fill(false));
  const friendly = player;
  const enemy = opp(player);

  if (player === BLACK) {
    const passUp = Array.from({ length: R }, () => Array(C).fill(false));
    const passLeft = Array.from({ length: R }, () => Array(C).fill(false));

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (grid[r][c] === friendly) {
          if (r - 1 >= 0) passUp[r - 1][c] = true;
          if (c - 1 >= 0) passLeft[r][c - 1] = true;
        }
      }
    }

    for (let r = R - 1; r >= 0; r--) {
      for (let c = C - 1; c >= 0; c--) {
        const cell = grid[r][c];
        if (cell === enemy) {
          continue;
        } else if (cell === friendly) {
          if (passUp[r][c] && r - 1 >= 0) passUp[r - 1][c] = true;
          if (passLeft[r][c] && c - 1 >= 0) passLeft[r][c - 1] = true;
        } else if (cell === EMPTY) {
          if (passUp[r][c] || passLeft[r][c]) {
            reachable[r][c] = true;
            if (r - 1 >= 0) passUp[r - 1][c] = true;
            if (c - 1 >= 0) passLeft[r][c - 1] = true;
          }
        }
      }
    }
  } else {
    const passDown = Array.from({ length: R }, () => Array(C).fill(false));
    const passRight = Array.from({ length: R }, () => Array(C).fill(false));

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (grid[r][c] === friendly) {
          if (r + 1 < R) passDown[r + 1][c] = true;
          if (c + 1 < C) passRight[r][c + 1] = true;
        }
      }
    }

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const cell = grid[r][c];
        if (cell === enemy) {
          continue;
        } else if (cell === friendly) {
          if (passDown[r][c] && r + 1 < R) passDown[r + 1][c] = true;
          if (passRight[r][c] && c + 1 < C) passRight[r][c + 1] = true;
        } else if (cell === EMPTY) {
          if (passDown[r][c] || passRight[r][c]) {
            reachable[r][c] = true;
            if (r + 1 < R) passDown[r + 1][c] = true;
            if (c + 1 < C) passRight[r][c + 1] = true;
          }
        }
      }
    }
  }

  let count = 0;
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (reachable[r][c]) count++;
    }
  }
  return count;
}

/**
 * 直線吃子威脅射線檢測：計算有多少敵方射線正瞄準 (r, c)
 */
export function countThreatsToSquare(grid, r, c, player) {
  let threats = 0;

  if (player === BLACK) {
    // 敵方為白棋 (白棋由上往下、或由左往右吃黑)
    for (let d = 1; d <= 6; d++) {
      const ar = r - d;
      if (ar < 0) break;
      const val = grid[ar][c];
      if (val === BLACK) break; // 黑棋阻擋
      if (val === WHITE) {
        threats++;
        break;
      }
    }
    for (let d = 1; d <= 6; d++) {
      const ac = c - d;
      if (ac < 0) break;
      const val = grid[r][ac];
      if (val === BLACK) break; // 黑棋阻擋
      if (val === WHITE) {
        threats++;
        break;
      }
    }
  } else {
    // player is WHITE. 敵方為黑棋 (黑棋由下往上、或由右往左吃白)
    for (let d = 1; d <= 6; d++) {
      const ar = r + d;
      if (ar >= N) break;
      const val = grid[ar][c];
      if (val === WHITE) break; // 白棋阻擋
      if (val === BLACK) {
        threats++;
        break;
      }
    }
    for (let d = 1; d <= 6; d++) {
      const ac = c + d;
      if (ac >= N) break;
      const val = grid[r][ac];
      if (val === WHITE) break; // 白棋阻擋
      if (val === BLACK) {
        threats++;
        break;
      }
    }
  }

  return threats;
}

/**
 * 計算在 1~6 點中有幾種骰點可以直接發動吃子
 */
export function getCaptureDiceCount(b, player) {
  let diceMask = 0;

  if (player === BLACK) {
    // 敵方為白棋
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (b[r][c] === BLACK) {
          for (let d = 1; d <= 6; d++) {
            const ar = r - d;
            if (ar < 0) break;
            if (b[ar][c] === BLACK) break;
            if (b[ar][c] === WHITE) {
              diceMask |= (1 << d);
              break;
            }
          }
          for (let d = 1; d <= 6; d++) {
            const ac = c - d;
            if (ac < 0) break;
            if (b[r][ac] === BLACK) break;
            if (b[r][ac] === WHITE) {
              diceMask |= (1 << d);
              break;
            }
          }
        }
      }
    }
  } else {
    // 敵方為黑棋
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (b[r][c] === WHITE) {
          for (let d = 1; d <= 6; d++) {
            const ar = r + d;
            if (ar >= N) break;
            if (b[ar][c] === WHITE) break;
            if (b[ar][c] === BLACK) {
              diceMask |= (1 << d);
              break;
            }
          }
          for (let d = 1; d <= 6; d++) {
            const ac = c + d;
            if (ac >= N) break;
            if (b[r][ac] === WHITE) break;
            if (b[r][ac] === BLACK) {
              diceMask |= (1 << d);
              break;
            }
          }
        }
      }
    }
  }

  let count = 0;
  for (let d = 1; d <= 6; d++) {
    if (diceMask & (1 << d)) count++;
  }
  return count;
}

export function getBoardStateKey(b, player) {
  let key = "";
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      key += b[r][c];
    }
  }
  return key + player;
}

/**
 * 靜態盤面評估函數（支援轉置表快取）
 */
export function evaluatePositionV3(b, player) {
  const stateKey = getBoardStateKey(b, player);
  if (v3TranspositionTable.has(stateKey)) {
    return v3TranspositionTable.get(stateKey);
  }

  const enemy = opp(player);
  let myPieces = 0;
  let enemyPieces = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (b[r][c] === player) myPieces++;
      else if (b[r][c] === enemy) enemyPieces++;
    }
  }

  if (enemyPieces === 0) return 100000;
  if (myPieces === 0) return -100000;

  const materialDiff = myPieces - enemyPieces;
  const myTerritory = countTeamReachableCells(b, player);
  const enemyTerritory = countTeamReachableCells(b, enemy);
  const territoryDiff = myTerritory - enemyTerritory;

  const enemyThreatDiceCount = getCaptureDiceCount(b, player);
  const expectedCaptureLoss = (enemyThreatDiceCount / 6) * 55.0;

  const myThreatDiceCount = getCaptureDiceCount(b, enemy);
  const myCapturePotential = (myThreatDiceCount / 6) * 40.0;

  const score = Math.round((
    materialDiff * 45.0 +
    territoryDiff * 1.8 +
    myCapturePotential -
    expectedCaptureLoss
  ) * 10) / 10;

  if (v3TranspositionTable.size > 20000) {
    v3TranspositionTable.clear();
  }
  v3TranspositionTable.set(stateKey, score);
  return score;
}
