import test from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE } from "../src/core/constants.js";
import { GameEngine, poolOf } from "../src/core/game-engine.js";
import { createEmptyBoard, createDisc } from "../src/core/rules.js";
import { groupOf, numberMask, findFive, fiveScores, FIVE_WINDOWS, GROUPS, GROUP_SIZE } from "../src/core/five-rules.js";
import { mulberry32 } from "./helpers.js";

/** 第 g 組（0～3）的第 k 顆棋 */
const gid = (g, k = 0) => g * GROUP_SIZE + k;

test("棋子：64 顆分成 4 組、每組 16 顆；同一組的棋符號集合一樣", () => {
  assert.equal(GROUPS, 4);
  assert.equal(GROUP_SIZE, 16);
  const count = [0, 0, 0, 0];
  for (let id = 0; id < 64; id++) count[groupOf(id)]++;
  assert.deepEqual(count, [16, 16, 16, 16]);
  assert.equal(groupOf(gid(2, 15)), 2);
  assert.equal(numberMask(gid(1, 3)), 1 << 1);
  assert.equal(numberMask(gid(1, 3)), numberMask(gid(1, 9)));
});


test("五連窗口共 96 個", () => {
  assert.equal(FIVE_WINDOWS.length, 96);
});


test("五連：同色、同一組、連續 5 顆、直線；組別不同或顏色不同都不算", () => {
  const b = createEmptyBoard();
  for (let c = 0; c < 5; c++) b[0][c] = createDisc(gid(2, c), BLACK);
  assert.equal(findFive(b, BLACK)?.value, 3); // 第 3 組（γ）
  assert.equal(findFive(b, WHITE), null);
  b[0][3] = createDisc(gid(1, 0), BLACK); // 第 4 顆換成別組
  assert.equal(findFive(b, BLACK), null);
  b[0][3] = createDisc(gid(2, 9), WHITE); // 同組但是對手的
  assert.equal(findFive(b, BLACK), null);
});


test("斜線也算", () => {
  const b = createEmptyBoard();
  for (let k = 0; k < 5; k++) b[2 + k][1 + k] = createDisc(gid(0, k), WHITE);
  assert.equal(findFive(b, WHITE)?.value, 1);
});


test("分數 = 各自的棋子數", () => {
  const b = createEmptyBoard();
  b[0][0] = createDisc(gid(0), BLACK);
  b[0][1] = createDisc(gid(3), WHITE);
  b[0][2] = createDisc(gid(1), BLACK);
  assert.deepEqual(fiveScores(b, false), { black: 2, white: 1 });
});


test("開局：中間四顆每組各一顆；池子是每組下一顆要用的棋（依組別），每組剩 15 顆", () => {
  for (const seed of [1, 2, 3]) {
    const e = new GameEngine({ rng: mulberry32(seed) });
    const center = [e.board[3][3], e.board[3][4], e.board[4][3], e.board[4][4]];
    assert.deepEqual(center.map(d => groupOf(d.id)).sort(), [0, 1, 2, 3]);
    assert.deepEqual(e.pool.map(groupOf), [0, 1, 2, 3]);
    assert.deepEqual(e.groupCounts(), [15, 15, 15, 15]);
  }
});


test("選哪一組就下那一組；那組換下一顆、剩的數量減一；用完的組別從池子消失", () => {
  const e = new GameEngine({ rng: mulberry32(5) });
  const m = e.legalMoves()[0];
  const pick = e.pool[2];
  assert.ok(e.executeMove(m.r, m.c, pick));
  assert.equal(groupOf(e.board[m.r][m.c].id), 2);
  assert.deepEqual(e.groupCounts(), [15, 15, 14, 15]);
  assert.ok(!e.pool.includes(pick));
  assert.equal(groupOf(e.pool[2]), 2);
  assert.deepEqual(e.pool, poolOf(e.board));
  // 不在池子裡的棋不能下
  const m2 = e.legalMoves()[0];
  assert.equal(e.executeMove(m2.r, m2.c, gid(0, 15)), false);
  // 把第 0 組用完：池子只剩 3 組
  const b = createEmptyBoard();
  for (let k = 0; k < 16; k++) b[k >> 3][k & 7] = createDisc(gid(0, k), BLACK);
  assert.deepEqual(poolOf(b).map(groupOf), [1, 2, 3]);
});


