/**
 * v11：「2 組自選、六連立刻獲勝、沒人連成就比棋子數」專用的引擎。
 *
 * 載入前要先設定規則變體（core/five-rules.js）：globalThis.FIVE_RULES_VARIANT = { len: 6, match: "group", groups: 2 }。
 *
 * 由三段組成（實驗數據見 docs/two-group-rule.md）：
 *   1. 能直接連成六 → 直接連（v10 的位元棋盤判斷，組別精確）
 *   2. 中盤 → v9 的搜尋核心：根節點每一組各搜一次；更深處的組別當成機率（不逐一展開），分支少一半、搜得比較深。
 *      六連要好幾手才布得出雙重威脅，深度比組別精確重要：同樣時間下 v10（逐一展開組別）對 v9 只拿 18～39%，
 *      怎麼調 v10 的權重都一樣。
 *   3. 剩 EXACT_EMPTIES 格以內 → v10 精確算到終局（v9 在自選組別下只能精確算到剩 5 格）
 * 盤上每顆棋的組別由 groupOf(id) 決定（0 或 1）；回傳要下的格子與組別。
 */
import { searchV10, V10_PARAMS, WIN } from "./v10.js";
import { searchPoolV9 } from "./v9.js";
import { V9_PLAIN_PARAMS } from "./v9/search.js";

export { WIN };

export const V11_RULE = Object.freeze({ winLen: 6 });

export const V11_PARAMS = {
  v9: V9_PLAIN_PARAMS,
  v10: { ...V10_PARAMS, lineScale: 1, othelloScale: 2 },
  exactEmpties: 12 // 剩幾格以內交給 v10 精確計算
};

/**
 * @param {number[]} [o.reps] 每一組的代表棋 id（還有剩的組別才放）；中盤的 v9 搜尋用
 * @returns {{ sq:number, group:number, depth:number, exact:boolean, stage:"win"|"mid"|"exact" } | null}
 */
export function searchV11(board, player, groupOf, { timeMs = 1000, params = V11_PARAMS, supply = null, reps } = {}) {
  let empties = 0;
  for (const row of board) for (const d of row) if (!d) empties++;
  const p10 = { ...params.v10, exactEmpties: params.exactEmpties };
  // 1. 能直接連成六（1 層就看得到，分數是勝）
  const quick = searchV10(board, player, groupOf, { timeMs: Math.min(50, timeMs), maxDepth: 1, params: p10, supply, rule: V11_RULE });
  if (!quick) return null;
  if (quick.score > WIN / 2) return { sq: quick.sq, group: quick.group, depth: 1, exact: true, stage: "win" };
  // 3. 終盤：精確
  if (empties <= params.exactEmpties) {
    const r = searchV10(board, player, groupOf, { timeMs, params: p10, supply, rule: V11_RULE });
    return { sq: r.sq, group: r.group, depth: r.depth, exact: r.exact, stage: "exact" };
  }
  // 2. 中盤：v9
  const r = searchPoolV9(board, player, reps, { timeMs, poolSize: 64, params: params.v9 });
  return { sq: r.bestSq, group: groupOf(r.disc), depth: r.depth, exact: r.exact, stage: "mid" };
}
