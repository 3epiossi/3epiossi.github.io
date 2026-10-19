/**
 * 劃區爭霸 (District) - 地圖民調、人口密度與真實支持度生成器
 * 
 * 設計重點：
 * 1. 每格擁有不同的人口規模 P_{r,c}（55 ~ 155 人，依都會核心與鄉村聚落自然分佈），
 *    因此每格對應的選舉人票（即該格總人口票權）各不相同。
 * 2. 全盤總人口與總選舉人票固定為 可用格數 * 100（經典 2人局 6400、3人局 8100、4人局 10000）。
 *    自訂地圖輪廓（mask）時，地圖外的棋格人口為 0，不參與任何計算。
 * 3. 各政黨全盤真實總支持度嚴格符合先手補償目標（targetTotals）。
 * 4. 民調數據包含「四象限系統性偏差」與「單格抽樣誤差」，且每格民調總和仍等於該格普查人口 P_{r,c}。
 */

import { GAME_MODES, EXTRA_PARTY_K, CELL_POPULATION, POPULATION_PROFILES, CLUSTERING_PROFILES } from "./constants.js";

/** Mulberry32 偽隨機數產生器 (Deterministic PRNG) */
export function createPRNG(seed = 1337) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 依政黨數取得預設先手補償步階 k（經典模式值；5、6 黨使用 EXTRA_PARTY_K） */
export function defaultCompensationK(numPlayers) {
  if (GAME_MODES[numPlayers]) return GAME_MODES[numPlayers].initialK;
  return EXTRA_PARTY_K[numPlayers] ?? 0;
}

/**
 * 計算先手補償後各政黨真實總人數目標
 * @param {number} numPlayers - 政黨數 (2~6)
 * @param {number|null} k - 先手補償步階
 * @param {number|null} totalPopulation - 全盤總人口；省略時使用經典模式 N^2 * 100
 */
export function calculateTargetTotals(numPlayers, k = null, totalPopulation = null) {
  if (numPlayers < 2) throw new Error(`Unsupported player count: ${numPlayers}`);
  let total = totalPopulation;
  if (total === null) {
    const config = GAME_MODES[numPlayers];
    if (!config) throw new Error(`Unsupported player count: ${numPlayers}`);
    total = config.totalCells * CELL_POPULATION;
  }
  const compensationK = k !== null ? k : defaultCompensationK(numPlayers);

  const targets = [];
  if (numPlayers === 2) {
    targets.push(total / 2 - compensationK);
    targets.push(total / 2 + compensationK);
  } else {
    // 依座位順序線性調整：k > 0 時越晚行動的政黨支持者越多，k < 0 時先行動的較多
    const avg = total / numPlayers;
    const mid = (numPlayers - 1) / 2;
    for (let i = 0; i < numPlayers; i++) {
      targets.push(Math.round(avg + (i - mid) * compensationK));
    }
  }

  const currentSum = targets.reduce((a, b) => a + b, 0);
  const diff = total - currentSum;
  if (diff !== 0) {
    targets[targets.length - 1] += diff;
  }

  return targets;
}

/** 取得遮罩內所有可用棋格座標（列優先）；mask 為 null 時回傳整個正方形 */
export function listActiveCells(boardSize, mask = null) {
  const cells = [];
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (!mask || mask[r][c]) cells.push([r, c]);
    }
  }
  return cells;
}

/**
 * 生成每格差異化人口數（即該格選舉人票數）
 * 結合 2~3 個都會高密度中心與局部隨機波動，使每格人口落在 [minPop, maxPop]，且全盤總和精確為 可用格數 * 100
 * @returns {number[]} 依 activeCells 順序排列的人口陣列
 */
