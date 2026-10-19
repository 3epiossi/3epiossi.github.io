import test from "node:test";
import assert from "node:assert/strict";
import { WALL_SHAPES, SHAPE_MAP } from "../src/core/shapes.js";
import {
  createBoardState,
  canPlaceWall,
  applyPlaceWall,
  calculateRegions,
  tallyElectoralVotes,
  isDistrictSecured,
  canDistrictBeDivided
} from "../src/core/rules.js";
import { generateMap, calculateTargetTotals } from "../src/core/map-generator.js";

test("牆塊定義檢驗：共 10 種固定方向形狀 (I4, S4, T4)，長度與幾何拓撲均嚴格自洽", () => {
  assert.equal(WALL_SHAPES.length, 10, "必須精確有 10 種形狀");

  const typeCounts = { I4: 0, S4: 0, T4: 0 };
  for (const s of WALL_SHAPES) {
    typeCounts[s.type]++;
    assert.equal(s.edges.length, s.length, `${s.id} 邊數應等於長度`);
    if (s.type === "T4") {
      assert.equal(s.midpoints.length, 2, `${s.id} T4 中段頂點數應為 2`);
      assert.equal(s.endpoints.length, 3, `${s.id} T4 端點數必為 3`);
    } else {
      assert.equal(s.midpoints.length, s.length - 1, `${s.id} 中段頂點數應為長度-1`);
      assert.equal(s.endpoints.length, 2, `${s.id} 端點數必為 2`);
    }

    for (const e of s.edges) {
      assert.ok(e.r >= 0 && e.c >= 0);
      assert.ok(e.type === "H" || e.type === "V");
    }
  }

  assert.equal(typeCounts.I4, 2, "I4 應有 2 種 (橫、直)");
  assert.equal(typeCounts.S4, 4, "S4 應有 4 種");
  assert.equal(typeCounts.T4, 4, "T4 應有 4 種 (下、上、右、左)");
});

test("放置規則：外框視為牆，不可共用線段，端點可接觸", () => {
  const state = createBoardState(8);
  const i4H = SHAPE_MAP.get("I4_H");
  const s3 = SHAPE_MAP.get("S4_V_R");

  // 1. 放在 vr=0：水平邊落在頂部外框上 -> 外框本身是牆，禁止
  const borderCheck = canPlaceWall(state, i4H, 0, 1);
  assert.equal(borderCheck.valid, false, "牆塊線段不可與外框重疊");
  assert.equal(borderCheck.reason, "ON_BORDER");

  // 2. 放在 vr=-1：超出棋盤外框 -> 禁止
  const oobCheck = canPlaceWall(state, i4H, -1, 1);
  assert.equal(oobCheck.valid, false);
  assert.equal(oobCheck.reason, "OUT_OF_BOUNDS");

  // 3. 放在 vr=1, vc=0：內部水平邊，端點 (1,0) 接觸左側外框 -> 允許
  assert.equal(canPlaceWall(state, i4H, 1, 0).valid, true, "內部邊之端點接觸外框應被允許");

  // 4. S4 轉角落在外框頂點 (0,1)：中段不可貼外框
  const midCheck = canPlaceWall(state, s3, 0, 0);
  assert.equal(midCheck.valid, false);
});

test("放置規則：不可共用佔用的空間（邊重疊禁止）", () => {
  const state = createBoardState(8);
  const i4H = SHAPE_MAP.get("I4_H");

  applyPlaceWall(state, i4H, 2, 2, 0);

  const overlapCheck1 = canPlaceWall(state, i4H, 2, 2);
  assert.equal(overlapCheck1.valid, false);
  assert.equal(overlapCheck1.reason, "EDGE_OVERLAP");

  const overlapCheck2 = canPlaceWall(state, i4H, 2, 1);
  assert.equal(overlapCheck2.valid, false);
  assert.equal(overlapCheck2.reason, "EDGE_OVERLAP");
});

test("放置規則：兩道直牆在中段十字交叉禁止", () => {
  const state = createBoardState(8);
  const i4H = SHAPE_MAP.get("I4_H");
  const i3V = SHAPE_MAP.get("I4_V");

  applyPlaceWall(state, i4H, 3, 2, 0);

  const crossCheck = canPlaceWall(state, i3V, 2, 3);
  assert.equal(crossCheck.valid, false, "兩道直牆在中段十字交叉必須禁止");
  assert.equal(crossCheck.reason, "MIDPOINT_SHARED");
});

test("放置規則：兩個形狀共用中段頂點禁止 (MIDPOINT_SHARED)", () => {
  const state = createBoardState(8);
  const i4H = SHAPE_MAP.get("I4_H");
  const t4U = SHAPE_MAP.get("T4_U");

  applyPlaceWall(state, i4H, 3, 1, 0);

  const sharedMidpointCheck = canPlaceWall(state, t4U, 2, 2);
  assert.equal(sharedMidpointCheck.valid, false, "兩個形狀共用中段頂點必須禁止");
  assert.equal(sharedMidpointCheck.reason, "MIDPOINT_SHARED");
});

