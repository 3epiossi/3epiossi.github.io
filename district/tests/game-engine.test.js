import test from "node:test";
import assert from "node:assert/strict";
import { createTestEngine } from "./helpers.js";

test("遊戲初始化：依人數配置牆塊袋總量、棋盤尺寸與單一盲抽牆塊", () => {
  const e2 = createTestEngine(2, 42);
  assert.equal(e2.boardSize, 8);
  assert.equal(e2.candidatePool.length, 1, "抽到什麼就是什麼，當前手牌為 1 塊");
  assert.equal(e2.wallBag.length, 49, "50 塊 - 1 塊 = 49 塊在袋中");
  assert.equal(e2.currentPlayer, 0);
  assert.equal(e2.isGameOver, false);

  const e3 = createTestEngine(3, 43);
  assert.equal(e3.boardSize, 9);
  assert.equal(e3.candidatePool.length, 1, "3人局盲抽手牌 1 塊");
  assert.equal(e3.wallBag.length, 69, "70 - 1 = 69 塊在袋中");

  const e4 = createTestEngine(4, 44);
  assert.equal(e4.boardSize, 10);
  assert.equal(e4.candidatePool.length, 1, "4人局盲抽手牌 1 塊");
  assert.equal(e4.wallBag.length, 69, "70 - 1 = 69 塊在袋中");
});

test("Pass 行動：棄除當前抽出的牆塊並從牌袋補抽新一塊", () => {
  const eb = createTestEngine(2, 100);
  const drawnPiece = eb.candidatePool[0];
  const bagBefore = eb.wallBag.length;

  const resB = eb.pass();
  assert.equal(resB.success, true);
  assert.equal(resB.discarded.uid, drawnPiece.uid, "Pass 應棄掉當前抽出的塊");
  assert.equal(eb.candidatePool.length, 1, "維持 1 塊手牌（重新抽取新塊）");
  assert.notEqual(eb.candidatePool[0].uid, drawnPiece.uid, "已抽出新塊");
  assert.equal(eb.wallBag.length, bagBefore - 1, "牆袋被抽走 1 塊");
  assert.equal(eb.consecutivePasses, 1);
  assert.equal(eb.currentPlayer, 1, "回合輪替給 Player 1");
});

test("結束條件與計分統一：所有玩家連續各 pass 一次即終局，且 getAnalyticsReport 計分與真實結果完全同步", () => {
  const e = createTestEngine(2, 200);

  // 對局中：activeResults 應等於 pollResults
  const liveReport = e.getAnalyticsReport();
  assert.equal(liveReport.isGameOver, false);
  assert.deepEqual(liveReport.activeResults.electoralVotes, liveReport.pollResults.electoralVotes);

  // Player 0 pass, Player 1 pass -> 終局
  e.pass();
  assert.equal(e.isGameOver, false);
  e.pass();
  assert.equal(e.isGameOver, true, "2人局連續 pass 2 次應觸發終局");

  assert.ok(e.finalResults, "終局應生成 finalResults 開票數據");
  assert.equal(e.finalResults.ranking.length, 2);

  // 終局後：activeResults 必須切換為 trueResults，確保計分板與最終開票結果一致
  const finalReport = e.getAnalyticsReport();
  assert.equal(finalReport.isGameOver, true);
  assert.deepEqual(
    finalReport.activeResults.electoralVotes,
    finalReport.trueResults.electoralVotes,
    "終局計分板數據必須與真實開票結果完全一致"
  );
  assert.equal(
    finalReport.trueResults.electoralVotes.reduce((a, b) => a + b, 0),
    6400,
    "2人局總選舉人票必為 6400 票"
  );
});

test("放牆行動：成功放牆重置連續 pass、更新候選池並推進輪次", () => {
  const e = createTestEngine(2, 300);

  e.pass();
  assert.equal(e.consecutivePasses, 1);
  assert.equal(e.currentPlayer, 1);

  let placed = false;
  for (let vr = 1; vr < e.boardSize; vr++) {
    for (let vc = 0; vc < e.boardSize; vc++) {
      const res = e.placeWall(0, vr, vc);
      if (res.success) {
        placed = true;
        break;
      }
    }
    if (placed) break;
  }

  assert.equal(placed, true, "應能成功放置牆塊");
  assert.equal(e.consecutivePasses, 0, "成功放牆重置連續 pass 計數為 0");
  assert.equal(e.currentPlayer, 0, "推進回合至 Player 0");
});