export function generateCellPopulations(boardSize, rng, activeCells = null, profile = POPULATION_PROFILES.normal) {
  const active = activeCells || listActiveCells(boardSize);
  const isMasked = active.length !== boardSize * boardSize;
  const numCells = active.length;
  const totalPop = numCells * CELL_POPULATION;
  const [minPop, maxPop] = profile.range;

  // 以可用格數換算等效邊長，使都會/山區尺度與地圖大小相稱
  const effSize = isMasked ? Math.sqrt(numCells) : boardSize;
  // 自訂地圖：都會中心與山區落在地圖內的隨機棋格上，避免落入海中
  const pickCenter = (lo, span) => {
    if (!isMasked) {
      return [(lo + span * rng()) * (boardSize - 1), (lo + span * rng()) * (boardSize - 1)];
    }
    const [r, c] = active[Math.floor(rng() * numCells)];
    return [r + (rng() - 0.5) * 0.6, c + (rng() - 0.5) * 0.6];
  };

  // 產生 2~3 個高人口都會中心 (都會盆地) 與 2~3 個低人口偏遠山區，大幅拉開城鄉人口落差
  const numUrban = effSize <= 8 ? 2 : 3;
  const hubs = [];
  for (let i = 0; i < numUrban; i++) {
    const [r, c] = pickCenter(0.15, 0.70);
    hubs.push({
      r,
      c,
      amp: 2.5 + rng() * 0.8,
      sigma: effSize * (0.13 + rng() * 0.04)
    });
  }
  for (let i = 0; i < numUrban; i++) {
    const [r, c] = pickCenter(0.10, 0.80);
    hubs.push({
      r,
      c,
      amp: -(1.4 + rng() * 0.6),
      sigma: effSize * (0.20 + rng() * 0.08)
    });
  }

  const rawPops = [];
  for (const [r, c] of active) {
    {
      let density = 1.0;
      for (const h of hubs) {
        const d2 = (r - h.r) ** 2 + (c - h.c) ** 2;
        density += h.amp * Math.exp(-d2 / (2 * h.sigma * h.sigma));
      }
      density += (rng() - 0.5) * 0.12;
      rawPops.push(Math.max(0.04, density));
    }
  }

  const minRaw = Math.min(...rawPops);
  const maxRaw = Math.max(...rawPops);
  const span = Math.max(1e-6, maxRaw - minRaw);

  // 強化高低密度兩極化對比：非線性冪次曲線大幅拉開差距
  // 使都會核心能攀升至 200~285 人，偏遠山區降至 15~40 人
  const stretched = rawPops.map((v) => {
    const norm = (v - minRaw) / span; // 0 ~ 1
    const curved = Math.pow(norm, profile.curve);
    return minPop + curved * (maxPop - minPop);
  });

  const rawSum = stretched.reduce((a, b) => a + b, 0);
  const scaled = stretched.map(v => Math.max(minPop, Math.min(maxPop, (v / rawSum) * totalPop)));

  let pops = scaled.map(v => Math.round(v));
  let diff = totalPop - pops.reduce((a, b) => a + b, 0);

  // 配平總和誤差，兼顧極值保護
  const sortedIndices = Array.from({ length: numCells }, (_, i) => i)
    .sort((a, b) => pops[a] - pops[b]);

  let step = diff > 0 ? 1 : -1;
  let idx = diff > 0 ? numCells - 1 : 0;
  let guard = 0;
  while (diff !== 0 && guard++ < 3000) {
    const targetIdx = sortedIndices[idx];
    if (diff > 0 && pops[targetIdx] < maxPop) {
      pops[targetIdx]++;
      diff--;
    } else if (diff < 0 && pops[targetIdx] > minPop) {
      pops[targetIdx]--;
      diff++;
    }
    idx = (idx - step + numCells) % numCells;
  }

  return pops;
}

/**
 * 產生各政黨據點 (Strongholds)
 */
