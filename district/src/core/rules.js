/**
 * 劃區爭霸 (District) - 規則、幾何判定與選區開票統計引擎
 */

import { WALL_SHAPES, getPlacedGeometry } from "./shapes.js";

/**
 * 建立初始棋盤狀態
 * @param {number} boardSize - 棋盤外接正方形邊長 N
 * @param {boolean[][]|null} mask - N x N 可用棋格遮罩（自訂地圖輪廓）；null 代表完整正方形
 */
export function createBoardState(boardSize, mask = null) {
  return {
    boardSize,
    mask,
    // (N-1) x N 陣列：upDown[r][c] 代表 (r, c) 與 (r+1, c) 間的內部水平邊（佔用牆塊 ID 或 null）
    upDown: Array.from({ length: boardSize - 1 }, () => Array(boardSize).fill(null)),
    // N x (N-1) 陣列：leftRight[r][c] 代表 (r, c) 與 (r, c+1) 間的內部垂直邊（佔用牆塊 ID 或 null）
    leftRight: Array.from({ length: boardSize }, () => Array(boardSize - 1).fill(null)),
    // (N-1) x (N-1) 陣列：內部頂點 (vr, vc)（vr=1..N-1, vc=1..N-1）是否為某道牆的中段頂點
    midpoints: Array.from({ length: boardSize - 1 }, () => Array(boardSize - 1).fill(null)),
    // 外框頂點中段佔用 (N+1) x (N+1)
    borderMidpoints: Array.from({ length: boardSize + 1 }, () => Array(boardSize + 1).fill(null)),
    // 已放置的牆塊清單
    placedWalls: []
  };
}

/** 深度複製棋盤狀態 */
export function cloneBoardState(state) {
  return {
    boardSize: state.boardSize,
    mask: state.mask || null,
    upDown: state.upDown.map(row => [...row]),
    leftRight: state.leftRight.map(row => [...row]),
    midpoints: state.midpoints.map(row => [...row]),
    borderMidpoints: state.borderMidpoints
      ? state.borderMidpoints.map(row => [...row])
      : Array.from({ length: state.boardSize + 1 }, () => Array(state.boardSize + 1).fill(null)),
    placedWalls: state.placedWalls.map(w => ({ ...w }))
  };
}

/** 棋格是否位於棋盤（地圖輪廓）內 */
export function isCellActive(state, r, c) {
  const N = state.boardSize;
  if (r < 0 || r >= N || c < 0 || c >= N) return false;
  return !state.mask || state.mask[r][c] === true;
}

/** 頂點是否位於地圖海岸線或外框上（四周至少一格不在棋盤內） */
export function isBoundaryVertex(state, vr, vc) {
  return !isCellActive(state, vr - 1, vc - 1) || !isCellActive(state, vr - 1, vc) ||
    !isCellActive(state, vr, vc - 1) || !isCellActive(state, vr, vc);
}

/** 頂點是否已接上外框、海岸線或既有牆壁 */
export function isVertexAnchored(state, vr, vc) {
  if (isBoundaryVertex(state, vr, vc)) return true;
  return state.upDown[vr - 1][vc - 1] !== null || state.upDown[vr - 1][vc] !== null ||
    state.leftRight[vr - 1][vc - 1] !== null || state.leftRight[vr][vc - 1] !== null;
}

/** 查詢特定格線邊是否已被佔用，或超出邊界 */
export function getEdgeOccupant(state, edge) {
  const { boardSize, upDown, leftRight } = state;
  if (edge.type === "H") {
    if (edge.r < 0 || edge.r > boardSize || edge.c < 0 || edge.c > boardSize - 1) {
      return "OUT_OF_BOUNDS";
    }
    const a = isCellActive(state, edge.r - 1, edge.c);
    const b = isCellActive(state, edge.r, edge.c);
    if (!a && !b) return "OUT_OF_BOUNDS";
    // 外框與海岸線本身就是牆
    if (!a || !b) return "BORDER";
    return upDown[edge.r - 1][edge.c];
  } else if (edge.type === "V") {
    if (edge.r < 0 || edge.r > boardSize - 1 || edge.c < 0 || edge.c > boardSize) {
      return "OUT_OF_BOUNDS";
    }
    const a = isCellActive(state, edge.r, edge.c - 1);
    const b = isCellActive(state, edge.r, edge.c);
    if (!a && !b) return "OUT_OF_BOUNDS";
    if (!a || !b) return "BORDER";
    return leftRight[edge.r][edge.c - 1];
  }
  return "OUT_OF_BOUNDS";
}

