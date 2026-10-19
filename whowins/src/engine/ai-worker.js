/**
 * 搜尋專用的 Web Worker：選步與局面分析都在這裡算，畫面不會被擋住。
 * 同一個 worker 內的 Searcher 保留置換表，連續分析相鄰局面會更快。
 */
import { Searcher, chooseMove, analyzePosition } from "./service.js";

const searcher = new Searcher();

self.onmessage = (e) => {
  const { id, op, args } = e.data;
  let result = null;
  try {
    if (op === "play") result = chooseMove(searcher, args.board, args.turn, args.die, args.level, args.opts);
    else if (op === "analyze") result = analyzePosition(searcher, args.board, args.turn, args.opts);
  } catch (err) {
    console.error("engine worker error:", err);
  }
  self.postMessage({ id, result });
};