test("放置規則：端點接觸全部允許（端點接端點成十字+、端點接直線中段T字、端點接轉角）", () => {
  const state = createBoardState(8);
  const i4H = SHAPE_MAP.get("I4_H");
  const i4V = SHAPE_MAP.get("I4_V");

  applyPlaceWall(state, i4H, 3, 2, 0);

  const tJunctionCheck = canPlaceWall(state, i4V, 3, 3);
  assert.equal(tJunctionCheck.valid, true, "端點接到直線中段 (T 字) 應被允許");
  applyPlaceWall(state, i4V, 3, 3, 1);

  const state2 = createBoardState(8);
  const s4VR = SHAPE_MAP.get("S4_V_R");
  applyPlaceWall(state2, s4VR, 2, 2, 0);

  const cornerEndpointCheck = canPlaceWall(state2, i4H, 2, 3);
  assert.equal(cornerEndpointCheck.valid, true, "端點接到轉角應被允許");

  const state3 = createBoardState(8);
  assert.equal(canPlaceWall(state3, i4V, 0, 4).valid, true);
  applyPlaceWall(state3, i4V, 0, 4, 0);

  assert.equal(canPlaceWall(state3, i4V, 4, 4).valid, true);
  applyPlaceWall(state3, i4V, 4, 4, 1);

  assert.equal(canPlaceWall(state3, i4H, 4, 0).valid, true);
  applyPlaceWall(state3, i4H, 4, 0, 0);

  assert.equal(canPlaceWall(state3, i4H, 4, 4).valid, true, "四個端點湊成十字 + 必須被允許");
});

test("放置規則：T4 牆塊放置、端點碰外框與中段標記檢驗", () => {
  const state = createBoardState(8);
  const t4D = SHAPE_MAP.get("T4_D");
  const t4U = SHAPE_MAP.get("T4_U");
  const t4R = SHAPE_MAP.get("T4_R");
  const t4L = SHAPE_MAP.get("T4_L");

  assert.ok(t4D && t4U && t4R && t4L, "四種 T4 方向均應存在");

  const borderTouchCheck = canPlaceWall(state, t4D, 1, 0);
  assert.equal(borderTouchCheck.valid, true, "T4 端點接觸外框必須被允許");
  applyPlaceWall(state, t4D, 1, 0, 0);

  assert.equal(state.midpoints[0][0], 1);
  assert.equal(state.midpoints[1][0], 1);
});

test("放置規則：懸空牆不切出多餘區域", () => {
  const state = createBoardState(8);
  const initRegions = calculateRegions(state);
  assert.equal(initRegions.length, 1);
  assert.equal(initRegions[0].size, 64);

  const i4H = SHAPE_MAP.get("I4_H");
  applyPlaceWall(state, i4H, 4, 2, 0);

  const regionsAfter = calculateRegions(state);
  assert.equal(regionsAfter.length, 1, "懸空牆不應切出區域");
  assert.equal(regionsAfter[0].size, 64);
});

test("區域開票：依各格選舉人票權重加總，區內平手時平分選舉人票", () => {
  const dummyRegions = [
    { id: 0, size: 6, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]] }
  ];
  // 2 人局，每格 100 票（兩黨各 50 人平手），6 格共 600 張選舉人票
  const cellData = Array.from({ length: 8 }, () => {
    return Array.from({ length: 8 }, () => ({ support: [50, 50], votes: 100 }));
  });

  const tally = tallyElectoralVotes(dummyRegions, cellData, 2);
  assert.equal(tally.regionResults[0].isTie, true);
  assert.equal(tally.electoralVotes[0], 300, "平手應各拿一半 (600 / 2 = 300)");
  assert.equal(tally.electoralVotes[1], 300, "平手應各拿一半 (600 / 2 = 300)");
  assert.equal(tally.isGameTie, true);
});

