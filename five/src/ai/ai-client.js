/**
 * 🧠 主執行緒呼叫搜尋引擎（v13）的介面：優先用 Web Worker，不支援時退回同步計算。
 */
import { searchEngine } from "./ai-service.js";
import { searchLevel, LEVELS, clampLevel } from "./levels.js";

const RESPAWN_IDLE_MS = 600;

export class AiClient {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.supported = true; // false：這個環境開不了 Worker（或 Worker 壞了），改在主執行緒同步算
    this.spawn();
  }

  spawn() {
    clearTimeout(this.respawnTimer);
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
        this.worker = null; this.supported = false;
        for (const [, cb] of this.pending) cb(undefined);
        this.pending.clear();
      };
    } catch (e) {
      this.worker = null; this.supported = false;
    }
  }

  /**
   * 放棄所有還沒算完的搜尋（回傳 null）。搜尋在 worker 裡跑到一半沒辦法中斷，
   * 所以直接結束 worker；之後的搜尋不用排在過期的搜尋後面。
   * 新的 worker 不馬上開：重開要重新載入程式、解壓縮棋型表、配置記憶體，手機上每次要花 0.2～0.5 秒的滿載。
   * 連續換局面（連點上一手、拖折線圖）時會連續取消，等真的有新的搜尋、或安靜下來（RESPAWN_IDLE_MS）才開。
   */
  cancel() {
    if (!this.worker || this.pending.size === 0) return;
    this.worker.terminate();
    this.worker = null;
    const cbs = [...this.pending.values()];
    this.pending.clear();
    this.respawnTimer = setTimeout(() => { if (!this.worker && this.supported) this.spawn(); }, RESPAWN_IDLE_MS);
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
    if (!this.worker && this.supported) this.spawn();
    if (!this.worker) return new Promise((resolve) => setTimeout(() => resolve(syncRun()), 0));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, (result) => resolve(result === undefined ? syncRun() : result));
      this.worker.postMessage({ id, board, player, pool, timeMs, multiPV, level });
    });
  }
}