function generateStrongholds(numPlayers, boardSize, rng, activeCells = null) {
  const strongholds = [];
  const strongholdsPerParty = numPlayers === 2 ? 3 : 2;
  const isMasked = activeCells && activeCells.length !== boardSize * boardSize;
  const activeSet = isMasked ? new Set(activeCells.map(([r, c]) => `${r},${c}`)) : null;

  // 自訂地圖：以「離海岸線距離」取代「離外框距離」，避免據點貼在海邊
  const edgeDistOf = (r, c) => {
    if (!isMasked) return Math.min(r, boardSize - 1 - r, c, boardSize - 1 - c);
    const inside = (rr, cc) => activeSet.has(`${rr},${cc}`);
    return inside(r - 1, c) && inside(r + 1, c) && inside(r, c - 1) && inside(r, c + 1) ? 1 : 0;
  };
  const randomCell = () => {
    if (!isMasked) return [Math.floor(rng() * boardSize), Math.floor(rng() * boardSize)];
    return activeCells[Math.floor(rng() * activeCells.length)];
  };

  for (let p = 0; p < numPlayers; p++) {
    for (let count = 0; count < strongholdsPerParty; count++) {
      let bestPt = null;
      let maxDist = -1;

      for (let attempt = 0; attempt < 25; attempt++) {
        const [r, c] = randomCell();

        const edgeDist = edgeDistOf(r, c);
        if (edgeDist < 1 && attempt < 15) continue;

        let minDistToOthers = Infinity;
        for (const existing of strongholds) {
          const d = Math.hypot(r - existing.r, c - existing.c);
          if (d < minDistToOthers) minDistToOthers = d;
        }

        if (minDistToOthers > maxDist) {
          maxDist = minDistToOthers;
          bestPt = { r, c, partyId: p };
        }
      }

      let chosen = bestPt;
      if (!chosen) {
        const [r, c] = randomCell();
        chosen = { r, c, partyId: p };
      }
      strongholds.push(chosen);
    }
  }

  return strongholds;
}

/** 依據點平滑衰減計算每格政黨基礎偏好權重 */
function calculateRawAffinities(numPlayers, boardSize, strongholds, rng, activeCells, profile = CLUSTERING_PROFILES.normal) {
  const effSize = activeCells.length !== boardSize * boardSize ? Math.sqrt(activeCells.length) : boardSize;
  const sigma = effSize * profile.sigma;
  const affinities = [];

  for (const [r, c] of activeCells) {
    {
      const weights = Array(numPlayers).fill(0);
      for (const sh of strongholds) {
        const distSq = (r - sh.r) ** 2 + (c - sh.c) ** 2;
        weights[sh.partyId] += Math.exp(-distSq / (2 * sigma * sigma));
      }
      for (let p = 0; p < numPlayers; p++) {
        weights[p] = Math.max(0.08, weights[p] + (rng() - 0.5) * profile.noise);
      }
      affinities.push(weights);
    }
  }

  return affinities;
}

/**
 * 雙比例縮放 (Iterative Proportional Fitting) 與整數配平
 * 讓每格總和精確等於 cellPopulations[i]，且各政黨全盤總和精確符合 targetTotals[p]
 */
