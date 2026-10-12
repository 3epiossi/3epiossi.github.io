/**
 * ⚖️ 五連黑白棋 (Five-in-a-Row Othello) - 核心規則引擎 (Pure Game Rules)
 * 無 DOM 依賴。棋盤格為 null（空）或 { id, face }：
 *   id    0～63，編碼 (白面權重, 黑面權重)：白面 = (id >> 3) + 1，黑面 = (id & 7) + 1
 *   face  目前朝上的顏色 (BLACK | WHITE)
 */

import { N, BLACK, WHITE, DIRS, DISC_COUNT, FILES } from "./constants.js";

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
  const c = FILES.indexOf(coord[0].toUpperCase());
  const r = parseInt(coord.slice(1), 10) - 1;
  return inBounds(r, c) ? { r, c } : null;
}

// ===== 棋子（權重） =====

export const whiteWeight = (id) => (id >> 3) + 1;
export const blackWeight = (id) => (id & 7) + 1;
export const weightOf = (id, face) => (face === BLACK ? blackWeight(id) : whiteWeight(id));
export const discId = (white, black) => (white - 1) * 8 + (black - 1);

export function createDisc(id, face) {
  return { id, face };
}

// ===== 棋盤 =====

export function createEmptyBoard() {
  return Array.from({ length: N }, () => Array(N).fill(null));
}

export function cloneBoard(b) {
  return b.map(row => row.map(d => (d ? { id: d.id, face: d.face } : null)));
}

/** 標準開局：D4/E5 白、E4/D5 黑；四顆棋由 draw() 依序從袋子抽出 */
export function createInitialBoard(draw) {
  const b = createEmptyBoard();
  const layout = [[3, 3, WHITE], [3, 4, BLACK], [4, 3, BLACK], [4, 4, WHITE]];
  for (const [r, c, face] of layout) b[r][c] = createDisc(draw(), face);
  return b;
}

export function cloneMove(m) {
  if (!m) return null;
  return { ...m, flips: m.flips ? m.flips.map(f => [...f]) : [] };
}

/** 尚在袋子裡的棋子 id：全部 64 顆扣掉盤面與手上的 */
export function remainingBag(board, handId = null) {
  const used = new Set();
  if (handId != null) used.add(handId);
  for (const row of board) for (const d of row) if (d) used.add(d.id);
  const bag = [];
  for (let id = 0; id < DISC_COUNT; id++) if (!used.has(id)) bag.push(id);
  return bag;
}

// ===== 走步 =====

export function flipsFor(board, r, c, player) {
  if (!inBounds(r, c) || board[r][c]) return [];
  const out = [];
  const enemy = opp(player);
  for (const [dr, dc] of DIRS) {
    const line = [];
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc) && board[nr][nc] && board[nr][nc].face === enemy) {
      line.push([nr, nc]);
      nr += dr; nc += dc;
    }
    if (line.length && inBounds(nr, nc) && board[nr][nc] && board[nr][nc].face === player) {
      out.push(...line);
    }
  }
  return out;
}

export function getLegalMoves(board, player) {
  const moves = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const flips = flipsFor(board, r, c, player);
      if (flips.length) moves.push({ r, c, flips, player });
    }
  }
  return moves;
}

export function hasLegalMove(board, player) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!board[r][c] && flipsFor(board, r, c, player).length) return true;
    }
  }
  return false;
}

/** 回傳套用走步後的新棋盤（不修改原棋盤） */
export function applyMoveToBoard(board, move, discIdToPlace, player) {
  const nb = cloneBoard(board);
  nb[move.r][move.c] = createDisc(discIdToPlace, player);
  for (const [fr, fc] of move.flips) nb[fr][fc].face = player;
  return nb;
}

export function isBoardFull(board) {
  return board.every(row => row.every(Boolean));
}

// ===== 計分與終局 =====

export function computeScores(board) {
  const s = { black: 0, white: 0, blackCount: 0, whiteCount: 0 };
  for (const row of board) {
    for (const d of row) {
      if (!d) continue;
      if (d.face === BLACK) { s.black += blackWeight(d.id); s.blackCount++; }
      else { s.white += whiteWeight(d.id); s.whiteCount++; }
    }
  }
  return s;
}

export function isGameOver(board) {
  return isBoardFull(board) || (!hasLegalMove(board, BLACK) && !hasLegalMove(board, WHITE));
}

export function calculateSettlement(board) {
  const s = computeScores(board);
  const winner = s.black === s.white ? 0 : (s.black > s.white ? BLACK : WHITE);
  return { winner, black: s.black, white: s.white, blackCount: s.blackCount, whiteCount: s.whiteCount, diff: Math.abs(s.black - s.white) };
}
