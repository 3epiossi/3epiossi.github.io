import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { AIPlayer } from "../src/ai/ai-player.js";
import { SHAPE_MAP } from "../src/core/shapes.js";
import { buildParties, MAX_PARTIES, normalizeRules } from "../src/core/constants.js";
import { calculateTargetTotals } from "../src/core/map-generator.js";
import { createBoardState, canPlaceWall, calculateRegions } from "../src/core/rules.js";
import {
  PRESET_SHAPES,
  maskFromPreset,
  countActiveCells,
  countIslands,
  validateMask,
  encodeMask,
  decodeMask
} from "../src/core/board-shapes.js";
import { normalizeSettings, toEngineOptions } from "../src/ui/settings.js";

function playOut(engine) {
  const ais = engine.parties.map((_, i) => new AIPlayer(i));
  let guard = 0;
  while (!engine.isGameOver && guard++ < 400) {
    const move = ais[engine.currentPlayer].decideMove(engine);
    if (move.action === "place") {
      assert.equal(engine.placeWall(move.poolIndex, move.vr, move.vc).success, true);
    } else {
      engine.pass();
    }
  }
  assert.equal(engine.isGameOver, true, "對局應能順利結束");
}

test("自訂政黨：名稱、顏色與數量（2～6 黨）", () => {
  const parties = buildParties([
    { name: "  民主黨 ", color: "#123ABC" },
    { name: "", color: "not-a-color" }
  ]);
  assert.equal(parties[0].name, "民主黨");
  assert.equal(parties[0].shortName, "民");
  assert.equal(parties[0].color, "#123abc");
  assert.equal(parties[1].name, "綠黨", "空白名稱退回預設");
  assert.equal(parties[1].color, "#10b981", "無效顏色退回預設");

  const six = Array.from({ length: MAX_PARTIES }, (_, i) => ({ name: `P${i}` }));
  const e = new GameEngine({ parties: six, seed: 5 });
  assert.equal(e.numPlayers, 6);
  assert.equal(e.boardSize, 10, "5 黨以上預設 10x10");
  assert.equal(e.getAnalyticsReport().partyStats[5].name, "P5");
  const total = e.map.targetTotals.reduce((a, b) => a + b, 0);
  assert.equal(total, e.activeCellCount * 100);
  playOut(e);
});

test("先手補償：經典模式數值不變，可指定總人口", () => {
  assert.deepEqual(calculateTargetTotals(2, 42), [3158, 3242]);
  const t5 = calculateTargetTotals(5, 30, 5000);
  assert.equal(t5.reduce((a, b) => a + b, 0), 5000);
  assert.deepEqual(t5, [940, 970, 1000, 1030, 1060]);
});

test("地圖遮罩：海上棋格人口為 0、不屬於任何選區、不可放牆", () => {
  const N = 10;
  const mask = maskFromPreset("circle", N);
  const active = countActiveCells(mask);
  const e = new GameEngine({ numPlayers: 2, boardSize: N, mask, seed: 11 });

  assert.equal(e.activeCellCount, active);
  let pop = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = e.map.cells[r][c];
      if (mask[r][c]) {
        assert.ok(cell.population >= 15 && cell.population <= 285);
        assert.equal(cell.support.reduce((a, b) => a + b, 0), cell.population);
      } else {
        assert.equal(cell.population, 0);
        assert.equal(cell.active, false);
      }
      pop += cell.population;
    }
  }
  assert.equal(pop, active * 100, "總人口 = 陸地格數 x 100");

  const regions = calculateRegions(e.boardState);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].size, active, "初始選區只包含陸地格");

  // 角落 (0,0) 四周皆為海：任何貼著角落的牆都超出地圖
  assert.equal(mask[0][0], false);
  assert.equal(canPlaceWall(e.boardState, SHAPE_MAP.get("I4_H"), 1, 0).valid, false);

  const report = e.getAnalyticsReport();
  assert.equal(report.totalElectoralVotes, active * 100);
  playOut(e);
  const final = e.getAnalyticsReport();
  const sum = final.partyStats.reduce((s, p) => s + p.electoralVotes, 0);
  assert.equal(sum, active * 100, "終局所有選舉人票都已分配（含均分選區）");
});

test("地圖遮罩：多個島嶼各自成為獨立選區", () => {
  const N = 8;
  const mask = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => (c <= 2 || c >= 5) && r >= 1 && r <= 6));
  assert.equal(countIslands(mask), 2);
  const state = createBoardState(N, mask);
  const regions = calculateRegions(state);
  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map((r) => r.size).sort(), [18, 18]);

  // 島嶼間的海峽：兩側都是海的邊不可放牆
  assert.equal(canPlaceWall(state, SHAPE_MAP.get("I4_V"), 2, 4).valid, false);
  // 海岸線與外框一樣視為牆，不可共用線段
  assert.equal(canPlaceWall(state, SHAPE_MAP.get("I4_V"), 2, 3).reason, "ON_BORDER");
  // 島內的邊可以放，端點可接觸海岸線
  assert.equal(canPlaceWall(state, SHAPE_MAP.get("I4_V"), 1, 1).valid, true);
});

