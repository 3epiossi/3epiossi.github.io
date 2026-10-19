/**
 * 引擎服務層：把規則核心的整數走法轉成網頁（rules.js）用的格式，並提供「CPU 選步」與「局面分析」兩個入口。
 * 網頁與 Worker 都只呼叫這裡；測試與校準腳本也用這裡，所以等級的行為在網頁和腳本裡完全相同。
 */
import { Position, BLACK, genMoves, mvTo, mvFrom, mvCap, mvDie } from "./core.js";
import { Searcher } from "./search.js";
import { LEVELS, clampLevel } from "./levels.js";

/** 整數走法 → { cap, from:{r,c}, to:{r,c}, die }（可序列化，Worker 傳回主執行緒用） */
export function decodeMove(m) {
  if (m == null || m < 0) return null;
  const to = mvTo(m), fr = mvFrom(m);
  return { code: m, cap: !!mvCap(m), from: { r: fr >> 3, c: fr & 7 }, to: { r: to >> 3, c: to & 7 }, die: mvDie(m) };
}

export function encodeMove({ cap, from, to, die }) {
  const t = (to.r << 3) | to.c, f = cap ? (from.r << 3) | from.c : t;
  return t | (f << 6) | ((cap ? 1 : 0) << 12) | (die << 13);
}

const MBUF = new Int32Array(512);

/** 二維棋盤 → Position */
export function toPosition(board, turn, free = false, komi = 3.5) {
  return new Position().load(board, turn, free, komi);
}

/**
 * CPU 依等級選步（Position 版，腳本與 Worker 共用）。die = 擲出的點數（自選點數回合為 null / 0）。
 * 回傳 { code: 整數走法（-1 = PASS）, depth, value }。
 * 失誤（eps）與隨機等級用 rng 抽，傳入 rng 可讓測試重現。
 */
export function chooseCode(searcher, pos, die, cfg, { timeMs = 1000, rng = Math.random } = {}) {
  const turn = pos.turn;
  const rollDie = pos.free ? 0 : die;
  const randomPick = () => {
    const n = genMoves(pos, turn, rollDie || 0, MBUF);
    return n ? MBUF[Math.floor(rng() * n)] : -1;
  };
  if (cfg.kind === "random" || (cfg.eps && rng() < cfg.eps)) return { code: randomPick(), depth: 0 };
  const r = searcher.analyze(pos, {
    maxDepth: cfg.depth || 12,
    timeMs: cfg.time || timeMs,
    fixedDepth: !!cfg.depth,
    die: rollDie || null
  });
  let m = -1;
  if (r.mode === "free") {
    let bv = -1;
    for (const pd of r.perDie) if (pd && pd.value > bv) { bv = pd.value; m = pd.move; }
  } else {
    const pd = r.perDie[(rollDie || 1) - 1];
    m = pd ? pd.move : -1;
  }
  return { code: m, depth: r.depth, value: r.value };
}

/** 網頁用：二維棋盤版，回傳 { move: decodeMove | null（null = PASS）, depth, value } */
export function chooseMove(searcher, board, turn, die, level, { free = false, komi = 3.5, timeMs = 1000, rng = Math.random } = {}) {
  const cfg = LEVELS[clampLevel(level) - 1];
  const r = chooseCode(searcher, toPosition(board, turn, free, komi), die, cfg, { timeMs, rng });
  return { move: decodeMove(r.code), depth: r.depth, value: r.value };
}

/**
 * 局面分析（教練強度）。回傳 { value（輪到的一方的勝率）, perDie: [{ die, value, move, moves? }], depth, mode }
 * value 與 perDie 都是「輪到的一方」的角度；moves 只在 allMoves 時有，每一步一個精確勝率。
 */
export function analyzePosition(searcher, board, turn, { free = false, komi = 3.5, timeMs = 1000, maxDepth = 12, die = null, allMoves = false, fixedDepth = false } = {}) {
  const pos = toPosition(board, turn, free, komi);
  const r = searcher.analyze(pos, { maxDepth, timeMs, die, allMoves, fixedDepth });
  return {
    value: r.value, depth: r.depth, mode: r.mode, solved: !!r.solved, nodes: r.nodes,
    perDie: (r.perDie || []).map(pd => pd ? {
      die: pd.die, value: pd.value, move: decodeMove(pd.move),
      moves: pd.moves ? pd.moves.map(x => ({ move: decodeMove(x.move), value: x.value })) : undefined
    } : null)
  };
}

export { Searcher, BLACK };
