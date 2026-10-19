/**
 * 劃區爭霸 (District) - 強化版 CPU AI 決策引擎 (v2.0)
 * 
 * 核心演算法：
 * 1. 變異數感知勝率模型 (Variance-Aware Gaussian/Softmax EV)：
 *    考慮各格不同選舉人票權重、四象限系統性偏差與單格抽樣誤差，精確估算各選區期望選舉人票。
 * 2. 傑利蠑螈效率評估 (Packing & Cracking Heuristic)：
 *    獎勵「集中對手鐵票 (Packing)」與「以微幅安全領先切割選區 (Cracking)」，懲罰自我票源過度集中。
 * 3. 虛擬延伸封區預判 (Virtual Ray-Bridge Lookahead) 與鄰格分流梯度：
 *    當單一牆塊尚未立即封閉選區時，從開放端點向最近外框或既有牆壁投射虛擬橋樑，
 *    預判兩步內圍地後的期望票數收益，解決單步視野盲區。
 * 4. 雙層期望極小化極大搜尋 (2-Ply Expectiminimax)：
 *    對前段候選走法模擬下一位對手從剩餘牌袋抽牌後的最佳反制，挑選淨勝分最高之決策。
 */

import { evaluateMovesByRolloutGen } from "./rollout.js";
import { normalizeAiLevel } from "../core/constants.js";
import {
  applyPlaceWall,
  getLegalPlacements,
  calculateRegions,
  cloneBoardState,
  isBoundaryVertex,
  isVertexAnchored
} from "../core/rules.js";

/**
 * 計算單一區域的政黨期望勝率、期望選舉人票與劃區效率加權
 */
export function evaluateRegionProbabilities(region, pollSupportGrid, numPlayers, electoralVotesGrid = null, sigmaScale = 1) {
  const size = region.cells.length;
  const totalSupport = Array(numPlayers).fill(0);
  const quadCounts = [0, 0, 0, 0];
  let regionVotes = 0;
  const N = pollSupportGrid.length;
  const halfN = Math.floor(N / 2);

  for (const [r, c] of region.cells) {
    const cellSupport = pollSupportGrid[r][c];
    let cellSum = 0;
    for (let p = 0; p < numPlayers; p++) {
      totalSupport[p] += cellSupport[p];
      cellSum += cellSupport[p];
    }
    const ev = electoralVotesGrid ? electoralVotesGrid[r][c] : cellSum;
    regionVotes += ev;

    const q = (r >= halfN ? 2 : 0) + (c >= halfN ? 1 : 0);
    quadCounts[q] += ev / 100;
  }

  // 若測試環境傳入每格總和 100 且未指定 electoralVotesGrid，預設以 regionVotes 計票
  const effectiveVotes = regionVotes > 0 ? regionVotes : size * 100;

  // 計算區域民調誤差標準差：包含象限偏差變異 (與同象限格數平方成正比) + 單格獨立誤差變異
  let quadVar = 0;
  for (let q = 0; q < 4; q++) {
    quadVar += quadCounts[q] * quadCounts[q] * 3.2;
  }
  const cellVar = (effectiveVotes / 100) * 6.5;
  const sigma = Math.max(0.01, Math.max(3.5, Math.sqrt(quadVar + cellVar)) * sigmaScale);

  // 使用溫度為 sigma 的 Softmax 計算各黨勝出機率
  const scaled = totalSupport.map(s => s / sigma);
  const maxScaled = Math.max(...scaled);
  const exps = scaled.map(v => Math.exp(v - maxScaled));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(v => v / sumExp);

  const expectedVotes = probs.map(pr => effectiveVotes * pr);

  return {
    size,
    votes: effectiveVotes,
    sigma,
    totalSupport,
    probs,
    expectedVotes
  };
}