test("引擎（五連模式）：連成五立刻結束、由連成五的一方獲勝", () => {
  let ended = 0;
  for (let g = 0; g < 60 && ended < 3; g++) {
    const e = new GameEngine({ rng: mulberry32(800 + g) });
    while (!e.gameOver) {
      const m = e.legalMoves();
      if (!m.length) { e.passTurn(); continue; }
      const player = e.currentTurn;
      const pick = m[(g * 3 + e.tree.nodes.size) % m.length];
      e.executeMove(pick.r, pick.c);
      if (e.gameOver && e.settlementData.byFive) {
        assert.equal(e.settlementData.winner, player);
        assert.ok(findFive(e.board, player));
        assert.deepEqual(e.lastMove.five.cells, e.settlementData.five.cells);
        // 時光機：跳回上一手再回來，終局狀態完整還原
        const tip = e.tree.currentNodeId;
        const prev = e.tree.getNode(tip).parentId;
        e.jumpToNode(prev);
        assert.equal(e.gameOver, false);
        e.jumpToNode(tip);
        assert.equal(e.gameOver, true);
        assert.ok(e.settlementData.byFive);
        ended++;
      }
    }
    if (!e.settlementData.byFive) {
      const s = fiveScores(e.board, false);
      assert.equal(e.settlementData.black, s.black);
      assert.equal(e.settlementData.winner, s.black === s.white ? 0 : s.black > s.white ? BLACK : WHITE);
    }
  }
  assert.ok(ended >= 1);
});


test("引擎：每顆 1 分，雙方合計等於盤上棋子數（填滿時 64）；五連以那一組的字標示", async () => {
  const { discLabel, letterOf } = await import("../src/core/five-rules.js");
  assert.equal(discLabel(gid(3, 7)), "♣\uFE0E");
  assert.equal(letterOf(1), "♠\uFE0E");
  let sawFull = false, sawFive = false;
  for (let g = 0; g < 40 && !(sawFull && sawFive); g++) {
    const e = new GameEngine({ rng: mulberry32(900 + g) });
    while (!e.gameOver) {
      const m = e.legalMoves();
      if (!m.length) { e.passTurn(); continue; }
      const p = m[(g + e.tree.nodes.size) % m.length];
      e.executeMove(p.r, p.c, e.pool[(g + e.tree.nodes.size) % e.pool.length]);
    }
    const s = e.settlementData;
    const discs = e.board.flat().filter(Boolean).length;
    assert.equal(s.black + s.white, discs);
    if (discs === 64) sawFull = true;
    if (s.byFive) {
      sawFive = true;
      // 結算原因存的是組別編號（顯示時才依目前的字換），1～4
      assert.ok(s.reason.p.v.$sym >= 1 && s.reason.p.v.$sym <= 4);
      assert.match(letterOf(s.reason.p.v.$sym), /^[♠♥♦♣]\uFE0E$/);
    }
  }
  assert.ok(sawFull || sawFive);
});


test("AI（v13）：只選合法位置、池子裡的棋；能直接連成五就連", async () => {
  const { findBestMoveForCPU } = await import("../src/ai/ai-service.js");
  const e = new GameEngine({ rng: mulberry32(77) });
  for (let i = 0; i < 10 && !e.gameOver; i++) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const r = findBestMoveForCPU(e.board, e.currentTurn, e.pool, { timeMs: 50 });
    assert.ok(e.findLegalMove(r.chosen.r, r.chosen.c));
    assert.ok(e.pool.includes(r.chosen.disc));
    assert.ok(e.executeMove(r.chosen.r, r.chosen.c, r.chosen.disc));
  }
  // 第 4 列 A～D：四顆黑、第 2 組；黑下 E4 翻 F4，連成五
  const b = createEmptyBoard();
  for (let c = 0; c < 4; c++) b[3][c] = createDisc(gid(2, c), BLACK);
  b[3][5] = createDisc(gid(0, 0), WHITE); b[3][6] = createDisc(gid(0, 1), BLACK);
  b[6][1] = createDisc(gid(1, 0), WHITE); b[7][2] = createDisc(gid(3, 0), BLACK);
  const r = findBestMoveForCPU(b, BLACK, poolOf(b), { timeMs: 100 });
  assert.equal(r.chosen.r * 8 + r.chosen.c, 3 * 8 + 4);
  assert.equal(groupOf(r.chosen.disc), 2);
  assert.ok(r.maxScore >= 0.999);
});


