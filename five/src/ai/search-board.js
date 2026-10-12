/**
 * 輕量棋盤 { f, b, w }（朝上顏色、黑面權重、白面權重，各 64 格）。
 * 教練說明需要在落子前後比較局面（立即得分、對手行動力），用這個結構比走遊戲棋盤快。
 * 搜尋本身用位元棋盤，見 ./v6/。
 */

import { N, BLACK, WHITE, DIRS } from "../core/constants.js";
import { blackWeight, whiteWeight } from "../core/rules.js";

const EMPTY = 0;
const SIZE = N * N;

export function toSearchBoard(board) {
  const sb = { f: new Int8Array(SIZE), b: new Float32Array(SIZE), w: new Float32Array(SIZE) };
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const d = board[r][c];
      if (!d) continue;
      const i = r * N + c;
      sb.f[i] = d.face;
      sb.b[i] = blackWeight(d.id);
      sb.w[i] = whiteWeight(d.id);
    }
  }
  return sb;
}

export const other = (p) => (p === BLACK ? WHITE : BLACK);

const cloneSb = (sb) => ({ f: sb.f.slice(), b: sb.b.slice(), w: sb.w.slice() });

function flipsAt(sb, r, c, player) {
  const idx = r * N + c;
  if (sb.f[idx] !== EMPTY) return null;
  const enemy = other(player);
  let out = null;
  for (const [dr, dc] of DIRS) {
    let nr = r + dr, nc = c + dc, k = 0;
    while (nr >= 0 && nr < N && nc >= 0 && nc < N && sb.f[nr * N + nc] === enemy) { nr += dr; nc += dc; k++; }
    if (k > 0 && nr >= 0 && nr < N && nc >= 0 && nc < N && sb.f[nr * N + nc] === player) {
      if (!out) out = [];
      let fr = r + dr, fc = c + dc;
      for (let s = 0; s < k; s++) { out.push(fr * N + fc); fr += dr; fc += dc; }
    }
  }
  return out;
}

export function legalMovesSb(sb, player) {
  const moves = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const fl = flipsAt(sb, r, c, player);
      if (fl) moves.push({ r, c, flips: fl });
    }
  }
  return moves;
}

export function countMoves(sb, player) {
  let n = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (flipsAt(sb, r, c, player)) n++;
  return n;
}

/** 落子：回傳新棋盤。placed = { b, w }（落下那顆棋的兩面權重） */
export function applyMoveSb(sb, move, placed, player) {
  const nb = cloneSb(sb);
  const i = move.r * N + move.c;
  nb.f[i] = player; nb.b[i] = placed.b; nb.w[i] = placed.w;
  for (const j of move.flips) nb.f[j] = player;
  return nb;
}

export function scoreOf(sb, player) {
  let mine = 0, theirs = 0;
  for (let i = 0; i < SIZE; i++) {
    const f = sb.f[i];
    if (f === EMPTY) continue;
    const v = f === BLACK ? sb.b[i] : sb.w[i];
    if (f === player) mine += v; else theirs += v;
  }
  return { mine, theirs };
}

/** 單步立即得分：落下的棋 + 翻面造成的權重差 */
export function immediateGain(sb, move, placed, player) {
  let gain = player === BLACK ? placed.b : placed.w;
  for (const j of move.flips) {
    gain += player === BLACK ? sb.b[j] - sb.w[j] : sb.w[j] - sb.b[j];
  }
  return gain;
}