/** 評估棋盤狀態下各玩家依民調之期望總選舉人票 */
export function evaluateBoardExpectedVotes(boardState, pollSupportGrid, numPlayers, electoralVotesGrid = null, minSize = 1, sigmaScale = 1) {
  const regions = calculateRegions(boardState);
  const totalExpected = Array(numPlayers).fill(0);

  for (const region of regions) {
    const { expectedVotes } = evaluateRegionProbabilities(
      region,
      pollSupportGrid,
      numPlayers,
      electoralVotesGrid,
      sigmaScale
    );
    // 未達最小格數的選區是均分選區：選舉人票平分給所有政黨
    if (region.cells.length < minSize) {
      const { votes } = evaluateRegionProbabilities(region, pollSupportGrid, numPlayers, electoralVotesGrid);
      for (let p = 0; p < numPlayers; p++) totalExpected[p] += votes / numPlayers;
      continue;
    }
    for (let p = 0; p < numPlayers; p++) {
      totalExpected[p] += expectedVotes[p];
    }
  }

  return totalExpected;
}

/**
 * 計算玩家 p 的相對優勢分數（我方期望選舉人票 − 最強對手期望選舉人票）
 */
export function calculatePlayerScore(expectedVotes, playerId, numPlayers) {
  const myVotes = expectedVotes[playerId];
  let maxOpponent = -Infinity;
  for (let p = 0; p < numPlayers; p++) {
    if (p !== playerId && expectedVotes[p] > maxOpponent) {
      maxOpponent = expectedVotes[p];
    }
  }
  return myVotes - (maxOpponent === -Infinity ? 0 : maxOpponent);
}

/**
 * 從開放端點向四個正交方向尋找距離 <= 2 的最短封口橋樑，並回傳可封閉的虛擬邊
 */
function findVirtualBridgeEdges(boardState, endpoints) {
  const bridges = [];
  const dirs = [
    { dr: -1, dc: 0, type: "V" },
    { dr: 1, dc: 0, type: "V" },
    { dr: 0, dc: -1, type: "H" },
    { dr: 0, dc: 1, type: "H" }
  ];

  for (const [er, ec] of endpoints) {
    if (isBoundaryVertex(boardState, er, ec)) continue;

    for (const d of dirs) {
      const tempEdges = [];
      let cr = er;
      let cc = ec;
      let reachedAnchor = false;

      for (let step = 1; step <= 2; step++) {
        const nr = cr + d.dr;
        const nc = cc + d.dc;
        const edgeR = d.type === "V" ? Math.min(cr, nr) : cr;
        const edgeC = d.type === "H" ? Math.min(cc, nc) : cc;

        // 若該方向已經是放過的牆，表示這是剛放牆的本體方向，跳過
        if (d.type === "H" && boardState.upDown[edgeR - 1]?.[edgeC] !== null) break;
        if (d.type === "V" && boardState.leftRight[edgeR]?.[edgeC - 1] !== null) break;

        tempEdges.push({ type: d.type, r: edgeR, c: edgeC });
        cr = nr;
        cc = nc;

        if (isVertexAnchored(boardState, cr, cc)) {
          reachedAnchor = true;
          break;
        }
      }

      if (reachedAnchor && tempEdges.length > 0) {
        bridges.push(tempEdges);
      }
    }
  }

  return bridges;
}

/**
 * 評估單步牆塊的戰術價值（含鄰格分流梯度、端點錨定與單步虛擬封區潛力）
 */