test("multiPV（提示用）：每個合法位置 × 每一組都有分數，最佳步跟一般搜尋同樣好", async () => {
  const { searchEngine } = await import("../src/ai/ai-service.js");
  const rng = mulberry32(31);
  for (const target of [44, 30]) {
    const e = new GameEngine({ rng });
    while (!e.gameOver && e.board.flat().filter(x => !x).length > target) {
      const m = e.legalMoves();
      if (!m.length) { e.passTurn(); continue; }
      const pick = m[Math.floor(rng() * m.length)];
      e.executeMove(pick.r, pick.c, e.pool[Math.floor(rng() * e.pool.length)]);
    }
    if (e.gameOver || !e.legalMoves().length) continue;
    const multi = searchEngine(e.board, e.currentTurn, e.pool, { timeMs: 60000, maxDepth: 2, multiPV: true });
    const keys = new Set(multi.scores.map(x => x.key));
    for (const m of e.legalMoves()) for (const d of e.pool) assert.ok(keys.has(d * 64 + m.r * 8 + m.c), "每一格每一組都要有分數");
    for (let i = 1; i < multi.scores.length; i++) assert.ok(multi.scores[i - 1].score >= multi.scores[i].score);
    const one = searchEngine(e.board, e.currentTurn, e.pool, { timeMs: 60000, maxDepth: 2 });
    assert.ok(Math.abs(one.scores[0].score - multi.scores[0].score) < 1e-9);
  }
});


test("棋子文字：預設撲克花色 ♠♥♦♣（文字樣式）；也可以用希臘字母，或自訂剛好 4 個不同的字；不合格或舊設定退回預設", async () => {
  const { letterOf, setSymbolSet, getSymbolSet, parseCustomSymbols } = await import("../src/core/five-rules.js");
  assert.equal(getSymbolSet(), "suits");
  assert.deepEqual([1, 2, 3, 4].map(n => letterOf(n)), ["♠\uFE0E", "♥\uFE0E", "♦\uFE0E", "♣\uFE0E"]);
  setSymbolSet("greek");
  assert.equal(letterOf(1), "α");
  assert.equal(letterOf(4), "δ");
  setSymbolSet("custom", "春夏秋冬");
  assert.equal(getSymbolSet(), "custom");
  assert.equal(letterOf(1), "春");
  assert.equal(letterOf(4), "冬");
  setSymbolSet("custom", "あ い う え"); // 空白不算
  assert.equal(letterOf(3), "う");
  assert.deepEqual(parseCustomSymbols("ABC"), { ok: false, reason: "count", count: 3 });
  assert.deepEqual(parseCustomSymbols("天地天黃"), { ok: false, reason: "dupe", dupe: "天" });
  assert.equal(parseCustomSymbols("👍🏽🍎🍊🍋").ok, true); // 一個表情符號（含膚色）算一個字
  setSymbolSet("custom", "天地玄黃宇宙洪荒");   // 舊規則的 8 個字 → 不合格，退回預設
  assert.equal(getSymbolSet(), "suits");
  for (const old of ["letters", "shapes", "bogus"]) {
    setSymbolSet(old);
    assert.equal(getSymbolSet(), "suits");
  }
  assert.equal(letterOf(1), "♠\uFE0E");
});

test("五連威脅：不分黑白，4 顆同一組、剩一格空 → 四；3 顆 → 三；組別不同不算", async () => {
  const { findThreats } = await import("../src/core/five-rules.js");
  const b = createEmptyBoard();
  // 第 0 列：A1～D1 黑白混雜、都是第 2 組（γ），E1 空 → 四，缺口 E1 要補第 3 個符號（γ）
  for (let c = 0; c < 4; c++) b[0][c] = createDisc(gid(2, c), c % 2 ? WHITE : BLACK);
  // 第 2 列：A3～C3 黑白混雜、第 0 組，D3、E3 空 → 三
  for (let c = 0; c < 3; c++) b[2][c] = createDisc(gid(0, c), c === 1 ? BLACK : WHITE);
  // 第 4 列：A5～C5 第 3 組，但 D5 是第 1 組 → A5～E5 這段不算
  for (let c = 0; c < 3; c++) b[4][c] = createDisc(gid(3, c), BLACK);
  b[4][3] = createDisc(gid(1, 0), WHITE);
  const t = findThreats(b);
  for (let c = 0; c < 4; c++) assert.ok(t.fours.has(c), "A1～D1 是四（黑白混雜也算）");
  assert.equal(t.gaps.get(4), 1 << 2);
  for (let c = 0; c < 3; c++) assert.ok(t.threes.has(16 + c), "A3～C3 是三（黑白混雜也算）");
  for (let c = 0; c < 3; c++) assert.ok(!t.threes.has(32 + c) && !t.fours.has(32 + c), "A5～C5 那段夾了別組的棋");
  const b2 = createEmptyBoard();
  b2[0][0] = createDisc(gid(0), BLACK); b2[0][1] = createDisc(gid(1), BLACK); b2[0][2] = createDisc(gid(2), BLACK);
  assert.equal(findThreats(b2).threes.size, 0);
});