/** 設定格線邊之佔用牆塊 ID（只會是兩側皆為陸地的內部邊） */
export function setEdgeOccupant(state, edge, id) {
  if (edge.type === "H") {
    state.upDown[edge.r - 1][edge.c] = id;
  } else if (edge.type === "V") {
    state.leftRight[edge.r][edge.c - 1] = id;
  }
}

/** 查詢頂點是否為某道牆的中段頂點 */
export function getMidpointOccupant(state, mr, mc) {
  const N = state.boardSize;
  if (mr < 0 || mr > N || mc < 0 || mc > N) return "OUT_OF_BOUNDS";
  if (mr >= 1 && mr <= N - 1 && mc >= 1 && mc <= N - 1) {
    return state.midpoints[mr - 1][mc - 1];
  }
  return state.borderMidpoints ? state.borderMidpoints[mr][mc] : null;
}

/** 設定頂點為某道牆之中段頂點 */
export function setMidpointOccupant(state, mr, mc, id) {
  const N = state.boardSize;
  if (mr >= 1 && mr <= N - 1 && mc >= 1 && mc <= N - 1) {
    state.midpoints[mr - 1][mc - 1] = id;
  } else if (mr >= 0 && mr <= N && mc >= 0 && mc <= N) {
    if (!state.borderMidpoints) {
      state.borderMidpoints = Array.from({ length: N + 1 }, () => Array(N + 1).fill(null));
    }
    state.borderMidpoints[mr][mc] = id;
  }
}

/**
 * 檢查新牆塊放置是否合法 (Rule 6.1)
 * 1. 邊不可超出棋盤外框（邊界本身未預先放牆，因此牆塊邊線段可與邊界重複）
 * 2. 邊不可與已有牆壁重疊；外框與海岸線本身視為牆，也不可共用線段
 * 3. 中段頂點不可共用（不能已有牆佔用其為中段），也不可落在外框或海岸線上
 * 4. 端點可接觸端點、中段、外框或海岸線
 */
export function canPlaceWall(state, shape, vr, vc) {
  const geometry = getPlacedGeometry(shape, vr, vc);

  // 1. 邊界與重疊檢查
  for (const edge of geometry.edges) {
    const occupant = getEdgeOccupant(state, edge);
    if (occupant === "OUT_OF_BOUNDS") {
      return { valid: false, reason: "OUT_OF_BOUNDS", detail: "邊超出棋盤範圍" };
    }
    if (occupant === "BORDER") {
      return { valid: false, reason: "ON_BORDER", detail: "外框與海岸線本身就是牆，不能與它共用線段" };
    }
    if (occupant !== null) {
      return { valid: false, reason: "EDGE_OVERLAP", detail: "邊不可與已有牆壁重疊" };
    }
  }

  // 2. 中段頂點不可共用檢查
  for (const [mr, mc] of geometry.midpoints) {
    const occupant = getMidpointOccupant(state, mr, mc);
    if (occupant === "OUT_OF_BOUNDS") {
      return { valid: false, reason: "MIDPOINT_OUT_OF_BOUNDS", detail: "中段頂點超出棋盤範圍" };
    }
    if (isBoundaryVertex(state, mr, mc)) {
      return { valid: false, reason: "MIDPOINT_ON_BORDER", detail: "牆的轉角或中段不能貼在外框或海岸線上" };
    }
    if (occupant !== null) {
      return { valid: false, reason: "MIDPOINT_SHARED", detail: "兩道牆不能共用中段頂點（含十字中段交叉與轉角相貼）" };
    }
  }

  return { valid: true };
}

/** 在棋盤上放置牆塊 */
export function applyPlaceWall(state, shape, vr, vc, playerId, wallId = null) {
  const check = canPlaceWall(state, shape, vr, vc);
  if (!check.valid) {
    throw new Error(`Invalid wall placement: ${check.reason} (${check.detail})`);
  }

  const id = wallId !== null ? wallId : state.placedWalls.length + 1;
  const geometry = getPlacedGeometry(shape, vr, vc);

  for (const edge of geometry.edges) {
    setEdgeOccupant(state, edge, id);
  }

  for (const [mr, mc] of geometry.midpoints) {
    setMidpointOccupant(state, mr, mc, id);
  }

  state.placedWalls.push({
    id,
    playerId,
    shapeId: shape.id,
    shapeType: shape.type,
    vr,
    vc,
    geometry
  });

  return id;
}

