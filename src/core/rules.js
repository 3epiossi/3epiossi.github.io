/**
 * 🎲 骰子黑白棋 (Dice Othello) - 核心規則引擎 (Pure Game Rules)
 * 完全無 DOM 依賴，100% 遵守五大核心規則與終局勢力填滿判定
 */

import { BOARD_SIZE, N, PLAYER, EMPTY, BLACK, WHITE, FILES, MOVE_TYPE } from "./constants.js";

export function opp(player) {
  return player === BLACK ? WHITE : BLACK;
}

export function inBounds(r, c) {
  return r >= 0 && r < N && c >= 0 && c < N;
}

export function posToCoord(r, c) {
  return FILES[c] + (r + 1);
}

export function coordToPos(coord) {
  if (!coord || typeof coord !== "string" || coord.length < 2) return null;
  const colChar = coord[0].toUpperCase();
  const c = FILES.indexOf(colChar);
  const r = parseInt(coord.slice(1), 10) - 1;
  if (inBounds(r, c)) return { r, c };
  return null;
}

export function createInitialBoard() {
  const b = Array.from({ length: N }, () => Array(N).fill(EMPTY));
  b[0][0] = WHITE; // A1: 白棋
  b[7][7] = BLACK; // H8: 黑棋
  return b;
}

export function cloneBoard(b) {
  return b.map(row => [...row]);
}

export function cloneMove(m) {
  if (!m) return null;
  return {
    ...m,
    from: m.from ? { ...m.from } : { r: m.fromR, c: m.fromC },
    to: m.to ? { ...m.to } : { r: m.toR, c: m.toC },
    path: m.path ? m.path.map(p => ({ ...p })) : []
  };
}

/**
 * 依據規則二（生子）與規則三（純直線吃子）計算單顆棋子的合法落子步數
 */