test("放牆即時預覽：previewMoveDelta 預覽票數消長（總選舉人票恆為 6400）", () => {
  const e = createTestEngine(2, 500);

  let preview = null;
  for (let vr = 1; vr < e.boardSize; vr++) {
    for (let vc = 0; vc < e.boardSize; vc++) {
      preview = e.previewMoveDelta(0, vr, vc, 0);
      if (preview) break;
    }
    if (preview) break;
  }

  assert.ok(preview, "合法位置應回傳 preview 資訊");
  assert.equal(preview.delta.length, 2);
  assert.equal(preview.currentVotes.reduce((a, b) => a + b, 0), 6400);
  assert.equal(preview.nextVotes.reduce((a, b) => a + b, 0), 6400);
});

test("視覺化棋盤驗證：棋盤 SVG 零數字文字、全盤連續熱力圖深淺與每格精確等於人口數之連續點圖", async () => {
  const { BoardView } = await import("../src/ui/board-view.js");
  const { PoolView } = await import("../src/ui/pool-view.js");

  class MockEl {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attrs = new Map();
      this.style = { setProperty() {} };
      const classes = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => x && classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
        contains: (c) => classes.has(c)
      };
    }
    set innerHTML(v) { this.children = []; this._html = v; }
    get innerHTML() { return this._html || ""; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k); }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener() {}
    querySelector() { return new MockEl("div"); }
    querySelectorAll() { return []; }
  }

  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement: (t) => new MockEl(t),
    createElementNS: (_ns, t) => new MockEl(t)
  };

  try {
    const e = createTestEngine(2, 1024);
    const bContainer = new MockEl("div");
    const pContainer = new MockEl("div");
    const bv = new BoardView(bContainer);
    const pv = new PoolView(pContainer);

    bv.setEngine(e);
    pv.setEngine(e);

    const countTags = (node, tag) => {
      let n = node.tagName === tag ? 1 : 0;
      for (const ch of node.children) n += countTags(ch, tag);
      return n;
    };

    assert.equal(countTags(bv.svg, "text"), 0, "開局時無確定當選選區，棋盤 SVG 上不應寫任何雜亂數字或文字 (<text> 數量應為 0)");

    // 驗證每個棋格剛好分到該格人口數個點，且全盤總點數等於 6400
    const allCellDots = bv._ensureContinuousCellDots();
    let totalDots = 0;
    for (let r = 0; r < e.boardSize; r++) {
      for (let c = 0; c < e.boardSize; c++) {
        const expectedPop = e.map.cells[r][c].population;
        const cellPts = allCellDots[r][c];
        assert.equal(cellPts.length, expectedPop, `棋格 (${r},${c}) 點數應剛好等於該格人口數 ${expectedPop}`);
        totalDots += cellPts.length;
      }
    }
    assert.equal(totalDots, 6400, "全盤人口點總數應等於 6400");

    // 驗證熱力圖顏色深淺隨領先比例遞增（平手最淺淡，鐵票倉最深濃）
    const tieColor = bv._computeHeatmapColor([0.5, 0.5]);
    const mildRed = bv._computeHeatmapColor([0.6, 0.4]);
    const strongRed = bv._computeHeatmapColor([0.85, 0.15]);
    assert.notEqual(tieColor, mildRed);
    assert.notEqual(mildRed, strongRed);

    // 驗證終局前無選區獲勝覆蓋層
    const countClass = (node, cls) => {
      let n = node.classList && node.classList.contains(cls) ? 1 : 0;
      for (const ch of node.children) n += countClass(ch, cls);
      return n;
    };
    assert.equal(countClass(bv.svg, "districtGameOverOverlay"), 0, "對局進行中不應有額外覆蓋層（直接換顏色）");

    // 模擬至終局
    while (!e.isGameOver) {
      e.pass();
    }
    bv.render();

    // 驗證終局後選區確定當選，棋盤上應標註選區編號 (<text> 標籤 > 0)
    assert.ok(countTags(bv.svg, "text") > 0, "確定當選的選區編號應標記在棋盤 SVG 上 (<text> 數量應 > 0)");

    // 驗證終局後同樣不使用覆蓋層，而是直接換底色
    assert.equal(countClass(bv.svg, "districtGameOverOverlay"), 0, "終局時不使用覆蓋層，直接於熱力底層切換勝選政黨色");

    // 驗證 _computeSecuredDistrictColor 顏色深淺隨獲勝比例單調變化
    const closeWinColor = bv._computeSecuredDistrictColor({ securedWinner: 0, winners: [0], support: [51, 49] });
    const midWinColor = bv._computeSecuredDistrictColor({ securedWinner: 0, winners: [0], support: [65, 35] });
    const strongWinColor = bv._computeSecuredDistrictColor({ securedWinner: 0, winners: [0], support: [90, 10] });
    const tieWinColor = bv._computeSecuredDistrictColor({ securedWinner: null, winners: [0, 1], support: [50, 50] });

    assert.equal(tieWinColor, "#8b95a7", "平手時呈現與均分選區相同的中性灰底色");
    assert.notEqual(closeWinColor, strongWinColor, "微幅險勝與壓倒性大勝顏色深淺應有明顯層次");
    assert.notEqual(closeWinColor, midWinColor, "顏色深淺隨領先比例遞增");

    // 驗證確定當選選區同時具備同色斜線 (Hatching)，且斜線密度隨人口比例遞增、顏色深淺隨獲勝比例遞增
    const lowPopHatch = bv._computeSecuredDistrictHatch({ securedWinner: 0, winners: [0], support: [60, 40], population: 64 }, 6400, 96);
    const midPopHatch = bv._computeSecuredDistrictHatch({ securedWinner: 0, winners: [0], support: [60, 40], population: 512 }, 6400, 96);
    const highPopHatch = bv._computeSecuredDistrictHatch({ securedWinner: 0, winners: [0], support: [60, 40], population: 1600 }, 6400, 96);

    assert.ok(lowPopHatch && highPopHatch);
    assert.ok(highPopHatch.density > lowPopHatch.density, "人口占比高之區域，斜線密度應更高");
    assert.ok(highPopHatch.spacing < lowPopHatch.spacing, "人口占比高之區域，斜線間距應更小 (更密集)");
    assert.ok(midPopHatch.spacing < lowPopHatch.spacing && highPopHatch.spacing < midPopHatch.spacing);

    const closeHatch = bv._computeSecuredDistrictHatch({ securedWinner: 1, winners: [1], support: [49, 51], population: 500 }, 6400, 96);
    const landSlideHatch = bv._computeSecuredDistrictHatch({ securedWinner: 1, winners: [1], support: [10, 90], population: 500 }, 6400, 96);
    assert.notEqual(closeHatch.color, landSlideHatch.color, "險勝與大勝斜線顏色深淺應有明顯層次");
    assert.ok(landSlideHatch.opacity > closeHatch.opacity, "大勝時斜線濃郁度應更高");

    // 驗證終局棋盤上確實有 securedHatchCell 元素存在且 fill 指向 secured-hatch pattern
    const hatchCellsCount = countClass(bv.svg, "securedHatchCell");
    assert.ok(hatchCellsCount > 0, "終局時確定當選的選區應繪製 securedHatchCell 斜線格");

    // 驗證選前／選後對比機制 (Before & After Slider View)
    bv.setCompareMode(true, 0.5);
    assert.equal(bv.compareMode, true, "應成功開啟對比模式");
    assert.equal(bv.compareRatio, 0.5, "預設對比位置應在中央 0.5");
    const countClips = countTags(bv.svg, "clipPath");
    assert.ok(countClips >= 2, "對比模式應產生 before 與 after 兩個 clipPath 進行分割渲染");
    const watermarkCount = countClass(bv.svg, "compareWatermark");
    assert.equal(watermarkCount, 0, "對比模式不再畫「劃區前／後」文字標籤");
    const handleCount = countClass(bv.svg, "compareHandle");
    assert.equal(handleCount, 0, "對比模式不再畫圓形把手，直接拖線即可");

    // 關閉對比模式
    bv.setCompareMode(false);
    assert.equal(bv.compareMode, false, "應成功關閉對比模式");
  } finally {
    globalThis.document = prevDoc;
  }
});

