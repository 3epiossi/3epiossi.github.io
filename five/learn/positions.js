/**
 * 五連黑白棋規則學院：教學用局面與輔助函式（純規則，無 DOM；tests/learn.test.js 會驗證每一題都有解）
 *
 * 局面用 8 行字串描述，每格 2 個字元：
 *   ".." 空格
 *   "b2" 黑面、第 3 組（組別 0～3，依序是 ♠ ♥ ♦ ♣）
 *   "w0" 白面、第 1 組
 * 每顆棋依組別編號分配 id（組別 g 的第 k 顆是 g * 16 + k），所以「同一組」的判斷與正式遊戲相同。
 */

import { BLACK, WHITE, N } from "../src/core/constants.js";
import {
  createEmptyBoard, flipsFor, getLegalMoves, applyMoveToBoard, hasLegalMove, computeScores, opp
} from "../src/core/rules.js";
import { findFive, groupOf, GROUPS, GROUP_SIZE } from "../src/core/five-rules.js";

export function parseBoard(rows) {
  const board = createEmptyBoard();
  const next = Array(GROUPS).fill(0);
  rows.forEach((row, r) => {
    for (let c = 0; c < N; c++) {
      const cell = row.slice(c * 2, c * 2 + 2);
      if (cell === "..") continue;
      const face = cell[0] === "b" ? BLACK : WHITE;
      const g = Number(cell[1]);
      board[r][c] = { id: g * GROUP_SIZE + next[g]++, face };
    }
  });
  return board;
}

/** 這一組在盤面外還剩幾顆（教學局面用：每一組共 16 顆，扣掉盤上的） */
export function remainingInGroup(board, group) {
  let used = 0;
  for (const row of board) for (const d of row) if (d && groupOf(d.id) === group) used++;
  return GROUP_SIZE - used;
}

/** 取出某一組下一顆還沒用到的 id */
export function nextDiscId(board, group) {
  const used = new Set();
  for (const row of board) for (const d of row) if (d) used.add(d.id);
  for (let k = 0; k < GROUP_SIZE; k++) {
    const id = group * GROUP_SIZE + k;
    if (!used.has(id)) return id;
  }
  return null;
}

/** 在 (r, c) 下 group 組。回傳 { board, flips, five } 或 null（不合法或那組用完） */
export function playMove(board, r, c, group, player) {
  const flips = flipsFor(board, r, c, player);
  if (!flips.length) return null;
  const id = nextDiscId(board, group);
  if (id === null) return null;
  const next = applyMoveToBoard(board, { r, c, flips }, id, player);
  return { board: next, flips, five: findFive(next, player) };
}

/** player 現在有沒有任何一步（任一組）可以直接連成五 */
export function winningMoves(board, player) {
  const wins = [];
  for (const m of getLegalMoves(board, player)) {
    for (let g = 0; g < GROUPS; g++) {
      const res = playMove(board, m.r, m.c, g, player);
      if (res && res.five) wins.push({ r: m.r, c: m.c, group: g });
    }
  }
  return wins;
}

export const FIVE_POSITIONS = {
  // 第 2 課：標準開局，黑棋先下。四顆都是第 1 組，這課先不管組別
  opening: parseBoard([
    "................",
    "................",
    "................",
    "......w0b0......",
    "......b0w0......",
    "................",
    "................",
    "................"
  ]),

  // 第 3 課：開局四顆各是不同組
  openingGroups: parseBoard([
    "................",
    "................",
    "................",
    "......w0b1......",
    "......b2w3......",
    "................",
    "................",
    "................"
  ]),

  // 第 4 課：黑棋在第 4 列已經有 4 顆 ♦（第 3 組），缺口 D4。只有選 ♦ 補在 D4 才是五連
  fiveByPlacing: parseBoard([
    "................",
    "................",
    "....w1....w3....",
    "..b2b2..b2b2....",
    "......w0w0......",
    "......b1........",
    "................",
    "................"
  ]),

  // 第 5 課：翻面造成的五連。黑棋在 E6 下 ♥（第 2 組），夾住 C6、D6 兩顆白色的 ♥，翻成黑色後 A6～E6 全是黑色 ♥
  fiveByFlipping: parseBoard([
    "................",
    "................",
    "..........w2....",
    "......b3........",
    "......w0........",
    "b1b1w1w1........",
    "........b0......",
    "................"
  ]),

  // 第 6 課：白棋在第 3 列有 4 顆 ♠，缺口 E3，而且 E3 的下方是黑棋、再下面是白棋，白棋下一手選 ♠ 放 E3 就贏。輪到黑棋，要想辦法擋
  defend: parseBoard([
    "......b2........",
    "..........w2....",
    "w0w0w0w0........",
    "........b1......",
    "........w3......",
    "..b3............",
    "................",
    "................"
  ]),

  // 第 8 課：白棋有威脅（E3 缺口），但黑棋這一手自己就能連成五，先連先贏
  raceToFive: parseBoard([
    "......b2........",
    "................",
    "w0w0w0w0........",
    "........b1......",
    "........w3......",
    "b1b1w1w1........",
    "........b0......",
    "................"
  ])
};

// ===== 第 7 課：PASS 與終局數棋 =====

/** 固定種子的亂數（mulberry32） */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 用固定種子下一局隨機棋，找出第一次有人必須 PASS 的局面，以及終局。
 * 回傳 { passBoard, passPlayer, finalBoard, scores, winner }；中途有人連成五或沒有人 PASS 的種子會回傳 null。
 */
export function playoutDemo(seed) {
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  let board = parseBoard([
    "................",
    "................",
    "................",
    "......w0b1......",
    "......b2w3......",
    "................",
    "................",
    "................"
  ]);
  let turn = BLACK;
  let passBoard = null;
  let passPlayer = null;
  let guard = 0;
  while (guard++ < 200) {
    const moves = getLegalMoves(board, turn);
    if (!moves.length) {
      if (!hasLegalMove(board, opp(turn))) break;
      if (!passBoard) { passBoard = board; passPlayer = turn; }
      turn = opp(turn);
      continue;
    }
    const m = pick(moves);
    const groups = [];
    for (let g = 0; g < GROUPS; g++) if (nextDiscId(board, g) !== null) groups.push(g);
    const res = playMove(board, m.r, m.c, pick(groups), turn);
    if (!res) return null;
    if (res.five) return null;
    board = res.board;
    turn = opp(turn);
  }
  if (!passBoard) return null;
  const s = computeScores(board);
  if (s.blackCount === s.whiteCount) return null;
  return {
    passBoard,
    passPlayer,
    finalBoard: board,
    counts: { black: s.blackCount, white: s.whiteCount },
    winner: s.blackCount > s.whiteCount ? BLACK : WHITE
  };
}

/** 第 7 課用的種子（tests/learn.test.js 會確認它回傳有效的示範局） */
export const PASS_DEMO_SEED = 32;