test("五連威脅：那一組剩下的棋不夠補滿空格就不算（三要剩 2 顆、四要剩 1 顆）", async () => {
  const { findThreatGroups } = await import("../src/core/five-rules.js");
  const lineAt = (b, sq) => findThreatGroups(b).find(g => g.v === 3 && g.cells.includes(sq));
  // D1～F1：第 3 組（♦）的三；其他第 3 組的棋放在第 4、6、8 列（隔開，不會自己湊成連線）
  const three = (others) => {
    const b = createEmptyBoard();
    for (let c = 3; c < 6; c++) b[0][c] = createDisc(gid(2, c - 3), c % 2 ? WHITE : BLACK);
    for (let k = 0; k < others; k++) b[3 + 2 * Math.floor(k / 4)][2 * (k % 4)] = createDisc(gid(2, 3 + k), BLACK);
    return b;
  };
  assert.equal(lineAt(three(11), 3)?.kind, 3);    // 剩 2 顆：三照畫
  assert.equal(lineAt(three(12), 3), undefined);  // 剩 1 顆：補不滿兩格，不畫
  // 四：剩 1 顆照畫，剩 0 顆不畫
  const four = (others) => {
    const b = createEmptyBoard();
    for (let c = 3; c < 7; c++) b[0][c] = createDisc(gid(2, c - 3), BLACK);
    for (let k = 0; k < others; k++) b[3 + 2 * Math.floor(k / 4)][2 * (k % 4)] = createDisc(gid(2, 4 + k), WHITE);
    return b;
  };
  assert.equal(lineAt(four(11), 3)?.kind, 4);
  assert.equal(lineAt(four(12), 3), undefined);
});

test("五連威脅分組：同一條線、同一組的重疊窗口合併成一組（活四一組、兩個缺口）", async () => {
  const { findThreatGroups } = await import("../src/core/five-rules.js");
  const b = createEmptyBoard();
  for (let c = 1; c < 5; c++) b[1][c] = createDisc(gid(2, c), c % 2 ? BLACK : WHITE);
  const groups = findThreatGroups(b);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 4);
  assert.equal(groups[0].v, 3);
  assert.deepEqual(groups[0].cells, [9, 10, 11, 12]);
  assert.deepEqual([...groups[0].gaps].sort((a, c) => a - c), [8, 13]);
});


test("棋子文字顏色：借用另一方的寶石色；棋面只能用寶石預設色", async () => {
  const { resolveTextColor, textPaletteFor, normalizeFace } = await import("../src/ui/text-colors.js");
  const { DEFAULT_BLACK_PRESETS, DEFAULT_WHITE_PRESETS } = await import("../../src/ui/skin-workshop.js");
  assert.equal(textPaletteFor(true), DEFAULT_WHITE_PRESETS);   // 黑方棋面的字用白方的顏色（淺色系）
  assert.equal(textPaletteFor(false), DEFAULT_BLACK_PRESETS);  // 白方棋面的字用黑方的顏色（深色系）
  assert.equal(resolveTextColor(true, "rose").color, DEFAULT_WHITE_PRESETS.find(p => p.id === "rose").color);
  assert.equal(resolveTextColor(true, "ruby").id, DEFAULT_WHITE_PRESETS[0].id);  // 不在色系裡 → 第一個
  assert.equal(resolveTextColor(false, "").id, DEFAULT_BLACK_PRESETS[0].id);
  // 以前存的自訂色、圖片 → 該方的第一個預設色；預設色照舊
  assert.equal(normalizeFace({ type: "image", imageData: "data:" }, true).id, DEFAULT_BLACK_PRESETS[0].id);
  assert.equal(normalizeFace({ type: "color", color: "#fde68a" }, false).id, DEFAULT_WHITE_PRESETS[0].id);
  assert.equal(normalizeFace({ type: "preset", id: "ruby" }, true).gradient, DEFAULT_BLACK_PRESETS.find(p => p.id === "ruby").gradient);
});


