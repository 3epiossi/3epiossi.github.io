/**
 * 🧠 主執行緒呼叫搜尋引擎（v13）的介面：優先用 Web Worker，不支援時退回同步計算。
 */
import { searchEngine } from "./ai-service.js";
import { searchLevel, LEVELS, clampLevel } from "./levels.js";

export class AiClient {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.spawn();
  }

  spawn() {
    try {
      this.worker = new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = (e) => {
        const cb = this.pending.get(e.data.id);
        if (!cb) return;
        this.pending.delete(e.data.id);
        cb(e.data.result);
      };
      this.worker.onerror = (e) => {
        console.warn("v13 worker 無法使用，改為同步計算", e);
        this.worker = null;
        for (const [, cb] of this.pending) cb(undefined);
        this.pending.clear();
      };
    } catch (e) {
      this.worker = null;
    }
  }

  /**
   * 放棄所有還沒算完的搜尋（回傳 null）。搜尋在 worker 裡跑到一半沒辦法中斷，
   * 所以直接結束 worker 再開一個新的；之後的搜尋不用排在過期的搜尋後面。
   */
  cancel() {
    if (!this.worker || this.pending.size === 0) return;
    this.worker.terminate();
    const cbs = [...this.pending.values()];
    this.pending.clear();
    this.spawn();
    for (const cb of cbs) cb(null);
  }

  /**
   * @returns {Promise<{bestSq:number, disc:number, scores:{sq:number, disc:number, key:number, score:number}[], depth:number, exact:boolean} | null>}
   */
  search({ board, player, pool, timeMs, multiPV = false, level = null }) {
    const syncRun = () => {
      const r = level != null
        ? searchLevel(board, player, pool, LEVELS[clampLevel(level) - 1], { timeMs })
        : searchEngine(board, player, pool, { timeMs, multiPV });
      return r ? { bestSq: r.bestSq, disc: r.disc, scores: r.scores, depth: r.depth, exact: r.exact } : null;
    };
    if (!this.worker) return new Promise((resolve) => setTimeout(() => resolve(syncRun()), 0));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, (result) => resolve(result === undefined ? syncRun() : result));
      this.worker.postMessage({ id, board, player, pool, timeMs, multiPV, level });
    });
  }
}