test("內建圖形與遮罩編碼", () => {
  for (const preset of PRESET_SHAPES) {
    const N = preset.defaultSize || 8;
    const mask = maskFromPreset(preset.id, N);
    if (!preset.rings) {
      assert.equal(mask, null, "正方形不需要遮罩");
      continue;
    }
    assert.ok(validateMask(mask).valid, `${preset.name} 應可開局`);
    assert.deepEqual(decodeMask(encodeMask(mask)), mask);
  }
  assert.equal(validateMask(Array.from({ length: 6 }, () => Array(6).fill(false))).valid, false);
  assert.equal(decodeMask("10/1"), null, "非正方形編碼視為無效");
});

test("設定正規化：保存的自訂地圖可還原為引擎參數", () => {
  const mask = maskFromPreset("heart", 11);
  const settings = normalizeSettings({
    parties: [{ name: "A", color: "#ff0000", type: "human" }, { name: "B", color: "#00ff00", type: "cpu" }, { name: "C", color: "#0000ff", type: "cpu" }],
    shapeId: "custom",
    boardSize: 99,
    customMask: encodeMask(mask)
  });
  assert.equal(settings.boardSize, 11, "自訂地圖的尺寸以遮罩為準");
  const opts = toEngineOptions(settings);
  assert.deepEqual(opts.mask, mask);
  assert.equal(opts.parties.length, 3);

  const fallback = normalizeSettings({ parties: [{ name: "solo" }], shapeId: "nope" });
  assert.equal(fallback.parties.length, 2, "至少 2 黨");
  assert.equal(fallback.shapeId, "square");
  assert.equal(toEngineOptions(fallback).mask, null);
});

test("進階規則：手牌、牆塊種類、牌袋份量與結束條件", () => {
  const e = new GameEngine({ numPlayers: 2, seed: 3, rules: { handSize: 3, families: ["T4"], bagScale: 0.6, passRounds: 2 } });
  assert.equal(e.candidatePool.length, 3, "手牌 3 塊");
  assert.ok(e.wallBag.every((p) => p.shape.type === "T4"), "牌袋只剩 T4");
  assert.equal(e.config.totalBagPieces, e.bagShapes.length * e.config.bagCopiesPerShape);
  assert.ok(e.config.totalBagPieces < 50 && e.config.totalBagPieces >= 20);

  // 放棄可指定丟掉哪一塊，並補滿手牌
  const keep = e.candidatePool[0].uid;
  const drop = e.candidatePool[2].uid;
  e.pass(2);
  assert.equal(e.candidatePool.length, 3);
  assert.equal(e.candidatePool[0].uid, keep);
  assert.equal(e.discardPile.at(-1).uid, drop);

  // 兩輪：2 黨要連續放棄 4 次才結束
  e.pass();
  e.pass();
  assert.equal(e.isGameOver, false, "連續放棄 3 次還沒結束");
  e.pass();
  assert.equal(e.isGameOver, true);

  const classic = new GameEngine({ numPlayers: 2, seed: 3 });
  assert.equal(classic.config.totalBagPieces, 50, "預設規則維持經典牌袋");
  assert.equal(classic.k, -5);
  assert.equal(new GameEngine({ numPlayers: 2, seed: 3, rules: { compensation: 0 } }).k, 0);
});

test("進階規則：未達最小格數的選區為均分選區，選舉人票平分給所有政黨", () => {
  const e = new GameEngine({ numPlayers: 2, seed: 8, rules: { minDistrictSize: 3 } });
  playOut(e);
  const final = e.getAnalyticsReport();
  const assigned = final.partyStats.reduce((s, p) => s + p.electoralVotes, 0);
  assert.ok(Math.abs(assigned - e.activeCellCount * 100) < 1e-6, "選舉人票全數分配，均分選區不流失");
  const splits = final.districts.filter((d) => d.isVoid);
  assert.ok(splits.length > 0, "應有均分選區");
  assert.ok(splits.every((d) => d.cellCount < 3));
  assert.ok(final.totalVoidElectoralVotes > 0);
});

test("邊界即牆：海岸線轉角不可作為牆的中段", () => {
  // 7x7 陸地，右下角 (5..6, 5..6) 為海，頂點 (5,5) 是內凹的海岸轉角
  const N = 7;
  const mask = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => !(r >= 5 && c >= 5)));
  const state = createBoardState(N, mask);
  // S4_H_U 中段在 (1,0),(1,1)；錨點 (4,4) -> 中段 (5,4),(5,5)
  const check = canPlaceWall(state, SHAPE_MAP.get("S4_H_U"), 4, 4);
  assert.equal(check.valid, false);
});

test("進階規則：舊版存檔的牆塊家族（I3、S3）會換成 I4、S4，不會只剩 T4", () => {
  const legacy = normalizeRules({ families: ["I3", "S3", "T4"] });
  assert.deepEqual(legacy.families, ["I4", "S4", "T4"]);
  const engine = new GameEngine({ numPlayers: 2, seed: 4, rules: legacy });
  assert.deepEqual([...new Set(engine.wallBag.map((p) => p.shape.type))].sort(), ["I4", "S4", "T4"]);
  assert.deepEqual(normalizeRules({ families: ["T4"] }).families, ["T4"]);
  assert.deepEqual(normalizeRules({ families: ["X9"] }).families, ["I4", "S4", "T4"], "全部不合法時退回預設");
});