function fitSupportMatrix(numPlayers, affinities, cellPopulations, targetTotals) {
  const numCells = cellPopulations.length;
  const matrix = affinities.map(w => [...w]);

  // 迭代雙比例縮放
  for (let iter = 0; iter < 18; iter++) {
    // 1. 依格歸一 (每格總和 = cellPopulations[i])
    for (let i = 0; i < numCells; i++) {
      const cellPop = cellPopulations[i];
      const sum = matrix[i].reduce((a, b) => a + b, 0);
      if (sum > 0) {
        for (let p = 0; p < numPlayers; p++) {
          matrix[i][p] = (matrix[i][p] / sum) * cellPop;
        }
      }
    }

    // 2. 依黨歸一 (每黨總和 = targetTotals[p])
    for (let p = 0; p < numPlayers; p++) {
      let colSum = 0;
      for (let i = 0; i < numCells; i++) colSum += matrix[i][p];
      if (colSum > 0) {
        const factor = targetTotals[p] / colSum;
        for (let i = 0; i < numCells; i++) {
          matrix[i][p] *= factor;
        }
      }
    }
  }

  // 再做最後一次格歸一並以最大餘數法轉為整數，保證每格總和嚴格等於 cellPopulations[i]
  const intMatrix = [];
  for (let i = 0; i < numCells; i++) {
    const cellPop = cellPopulations[i];
    const rowSum = matrix[i].reduce((a, b) => a + b, 0);
    const scaledRow = matrix[i].map(v => (rowSum > 0 ? (v / rowSum) * cellPop : cellPop / numPlayers));

    const floors = scaledRow.map(v => Math.floor(v));
    const remainder = scaledRow.map((v, idx) => ({ idx, rem: v - floors[idx] }));
    remainder.sort((a, b) => b.rem - a.rem);

    let need = cellPop - floors.reduce((a, b) => a + b, 0);
    for (let k = 0; k < need; k++) {
      floors[remainder[k].idx]++;
    }
    intMatrix.push(floors);
  }

  // 零和微調：確保各黨全盤總和精確等於 targetTotals[p]，同時維持每格總人口不變
  const colSums = Array(numPlayers).fill(0);
  for (let i = 0; i < numCells; i++) {
    for (let p = 0; p < numPlayers; p++) {
      colSums[p] += intMatrix[i][p];
    }
  }

  let safety = 0;
  while (safety++ < 2000) {
    let deficitParty = -1;
    let surplusParty = -1;
    for (let p = 0; p < numPlayers; p++) {
      if (colSums[p] < targetTotals[p] && deficitParty === -1) deficitParty = p;
      if (colSums[p] > targetTotals[p] && surplusParty === -1) surplusParty = p;
    }

    if (deficitParty === -1 || surplusParty === -1) break;

    let adjusted = false;
    for (let i = 0; i < numCells; i++) {
      const minKeep = Math.max(8, Math.floor(cellPopulations[i] * 0.15));
      const maxKeep = Math.floor(cellPopulations[i] * 0.85);
      if (intMatrix[i][surplusParty] > minKeep && intMatrix[i][deficitParty] < maxKeep) {
        intMatrix[i][surplusParty]--;
        intMatrix[i][deficitParty]++;
        colSums[surplusParty]--;
        colSums[deficitParty]++;
        adjusted = true;
        break;
      }
    }

    if (!adjusted) {
      for (let i = 0; i < numCells; i++) {
        if (intMatrix[i][surplusParty] > 4) {
          intMatrix[i][surplusParty]--;
          intMatrix[i][deficitParty]++;
          colSums[surplusParty]--;
          colSums[deficitParty]++;
          break;
        }
      }
    }
  }

  return intMatrix;
}

/** 取得格子所在的象限 (0: 左上 NW, 1: 右上 NE, 2: 左下 SW, 3: 右下 SE) */
export function getQuadrant(r, c, boardSize) {
  const mid = Math.floor(boardSize / 2);
  const isSouth = r >= mid;
  const isEast = c >= mid;
  if (!isSouth && !isEast) return 0; // NW
  if (!isSouth && isEast) return 1;  // NE
  if (isSouth && !isEast) return 2;  // SW
  return 3;                          // SE
}

/**
 * 政黨支持度全程固定不變，民調完全等同真實支持度
 */
export function generatePollFromTrue(trueBoard, cellPopGrid, numPlayers, boardSize, rng) {
  const quadrantBiases = Array.from({ length: 4 }, () => Array(numPlayers).fill(0));
  const pollBoard = trueBoard.map(row => row.map(cell => [...cell]));
  return { pollBoard, quadrantBiases };
}

/** 重抽上限；用盡時退回分數最高的一張 */
const MAX_FAIRNESS_ATTEMPTS = 30;
/** 每黨各格支持率的變異係數（標準差 / 平均）下限，擋掉「每格都一樣」的地圖；用相對值才不會因黨數多而偏嚴 */
const MIN_SHARE_CV = 0.15;
/** 每黨領先格數至少要達到公平份額（格數 / 黨數）的這個比例 */
const MIN_LEAD_CELL_RATIO = 0.5;

/**
 * 檢查地圖是否讓每個政黨都有劃區操作的空間：
 * 1. 各黨支持率在空間上要有起伏（變異係數 >= MIN_SHARE_CV）
 * 2. 各黨要有足夠的領先格（>= 公平份額 * MIN_LEAD_CELL_RATIO）
 * score 取各黨兩項達成率的最小值，越大越好。
 */
