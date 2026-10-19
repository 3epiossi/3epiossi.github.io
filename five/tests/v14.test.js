import test from "node:test";
import assert from "node:assert/strict";
import { searchV13, V13_PARAMS } from "../src/ai/v13.js";
import { searchV14, setPatternWeights, resetPatternWeights, othelloEvalV14, V14_PARAMS, WIN } from "../src/ai/v14.js";
import { decodePatternWeights, PATTERN_EXTRA } from "../src/ai/pattern-weights.js";
import { INSTANCES, STAGES, STAGE_SIZE, stageOf, patternIndices } from "../src/ai/patterns.js";
import { createEmptyBoard, getLegalMoves, applyMoveToBoard, createInitialBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { mulberry32 } from "./helpers.js";

const groupOf = (id) => id >> 4;
const opp = (t) => (t === BLACK ? WHITE : BLACK);
const disc = (g, face, k = 0) => ({ id: g * 16 + k, face });

function randomGame(rng, plies) {
  let k = 0;
  let b = createInitialBoard(() => [0, 16, 32, 48][k++]), turn = BLACK;
  const used = new Set([0, 16, 32, 48]);
  for (let i = 0; i < plies; i++) {
    let ms = getLegalMoves(b, turn);
    if (!ms.length) { turn = opp(turn); ms = getLegalMoves(b, turn); if (!ms.length) break; }
    const m = ms[Math.floor(rng() * ms.length)];
    let id;
    do { id = Math.floor(rng() * 64); } while (used.has(id));
    used.add(id);
    b = applyMoveToBoard(b, m, id, turn);
    turn = opp(turn);
  }
  return { b, turn };
}

test("v14 棋型表：解碼後大小正確（STAGES × STAGE_SIZE），棋型 46 個、階段內插的比重在 0～1", () => {
  const w = decodePatternWeights();
  assert.ok(w instanceof Int8Array);
  assert.equal(w.length, STAGES * STAGE_SIZE);
  assert.equal(PATTERN_EXTRA.length, STAGES * 2);
  assert.ok(PATTERN_EXTRA.every(Number.isFinite));
  assert.equal(INSTANCES.length, 46);
  for (const e of [0, 13, 30, 47, 60]) { const [s, a] = stageOf(e); assert.ok(s >= 0 && s < STAGES - 1 && a >= 0 && a <= 1); }
  // 每個實例的位置都在自己那種棋型的表裡
  const cells = new Uint8Array(64).fill(2);
  for (const i of patternIndices(cells)) assert.ok(i >= 0 && i < STAGE_SIZE - 2);
});

test("v14 棋型評估：角落是自己的明顯比角落是對手的好", () => {
  const b = createEmptyBoard();
  b[3][3] = disc(0, WHITE); b[3][4] = disc(1, BLACK); b[4][3] = disc(2, BLACK); b[4][4] = disc(3, WHITE);
  b[2][2] = disc(0, BLACK, 1); b[2][3] = disc(1, WHITE, 1);
  // 角落附近有棋（像中盤的樣子；只有一顆孤零零的角，訓練資料裡沒出現過，分數不準）
  for (const [r, c, f] of [[0, 1, BLACK], [1, 0, WHITE], [1, 1, WHITE], [0, 2, WHITE], [5, 5, BLACK], [5, 4, WHITE], [2, 4, BLACK], [2, 5, WHITE], [4, 5, BLACK]]) b[r][c] = disc(3, f, (r * 8 + c) & 15);
  const mine = b.map(r => r.slice()), theirs = b.map(r => r.slice());
  mine[0][0] = disc(2, BLACK, 2); theirs[0][0] = disc(2, WHITE, 2);
  assert.ok(othelloEvalV14(mine, BLACK, groupOf) > othelloEvalV14(theirs, BLACK, groupOf) + 5);
});

test("v14 沒有棋型表時（setPatternWeights(null)）跟 v13 搜得一模一樣：連線的部分沒動到（含 findWin、行動力的加速）", () => {
  setPatternWeights(null);
  try {
    const rng = mulberry32(7);
    for (let i = 0; i < 25; i++) {
      const { b, turn } = randomGame(rng, 10 + Math.floor(rng() * 30));
      if (!getLegalMoves(b, turn).length) continue;
      const a = searchV13(b, turn, groupOf, { timeMs: 1e9, maxDepth: 3, params: V13_PARAMS });
      const c = searchV14(b, turn, groupOf, { timeMs: 1e9, maxDepth: 3, params: { ...V14_PARAMS, lineScale: V13_PARAMS.lineScale } });
      assert.deepEqual([c.sq, c.group, c.score, c.nodes], [a.sq, a.group, a.score, a.nodes]);
    }
  } finally {
    resetPatternWeights();
  }
});

test("v14：能直接連成五就連；對手下一手就能連成五時去化解", () => {
  // 第 1 組白棋 4 顆排成一列（B1～E1），A1 空著：白下 A1（要合法）就連成五
  const b = createEmptyBoard();
  for (let c = 1; c <= 4; c++) b[0][c] = disc(1, WHITE, c);
  b[1][0] = disc(0, BLACK, 1); b[2][0] = disc(0, WHITE, 2); // 白下 A1 可以翻 A2
  b[3][3] = disc(2, WHITE, 3); b[3][4] = disc(3, BLACK, 3); b[4][3] = disc(3, BLACK, 4); b[4][4] = disc(2, WHITE, 4);
  const r = searchV14(b, WHITE, groupOf, { timeMs: 300 });
  assert.equal(r.sq, 0); assert.equal(r.group, 1); assert.ok(r.score > WIN / 2);
  // 換黑方（黑不能下 A1）：白的威脅一定要化解，黑下完之後白就不能馬上連成五
  const k = searchV14(b, BLACK, groupOf, { timeMs: 300 });
  const m = getLegalMoves(b, BLACK).find((x) => x.r * 8 + x.c === k.sq);
  const after = applyMoveToBoard(b, m, k.group * 16 + 9, BLACK);
  assert.ok(searchV14(after, WHITE, groupOf, { timeMs: 300, maxDepth: 1 }).score < WIN / 2);
});

// ===== 平行分析：把第一步分給好幾份 =====
import { searchEngine } from "../src/ai/ai-service.js";
import { mergeParts, analysisWorkers } from "../src/ai/ai-client.js";

/** 終盤局面（剩 target 格左右，輪到的一方至少有 3 個格子可下） */
function endgamePosition(seed, target) {
  const rng = mulberry32(seed);
  for (let tries = 0; tries < 200; tries++) {
    const { b, turn } = randomGame(rng, 60 - target);
    const empties = b.flat().filter((x) => !x).length;
    if (empties !== target) continue;
    const sq = new Set(getLegalMoves(b, turn).map((m) => m.r * 8 + m.c));
    if (sq.size >= 3) return { b, turn };
  }
  return null;
}
const POOL = [15, 31, 47, 63];
const keyOf = (r) => new Map(r.scores.map((x) => [`${x.sq}:${x.disc}`, x.score]));

test("平行分析：分成幾份（格子不重疊、不漏），各份加起來跟單獨搜尋的每一步分數完全一樣（終盤精確算）", () => {
  let checked = 0;
  for (const seed of [3, 11, 21, 33]) {
    const pos = endgamePosition(seed, 8);
    if (!pos) continue;
    const full = searchEngine(pos.b, pos.turn, POOL, { timeMs: 20000, multiPV: true });
    assert.ok(full.exact);
    for (const k of [2, 3, 4]) {
      const parts = Array.from({ length: k }, (_, i) => searchEngine(pos.b, pos.turn, POOL, { timeMs: 20000, multiPV: true, part: [i, k] }));
      const sqs = parts.map((p) => new Set((p?.scores ?? []).map((x) => x.sq)));
      // 格子不重疊
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) for (const s of sqs[i]) assert.ok(!sqs[j].has(s), `格子 ${s} 在兩份裡`);
      // 加起來一樣
      const merged = mergeParts(parts);
      assert.deepEqual([...keyOf(merged)].sort(), [...keyOf(full)].sort());
      assert.equal(merged.scores[0].score, full.scores[0].score);
      assert.ok(merged.exact);
      checked++;
    }
  }
  assert.ok(checked >= 6, `只測了 ${checked} 組`);
});

