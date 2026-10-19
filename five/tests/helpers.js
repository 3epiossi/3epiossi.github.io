/** 測試共用：可重現的亂數、基準對手與自動對局 */
import { GameEngine } from "../src/core/game-engine.js";
import { findBestMoveForCPU } from "../src/ai/ai-service.js";
import { toSearchBoard, legalMovesSb, immediateGain } from "../src/ai/search-board.js";
import { blackWeight, whiteWeight } from "../src/core/rules.js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 基準對手：隨機落子 */
export function randomMove(e, rng) {
  const m = e.legalMoves();
  return m[Math.floor(rng() * m.length)];
}

/** 基準對手：只看這一步立刻賺多少權重 */
export function greedyMove(e) {
  const sb = toSearchBoard(e.board);
  const placed = { b: blackWeight(e.hand), w: whiteWeight(e.hand) };
  let best = null, bestV = -Infinity;
  for (const m of legalMovesSb(sb, e.currentTurn)) {
    const v = immediateGain(sb, m, placed, e.currentTurn);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

/** v6 的走步（同步版） */
export function engineMove(e, timeMs, params) {
  return findBestMoveForCPU(e.board, e.currentTurn, e.pool, { timeMs, params }).chosen;
}

/**
 * 自動打完一局。pickBlack / pickWhite 是 (engine) => {r, c}。
 * 預設雙方都用 v6（短思考時間）。
 */
export function playGame({ seed = 1, pickBlack, pickWhite, timeMs = 20 } = {}) {
  const e = new GameEngine({ rng: mulberry32(seed) });
  const v6 = (eng) => engineMove(eng, timeMs);
  let guard = 0;
  while (!e.gameOver && guard++ < 200) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const pick = e.currentTurn === 1 ? (pickBlack || v6) : (pickWhite || v6);
    const m = pick(e);
    e.executeMove(m.r, m.c, m.disc ?? e.hand);
  }
  return e;
}