test("makesFourAt：剛下的棋經過的窗口有 4 顆同色、同一組的棋，剩 1 格空的", async () => {
  const { makesFourAt } = await import("../src/core/five-rules.js");
  const b = createEmptyBoard();
  for (let c = 0; c < 4; c++) b[0][c] = { id: gid(0, c), face: 1 };
  assert.equal(makesFourAt(b, 0, 3), true);
  b[0][1] = { id: gid(0, 1), face: 2 }; // 其中一顆是對方的顏色 → 不算
  assert.equal(makesFourAt(b, 0, 3), false);
  b[0][1] = { id: gid(3, 1), face: 1 }; // 別組 → 不算
  assert.equal(makesFourAt(b, 0, 3), false);
});


test("四的缺口：只有下在那裡真的會連成五（翻面也算）的那一方才標", async () => {
  const { completesFive, withGapOwners, findThreatGroups } = await import("../src/core/five-rules.js");
  const G = 2; // 第 2 組（β）
  // 同一直行：第 1 列是缺口，下面四顆都是第 2 組，最下面一顆是第 4 組
  const column = (faces) => {
    const b = createEmptyBoard();
    [gid(1, 0), gid(1, 1), gid(1, 2), gid(1, 3), gid(3, 0)].forEach((d, i) => { b[1 + i][4] = { id: d, face: faces[i] }; });
    return b;
  };
  const gap = 0 * 8 + 4;
  // 黑 白 黑 白 白 → 白下會翻第一顆黑，但第三顆還是黑；黑下不翻 → 兩方都連不成
  const b1 = column([BLACK, WHITE, BLACK, WHITE, WHITE]);
  assert.equal(completesFive(b1, gap, G, WHITE), false);
  assert.equal(completesFive(b1, gap, G, BLACK), false);
  const g1 = withGapOwners(b1, findThreatGroups(b1)).find(g => g.kind === 4 && g.v === G);
  assert.deepEqual(g1.gaps, []);
  // 黑 黑 黑 白 白 → 白下把三顆黑翻成白 → 五連；黑下連不成
  const b2 = column([BLACK, BLACK, BLACK, WHITE, WHITE]);
  assert.equal(completesFive(b2, gap, G, WHITE), true);
  assert.equal(completesFive(b2, gap, G, BLACK), false);
  const g2 = withGapOwners(b2, findThreatGroups(b2)).find(g => g.kind === 4 && g.v === G);
  assert.deepEqual(g2.gaps, [gap]);
  assert.deepEqual(g2.gapOwners[gap], [WHITE]);
});


test("從這裡繼續下：目前這一步變成最新一步，之後的棋與分支都刪掉，可以直接接著下", async () => {
  const { GameEngine } = await import("../src/core/game-engine.js");
  const play = (e) => { const m = e.legalMoves()[0]; assert.ok(e.playMove(m.r, m.c, e.pool[0])); };
  // 主線：下 6 步，退回第 3 步，從這裡繼續
  const e = new GameEngine({ rng: mulberry32(7) });
  for (let i = 0; i < 6; i++) play(e);
  e.goToStep(3);
  const at3 = e.tree.currentNodeId;
  assert.ok(e.makeCurrentLatest());
  assert.equal(e.tree.getBranchHistory().length, 4);
  assert.equal(e.tree.getBranchTipNode().id, at3);
  assert.equal(e.tree.currentNodeId, at3);
  play(e);                                            // 直接接著下，不會開分支
  assert.equal(e.tree.activeBranchId, "main");
  assert.equal(e.tree.getBranchHistory().length, 5);

  // 分支：退回第 2 步改下別步（開分支），在分支上再下兩步、退一步，從這裡繼續 → 分支變成主線
  const f = new GameEngine({ rng: mulberry32(8) });
  for (let i = 0; i < 6; i++) play(f);
  f.goToStep(2);
  const alt = f.legalMoves()[1] || f.legalMoves()[0];
  assert.ok(f.playMove(alt.r, alt.c, f.pool[0]));
  assert.notEqual(f.tree.activeBranchId, "main");
  play(f); play(f);
  f.goToStep(4);
  const branchAt4 = f.tree.currentNodeId;
  assert.ok(f.makeCurrentLatest());
  assert.equal(f.tree.activeBranchId, "main");
  assert.equal(f.tree.branches.size, 1);
  const line = f.tree.getBranchHistory();
  assert.equal(line.length, 5);
  assert.equal(line[4].id, branchAt4);
  assert.ok(line.every(n => n.branchId === "main"));
  assert.equal(f.tree.nodes.size, 5);                 // 原本主線第 3 步之後的棋都刪掉了
});