function evaluateWallTactics(boardBefore, boardAfter, move, playerId, pollGrid, evGrid, numPlayers, baseScoreAfter, minSize = 1, sigmaScale = 1) {
  const N = boardAfter.boardSize;
  const geometry = boardAfter.placedWalls[boardAfter.placedWalls.length - 1].geometry;
  let tacticalBonus = 0;

  // 1. 計算每格我方相對於最強對手的淨勝票差
  const cellNetMargin = (r, c) => {
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    const s = pollGrid[r]?.[c];
    if (!s) return null;
    const my = s[playerId];
    let bestOpp = 0;
    for (let p = 0; p < numPlayers; p++) {
      if (p !== playerId && s[p] > bestOpp) bestOpp = s[p];
    }
    return my - bestOpp;
  };

  // 2. 評估牆塊每一條邊隔開的相鄰兩格
  for (const edge of geometry.edges) {
    let m1 = null;
    let m2 = null;
    if (edge.type === "H") {
      m1 = cellNetMargin(edge.r - 1, edge.c);
      m2 = cellNetMargin(edge.r, edge.c);
    } else {
      m1 = cellNetMargin(edge.r, edge.c - 1);
      m2 = cellNetMargin(edge.r, edge.c);
    }

    if (m1 === null || m2 === null) continue;

    const hi = Math.max(m1, m2);
    const lo = Math.min(m1, m2);

    // 情境 A (Packing 對手鐵票)：一側為對手強鐵票區 (lo < -16)，另一側為搖擺或我方區 (hi > -8)
    if (lo < -16 && hi > -8) {
      tacticalBonus += Math.min(18, (-lo - 12) * 0.45);
    }
    // 情境 B (Cracking 保護我方微幅領先)：一側我方小贏 (+3 ~ +26)，另一側對手領先 (lo < -5)
    else if (hi >= 3 && hi <= 26 && lo < -5) {
      tacticalBonus += Math.min(15, (hi - lo) * 0.35);
    }
    // 情境 C (避免自我切割)：一側我方大贏 (hi > 18)，另一側我方小輸 (-15 <= lo < 0)，合併原本能全拿！
    else if (hi > 18 && lo >= -15 && lo < 0 && hi + lo > 4) {
      tacticalBonus -= 14;
    }
    // 情境 D (避免切碎我方雙贏鐵票區)
    else if (hi > 10 && lo > 10) {
      tacticalBonus -= 6;
    }
  }

  // 3. 檢查端點與既有牆或外框的錨定數（圍地必備條件）
  let anchoredEndpoints = 0;
  for (const [er, ec] of geometry.endpoints) {
    // 端點接觸外框、海岸線，或放牆前已連接其他牆
    if (isVertexAnchored(boardBefore, er, ec)) {
      anchoredEndpoints++;
    }
  }
  tacticalBonus += anchoredEndpoints * 5.5;

  // 4. 虛擬橋樑延伸預判（若此牆尚未直接封區，檢查距離 1~2 格內封口後的期望值躍升）
  const bridges = findVirtualBridgeEdges(boardAfter, geometry.endpoints);
  if (bridges.length > 0) {
    const virtualBoard = cloneBoardState(boardAfter);
    // 投射最多 2 條最短虛擬橋樑測試封區效果
    for (let b = 0; b < Math.min(2, bridges.length); b++) {
      for (const ve of bridges[b]) {
        if (ve.type === "H") {
          virtualBoard.upDown[ve.r - 1][ve.c] = 77777;
        } else {
          virtualBoard.leftRight[ve.r][ve.c - 1] = 77777;
        }
      }
    }
    const virtualExpected = evaluateBoardExpectedVotes(virtualBoard, pollGrid, numPlayers, evGrid, minSize, sigmaScale);
    const virtualScore = calculatePlayerScore(virtualExpected, playerId, numPlayers);
    const potentialGain = virtualScore - baseScoreAfter;
    if (potentialGain > 0) {
      tacticalBonus += potentialGain * 0.38;
    } else if (potentialGain < -20) {
      tacticalBonus += potentialGain * 0.20;
    }
  }

  return tacticalBonus;
}

/**
 * 電腦強度 1～4 級。參數：
 *   eps         每一步改走隨機合法位置的機率（1 = 完全隨機）
 *   randomTop   從啟發式評分前幾名隨機挑一手（1 = 一定選最高分）
 *   topK / oppShapes / oppSamples   前瞻：重新評估的候選數、對手抽樣的形狀數與位置數
 *   rollouts / rolloutTop           模擬型：前幾名候選各自隨機模擬到終局的次數（見 rollout.js）
 *   sigma       區內勝負的軟化程度（預設 1；試過 0.03～0.3 對棋力沒有影響，各級都不用）
 *
 * 相鄰兩級對戰勝率（上一級贏；同一張地圖、種子各打兩盤並互換先後手；台灣 24x24、預設補償，各 200 盤，誤差約 ±3.4%）：
 *                  池子 1   池子 2   池子 3
 *   2 對 1         64.0%    63.0%    56.0%
 *   3 對 2         62.0%    61.5%    60.0%
 *   4 對 3         62.0%    60.0%    66.5%
 * 目標是每級約 65%（60～70%）。池子 3 的第 2 級對第 1 級偏低（56%），但調強第 2 級（只從前 2 名挑）會讓第 3 級對它只剩 51.5%，所以不調。
 *
 * 為什麼不是五連黑白棋的 80%：地圖的民調與真實支持度是同一份資料（沒有隱藏資訊），但選區切得很碎
 * （平均約 35 區、每區 4 格），結果接近「每格各自多數決」，技術能拉開的差距很窄。最強的模擬型對純隨機也只有約 8 成。
 * 第 5 級沒有空間：模擬 30 次對 10 次 58.5%、模擬 60 次對 30 次 52.5%；候選擴到 20 個、模擬時雙方改成抽 3 個選最好、
 * 池子變大、牌袋縮小都試過，沒有明顯改善。第 4 級每步約 0.25～0.6 秒（台灣 24x24），用 decideMoveAsync 分段計算不卡畫面。
 */
