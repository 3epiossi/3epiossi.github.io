/**
 * 劃區爭霸 (District) - 蒙地卡羅模擬（rollout）
 *
 * 從某個局面起，雙方都隨機出牌（有合法位置就隨機放，沒有就放棄）一路下到終局，用正式的開票規則算最後的選舉人票。
 * 平均很多次，就是「這個局面接下來大概會怎麼樣」，比只看目前選區的靜態評估看得遠，
 * 因為它把後面還會被切開的選區、對手之後的牆都算進去。
 * 牌袋只用「還剩哪些形狀」，不偷看抽牌順序。
 */

import { applyPlaceWall, calculateRegions, canPlaceWall, cloneBoardState, getLegalPlacements, tallyElectoralVotes } from "../core/rules.js";

/** 隨機抽樣找一個合法位置；試太多次沒找到再完整掃描 */
function randomPlacement(board, shape, tries) {
  const N = board.boardSize;
  const span = N + 3;
  for (let i = 0; i < tries; i++) {
    const vr = Math.floor(Math.random() * span) - 2;
    const vc = Math.floor(Math.random() * span) - 2;
    if (canPlaceWall(board, shape, vr, vc).valid) return { vr, vc };
  }
  const all = getLegalPlacements(board, shape);
  return all.length ? all[Math.floor(Math.random() * all.length)] : null;
}

/** 目前局面對 player 的靜態分數：每個選區得票多的政黨拿下全部票（單格等小選區平分），我方票數減最強對手 */
function quickScore(ctx, board, player) {
  const { support, evs, numPlayers, minSize } = ctx;
  const regions = calculateRegions(board);
  const ev = Array(numPlayers).fill(0);
  for (const region of regions) {
    const sum = Array(numPlayers).fill(0);
    let votes = 0;
    for (const [r, c] of region.cells) {
      const s = support[r][c];
      for (let p = 0; p < numPlayers; p++) sum[p] += s[p];
      votes += evs[r][c];
    }
    if (region.cells.length < minSize) { for (let p = 0; p < numPlayers; p++) ev[p] += votes / numPlayers; continue; }
    let best = 0, ties = 1;
    for (let p = 1; p < numPlayers; p++) { if (sum[p] > sum[best]) { best = p; ties = 1; } else if (sum[p] === sum[best]) ties++; }
    for (let p = 0; p < numPlayers; p++) if (sum[p] === sum[best]) ev[p] += votes / ties;
  }
  let opp = -Infinity;
  for (let p = 0; p < numPlayers; p++) if (p !== player && ev[p] > opp) opp = ev[p];
  return ev[player] - opp;
}

/** 抽 k 個隨機合法位置，挑下完靜態分數最高的（k = 1 就是純隨機） */
function pickPlacement(ctx, board, shape, player, tries) {
  const k = ctx.k || 1;
  if (k <= 1) return randomPlacement(board, shape, tries);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < k; i++) {
    const pos = randomPlacement(board, shape, tries);
    if (!pos) break;
    const nb = cloneBoardState(board);
    applyPlaceWall(nb, shape, pos.vr, pos.vc, player, 9999);
    const sc = quickScore(ctx, nb, player);
    if (sc > bestScore) { bestScore = sc; best = pos; }
  }
  return best;
}

/**
 * 模擬一盤到終局，回傳 playerId 的結果：(我的選舉人票 - 最強對手) / 總票數，範圍約 [-1, 1]。
 * ctx：{ cellData, numPlayers, tallyOptions, passLimit, handSize }
 * 狀態：board（會被改動，傳入前要先複製）、pool（手牌形狀）、bag（牌袋剩餘形狀，會被改動）
 */
export function playout(ctx, board, pool, bag, player, consecutivePasses, playerId, tries = 24) {
  const { numPlayers, passLimit, handSize } = ctx;
  const draw = () => {
    while (pool.length < handSize && bag.length > 0) {
      const i = Math.floor(Math.random() * bag.length);
      pool.push(bag[i]);
      bag[i] = bag[bag.length - 1];
      bag.pop();
    }
  };
  draw(); // 剛下完一步，先補抽手牌
  let guard = 0;
  while (guard++ < 400) {
    if (consecutivePasses >= passLimit) break;
    if (pool.length === 0 && bag.length === 0) break;
    // 隨機挑一塊手牌找位置；每塊都找不到就放棄
    let placed = false;
    const order = pool.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const idx of order) {
      const pos = pickPlacement(ctx, board, pool[idx], player, tries);
      if (!pos) continue;
      applyPlaceWall(board, pool[idx], pos.vr, pos.vc, player, 9999);
      pool.splice(idx, 1);
      placed = true;
      break;
    }
    if (placed) consecutivePasses = 0;
    else { if (pool.length) pool.shift(); consecutivePasses++; }
    draw();
    player = (player + 1) % numPlayers;
    // 手上沒有任何能放的牆，袋子也空了就結束
    if (bag.length === 0 && pool.length > 0 && pool.every((s) => getLegalPlacements(board, s).length === 0)) break;
  }
  const regions = calculateRegions(board);
  const res = tallyElectoralVotes(regions, ctx.cellData, numPlayers, board, true, ctx.tallyOptions);
  const ev = res.electoralVotes;
  let opp = -Infinity;
  for (let p = 0; p < numPlayers; p++) if (p !== playerId && ev[p] > opp) opp = ev[p];
  const total = ev.reduce((a, b) => a + b, 0) || 1;
  return (ev[playerId] - opp) / total;
}

/**
 * 評估一組候選走法：每個走法各模擬 rollouts 次，回傳平均結果（跟 moves 同順序）。
 * moves：{ board（下完這步的局面）, poolAfter（下完後手牌形狀）, passes（連續放棄數） } ，輪到對手下。
 * 這是生成器：每算約 sliceMs 毫秒就 yield 一次，讓呼叫端（瀏覽器）有機會重繪；同步呼叫端用 evaluateMovesByRollout。
 */
export function* evaluateMovesByRolloutGen(engine, playerId, moves, rollouts, policySamples = 1, sliceMs = 10) {
  const N = engine.boardSize;
  const cells = engine.map.cells;
  const ctx = {
    k: policySamples,
    minSize: engine.rules.minDistrictSize || 1,
    support: Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => cells[r][c].support)),
    evs: Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => cells[r][c].electoralVotes)),
    cellData: engine._cellData(),
    numPlayers: engine.numPlayers,
    tallyOptions: engine._tallyOptions(),
    passLimit: engine.passLimit,
    handSize: engine.rules.handSize
  };
  const bagShapes = engine.wallBag.map((p) => p.shape);
  const next = (playerId + 1) % engine.numPlayers;
  const out = [];
  let sliceStart = performance.now();
  for (const m of moves) {
    let sum = 0;
    for (let r = 0; r < rollouts; r++) {
      const bag = bagShapes.slice();
      const pool = m.poolAfter.slice();
      sum += playout(ctx, cloneBoardState(m.board), pool, bag, next, m.passes, playerId);
      if (performance.now() - sliceStart > sliceMs) {
        yield;
        sliceStart = performance.now();
      }
    }
    out.push(sum / rollouts);
  }
  return out;
}

/** 同步版：一口氣算完 */
export function evaluateMovesByRollout(engine, playerId, moves, rollouts, policySamples = 1) {
  const it = evaluateMovesByRolloutGen(engine, playerId, moves, rollouts, policySamples, Infinity);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
