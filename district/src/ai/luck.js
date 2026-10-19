/**
 * 劃區爭霸 (District) - 抽牌手氣（跟誰會贏？的骰運同一個概念）
 *
 * 一回合的手氣 = 這回合手上的牆塊能做到的最好結果 − 隨機抽一塊平均能做到的結果，
 * 單位是期望選舉人票差（我方期望票減最強對手，用 CPU 同一套評估）。
 *   正數：抽到合用的牆，手氣好。負數：抽到的牆在這個局面幫不上忙。
 * 「能做到的最好結果」= 手牌每塊牆在棋盤上最好的位置，或乾脆放棄（維持現況）。
 * 不看玩家實際下在哪，只看抽到什麼，所以跟棋力（下得好不好）分開算。
 */

import { evaluateBoardExpectedVotes, calculatePlayerScore } from "./ai-player.js";
import { applyPlaceWall, cloneBoardState, getLegalPlacements } from "../core/rules.js";

/** 每個形狀最多評估幾個位置（等距抽樣）：每一回合要評估十種形狀，不抽樣會太慢 */
const PLACEMENT_CAP = 24;

function makeContext(engine) {
  const n = engine.boardSize;
  const pollGrid = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => {
    const cell = engine.map.cells[r][c];
    return cell.active === false ? null : cell.pollSupport;
  }));
  const evGrid = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => engine.map.cells[r][c].electoralVotes));
  return { pollGrid, evGrid, numPlayers: engine.numPlayers, minSize: engine.rules?.minDistrictSize || 1, handSize: engine.rules?.handSize || 1 };
}

function scoreOf(ctx, board, player) {
  return calculatePlayerScore(evaluateBoardExpectedVotes(board, ctx.pollGrid, ctx.numPlayers, ctx.evGrid, ctx.minSize, 1), player, ctx.numPlayers);
}

/** 這塊牆在這個局面最好的結果（放棄 = 維持現況也算一種） */
function bestForShape(ctx, board, shape, player, baseline) {
  const legal = getLegalPlacements(board, shape);
  let best = baseline;
  const stride = Math.max(1, Math.ceil(legal.length / PLACEMENT_CAP));
  for (let i = 0; i < legal.length; i += stride) {
    const b = cloneBoardState(board);
    applyPlaceWall(b, shape, legal[i].vr, legal[i].vc, player, 9999);
    const v = scoreOf(ctx, b, player);
    if (v > best) best = v;
  }
  return best;
}

/** 從 h 次獨立抽牌取最好的那一個，期望值（values 與機率一一對應） */
function expectedMax(values, probs, h) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  let cum = 0, prevPow = 0, out = 0;
  for (const i of order) {
    cum += probs[i];
    const pow = Math.pow(Math.min(1, cum), h);
    out += values[i] * (pow - prevPow);
    prevPow = pow;
  }
  return out;
}

/**
 * 算「走出 node 這一步之前」那一回合的手氣（生成器：每評估完一種形狀 yield 一次）。
 * 回傳期望選舉人票差；牌袋空了沒有抽牌可言，回傳 null。
 */
export function* luckOfTurn(engine, parentNode, ctx = engine._luckCtx || (engine._luckCtx = makeContext(engine))) {
  const snap = parentNode.snap;
  const player = snap.currentPlayer;
  const hand = snap.candidatePool;
  if (!hand.length) return null;
  const counts = new Map();
  for (const p of [...hand, ...snap.wallBag]) counts.set(p.shape.id, { shape: p.shape, n: (counts.get(p.shape.id)?.n || 0) + 1 });
  if (counts.size === 0) return null;
  if (snap.wallBag.length === 0 && hand.length <= ctx.handSize) {
    // 最後一輪：沒有牌袋可抽，沒有運氣的成分
    return null;
  }
  const baseline = scoreOf(ctx, snap.boardState, player);
  const best = new Map();
  for (const [id, { shape }] of counts) {
    best.set(id, bestForShape(ctx, snap.boardState, shape, player, baseline));
    yield;
  }
  const total = [...counts.values()].reduce((a, c) => a + c.n, 0);
  const ids = [...counts.keys()];
  const expected = expectedMax(ids.map((id) => best.get(id)), ids.map((id) => counts.get(id).n / total), ctx.handSize);
  const got = Math.max(baseline, ...hand.map((p) => best.get(p.shape.id) ?? bestForShape(ctx, snap.boardState, p.shape, player, baseline)));
  return got - expected;
}

/**
 * 手上這塊牆的運氣（目前局面）：它在這個局面最好能做到的結果，減去隨機抽一塊的平均。定義同每回合的手氣（期望選舉人票差）。
 * 生成器：每算完一種形狀讓出一次。
 */
export function* luckOfPieceGen(engine, shape, ctx = engine._luckCtx || (engine._luckCtx = makeContext(engine))) {
  const player = engine.currentPlayer;
  const board = engine.boardState;
  const counts = new Map();
  for (const p of [...engine.candidatePool, ...engine.wallBag]) counts.set(p.shape.id, { shape: p.shape, n: (counts.get(p.shape.id)?.n || 0) + 1 });
  if (!counts.has(shape.id)) return null;
  const baseline = scoreOf(ctx, board, player);
  const best = new Map();
  for (const [id, { shape: s }] of counts) {
    best.set(id, bestForShape(ctx, board, s, player, baseline));
    yield;
  }
  const total = [...counts.values()].reduce((a, c) => a + c.n, 0);
  const ids = [...counts.keys()];
  const expected = expectedMax(ids.map((id) => best.get(id)), ids.map((id) => counts.get(id).n / total), 1);
  return best.get(shape.id) - expected;
}

/** 非同步版：每段讓出一次主執行緒，畫面不會卡住 */
export async function luckOfTurnAsync(engine, parentNode) {
  const it = luckOfTurn(engine, parentNode);
  let r = it.next();
  while (!r.done) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    r = it.next();
  }
  return r.value;
}

/**
 * 某一步之後各黨的預期選舉人票占比（%），給戰況走勢圖用。終局用開票結果；結果存在節點上，只算一次。
 */
export function shareOfNode(engine, node) {
  if (node.share) return node.share;
  const snap = node.snap;
  let share;
  if (snap.isGameOver && snap.finalResults) {
    share = snap.finalResults.partyStats.map((s) => s.seatShare);
  } else {
    const ctx = engine._luckCtx || (engine._luckCtx = makeContext(engine));
    const ev = evaluateBoardExpectedVotes(snap.boardState, ctx.pollGrid, ctx.numPlayers, ctx.evGrid, ctx.minSize, 1);
    const sum = ev.reduce((a, b) => a + b, 0) || 1;
    share = ev.map((v) => (v / sum) * 100);
  }
  node.share = share;
  return share;
}
