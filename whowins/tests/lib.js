/**
 * 誰會贏？ 測試與校準共用：用快速核心下完整盤、可重現的骰子、代理人（搜尋、隨機、舊 v5）。
 */
import { Position, BLACK, WHITE, genMoves, canCaptureEver, settleDiff, mvTo, mvFrom, mvCap, mvDie } from "../src/engine/core.js";
import { Searcher } from "../src/engine/search.js";
import { chooseCode } from "../src/engine/service.js";
import { LEVELS } from "../src/engine/levels.js";

export const opp = (s) => (s === BLACK ? WHITE : BLACK);

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const MBUF = new Int32Array(512);

/** 隨機代理人（第 1 級用）：隨機合法步，自選點數時隨機挑一個有步的點數 */
export function randomAgent(rng) {
  return {
    name: "random",
    choose(pos, die) {
      const n = genMoves(pos, pos.turn, die || 0, MBUF);
      return n ? MBUF[Math.floor(rng() * n)] : -1;
    }
  };
}

/** 搜尋代理人：depth 固定層數，timeMs 與 fixedDepth=false 時按時間，eps 是隨機失誤率 */
export function searchAgent({ depth = 2, timeMs = 1000, fixedDepth = true, eps = 0, rng = Math.random, searcher = new Searcher(), name } = {}) {
  return {
    name: name || `search d${depth}`,
    searcher,
    choose(pos, die) {
      if (eps && rng() < eps) {
        const n = genMoves(pos, pos.turn, die || 0, MBUF);
        if (n) return MBUF[Math.floor(rng() * n)];
      }
      const r = searcher.analyze(pos, { maxDepth: depth, timeMs, fixedDepth, die: die || null });
      if (r.mode === "free") {
        let best = -1, bv = -1;
        for (const pd of r.perDie) if (pd && pd.value > bv) { bv = pd.value; best = pd.move; }
        return best;
      }
      const pd = r.perDie[(die || 1) - 1];
      return pd ? pd.move : -1;
    }
  };
}

/**
 * 下完一整盤。骰子由 diceSeed 決定：第 k 次「擲骰」固定是同一個點數，與走法無關，
 * 所以兩個引擎用同一組 seed 對打，運氣相同（共同隨機數）。
 * onSample(pos, mover) 在每個機率節點（擲骰前）被呼叫，用來收集訓練資料。
 * 回傳 { diff（黑方淨勝分）, winner, plies, moves: [{ side, die, move, free }] }
 */
export function playGame({ black, white, diceSeed = 1, komi = 3.5, onSample = null, maxPlies = 600, record = false }) {
  const pos = new Position();
  pos.komi = komi;
  const dice = makeRng(diceSeed);
  const moves = [];
  let free = false, passes = 0, plies = 0, diff = null;
  while (plies < maxPlies) {
    const side = pos.turn;
    const agent = side === BLACK ? black : white;
    pos.free = free;
    let die = 0, m;
    if (free) {
      m = agent.choose(pos, 0);
      if (m < 0) { // 自選也無步：再 PASS；連續兩次視為終局
        passes++;
        if (passes >= 2) { diff = settleDiff(pos, side); break; }
        pos.turn = opp(side); plies++;
        continue;
      }
      die = mvDie(m);
    } else {
      if (onSample) onSample(pos, side);
      die = 1 + Math.floor(dice() * 6);
      m = agent.choose(pos, die);
      if (m < 0) { // PASS
        if (record) moves.push({ side, die, move: -1, free: false });
        free = true; passes = 0; pos.turn = opp(side); plies++;
        continue;
      }
    }
    pos.makeMove(m, side);
    if (record) moves.push({ side, die, move: m, free });
    plies++; passes = 0;
    const e = side === BLACK ? pos.w : pos.b;
    let any = 0;
    for (let r = 0; r < 8; r++) any |= e[r];
    if (!any) { diff = settleDiff(pos, side); break; }
    pos.turn = opp(side); free = false;
    if (!canCaptureEver(pos)) { diff = settleDiff(pos, pos.turn); break; }
  }
  if (diff === null) diff = settleDiff(pos, pos.turn);
  return { diff, winner: diff > 0 ? BLACK : WHITE, plies, moves };
}

/** 成對對戰：同一個 diceSeed 下 A 執黑一次、A 執白一次。回傳 A 的勝場（0、1、2） */
export function pairedMatch(makeA, makeB, diceSeed, komi = 3.5) {
  const a1 = makeA(), b1 = makeB();
  const g1 = playGame({ black: a1, white: b1, diceSeed, komi });
  const a2 = makeA(), b2 = makeB();
  const g2 = playGame({ black: b2, white: a2, diceSeed, komi });
  return (g1.winner === BLACK ? 1 : 0) + (g2.winner === WHITE ? 1 : 0);
}

/** 依 levels.js 的等級設定下棋（和網頁的 CPU 完全同一條路）。cfg 可傳自訂設定 */
export function levelAgent(levelOrCfg, { rng = Math.random, timeMs = 1000, searcher = new Searcher() } = {}) {
  const cfg = typeof levelOrCfg === "number" ? LEVELS[levelOrCfg - 1] : levelOrCfg;
  return {
    name: "level " + (cfg.id ?? JSON.stringify(cfg)),
    choose(pos, die) { return chooseCode(searcher, pos, die, cfg, { timeMs, rng }).code; }
  };
}