test("存檔：對局樹（含分支）存成 JSON 再讀回，局面、分支、目前那一步都一樣，讀回後可以接著下", async () => {
  const play = (e) => { const m = e.legalMoves()[0]; assert.ok(e.playMove(m.r, m.c, e.pool[0])); };
  const e = new GameEngine({ rng: mulberry32(11) });
  for (let i = 0; i < 6; i++) play(e);
  e.goToStep(3);
  const alt = e.legalMoves()[1] || e.legalMoves()[0];
  assert.ok(e.playMove(alt.r, alt.c, e.pool[0]));     // 開一條分支
  play(e);
  e.tree.getCurrentNode().mark = { sym: "!", why: { key: "markKey", p: {} } }; // app 加在節點上的欄位也要保留
  const saved = JSON.parse(JSON.stringify(e.tree.toJSON()));

  const g = new GameEngine({ rng: mulberry32(99) });
  assert.ok(g.restoreTree(saved));
  assert.equal(g.tree.nodes.size, e.tree.nodes.size);
  assert.equal(g.tree.branches.size, 2);
  assert.equal(g.tree.activeBranchId, e.tree.activeBranchId);
  assert.equal(g.tree.currentNodeId, e.tree.currentNodeId);
  assert.deepEqual(g.board, e.board);
  assert.deepEqual(g.pool, e.pool);
  assert.equal(g.currentTurn, e.currentTurn);
  assert.deepEqual(g.tree.getCurrentNode().mark, e.tree.getCurrentNode().mark);
  assert.deepEqual(g.tree.getBranchHistory("main").map(n => n.id), e.tree.getBranchHistory("main").map(n => n.id));
  play(g);                                              // 讀回後照常下棋
  assert.equal(g.tree.getBranchHistory().length, e.tree.getBranchHistory().length + 1);

  // 壞掉的存檔：丟出錯誤，原本的局面不變
  const before = g.tree;
  assert.throws(() => g.restoreTree({ v: 1, nodes: [], branches: [] }));
  assert.equal(g.tree, before);
});

test("花五：同一組五連但黑白混雜 → kind 5，記下黑白各幾顆；同色不算（那已經贏了）", async () => {
  const { findThreatGroups, findThreats } = await import("../src/core/five-rules.js");
  const b = createEmptyBoard();
  [BLACK, WHITE, BLACK, BLACK, WHITE].forEach((f, i) => { b[2][1 + i] = { id: gid(2, i), face: f }; });
  const gs = findThreatGroups(b).filter(g => g.kind === 5);
  assert.equal(gs.length, 1);
  assert.equal(gs[0].v, 3);
  assert.deepEqual(gs[0].cells, [17, 18, 19, 20, 21]);
  // 同一條線的四併進來：兩端的缺口（A3、G3）留著，withGapOwners 再判斷誰真的連得成
  assert.deepEqual(gs[0].gaps.sort((x, y) => x - y), [16, 22]);
  assert.deepEqual(gs[0].mixed, { black: 3, white: 2 });
  assert.equal(findFive(b, BLACK) || findFive(b, WHITE), null);
  // 舊的集合介面不把花五的棋當成三或四（缺口照樣列出）
  const t = findThreats(b);
  assert.equal(t.fours.size + t.threes.size, 0);
  assert.deepEqual([...t.gaps.keys()].sort((x, y) => x - y), [16, 22]);
  // 混了別組 → 不是花五
  b[2][3] = { id: gid(0, 0), face: BLACK };
  assert.equal(findThreatGroups(b).some(g => g.kind === 5), false);
});