/** 搜尋某牆塊在棋盤上的所有合法放置位置 */
export function getLegalPlacements(state, shape) {
  const placements = [];
  const N = state.boardSize;
  for (let vr = -2; vr <= N; vr++) {
    for (let vc = -2; vc <= N; vc++) {
      if (canPlaceWall(state, shape, vr, vc).valid) {
        placements.push({ vr, vc });
      }
    }
  }
  return placements;
}

/**
 * 以 BFS 計算棋盤的所有連通區域（連通分量）
 */
export function calculateRegions(state) {
  const N = state.boardSize;
  const mask = state.mask;
  // 地圖外的棋格預先標記為已拜訪，不屬於任何選區
  const visited = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => (mask ? !mask[r][c] : false))
  );
  const regions = [];

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (visited[r][c]) continue;

      const cells = [];
      let head = 0;
      const queue = [[r, c]];
      visited[r][c] = true;

      while (head < queue.length) {
        const [cr, cc] = queue[head++];
        cells.push([cr, cc]);

        if (cr > 0 && !visited[cr - 1][cc] && state.upDown[cr - 1][cc] === null) {
          visited[cr - 1][cc] = true;
          queue.push([cr - 1, cc]);
        }
        if (cr < N - 1 && !visited[cr + 1][cc] && state.upDown[cr][cc] === null) {
          visited[cr + 1][cc] = true;
          queue.push([cr + 1, cc]);
        }
        if (cc > 0 && !visited[cr][cc - 1] && state.leftRight[cr][cc - 1] === null) {
          visited[cr][cc - 1] = true;
          queue.push([cr, cc - 1]);
        }
        if (cc < N - 1 && !visited[cr][cc + 1] && state.leftRight[cr][cc] === null) {
          visited[cr][cc + 1] = true;
          queue.push([cr, cc + 1]);
        }
      }

      regions.push({
        id: regions.length,
        size: cells.length,
        cells
      });
    }
  }

  return regions;
}

/**
 * 檢查某選區在當前棋盤狀態下，是否可能被合法的 I4, S4, T4 牆塊再分割
 * @param {Object} state - 棋盤狀態 (boardSize, upDown, leftRight, midpoints)
 * @param {Object} dist - 選區物件 (cells: [[r, c], ...], size: number)
 * @returns {boolean} true 表示存在至少一種合法放牆方式能將此區再分割成 >= 2 個連通區塊
 */