test("GameEngine: 支援悔棋 (undo) 與暫定領先席次分析數據", () => {
  const e = createTestEngine(2, 42);
  assert.equal(e.canUndo(), false, "開局尚未行動時不可悔棋");

  const initialReport = e.getAnalyticsReport();
  assert.equal(initialReport.partyStats.length, 2);
  const sumProvShare = initialReport.partyStats.reduce((acc, p) => acc + p.provisionalSeatShare, 0);
  assert.ok(Math.abs(sumProvShare - 100) < 1e-6, "各黨暫定總領先得票率總和應為 100%");

  const firstPieceId = e.candidatePool[0].id;
  let placed = false;
  for (let vr = 1; vr < e.boardSize && !placed; vr++) {
    for (let vc = 0; vc < e.boardSize && !placed; vc++) {
      const res = e.placeWall(0, vr, vc);
      if (res.success) placed = true;
    }
  }
  assert.equal(placed, true);
  assert.equal(e.canUndo(), true, "行動後應可悔棋");
  assert.equal(e.boardState.placedWalls.length, 1);

  const undoOk = e.undo();
  assert.equal(undoOk.success, true);
  assert.equal(e.canUndo(), false, "退回開局後不可再悔棋");
  assert.equal(e.boardState.placedWalls.length, 0, "悔棋後已放牆數應恢復為 0");
  assert.equal(e.currentPlayer, 0, "悔棋後應恢復為原本行動方");
  assert.equal(e.candidatePool[0].id, firstPieceId, "悔棋後當前抽出的牆塊應完全還原");
});