test("地圖生成：各格人口與選舉人票不同 (15~285)，且全圖總和嚴格符合先手補償", () => {
  const map2p = generateMap(2, 42, 42);
  assert.equal(map2p.boardSize, 8);
  const targets2p = calculateTargetTotals(2, 42);
  assert.equal(targets2p[0], 3200 - 42, "先手 = 3200 - 42");
  assert.equal(targets2p[1], 3200 + 42, "後手 = 3200 + 42");

  const trueSums2p = [0, 0];
  let totalPop2p = 0;
  const distinctPops = new Set();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = map2p.cells[r][c];
      assert.ok(cell.population >= 15 && cell.population <= 285, `單格人口應介於 15~285: ${cell.population}`);
      assert.equal(cell.electoralVotes, cell.population, "單格選舉人票應等於該格總人口");
      assert.equal(
        cell.trueSupport[0] + cell.trueSupport[1],
        cell.population,
        "每格真實支持總和必等於該格人口"
      );
      assert.equal(
        cell.pollSupport[0] + cell.pollSupport[1],
        cell.population,
        "每格民調支持總和必等於該格人口"
      );

      distinctPops.add(cell.population);
      totalPop2p += cell.population;
      trueSums2p[0] += cell.trueSupport[0];
      trueSums2p[1] += cell.trueSupport[1];
    }
  }

  assert.ok(distinctPops.size >= 10, "棋盤各格人口應呈現多樣化差異");
  assert.equal(totalPop2p, 6400, "8x8 棋盤總人口與總選舉人票必為 6400");
  assert.equal(trueSums2p[0], targets2p[0], "真實總和必須精確符合先手補償");
  assert.equal(trueSums2p[1], targets2p[1], "真實總和必須精確符合先手補償");

  // 3 人局檢驗
  const map3p = generateMap(3, 101, 45);
  const targets3p = calculateTargetTotals(3, 45);
  assert.equal(targets3p.reduce((a, b) => a + b, 0), 8100);

  const trueSums3p = [0, 0, 0];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = map3p.cells[r][c];
      assert.equal(cell.trueSupport.reduce((a, b) => a + b, 0), cell.population);
      for (let p = 0; p < 3; p++) trueSums3p[p] += cell.trueSupport[p];
    }
  }
  assert.deepEqual(trueSums3p, targets3p, "3人局各黨真實總和精確一致");
});

test("確定當選判定：均質堡壘與不可再分割選區方可計入得票，未確定選區不計入", () => {
  const state = createBoardState(8);
  const cellData = Array.from({ length: 8 }, () => {
    return Array.from({ length: 8 }, () => ({ support: [60, 40], votes: 100 }));
  });

  // 1. 均質堡壘測試：全區每格皆由紅黨領先 (60 > 40)，即使包含 10 格且可被分割，依然確定當選
  const homogeneousDist = {
    id: 0,
    size: 10,
    cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 0]]
  };
  assert.equal(isDistrictSecured(state, homogeneousDist, cellData, 0), true, "均質堡壘應確定當選");

  // 最小選區 2 格時，仍可再分割的均質區可能被切出會均分的小區塊，不算確定當選
  assert.equal(
    isDistrictSecured(state, homogeneousDist, cellData, 0, false, undefined, 2),
    false,
    "最小選區大於 1 時，可再分割的均質堡壘不算確定當選"
  );

  // 2. 混合格測試：包含對手領先格，且尺寸大可被分割 -> 未確定當選
  cellData[0][0].support = [20, 80]; // 藍黨在 (0,0) 領先
  assert.equal(isDistrictSecured(state, homogeneousDist, cellData, 0), false, "非均質且可分割時應為未確定當選");

  // 3. 不可再分割測試：單格 (size=1) 幾何上無內部邊，絕對不可能被任何 I4, S4, T4 牆塊分割
  const singleCellDist = { id: 1, size: 1, cells: [[0, 0]] };
  assert.equal(isDistrictSecured(state, singleCellDist, cellData, 1), true, "單格不可再分割，藍黨確定當選");

  // 4. tallyElectoralVotes 計票整合：傳入 state 時，只有確定當選的選區計入得票
  const regions = [homogeneousDist, singleCellDist];
  const tally = tallyElectoralVotes(regions, cellData, 2, state);

  // singleCellDist: 100 票確定給藍黨 (P1)
  // homogeneousDist: 1000 票爭奪中，不計入紅黨
  assert.equal(tally.electoralVotes[1], 100, "藍黨拿下單格確定票 100");
  assert.equal(tally.electoralVotes[0], 0, "紅黨在爭奪中選區得票暫不計入 (0 票)");
  assert.equal(tally.unsecuredElectoralVotes, 1000, "1000 票記為爭奪中 / 未確定");
  assert.equal(tally.regionResults[0].isSecured, false);
  assert.equal(tally.regionResults[1].isSecured, true);

  // 5. 單格平手測試：1 格人口 34 票（兩黨各 17 票平手），不可再分割，票數平分確定入帳 (各 17 票)
  const singleCellTieDist = { id: 2, size: 1, cells: [[1, 1]] };
  cellData[1][1].support = [17, 17];
  cellData[1][1].votes = 34;

  const tieRegions = [singleCellTieDist];
  const tieTally = tallyElectoralVotes(tieRegions, cellData, 2, state);
  assert.equal(tieTally.regionResults[0].isTie, true, "單格應為平手");
  assert.equal(tieTally.regionResults[0].isSecured, true, "不可分割單格平手應為確定定案");
  assert.equal(tieTally.electoralVotes[0], 17, "紅黨平分得 17 票");
  assert.equal(tieTally.electoralVotes[1], 17, "藍黨平分得 17 票");
  assert.equal(tieTally.totalConfirmedVotes, 34, "確定票數應為 34");
  assert.equal(tieTally.totalUnsecuredVotes, 0, "不應有任何未確定票");
});