export function evaluateMapFairness(numPlayers, cellPopulations, supportList) {
  const n = cellPopulations.length;
  const leadCells = Array(numPlayers).fill(0);
  const sum = Array(numPlayers).fill(0);
  const sumSq = Array(numPlayers).fill(0);
  for (let i = 0; i < n; i++) {
    const pop = cellPopulations[i];
    let top = 0;
    for (let p = 0; p < numPlayers; p++) {
      const share = supportList[i][p] / pop;
      sum[p] += share;
      sumSq[p] += share * share;
      if (supportList[i][p] > supportList[i][top]) top = p;
    }
    leadCells[top]++;
  }
  const minLead = (n / numPlayers) * MIN_LEAD_CELL_RATIO;
  let score = Infinity;
  for (let p = 0; p < numPlayers; p++) {
    const mean = sum[p] / n;
    const std = Math.sqrt(Math.max(0, sumSq[p] / n - mean * mean));
    score = Math.min(score, std / mean / MIN_SHARE_CV, leadCells[p] / minLead);
  }
  return { ok: score >= 1, score, leadCells };
}

/**
 * 完整地圖生成入口
 * @param {number} numPlayers - 政黨數 (2~6)
 * @param {number} seed
 * @param {number|null} k - 先手補償步階
 * @param {{boardSize?: number, mask?: boolean[][]|null, popContrast?: string, partyClustering?: string}} options
 *   自訂棋盤尺寸、地圖輪廓、城鄉人口差距與政黨分布
 */
export function generateMap(numPlayers, seed = 1337, k = null, options = {}) {
  const config = GAME_MODES[numPlayers];
  const boardSize = options.boardSize || (config ? config.boardSize : 10);
  const mask = options.mask || null;
  if (numPlayers < 2) throw new Error(`Unsupported player count: ${numPlayers}`);

  const rng = createPRNG(seed);
  const activeCells = listActiveCells(boardSize, mask);
  const totalPopulation = activeCells.length * CELL_POPULATION;
  const targetTotals = calculateTargetTotals(numPlayers, k, totalPopulation);
  const popProfile = POPULATION_PROFILES[options.popContrast] || POPULATION_PROFILES.normal;
  const clusterProfile = CLUSTERING_PROFILES[options.partyClustering] || CLUSTERING_PROFILES.normal;
  // 重抽直到每黨都有可操作的空間（見 evaluateMapFairness），用盡次數則取最佳的一張
  let best = null;
  for (let attempt = 0; attempt < MAX_FAIRNESS_ATTEMPTS; attempt++) {
    const cellPopulations = generateCellPopulations(boardSize, rng, activeCells, popProfile);
    const strongholds = generateStrongholds(numPlayers, boardSize, rng, activeCells);
    const affinities = calculateRawAffinities(numPlayers, boardSize, strongholds, rng, activeCells, clusterProfile);
    const supportList = fitSupportMatrix(numPlayers, affinities, cellPopulations, targetTotals);
    const fairness = evaluateMapFairness(numPlayers, cellPopulations, supportList);
    if (!best || fairness.score > best.fairness.score) {
      best = { cellPopulations, strongholds, supportList, fairness };
    }
    if (fairness.ok) break;
  }
  const { cellPopulations, strongholds, supportList } = best;

  const quadrantBiases = Array.from({ length: 4 }, () => Array(numPlayers).fill(0));

  // 先建立全空棋格（地圖外：人口 0、無支持者），再填入地圖內棋格
  const cells = [];
  for (let r = 0; r < boardSize; r++) {
    const row = [];
    for (let c = 0; c < boardSize; c++) {
      const empty = Array(numPlayers).fill(0);
      row.push({
        r,
        c,
        active: false,
        population: 0,
        electoralVotes: 0,
        quadrant: getQuadrant(r, c, boardSize),
        support: empty,
        trueSupport: empty,
        pollSupport: empty
      });
    }
    cells.push(row);
  }

  activeCells.forEach(([r, c], i) => {
    const pop = cellPopulations[i];
    const support = supportList[i];
    Object.assign(cells[r][c], {
      active: true,
      population: pop,
      electoralVotes: pop,
      support,
      trueSupport: support,
      pollSupport: support
    });
  });

  return {
    boardSize,
    mask,
    activeCellCount: activeCells.length,
    numPlayers,
    seed,
    totalElectoralVotes: totalPopulation,
    targetTotals,
    strongholds,
    quadrantBiases,
    cells
  };
}
