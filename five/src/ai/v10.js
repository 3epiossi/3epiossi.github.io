/**
 * v10：「2 組自選」規則專用的引擎（見 ./v10/search.js）。
 * 盤上每顆棋的組別由 groupOf(id) 決定（0 或 1）；回傳要下的格子與組別，實際用哪一顆棋由呼叫端從那組的庫存挑。
 */
import { searchRootV10, V10_PARAMS, WIN } from "./v10/search.js";
import { BLACK } from "../core/constants.js";

export { V10_PARAMS, WIN };

/** 遊戲棋盤 → 輪到 player 的角度的位元棋盤 */
export function toPosition(board, player, groupOf) {
  let pH = 0, pL = 0, oH = 0, oL = 0, gH = 0, gL = 0;
  for (let s = 0; s < 64; s++) {
    const d = board[s >> 3][s & 7];
    if (!d) continue;
    const bit = s < 32 ? 1 << s : 1 << (s - 32);
    const hi = s >= 32;
    if (d.face === player) { if (hi) pH |= bit; else pL |= bit; } else if (hi) oH |= bit; else oL |= bit;
    if (groupOf(d.id) === 1) { if (hi) gH |= bit; else gL |= bit; }
  }
  return { pH, pL, oH, oL, gH, gL };
}

/**
 * @param {{mine:number[], theirs:number[]}|null} [o.supply] 各自持有模式：自己與對手剩的 [α, β]；不給 = 共用模式（從盤面推算）
 * @param {{winLen?:number, instantWin?:boolean, countFives?:boolean}|null} [o.rule] 勝負規則（見 ./v10/search.js 開頭）；不給 = 五連立刻獲勝
 * @returns {{ sq:number, group:number, score:number, scores:{sq:number, group:number, score:number}[], depth:number, exact:boolean, nodes:number, ms:number } | null}
 */
export function searchV10(board, player, groupOf, { timeMs = 1000, maxDepth, multiPV = false, params = V10_PARAMS, supply = null, rule = null } = {}) {
  const r = searchRootV10({ pos: toPosition(board, player, groupOf), supply, rule, timeMs, maxDepth, multiPV, params });
  if (!r) return null;
  const scores = r.scores.map(x => ({ sq: x.mv >> 1, group: x.mv & 1, score: x.score }));
  return { sq: r.best >> 1, group: r.best & 1, score: scores[0].score, scores, depth: r.depth, exact: r.exact, nodes: r.nodes, ms: r.ms };
}

export { BLACK };