test("mergeParts：由高到低排、深度取最淺、節點相加、全部算到底才 exact；全是 null → null；只有一份就照原樣", () => {
  const a = { bestSq: 3, disc: 1, scores: [{ sq: 3, disc: 1, key: 67, score: 0.2 }, { sq: 5, disc: 1, key: 69, score: -0.1 }], depth: 7, exact: true, nodes: 100 };
  const b = { bestSq: 9, disc: 2, scores: [{ sq: 9, disc: 2, key: 137, score: 0.5 }], depth: 6, exact: false, nodes: 50 };
  const m = mergeParts([a, null, b]);
  assert.deepEqual(m.scores.map((x) => x.sq), [9, 3, 5]);
  assert.equal(m.bestSq, 9); assert.equal(m.disc, 2);
  assert.equal(m.depth, 6); assert.equal(m.nodes, 150); assert.equal(m.exact, false);
  assert.equal(mergeParts([null, null]), null);
  assert.equal(mergeParts([null, a]), a);
});

test("分析用幾條 worker：手機與 4 核以下一條，電腦一半的核心、最多 4 條", () => {
  assert.equal(analysisWorkers({ lowPower: true, cores: 16 }), 1);
  assert.equal(analysisWorkers({ cores: 4 }), 1);
  assert.equal(analysisWorkers({ cores: 6 }), 3);
  assert.equal(analysisWorkers({ cores: 8 }), 4);
  assert.equal(analysisWorkers({ cores: 32 }), 4);
});

