import test from "node:test";
import assert from "node:assert/strict";
import { searchV10, WIN, V10_PARAMS } from "../src/ai/v10.js";
import { createEmptyBoard, getLegalMoves, applyMoveToBoard, createInitialBoard } from "../src/core/rules.js";
import { BLACK, WHITE } from "../src/core/constants.js";
import { mulberry32 } from "./helpers.js";

// 2 組自選：id 0～31 是第 0 組、32～63 是第 1 組（測試直接傳 groupOf，不用設定規則變體）
const groupOf = (id) => id >> 5;
const opp = (t) => (t === BLACK ? WHITE : BLACK);
const disc = (g, face, k = 0) => ({ id: g * 32 + k, face });

/** 照規則判斷：face 有沒有同色、同組的五連 */
function hasFive(board, face) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let ok = true, g = null;
      for (let k = 0; k < 5; k++) {
        const y = r + k * dr, x = c + k * dc, d = board[y]?.[x];
        if (!d || d.face !== face) { ok = false; break; }
        const gg = groupOf(d.id);
        if (g == null) g = gg; else if (g !== gg) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

/** 窮舉（照規則一步一步試）：輪到 turn 的分數（棋子數差；連成五 = ±WIN，跟 v10 一樣越快越好） */
function bruteForce(board, turn, rem, ply = 0, passed = false) {
  const moves = getLegalMoves(board, turn);
  if (!moves.length) {
    if (passed || !getLegalMoves(board, opp(turn)).length) {
      let a = 0, b = 0;
      for (const row of board) for (const d of row) if (d) d.face === turn ? a++ : b++;
      return a - b;
    }
    return -bruteForce(board, opp(turn), rem, ply + 1, true);
  }
  let best = -Infinity;
  for (const m of moves) for (let g = 0; g < 2; g++) {
    if (!rem[g]) continue;
    const nb = applyMoveToBoard(board, m, g * 32 + (32 - rem[g]) % 32, turn);
    const nr = [...rem]; nr[g]--;
    const v = hasFive(nb, turn) ? WIN - ply - 1 : -bruteForce(nb, opp(turn), nr, ply + 1, false);
    if (v > best) best = v;
  }
  return best;
}

test("v10：能直接連成五就連（找到那一格和那一組，分數是勝）", () => {
  const b = createEmptyBoard();
  // 第 3 列 A～D：四顆黑、第 1 組；E4 空著，F4 是白（黑下 E4 會夾到… 不需要翻，只要是合法位置）
  for (let c = 0; c < 4; c++) b[3][c] = disc(1, BLACK, c);
  b[3][5] = disc(0, WHITE); b[3][6] = disc(0, BLACK, 5); // 黑下 E4 翻 F4 → 合法
  b[5][5] = disc(0, WHITE, 6); b[6][6] = disc(0, BLACK, 7);
  const r = searchV10(b, BLACK, groupOf, { timeMs: 200 });
  assert.equal(r.sq, 3 * 8 + 4);
  assert.equal(r.group, 1);
  assert.ok(r.score >= WIN - 2);
});

test("v10：對手下一手就要連成五 → 一定擋（下完之後對手不能直接連成五）", () => {
  const rng = mulberry32(3);
  let checked = 0;
  for (let trial = 0; trial < 400 && checked < 6; trial++) {
    // 隨機下到中盤，找「白方下一手能連成五、黑方擋得住」的局面
    let b = createInitialBoard((() => { let k = 0; return () => [0, 32, 1, 33][k++]; })());
    let turn = BLACK, used = [2, 2];
    for (let i = 0; i < 26; i++) {
      const ms = getLegalMoves(b, turn);
      if (!ms.length) { turn = opp(turn); continue; }
      const m = ms[Math.floor(rng() * ms.length)], g = rng() < 0.75 ? 0 : 1;
      b = applyMoveToBoard(b, m, g * 32 + used[g]++ % 32, turn);
      if (hasFive(b, turn)) break;
      turn = opp(turn);
    }
    if (turn !== BLACK || hasFive(b, WHITE) || hasFive(b, BLACK)) continue;
    const whiteWins = (bb) => getLegalMoves(bb, WHITE).some(m => [0, 1].some(g => hasFive(applyMoveToBoard(bb, m, g * 32 + 31, WHITE), WHITE)));
    if (!whiteWins(b)) continue;
    // 黑方要有辦法擋（某一步下完白方就不能直接連成五）
    const blackMoves = getLegalMoves(b, BLACK);
    if (!blackMoves.length) continue;
    const canBlock = blackMoves.some(m => [0, 1].some(g => !whiteWins(applyMoveToBoard(b, m, g * 32 + 30, BLACK))));
    const blackWinsNow = blackMoves.some(m => [0, 1].some(g => hasFive(applyMoveToBoard(b, m, g * 32 + 30, BLACK), BLACK)));
    if (!canBlock || blackWinsNow) continue;
    const r = searchV10(b, BLACK, groupOf, { timeMs: 300 });
    const mv = getLegalMoves(b, BLACK).find(m => m.r * 8 + m.c === r.sq);
    const after = applyMoveToBoard(b, mv, r.group * 32 + 30, BLACK);
    assert.ok(!whiteWins(after), `沒擋住：${JSON.stringify({ sq: r.sq, group: r.group })}`);
    checked++;
  }
  assert.ok(checked >= 3, `找到的測試局面太少：${checked}`);
});

test("v10：終盤精確求解跟窮舉的結果一模一樣（剩 7～9 格，隨機局面）", () => {
  const rng = mulberry32(11);
  let checked = 0;
  for (let trial = 0; trial < 200 && checked < 12; trial++) {
    let b = createInitialBoard((() => { let k = 0; return () => [0, 32, 1, 33][k++]; })());
    let turn = BLACK;
    const rem = [30, 30];
    let over = false;
    const target = 7 + Math.floor(rng() * 3);
    while (b.flat().filter(x => !x).length > target) {
      const ms = getLegalMoves(b, turn);
      if (!ms.length) { if (!getLegalMoves(b, opp(turn)).length) { over = true; break; } turn = opp(turn); continue; }
      const m = ms[Math.floor(rng() * ms.length)];
      let g = rng() < 0.5 ? 0 : 1;
      if (!rem[g]) g = 1 - g;
      b = applyMoveToBoard(b, m, g * 32 + (32 - rem[g]) % 32, turn); rem[g]--;
      if (hasFive(b, turn)) { over = true; break; }
      turn = opp(turn);
    }
    if (over || !getLegalMoves(b, turn).length) continue;
    const truth = bruteForce(b, turn, rem);
    // 死格子合併會固定用剩比較多的那組；窮舉兩組都試。終局分數必須一樣
    for (const deadMerge of [false, true]) {
      const r = searchV10(b, turn, groupOf, { timeMs: 20000, params: { ...V10_PARAMS, deadMerge } });
      assert.ok(r.exact, "應該精確算完");
      const sameOutcome = Math.abs(truth) > WIN / 2 ? Math.sign(r.score) === Math.sign(truth) && Math.abs(r.score) > WIN / 2 : r.score === truth;
      assert.ok(sameOutcome, `deadMerge=${deadMerge}：v10 ${r.score}，窮舉 ${truth}`);
    }
    checked++;
  }
  assert.ok(checked >= 8, `找到的測試局面太少：${checked}`);
});

/** 照規則判斷：face 有沒有同色、同組、連續 len 顆 */
function hasRun(board, face, len) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let ok = true, g = null;
      for (let k = 0; k < len; k++) {
        const d = board[r + k * dr]?.[c + k * dc];
        if (!d || d.face !== face) { ok = false; break; }
        const gg = groupOf(d.id);
        if (g == null) g = gg; else if (g !== gg) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}
/** face 的五連數量：每一段連續 5 格同色同組算一個（六連 2 個、七連 3 個） */
function countFives(board, face) {
  let n = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let ok = true, g = null;
      for (let k = 0; k < 5; k++) {
        const d = board[r + k * dr]?.[c + k * dc];
        if (!d || d.face !== face) { ok = false; break; }
        const gg = groupOf(d.id);
        if (g == null) g = gg; else if (g !== gg) { ok = false; break; }
      }
      if (ok) n++;
    }
  }
  return n;
}
/** 窮舉，照指定的勝負規則 */
function bruteRule(board, turn, rem, rule, ply = 0, passed = false) {
  const moves = getLegalMoves(board, turn);
  if (!moves.length) {
    if (passed || !getLegalMoves(board, opp(turn)).length) {
      let a = 0, b = 0;
      for (const row of board) for (const d of row) if (d) d.face === turn ? a++ : b++;
      return a - b + (rule.countFives ? 65 * (countFives(board, turn) - countFives(board, opp(turn))) : 0);
    }
    return -bruteRule(board, opp(turn), rem, rule, ply + 1, true);
  }
  let best = -Infinity;
  for (const m of moves) for (let g = 0; g < 2; g++) {
    if (!rem[g]) continue;
    const nb = applyMoveToBoard(board, m, g * 32 + (32 - rem[g]) % 32, turn);
    const nr = [...rem]; nr[g]--;
    const v = rule.instantWin !== false && hasRun(nb, turn, rule.winLen ?? 5) ? WIN - ply - 1 : -bruteRule(nb, opp(turn), nr, rule, ply + 1, false);
    if (v > best) best = v;
  }
  return best;
}

