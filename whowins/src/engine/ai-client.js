/**
 * 主執行緒呼叫引擎的介面：優先用 Web Worker，不支援時退回同步計算。
 * 搜尋在 worker 裡跑到一半沒辦法中斷，所以 cancel() 直接結束 worker（Promise 解成 null），
 * 之後的搜尋不用排在過期的搜尋後面；新的 worker 等真的有新搜尋、或安靜下來才開（連續取消時不重複開）。
 */
import { Searcher, chooseMove, analyzePosition } from "./service.js";

const RESPAWN_IDLE_MS = 600;

export class AiClient {
  constructor({ eager = true, useWorker = true } = {}) {
    this.seq = 0;
    this.pending = new Map();
    this.supported = useWorker && typeof Worker !== "undefined";
    this.syncSearcher = null;
    this.worker = null;
    if (eager && this.supported) this.spawn();
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
        console.warn("engine worker 無法使用，改為同步計算", e);
        this.worker = null; this.supported = false;
        for (const [, cb] of this.pending) cb(undefined);
        this.pending.clear();
      };
    } catch (e) {
      this.worker = null; this.supported = false;
    }
  }

  /** 放棄所有還沒算完的搜尋（回傳 null）。 */
  cancel() {
    if (!this.worker || this.pending.size === 0) return;
    this.worker.terminate();
    this.worker = null;
    const cbs = [...this.pending.values()];
    this.pending.clear();
    this.respawnTimer = setTimeout(() => { if (!this.worker && this.supported) this.spawn(); }, RESPAWN_IDLE_MS);
    for (const cb of cbs) cb(null);
  }

  _run(op, args) {
    const sync = () => {
      this.syncSearcher = this.syncSearcher || new Searcher();
      return op === "play"
        ? chooseMove(this.syncSearcher, args.board, args.turn, args.die, args.level, args.opts)
        : analyzePosition(this.syncSearcher, args.board, args.turn, args.opts);
    };
    if (!this.worker && this.supported) this.spawn();
    if (!this.worker) return new Promise((resolve) => setTimeout(() => resolve(sync()), 0));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, (result) => resolve(result === undefined ? sync() : result));
      this.worker.postMessage({ id, op, args });
    });
  }

  /** CPU 選步：{ board, turn, die(null = 自選), level, opts:{ free, komi, timeMs } } -> { move, depth } */
  play(args) { return this._run("play", args); }

  /** 局面分析：{ board, turn, opts:{ free, komi, timeMs, maxDepth, die, allMoves } } -> analyzePosition 的結果 */
  analyze(args) { return this._run("analyze", args); }
}