export function getLegalMovesForPiece(b, r0, c0, player, D) {
  if (!inBounds(r0, c0) || b[r0][c0] !== player || D <= 0) {
    return { spawns: [], captures: [] };
  }

  const enemy = opp(player);
  const spawns = [];
  const captures = [];

  // 黑棋朝左與上推進；白棋朝右與下推進
  const stepDirs = player === BLACK
    ? [[0, -1], [-1, 0]]
    : [[0, 1], [1, 0]];

  // 1. Spawns (規則二：增殖生子，可折線轉彎，己棋穿透無阻，敵棋阻斷，目標格為空格)
  const visited = new Set();
  const queue = [{ r: r0, c: c0, dist: 0, path: [{ r: r0, c: c0 }] }];
  visited.add(`${r0},${c0},0`);
  const reachableSpawns = new Map();

  while (queue.length > 0) {
    const curr = queue.shift();

    if (curr.dist === D) {
      if (b[curr.r][curr.c] === EMPTY) {
        reachableSpawns.set(`${curr.r},${curr.c}`, {
          r: curr.r,
          c: curr.c,
          path: curr.path
        });
      }
      continue;
    }

    for (const [dr, dc] of stepDirs) {
      const nr = curr.r + dr;
      const nc = curr.c + dc;
      const ndist = curr.dist + 1;

      if (!inBounds(nr, nc)) continue;
      if (b[nr][nc] === enemy) continue; // 規則五：敵棋阻斷

      const key = `${nr},${nc},${ndist}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({
          r: nr,
          c: nc,
          dist: ndist,
          path: [...curr.path, { r: nr, c: nc }]
        });
      }
    }
  }

  for (const target of reachableSpawns.values()) {
    spawns.push({
      from: { r: r0, c: c0 },
      to: { r: target.r, c: target.c },
      fromR: r0,
      fromC: c0,
      toR: target.r,
      toC: target.c,
      dice: D,
      type: MOVE_TYPE.SPAWN,
      path: target.path,
      player
    });
  }

  // 2. Captures (規則三：純直線突擊吃子，如車直衝，中途敵棋阻斷，目標恰為敵棋)
  for (const [dr, dc] of stepDirs) {
    let blocked = false;
    const capturePath = [{ r: r0, c: c0 }];

    for (let step = 1; step < D; step++) {
      const ir = r0 + dr * step;
      const ic = c0 + dc * step;
      if (!inBounds(ir, ic) || b[ir][ic] === enemy) {
        blocked = true;
        break;
      }
      capturePath.push({ r: ir, c: ic });
    }

    if (blocked) continue;

    const tr = r0 + dr * D;
    const tc = c0 + dc * D;
    if (inBounds(tr, tc) && b[tr][tc] === enemy) {
      capturePath.push({ r: tr, c: tc });
      captures.push({
        from: { r: r0, c: c0 },
        to: { r: tr, c: tc },
        fromR: r0,
        fromC: c0,
        toR: tr,
        toC: tc,
        dice: D,
        type: MOVE_TYPE.CAPTURE,
        path: capturePath,
        player
      });
    }
  }

  return { spawns, captures };
}

/**
 * 取得特定棋子在 1～6 步所有骰值下的合法落子集合（特權模式專用）
 */
export function getAllDiceLegalMovesForPiece(b, r0, c0, player) {
  const spawnsMap = new Map();
  const capturesMap = new Map();
  for (let d = 1; d <= 6; d++) {
    const m = getLegalMovesForPiece(b, r0, c0, player, d);
    for (const sp of m.spawns) {
      const key = `${sp.toR},${sp.toC}`;
      if (!spawnsMap.has(key)) {
        spawnsMap.set(key, { ...sp, usedDiceVal: d, dice: d });
      }
    }
    for (const cap of m.captures) {
      const key = `${cap.toR},${cap.toC}`;
      if (!capturesMap.has(key)) {
        capturesMap.set(key, { ...cap, usedDiceVal: d, dice: d });
      }
    }
  }
  return {
    spawns: Array.from(spawnsMap.values()),
    captures: Array.from(capturesMap.values())
  };
}

/**
 * 取得當前玩家全體棋子在指定骰值下的所有合法步
 */
export function getAllLegalMoves(b, player, D) {
  const spawns = [];
  const captures = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (b[r][c] === player) {
        const moves = getLegalMovesForPiece(b, r, c, player, D);
        for (const s of moves.spawns) spawns.push(s);
        for (const cp of moves.captures) captures.push(cp);
      }
    }
  }
  return { spawns, captures };
}

/**
 * 將走法套用至棋盤（純函數，產生新棋盤）
 */
export function applyMoveToBoard(b, m, player) {
  const nb = cloneBoard(b);
  const p = player || m.player;
  if (m.type === MOVE_TYPE.SPAWN) {
    nb[m.toR][m.toC] = p;
  } else if (m.type === MOVE_TYPE.CAPTURE) {
    nb[m.fromR][m.fromC] = EMPTY;
    nb[m.toR][m.toC] = p;
  }
  return nb;
}

/**
 * 檢查雙方在幾何與行棋可能性上是否可能互相吃子
 */
export function canCaptureEver(b) {
  const bPcs = [];
  const wPcs = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (b[r][c] === BLACK) bPcs.push({ r, c });
      else if (b[r][c] === WHITE) wPcs.push({ r, c });
    }
  }
  if (bPcs.length === 0 || wPcs.length === 0) return false;

  // 黑棋可抵達與佔領的空格集（左、上，被白棋阻擋）
  const qB = [...bPcs];
  const visB = new Set(bPcs.map(p => `${p.r},${p.c}`));
  while (qB.length > 0) {
    const { r, c } = qB.shift();
    for (const [dr, dc] of [[-1, 0], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && !visB.has(`${nr},${nc}`) && b[nr][nc] !== WHITE) {
        visB.add(`${nr},${nc}`);
        qB.push({ r: nr, c: nc });
      }
    }
  }

  // 白棋可抵達與佔領的空格集（右、下，被黑棋阻擋）
  const qW = [...wPcs];
  const visW = new Set(wPcs.map(p => `${p.r},${p.c}`));
  while (qW.length > 0) {
    const { r, c } = qW.shift();
    for (const [dr, dc] of [[1, 0], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && !visW.has(`${nr},${nc}`) && b[nr][nc] !== BLACK) {
        visW.add(`${nr},${nc}`);
        qW.push({ r: nr, c: nc });
      }
    }
  }

  // 檢查是否存在任一對 (黑, 白) 在同一直線上具備攻擊方向：
  // 同橫列：白棋在黑棋左側 (wc < bc)
  // 同縱行：白棋在黑棋上方 (wr < br)
  for (const bKey of visB) {
    const [br, bc] = bKey.split(',').map(Number);
    for (const wKey of visW) {
      const [wr, wc] = wKey.split(',').map(Number);
      if (br === wr && wc < bc) return true;
      if (bc === wc && wr < br) return true;
    }
  }
  return false;
}

/**
 * 終局勢力填滿演算法（依照規則一與規則二最短步數）
 */
export function fillTerritoryRule1Rule2(b, firstTurn = BLACK) {
  const result = cloneBoard(b);

  // 黑棋最短步數傳播 (往左、往上)
  const distB = Array.from({ length: N }, () => Array(N).fill(Infinity));
  const qB = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (result[r][c] === BLACK) {
        distB[r][c] = 0;
        qB.push({ r, c, d: 0 });
      }
    }
  }
  while (qB.length > 0) {
    const { r, c, d } = qB.shift();
    for (const [dr, dc] of [[-1, 0], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && result[nr][nc] !== WHITE) {
        if (d + 1 < distB[nr][nc]) {
          distB[nr][nc] = d + 1;
          qB.push({ r: nr, c: nc, d: d + 1 });
        }
      }
    }
  }

  // 白棋最短步數傳播 (往右、往下)
  const distW = Array.from({ length: N }, () => Array(N).fill(Infinity));
  const qW = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (result[r][c] === WHITE) {
        distW[r][c] = 0;
        qW.push({ r, c, d: 0 });
      }
    }
  }
  while (qW.length > 0) {
    const { r, c, d } = qW.shift();
    for (const [dr, dc] of [[1, 0], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && result[nr][nc] !== BLACK) {
        if (d + 1 < distW[nr][nc]) {
          distW[nr][nc] = d + 1;
          qW.push({ r: nr, c: nc, d: d + 1 });
        }
      }
    }
  }

  const newlyFilled = new Set();
  let filledCount = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (result[r][c] === EMPTY) {
        const dB = distB[r][c];
        const dW = distW[r][c];
        if (dB < Infinity && dW === Infinity) {
          result[r][c] = BLACK;
          newlyFilled.add(`${r},${c}`);
          filledCount++;
        } else if (dW < Infinity && dB === Infinity) {
          result[r][c] = WHITE;
          newlyFilled.add(`${r},${c}`);
          filledCount++;
        } else if (dB < Infinity && dW < Infinity) {
          if (dB < dW) result[r][c] = BLACK;
          else if (dW < dB) result[r][c] = WHITE;
          else result[r][c] = firstTurn;
          newlyFilled.add(`${r},${c}`);
          filledCount++;
        }
      }
    }
  }

  return { filledBoard: result, filledCount, newlyFilled };
}

/**
 * 終局計分與勝負裁定（含割目/貼目）
 */
export function calculateSettlement(b, komi = 3.5) {
  let bTotal = 0;
  let wBoard = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (b[r][c] === BLACK) bTotal++;
      else if (b[r][c] === WHITE) wBoard++;
    }
  }

  const wFinal = Math.round((wBoard + komi) * 10) / 10;
  let winner = EMPTY;
  const margin = Math.abs(Math.round((bTotal - wFinal) * 10) / 10);

  if (bTotal > wFinal) {
    winner = BLACK;
  } else if (wFinal > bTotal) {
    winner = WHITE;
  } else {
    winner = EMPTY; // 平手
  }

  return {
    winner,
    bTotal,
    wBoard,
    komi,
    wFinal,
    margin
  };
}