test("v10：其他勝負規則（六連獲勝、五連計數、兩者合併）的終盤精確求解也跟窮舉一模一樣", () => {
  const rules = [{ winLen: 6 }, { instantWin: false, countFives: true }, { winLen: 6, countFives: true }];
  for (const rule of rules) {
    const rng = mulberry32(21);
    let checked = 0;
    for (let trial = 0; trial < 300 && checked < 8; trial++) {
      let b = createInitialBoard((() => { let k = 0; return () => [0, 32, 1, 33][k++]; })());
      let turn = BLACK, over = false;
      const rem = [30, 30];
      const target = 7 + Math.floor(rng() * 2);
      while (b.flat().filter(x => !x).length > target) {
        const ms = getLegalMoves(b, turn);
        if (!ms.length) { if (!getLegalMoves(b, opp(turn)).length) { over = true; break; } turn = opp(turn); continue; }
        const m = ms[Math.floor(rng() * ms.length)];
        let g = rng() < 0.6 ? 0 : 1; // 偏向同一組，讓五連、六連比較常出現
        if (!rem[g]) g = 1 - g;
        b = applyMoveToBoard(b, m, g * 32 + (32 - rem[g]) % 32, turn); rem[g]--;
        if (rule.instantWin !== false && hasRun(b, turn, rule.winLen ?? 5)) { over = true; break; }
        turn = opp(turn);
      }
      if (over || !getLegalMoves(b, turn).length) continue;
      const truth = bruteRule(b, turn, rem, rule);
      const r = searchV10(b, turn, groupOf, { timeMs: 20000, rule, params: { ...V10_PARAMS, deadMerge: false } });
      assert.ok(r.exact, "應該精確算完");
      const same = Math.abs(truth) > WIN / 2 ? Math.sign(r.score) === Math.sign(truth) && Math.abs(r.score) > WIN / 2 : r.score === truth;
      assert.ok(same, `${JSON.stringify(rule)}：v10 ${r.score}，窮舉 ${truth}`);
      checked++;
    }
    assert.ok(checked >= 5, `${JSON.stringify(rule)} 找到的測試局面太少：${checked}`);
  }
});
