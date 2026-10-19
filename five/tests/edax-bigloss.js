/**
 * 分析 edax-arena.js 記下的 CPU 大虧手（照 Edax 少 4 顆以上）是為了什麼：
 *   block   對手下一手就能連成五（CPU 不擋就輸）
 *   avoid   Edax 的最佳格不管配哪一組，對手都能（幾手內）連成五 → 不能下
 *   four    CPU 這手替自己做出「下一手就能連成五」的威脅
 *   other   其他（連線的長期考量，或單純黑白棋判斷錯）
 *
 *   node five/tests/edax-bigloss.js five/tests/results/edax-d16-*.jsonl
 */
import fs from "fs";
import { searchV14, WIN } from "../src/ai/v14.js";
import { groupOf, GROUPS } from "../src/core/five-rules.js";
import { getLegalMoves, applyMoveToBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { poolOf } from "../src/core/game-engine.js";

const opp = (p) => (p === BLACK ? WHITE : BLACK);
const rows = process.argv.slice(2).flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
const big = rows.flatMap((r) => r.big || []);
const canWin = (board, who, depth = 1) => {
  const r = searchV14(board, who, groupOf, { timeMs: 200, maxDepth: depth });
  return r && r.score > WIN / 2;
};
const cnt = { block: 0, avoid: 0, four: 0, other: 0 }, lossBy = { block: 0, avoid: 0, four: 0, other: 0 };
for (const b of big) {
  const board = b.board.map((row) => row.map((x) => (x ? { id: x[0], face: x[1] } : null)));
  const me = b.turn, them = opp(me);
  let why;
  if (canWin(board, them)) why = "block";
  else {
    const pool = poolOf(board);
    const mv = getLegalMoves(board, me).find((m) => m.r * 8 + m.c === b.best);
    const allBad = mv && pool.every((id) => canWin(applyMoveToBoard(board, mv, id, me), them, 3));
    if (allBad) why = "avoid";
    else {
      const cm = getLegalMoves(board, me).find((m) => m.r * 8 + m.c === b.sq);
      const id = pool.find((x) => groupOf(x) === b.group);
      const after = applyMoveToBoard(board, cm, id, me);
      why = canWin(after, me) ? "four" : "other";
    }
  }
  cnt[why]++; lossBy[why] += b.loss;
}
console.log(`大虧手 ${big.length} 手（共 ${rows.length} 局）`);
for (const k of Object.keys(cnt)) console.log(`  ${k.padEnd(6)} ${String(cnt[k]).padStart(4)} 手，平均損失 ${(lossBy[k] / Math.max(1, cnt[k])).toFixed(1)}，總損失 ${lossBy[k].toFixed(0)}`);