export const AI_LEVELS = {
  1: { topK: 1, oppShapes: 0, oppSamples: 0, randomTop: 1, eps: 1 },
  2: { topK: 1, oppShapes: 0, oppSamples: 0, randomTop: 3 },
  3: { topK: 7, oppShapes: 2, oppSamples: 10, randomTop: 1 },
  4: { topK: 1, oppShapes: 0, oppSamples: 0, randomTop: 1, rollouts: 10, rolloutTop: 8, passMargin: 0.05 }
};

export class AIPlayer {
  /**
   * @param {number} playerId
   * @param {{difficulty?: string, level?: number|string, config?: object}} options - level 為 1～4 級（舊的 easy | normal | hard 也接受）；
   *   省略時依 engine.rules.aiLevel；config 直接給強度參數（量測用）。difficulty "fast" 為舊版不前瞻模式。
   */
  constructor(playerId, options = {}) {
    this.playerId = playerId;
    this.difficulty = options.difficulty || "master";
    this.level = options.level || null;
    this.config = options.config || null; // 直接給強度參數（校準與測試用）；沒給就依 level 查表
  }

  /** 決策下一步行動（同步，一口氣算完） */
  decideMove(engine) {
    const it = this._decide(engine);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }

  /**
   * 決策下一步行動（非同步）：慢的強度（模擬型）每隔約 10 毫秒讓出一次，瀏覽器畫面不會卡住。
   * 呼叫端要自己確認算完時局面沒變（例如玩家已經悔棋或開新局）。
   */
  async decideMoveAsync(engine) {
    const it = this._decide(engine);
    let r = it.next();
    while (!r.done) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      r = it.next();
    }
    return r.value;
  }

  /** 決策本體：生成器，模擬型強度在算的途中 yield */
  *_decide(engine) {
    const { boardState, candidatePool, currentPlayer, numPlayers, boardSize, wallBag } = engine;
    if (currentPlayer !== this.playerId) {
      throw new Error("Not this AI player's turn");
    }

    const level = this.config || AI_LEVELS[normalizeAiLevel(this.level ?? engine.rules?.aiLevel)];
    const SS = level.sigma ?? 1; // 區內勝負的軟化程度：1 = 原本的民調誤差模型，越小越接近「得票多的政黨直接拿下」
    // 地圖外棋格以 null 表示，戰術評估會略過
    const pollGrid = Array.from({ length: boardSize }, (_, r) =>
      Array.from({ length: boardSize }, (_, c) => {
        const cell = engine.map.cells[r][c];
        return cell.active === false ? null : cell.pollSupport;
      })
    );
    const evGrid = Array.from({ length: boardSize }, (_, r) =>
      Array.from({ length: boardSize }, (_, c) => engine.map.cells[r][c].electoralVotes)
    );

    const minSize = engine.rules?.minDistrictSize || 1;

    // 0. 現況基準期望分數 (Pass 的基準)
    const currentExpected = evaluateBoardExpectedVotes(boardState, pollGrid, numPlayers, evGrid, minSize, SS);
    const baselineScore = calculatePlayerScore(currentExpected, this.playerId, numPlayers);
    const currentRegionCount = calculateRegions(boardState).length;

    // 1. 搜尋當前手牌所有合法位置
    const candidateMoves = [];
    for (let poolIdx = 0; poolIdx < candidatePool.length; poolIdx++) {
      const piece = candidatePool[poolIdx];
      const legalPlacements = getLegalPlacements(boardState, piece.shape);

      for (const pos of legalPlacements) {
        candidateMoves.push({
          poolIndex: poolIdx,
          piece,
          vr: pos.vr,
          vc: pos.vc
        });
      }
    }

    if (candidateMoves.length === 0) {
      return { action: "pass" };
    }

    // 完全隨機（1 級）：不用評估，直接亂挑一個合法位置
    if (level.eps >= 1) {
      const pick = candidateMoves[Math.floor(Math.random() * candidateMoves.length)];
      return { action: "place", poolIndex: pick.poolIndex, vr: pick.vr, vc: pick.vc, score: 0 };
    }

    // 2. 第一層全方位評估：直接期望選舉人票 + 圍地戰術預判分
    for (const move of candidateMoves) {
      const cloned = cloneBoardState(boardState);
      applyPlaceWall(cloned, move.piece.shape, move.vr, move.vc, this.playerId, 9999);
      const expected = evaluateBoardExpectedVotes(cloned, pollGrid, numPlayers, evGrid, minSize, SS);
      const rawScore = calculatePlayerScore(expected, this.playerId, numPlayers);
      const tactical = evaluateWallTactics(
        boardState,
        cloned,
        move,
        this.playerId,
        pollGrid,
        evGrid,
        numPlayers,
        rawScore,
        minSize,
        SS
      );

      move.rawScore = rawScore;
      move.tacticalScore = tactical;
      move.immediateScore = rawScore + tactical;
      move.clonedBoard = cloned;
      move.closesRegion = calculateRegions(cloned).length > currentRegionCount;
    }

    candidateMoves.sort((a, b) => b.immediateScore - a.immediateScore);

    // 模擬型強度：前幾名候選（加上「放棄這塊」）各自隨機下到終局，取平均結果最好的
    if (level.rollouts) {
      const top = candidateMoves.slice(0, level.rolloutTop || 10);
      const poolShapes = candidatePool.map((p) => p.shape);
      const moves = top.map((m) => ({ board: m.clonedBoard, poolAfter: poolShapes.filter((_, i) => i !== m.poolIndex), passes: 0 }));
      moves.push({ board: boardState, poolAfter: poolShapes.slice(1), passes: engine.consecutivePasses + 1 });
      const scores = yield* evaluateMovesByRolloutGen(engine, this.playerId, moves, level.rollouts, level.policySamples || 1);
      // 放棄只在「明顯比最好的落子更好」時才選：模擬 10 次的雜訊會讓放棄在開局莫名勝出，雙方都放棄一輪就提早終局
      let bi = 0;
      for (let i = 1; i < top.length; i++) if (scores[i] > scores[bi]) bi = i;
      if (scores[top.length] > scores[bi] + (level.passMargin ?? 0)) return { action: "pass" };
      const pick = top[bi];
      return { action: "place", poolIndex: pick.poolIndex, vr: pick.vr, vc: pick.vc, score: scores[bi] };
    }

    // 3. 第二層對手反制前瞻 (2-Ply Expectiminimax)
    // 從牌袋中抽取最多 2 種代表性牆塊形狀模擬下一位對手的最佳反制
    const topK = Math.min(candidateMoves.length, Math.max(level.topK, level.randomTop));
    const nextPlayer = (this.playerId + 1) % numPlayers;

    const sampleOppShapes = [];
    const seenTypes = new Set();
    for (let i = wallBag.length - 1; i >= 0 && sampleOppShapes.length < level.oppShapes; i--) {
      const s = wallBag[i].shape;
      if (!seenTypes.has(s.type)) {
        seenTypes.add(s.type);
        sampleOppShapes.push(s);
      }
    }

    let bestMove = candidateMoves[0];
    let bestCompositeScore = -Infinity;

    for (let i = 0; i < topK; i++) {
      const move = candidateMoves[i];
      const nextBoard = move.clonedBoard;

      let worstCaseScoreAfterOpp = move.rawScore;

      if (sampleOppShapes.length > 0 && this.difficulty !== "fast") {
        let oppTotalBestMyScore = 0;
        let validSamples = 0;

        for (const oppShape of sampleOppShapes) {
          const oppLegal = getLegalPlacements(nextBoard, oppShape);
          if (oppLegal.length === 0) continue;

          // 快速挑出對手最可能威脅的位置（抽樣最多 10 個位置）
          const stride = Math.max(1, Math.floor(oppLegal.length / level.oppSamples));
          let oppBestScore = -Infinity;
          let myScoreUnderOppBest = move.rawScore;

          for (let idx = 0; idx < oppLegal.length; idx += stride) {
            const oppPos = oppLegal[idx];
            const oppCloned = cloneBoardState(nextBoard);
            applyPlaceWall(oppCloned, oppShape, oppPos.vr, oppPos.vc, nextPlayer, 8888);
            const oppExpected = evaluateBoardExpectedVotes(oppCloned, pollGrid, numPlayers, evGrid, minSize, SS);
            const oppScore = calculatePlayerScore(oppExpected, nextPlayer, numPlayers);

            if (oppScore > oppBestScore) {
              oppBestScore = oppScore;
              myScoreUnderOppBest = calculatePlayerScore(oppExpected, this.playerId, numPlayers);
            }
          }

          oppTotalBestMyScore += myScoreUnderOppBest;
          validSamples++;
        }

        if (validSamples > 0) {
          worstCaseScoreAfterOpp = oppTotalBestMyScore / validSamples;
        }
      }

      // 綜合評分 = 0.65 * 我方落子後直接期望分 + 0.35 * 對手反制後期望分 + 戰術圍地潛力分
      const composite = 0.65 * move.rawScore + 0.35 * worstCaseScoreAfterOpp + move.tacticalScore;
      move.compositeScore = composite;

      if (composite > bestCompositeScore) {
        bestCompositeScore = composite;
        bestMove = move;
      }
    }

    // 簡單：從前幾名隨機挑一手，偶爾會錯過最佳位置
    if (level.randomTop > 1) {
      const pool = candidateMoves.slice(0, Math.min(level.randomTop, candidateMoves.length));
      bestMove = pool[Math.floor(Math.random() * pool.length)];
      bestCompositeScore = bestMove.compositeScore ?? bestMove.immediateScore;
    }

    // 失誤：有一定機率改走隨機的合法位置（模擬失誤，直接落子不經過下面的 Pass 判斷）
    if (level.eps && Math.random() < level.eps) {
      const blunder = candidateMoves[Math.floor(Math.random() * candidateMoves.length)];
      return { action: "place", poolIndex: blunder.poolIndex, vr: blunder.vr, vc: blunder.vc, score: blunder.immediateScore };
    }

    // 4. 智慧 Pass 決策：
    // 若我方目前已領先，且最佳落子反而會損害我方期望值，則選擇 Pass；
    // 若我方目前落後且再 Pass 就會直接終局落敗，則只要不是嚴重自毀就積極落子拚搏。
    const isLastPassBeforeEnd = engine.consecutivePasses >= (engine.passLimit ?? numPlayers) - 1;
    const rawDelta = bestMove.rawScore - baselineScore;

    if (isLastPassBeforeEnd && baselineScore < 0) {
      // 落後且面臨終局：只要不大幅倒扣超過 45 票，就落子延續戰局
      if (rawDelta >= -45 || bestMove.tacticalScore > 8) {
        return {
          action: "place",
          poolIndex: bestMove.poolIndex,
          vr: bestMove.vr,
          vc: bestMove.vc,
          score: bestCompositeScore
        };
      }
    }

    // 一般回合：若直接票差 + 戰術價值 >= -6，則積極佈局；否則 Pass 棄牌
    if (rawDelta + bestMove.tacticalScore >= -6) {
      return {
        action: "place",
        poolIndex: bestMove.poolIndex,
        vr: bestMove.vr,
        vc: bestMove.vc,
        score: bestCompositeScore
      };
    }

    return { action: "pass" };
  }
}