export function canDistrictBeDivided(state, dist, shapes = WALL_SHAPES) {
  if (!dist || !dist.cells || dist.cells.length <= 1) return false;
  const N = state.boardSize;

  const inDist = Array.from({ length: N }, () => Array(N).fill(false));
  for (const [r, c] of dist.cells) {
    inDist[r][c] = true;
  }

  // 快速剪枝：若該區內部相鄰格子間已無任何未築邊，絕無可能再被切開
  let hasEmptyInternalEdge = false;
  for (const [r, c] of dist.cells) {
    if (r < N - 1 && inDist[r + 1][c] && state.upDown[r][c] === null) {
      hasEmptyInternalEdge = true;
      break;
    }
    if (c < N - 1 && inDist[r][c + 1] && state.leftRight[r][c] === null) {
      hasEmptyInternalEdge = true;
      break;
    }
  }
  if (!hasEmptyInternalEdge) return false;

  // 只檢驗錨點落在選區外接框附近的放置（牆塊外接框最大 3 格，邊必須落在選區內部）
  let minR = N, maxR = 0, minC = N, maxC = 0;
  for (const [r, c] of dist.cells) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }

  const visited = new Uint8Array(N * N);

  // 檢驗牌袋中所有牆塊形狀的所有可能放置
  for (const shape of shapes) {
    for (let vr = minR - 3; vr <= maxR + 1; vr++) {
      for (let vc = minC - 3; vc <= maxC + 1; vc++) {
        const check = canPlaceWall(state, shape, vr, vc);
        if (!check.valid) continue;

        const geom = getPlacedGeometry(shape, vr, vc);
        let touchesInternal = false;
        for (const e of geom.edges) {
          if (e.type === "H" ? (inDist[e.r - 1]?.[e.c] && inDist[e.r]?.[e.c]) : (inDist[e.r]?.[e.c - 1] && inDist[e.r]?.[e.c])) {
            touchesInternal = true;
            break;
          }
        }
        if (!touchesInternal) continue;

        // 單一牆塊是一棵樹，至少要有兩個頂點接上既有的牆或邊界，才可能圍出封閉切線
        let anchors = 0;
        for (const [ar, ac] of geom.endpoints) if (isVertexAnchored(state, ar, ac)) anchors++;
        for (const [ar, ac] of geom.midpoints) if (isVertexAnchored(state, ar, ac)) anchors++;
        if (anchors < 2) continue;

        // 該放置有邊落在此區內部，檢驗是否將 dist 分割為 >= 2 個連通子塊
        const blocked = new Set();
        for (const e of geom.edges) blocked.add(`${e.type}${e.r},${e.c}`);
        const open = (type, r, c, stored) => stored === null && !blocked.has(`${type}${r},${c}`);

        visited.fill(0);
        const [startR, startC] = dist.cells[0];
        visited[startR * N + startC] = 1;
        let count = 1;
        const q = [startR * N + startC];
        for (let h = 0; h < q.length; h++) {
          const r = Math.floor(q[h] / N);
          const c = q[h] % N;
          const tryVisit = (nr, nc, isOpen) => {
            const k = nr * N + nc;
            if (isOpen && inDist[nr][nc] && !visited[k]) {
              visited[k] = 1;
              count++;
              q.push(k);
            }
          };
          if (r > 0) tryVisit(r - 1, c, open("H", r, c, state.upDown[r - 1][c]));
          if (r < N - 1) tryVisit(r + 1, c, open("H", r + 1, c, state.upDown[r][c]));
          if (c > 0) tryVisit(r, c - 1, open("V", r, c, state.leftRight[r][c - 1]));
          if (c < N - 1) tryVisit(r, c + 1, open("V", r, c + 1, state.leftRight[r][c]));
        }

        if (count < dist.cells.length) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * 判定選區是否「確定當選 (Secured / Confirmed Won)」或「確定平手 (Secured Tie)」：
 * 滿足以下條件之一：
 * 1. 遊戲終局：對局結束後不可再放任何牆塊，所有已劃分選區（包含勝選與平手均分選區）即刻定案當選。
 * 2. 單一棋格：若只有 1 格，幾何上無內部邊，不可能再分割。
 * 3. 均質堡壘：區域內每個棋格皆由同一政黨領先，任何切法都不會改變勝選者（僅在最小選區為 1 格時適用）。
 * 4. 不可再分割：在當前棋盤狀態下，場上所有合法 I4, S4, T4 牆塊，幾何上無法再將該區分割成 2 個以上連通子區域。
 */
export function isDistrictSecured(state, dist, cellData, winnerParty = null, isGameOver = false, shapes = WALL_SHAPES, minSize = 1) {
  // 條件 1：終局已定案
  if (isGameOver) {
    return true;
  }

  // 條件 2：若只有 1 格，幾何上無內部邊，不可能再分割
  if (dist.cells.length <= 1) {
    return true;
  }

  // 條件 3：均質堡壘 (Homogeneous / Unassailable)
  // 最小選區大於 1 格時不適用：只要還能再切，就可能切出小於最小選區、選票均分的小區塊，勝負不再確定
  if (minSize <= 1 && winnerParty !== null && winnerParty !== undefined && winnerParty >= 0) {
    let allCellsWon = true;
    for (const [r, c] of dist.cells) {
      const s = cellData[r][c].support;
      const winSupport = s[winnerParty];
      for (let p = 0; p < s.length; p++) {
        if (p !== winnerParty && s[p] >= winSupport) {
          allCellsWon = false;
          break;
        }
      }
      if (!allCellsWon) break;
    }
    if (allCellsWon) {
      return true;
    }
  }

  // 條件 4：不可再分割 (Indivisible by I4, S4, T4)
  if (!state) return false;
  return !canDistrictBeDivided(state, dist, shapes);
}

/**
 * 計算各區域開票結果、選舉人票與深度劃區統計指標
 * - 只有確定當選的選區，選舉人票才會計入該政黨的已獲得票數中
 * - 爭奪中 / 未確定的選區票數計為 unsecuredElectoralVotes
 * - options.minDistrictSize：小於此格數的選區是「均分選區」，選舉人票平分給所有政黨（選區只會越切越小，因此均分即定案）
 * - options.shapes：判定「不可再分割」時考慮的牆塊形狀（牌袋中有的形狀）
 */
export function tallyElectoralVotes(regions, cellData, numPlayers, state = null, isGameOver = false, options = {}) {
  const minSize = options.minDistrictSize || 1;
  const shapes = options.shapes || WALL_SHAPES;
  let totalVoidVotes = 0;
  const electoralVotes = Array(numPlayers).fill(0);
  const provisionalElectoralVotes = Array(numPlayers).fill(0);
  const popularVotes = Array(numPlayers).fill(0);
  const regionsWon = Array(numPlayers).fill(0);
  const provisionalRegionsWon = Array(numPlayers).fill(0);
  const surplusWastedVotes = Array(numPlayers).fill(0);
  const lostWastedVotes = Array(numPlayers).fill(0);
  const regionResults = [];

  let totalElectoralVotes = 0;
  let totalConfirmedVotes = 0;
  let totalUnsecuredVotes = 0;

  for (const region of regions) {
    let regionVotes = 0;
    const support = Array(numPlayers).fill(0);

    for (const [r, c] of region.cells) {
      const cell = cellData[r][c];
      let cellSum = 0;
      for (let p = 0; p < numPlayers; p++) {
        const s = cell.support[p];
        support[p] += s;
        popularVotes[p] += s;
        cellSum += s;
      }
      regionVotes += cell.votes !== undefined ? cell.votes : cellSum;
    }

    totalElectoralVotes += regionVotes;

    if (region.cells.length < minSize) {
      // 均分選區：不計勝負，選舉人票平分給所有政黨，且立即定案
      const share = regionVotes / numPlayers;
      totalVoidVotes += regionVotes;
      totalConfirmedVotes += regionVotes;
      for (let p = 0; p < numPlayers; p++) {
        electoralVotes[p] += share;
        provisionalElectoralVotes[p] += share;
        regionsWon[p] += 1 / numPlayers;
        provisionalRegionsWon[p] += 1 / numPlayers;
      }
      regionResults.push({
        id: region.id,
        size: region.size,
        cells: region.cells,
        support,
        maxSupport: Math.max(...support),
        runnerUpSupport: 0,
        winners: [],
        isTie: false,
        isVoid: true,
        votes: regionVotes,
        margin: 0,
        marginPct: 0,
        isSecured: true,
        securedWinner: null,
        wastedByParty: Array(numPlayers).fill(0)
      });
      continue;
    }

    let maxSupport = -1;
    let winners = [];
    for (let p = 0; p < numPlayers; p++) {
      if (support[p] > maxSupport) {
        maxSupport = support[p];
        winners = [p];
      } else if (support[p] === maxSupport) {
        winners.push(p);
      }
    }

    const sorted = [...support].sort((a, b) => b - a);
    const runnerUpSupport = sorted.length > 1 ? sorted[1] : 0;
    const margin = maxSupport - runnerUpSupport;
    const marginPct = regionVotes > 0 ? (margin / regionVotes) * 100 : 0;

    // 暫定分配（全區勝者全拿或平分）
    if (winners.length === 1) {
      const w = winners[0];
      provisionalElectoralVotes[w] += regionVotes;
      provisionalRegionsWon[w] += 1;
    } else {
      const split = regionVotes / winners.length;
      for (const w of winners) {
        provisionalElectoralVotes[w] += split;
        provisionalRegionsWon[w] += 1 / winners.length;
      }
    }

    // 確定當選 / 平手均分定案判定
    const winnerParty = winners.length === 1 ? winners[0] : null;
    let isSecured = false;
    let securedWinner = null;

    if (winnerParty !== null) {
      if (isDistrictSecured(state, region, cellData, winnerParty, isGameOver, shapes, minSize)) {
        isSecured = true;
        securedWinner = winnerParty;
        electoralVotes[winnerParty] += regionVotes;
        regionsWon[winnerParty] += 1;
        totalConfirmedVotes += regionVotes;
      } else if (state === null) {
        // 未提供 state 時退回暫定全拿（供純單元測試使用）
        electoralVotes[winnerParty] += regionVotes;
        regionsWon[winnerParty] += 1;
        totalConfirmedVotes += regionVotes;
      } else {
        totalUnsecuredVotes += regionVotes;
      }
    } else {
      // 區內平手平分：若選區已不可再分割或遊戲已終局，票數平分並確定入帳
      const isTieSecured = isDistrictSecured(state, region, cellData, null, isGameOver, shapes, minSize) || (state === null);
      if (isTieSecured) {
        isSecured = true;
        securedWinner = null;
        const split = regionVotes / winners.length;
        for (const w of winners) {
          electoralVotes[w] += split;
          regionsWon[w] += 1 / winners.length;
        }
        totalConfirmedVotes += regionVotes;
      } else {
        totalUnsecuredVotes += regionVotes;
      }
    }

    // 計算廢票 (Wasted Votes)
    const wastedByParty = Array(numPlayers).fill(0);
    if (winners.length === 1) {
      const w = winners[0];
      const winThreshold = Math.floor((maxSupport + runnerUpSupport) / 2) + 1;
      const surplus = Math.max(0, maxSupport - winThreshold);
      surplusWastedVotes[w] += surplus;
      wastedByParty[w] = surplus;

      for (let p = 0; p < numPlayers; p++) {
        if (p !== w) {
          lostWastedVotes[p] += support[p];
          wastedByParty[p] = support[p];
        }
      }
    }

    regionResults.push({
      id: region.id,
      size: region.size,
      cells: region.cells,
      support,
      maxSupport,
      runnerUpSupport,
      winners,
      isTie: winners.length > 1,
      isVoid: false,
      votes: regionVotes,
      margin,
      marginPct,
      isSecured,
      securedWinner,
      wastedByParty
    });
  }

  const totalPopularVotes = popularVotes.reduce((a, b) => a + b, 0);
  const totalWastedVotes = Array.from({ length: numPlayers }, (_, p) => surplusWastedVotes[p] + lostWastedVotes[p]);

  const gerrymanderAdvantage = Array.from({ length: numPlayers }, (_, p) => electoralVotes[p] - popularVotes[p]);
  const seatShares = Array.from({ length: numPlayers }, (_, p) =>
    totalElectoralVotes > 0 ? (electoralVotes[p] / totalElectoralVotes) * 100 : 0
  );
  const voteShares = Array.from({ length: numPlayers }, (_, p) =>
    totalPopularVotes > 0 ? (popularVotes[p] / totalPopularVotes) * 100 : 0
  );

  // 決定勝負名次 (7.5: 選舉人票多者獲勝；同票比區域數；再同平手)
  const ranking = Array.from({ length: numPlayers }, (_, i) => ({
    playerId: i,
    electoralVotes: electoralVotes[i],
    provisionalElectoralVotes: provisionalElectoralVotes[i],
    regionsWon: regionsWon[i],
    districtsWon: regionsWon[i],
    popularVotes: popularVotes[i],
    seatShare: seatShares[i],
    voteShare: voteShares[i],
    gerrymanderAdvantage: gerrymanderAdvantage[i],
    wastedVotes: totalWastedVotes[i]
  })).sort((a, b) => {
    if (b.electoralVotes !== a.electoralVotes) return b.electoralVotes - a.electoralVotes;
    return b.regionsWon - a.regionsWon;
  });

  const isGameTie = ranking.length > 1 &&
    ranking[0].electoralVotes === ranking[1].electoralVotes &&
    ranking[0].regionsWon === ranking[1].regionsWon;

  const provisionalSeatShares = Array.from({ length: numPlayers }, (_, p) =>
    totalElectoralVotes > 0 ? (provisionalElectoralVotes[p] / totalElectoralVotes) * 100 : 0
  );

  return {
    regionResults,
    electoralVotes,
    confirmedElectoralVotes: electoralVotes,
    unsecuredElectoralVotes: totalUnsecuredVotes,
    provisionalElectoralVotes,
    provisionalSeatShares,
    popularVotes,
    totalElectoralVotes,
    totalConfirmedElectoralVotes: totalConfirmedVotes,
    totalConfirmedVotes: totalConfirmedVotes,
    totalUnsecuredElectoralVotes: totalUnsecuredVotes,
    totalUnsecuredVotes: totalUnsecuredVotes,
    totalVoidVotes,
    totalPopularVotes,
    seatShares,
    voteShares,
    gerrymanderAdvantage,
    surplusWastedVotes,
    lostWastedVotes,
    totalWastedVotes,
    regionsWon,
    districtsWon: regionsWon,
    provisionalRegionsWon,
    provisionalDistrictsWon: provisionalRegionsWon,
    winner: isGameTie ? null : ranking[0].playerId,
    isGameTie,
    ranking
  };
}
