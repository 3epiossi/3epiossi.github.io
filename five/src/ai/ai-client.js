/**
 * 🧠 主執行緒呼叫搜尋引擎（v13）的介面：優先用 Web Worker，不支援時退回同步計算。
 */
import { searchEngine } from "./ai-service.js";
import { searchLevel, LEVELS, clampLevel } from "./levels.js";

const RESPAWN_IDLE_MS = 600;

export class AiClient {
  /** @param {boolean} [o.eager] 馬上開 worker（預設）；false = 第一次搜尋才開 */
  constructor({ eager = true } = {}) {
    this.seq = 0;
    this.pending = new Map();
    this.supported = true; // false：這個環境開不了 Worker（或 Worker 壞了），改在主執行緒同步算
    if (eager) this.spawn();
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
  search({ board, player, pool, timeMs, multiPV = false, level = null, part = null }) {
    const syncRun = () => {
      const r = level != null
        ? searchLevel(board, player, pool, LEVELS[clampLevel(level) - 1], { timeMs })
        : searchEngine(board, player, pool, { timeMs, multiPV, part });
      return r ? { bestSq: r.bestSq, disc: r.disc, scores: r.scores, depth: r.depth, exact: r.exact } : null;
    };
    if (!this.worker && this.supported) this.spawn();
    if (!this.worker) return new Promise((resolve) => setTimeout(() => resolve(syncRun()), 0));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, (result) => resolve(result === undefined ? syncRun() : result));
      this.worker.postMessage({ id, board, player, pool, timeMs, multiPV, level, part });
    });
  }
}

/**
 * 把平行分析各份的結果合起來（各份是 searchEngine 的結果或 null）。
 * 各份算到的深度不一樣（工作量不同），直接混在一起排名不公平：統一取「每一份都算完的最深一層」的分數
 * （已經算出勝負的那一份 proven、算到底的 exact 不拖後腿）。每一份都是 null（被取消、或沒有合法位置）→ null。
 */
export function mergeParts(results) {
  const got = results.filter(Boolean);
  if (!got.length) return null;
  if (got.length === 1) return got[0];
  // 要比深度的：還沒算出勝負、也沒算到底的那些份
  const racing = got.filter((r) => !r.proven && !r.exact);
  const common = racing.length && racing.every((r) => r.hist) ? Math.min(...racing.map((r) => r.depth)) : null;
  const pick = (r) => {
    if (common == null || r.proven || r.exact) return r.scores;
    return r.hist.find((h) => h.depth === common)?.scores ?? r.scores;
  };
  const scores = got.flatMap(pick).sort((a, b) => b.score - a.score);
  const top = scores[0];
  return {
    bestSq: top ? top.sq : got[0].bestSq,
    disc: top ? top.disc : got[0].disc,
    scores,
    depth: common ?? Math.min(...got.map((r) => r.depth)),
    exact: got.every((r) => r.exact),
    nodes: got.reduce((n, r) => n + (r.nodes || 0), 0)
  };
}

/**
 * 平行分析：好幾條 worker 一起算「每一步的精確分數」（multiPV：提示、教練、勝率走勢、走法評價用）。
 * 每個第一步都用完整窗口各自搜尋、彼此獨立，所以把格子分給每條 worker，時間一樣、每一步卻能多搜幾層。
 * CPU 下棋（只要最佳一步）不平行：一般的 alpha-beta 要靠前面的步縮窗口，硬拆會變慢，見 AiClient。
 * workers = 1 就跟單一 AiClient 一樣。
 */
export class AiPool {
  constructor(workers = 1) {
    // 沒有 Worker 的環境只能在主執行緒同步算，分成好幾份只會讓畫面凍結更久：一份
    const n = typeof Worker === "undefined" ? 1 : Math.max(1, workers);
    // 第一條照舊先開好（第一次分析不用等）；其餘第一次平行搜尋時才開
    this.clients = Array.from({ length: n }, (_, i) => new AiClient({ eager: i === 0 }));
  }

  get size() { return this.clients.length; }

  search(opts) {
    const k = this.clients.length;
    // 沒有開 worker 的環境（或單條）：照舊
    if (k === 1 || !opts.multiPV || opts.level != null || !this.clients.every((c) => c.supported)) return this.clients[0].search(opts);
    return Promise.all(this.clients.map((c, i) => c.search({ ...opts, part: [i, k] }))).then(mergeParts);
  }

  cancel() {
    for (const c of this.clients) c.cancel();
  }
}

/** 分析用幾條 worker：電腦上用一半的核心（留給 CPU 搜尋與畫面），最多 4 條；手機、核心少的機器一條 */
export function analysisWorkers({ lowPower = false, cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4 } = {}) {
  if (lowPower || cores <= 4) return 1;
  return Math.min(4, Math.floor(cores / 2));
}
