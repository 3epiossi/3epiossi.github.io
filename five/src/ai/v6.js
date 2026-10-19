/**
 * v6 深算型（參考 Zebra）：位元棋盤 + 迭代加深 NegaScout + 置換表，
 * 評估以穩定子、行動力、邊界子為主，終盤逐一展開抽棋做精確期望值。
 * 細節見 ./v6/search.js 與 ./v6/eval.js。
 */
import { remainingBag } from "../core/rules.js";
import { searchRoot } from "./v6/search.js";

export const V6_DEFAULT_TIME = 1000;

/**
 * @returns {{ bestSq:number, scores:{sq:number, score:number}[], depth:number, exact:boolean } | null}
 */
export function searchV6(board, player, handId, { timeMs = V6_DEFAULT_TIME, multiPV = false, maxDepth, params } = {}) {
  return searchRoot({
    board, player, handId,
    bag: remainingBag(board, handId),
    timeMs, multiPV, maxDepth, params
  });
}