test("mergeParts：各份算到的深度不同時，統一取每一份都算完的最深一層（已經算出勝負 proven、算到底 exact 的不拖後腿）", () => {
  const mk = (sq, depthScores, extra = {}) => ({
    bestSq: sq, disc: 0, depth: Math.max(...depthScores.map((d) => d[0])), exact: false, nodes: 10,
    scores: [{ sq, disc: 0, key: sq, score: depthScores[depthScores.length - 1][1] }],
    hist: depthScores.map(([depth, score]) => ({ depth, scores: [{ sq, disc: 0, key: sq, score }] })), ...extra
  });
  const a = mk(1, [[5, 0.1], [6, 0.2]]);          // 算到 6 層
  const b = mk(2, [[5, 0.3], [6, 0.35], [7, 0.9]]); // 算到 7 層
  const m = mergeParts([a, b]);
  assert.equal(m.depth, 6);
  assert.deepEqual(m.scores.map((x) => [x.sq, x.score]), [[2, 0.35], [1, 0.2]]); // b 用第 6 層的分數，不是第 7 層的 0.9
  // proven 的那份不比深度：用它自己的最終分數，其他份仍然統一
  const w = { ...mk(3, [[1, 0.999]]), proven: true };
  const m2 = mergeParts([a, b, w]);
  assert.equal(m2.depth, 6);
  assert.deepEqual(m2.scores.map((x) => x.sq), [3, 2, 1]);
  // 沒有 hist（舊格式）：照最終分數合併
  const old = { bestSq: 9, disc: 0, depth: 4, exact: false, nodes: 1, scores: [{ sq: 9, disc: 0, key: 9, score: 0.5 }] };
  assert.equal(mergeParts([old, { ...a, hist: undefined }]).scores.length, 2);
});
