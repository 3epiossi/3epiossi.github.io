import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../whowins/src/core/game-engine.js";
import { BLACK, WHITE, MOVE_TYPE } from "../whowins/src/core/constants.js";
import { seededDie, parseSeed, randomSeed } from "../whowins/src/core/dice.js";
import { GameTree } from "../whowins/src/history/game-tree.js";
import { buildRecord, replayRecord, RECORD_FORMAT } from "../whowins/src/history/record.js";
import { generateSphericalGradient, getPieceBackgroundCss, DEFAULT_BLACK_PRESETS } from "../whowins/src/ui/skin-workshop.js";
import { migrateSettings } from "../whowins/src/storage/storage.js";
import { LEVELS, MAX_LEVEL, clampLevel, levelFromAlgo, LEGACY_ALGO_LEVEL, isTimedLevel } from "../whowins/src/engine/levels.js";

// 隨機但可重現的走法：用種子決定骰子，走法取第一個合法步
function play(engine, plies, pick = (moves) => moves[0]) {
  for (let i = 0; i < plies && !engine.gameOver; i++) {
    engine.rollDice();
    const moves = engine.legalMoves();
    if (!moves.length) { engine.passTurn(); continue; }
    engine.executeMove(pick(moves));
  }
}

test("skin helpers keep working", () => {
  assert.ok(generateSphericalGradient("#2563eb").includes("radial-gradient(circle at 35% 30%"));
  assert.equal(getPieceBackgroundCss({ type: "preset", gradient: DEFAULT_BLACK_PRESETS[0].gradient }, true), DEFAULT_BLACK_PRESETS[0].gradient);
  assert.ok(getPieceBackgroundCss({ type: "image", imageData: "data:image/png;base64,test", gloss: true }, true).includes('url("data:image/png;base64,test")'));
});

test("seeded dice: same seed and step give the same die, values are uniform", () => {
  assert.equal(seededDie(123, 5), seededDie(123, 5));
  const counts = Array(7).fill(0);
  for (let s = 0; s < 6000; s++) counts[seededDie(98765, s)]++;
  for (let d = 1; d <= 6; d++) assert.ok(counts[d] > 850 && counts[d] < 1150, `die ${d}: ${counts[d]}`);
  assert.equal(parseSeed(""), null);
  assert.equal(parseSeed("42"), 42);
  assert.equal(parseSeed("hello"), parseSeed("hello"));
  assert.ok(Number.isInteger(randomSeed()));
});

test("engine: initial state, dice from seed, move advances the tree", () => {
  const e = new GameEngine({ seed: 7 });
  assert.equal(e.currentTurn, BLACK);
  assert.equal(e.board[0][0], WHITE);
  assert.equal(e.board[7][7], BLACK);
  e.rollDice();
  assert.equal(e.diceValue, seededDie(7, 0));
  const moves = e.legalMoves();
  assert.ok(moves.length > 0);
  assert.equal(e.executeMove(moves[0]), true);
  assert.equal(e.currentTurn, WHITE);
  assert.equal(e.diceValue, null);
  assert.equal(e.tree.getCurrentNode().stepIdx, 1);
  assert.equal(e.tree.getCurrentNode().dice, seededDie(7, 0));
});

test("engine: same seed and same choices reproduce the same game", () => {
  const a = new GameEngine({ seed: 2024 }), b = new GameEngine({ seed: 2024 });
  play(a, 60); play(b, 60);
  assert.deepEqual(a.board, b.board);
  assert.deepEqual(a.tree.getBranchHistory().map(n => n.dice), b.tree.getBranchHistory().map(n => n.dice));
});

test("PASS gives the opponent a free-pick turn", () => {
  const e = new GameEngine({ seed: 1 });
  // 黑棋只有 H8：擲 6 以外都能生子；用指定點數找一個沒有合法走法的局面，再退而求其次直接 passTurn
  e.rollDice(1);
  e.passTurn();
  assert.equal(e.currentTurn, WHITE);
  assert.equal(e.isFreePickTurn, true);
  assert.equal(e.diceValue, null);
  const node = e.tree.getCurrentNode();
  assert.equal(node.move, null);
  assert.equal(node.dice, 1);
  e.rollDice(3);
  const moves = e.legalMoves();
  assert.ok(moves.every(m => m.usedDiceVal === 3));
});

test("history: jumping back keeps the line and the rolled die; moving there opens a branch", () => {
  const e = new GameEngine({ seed: 11 });
  play(e, 6);
  const line = e.tree.getBranchHistory();
  assert.ok(line.length >= 5);
  e.goToStep(2);
  assert.equal(e.currentTurn, line[2].turn);
  assert.equal(e.diceValue, line[3].dice, "die shown is the one rolled at that step");
  assert.equal(e.tree.getBranchHistory().length, line.length, "line is not truncated");
  assert.equal(e.isAtTip(), false);
  // 下一手跟原本不同 => 開分支
  const moves = e.legalMoves();
  const alt = moves.find(m => !(line[3].move && m.toR === line[3].move.toR && m.toC === line[3].move.toC)) || moves[0];
  assert.equal(e.executeMove(alt), true);
  assert.notEqual(e.tree.activeBranchId, "main");
  assert.equal(e.tree.branches.get(e.tree.activeBranchId).forkStepIdx, 2);
  // 退回分岔點：分支消失、回到主線
  e.goToStep(2);
  assert.equal(e.tree.activeBranchId, "main");
  assert.equal(e.tree.branches.size, 1);
});

test("research mode: choosing a different die at a past step branches, the same die does not", () => {
  const e = new GameEngine({ seed: 5 });
  play(e, 4);
  const line = e.tree.getBranchHistory();
  e.goToStep(1);
  const orig = line[2].dice;
  assert.equal(e.chooseDie(orig), true);
  assert.equal(e.tree.activeBranchId, "main", "same die: no branch");
  const other = orig === 6 ? 5 : orig + 1;
  assert.equal(e.chooseDie(other), true);
  assert.notEqual(e.tree.activeBranchId, "main");
  assert.equal(e.diceValue, other);
  assert.equal(e.isAtTip(), true);
});

test("makeCurrentLatest drops later moves and branches", () => {
  const e = new GameEngine({ seed: 3 });
  play(e, 8);
  e.goToStep(3);
  assert.equal(e.makeCurrentLatest(), true);
  assert.equal(e.tree.getBranchHistory().length, 4);
  assert.equal(e.isAtTip(), true);
  assert.equal(e.tree.branches.size, 1);
});

test("tree JSON round trip keeps boards, dice, seed and branches", () => {
  const e = new GameEngine({ seed: 99 });
  play(e, 10);
  e.goToStep(4);
  const moves = e.legalMoves();
  e.executeMove(moves[moves.length - 1]);
  const json = JSON.parse(JSON.stringify(e.tree.toJSON()));
  const t2 = GameTree.fromJSON(json);
  assert.equal(t2.seed, 99);
  assert.equal(t2.nodes.size, e.tree.nodes.size);
  assert.equal(t2.activeBranchId, e.tree.activeBranchId);
  for (const [id, n] of e.tree.nodes) {
    const m = t2.getNode(id);
    assert.deepEqual(m.board, n.board);
    assert.equal(m.dice, n.dice);
    assert.equal(m.isFreePickTurn, n.isFreePickTurn);
  }
  const e2 = new GameEngine({ seed: 1 });
  e2.restoreTree(json);
  assert.deepEqual(e2.board, e.board);
  assert.equal(e2.seed, 99);
});

test("record export then import reproduces the game (dice, moves, result)", () => {
  const e = new GameEngine({ seed: 31337, komi: 5.5 });
  play(e, 400);
  assert.equal(e.gameOver, true, "game finishes");
  const rec = buildRecord(e, { seats: { black: "cpu", white: "cpu" } });
  assert.equal(rec.format, RECORD_FORMAT);
  assert.equal(rec.seed, 31337);
  assert.equal(rec.komi, 5.5);
  assert.ok(rec.moves.every(m => m.die >= 1 && m.die <= 6));
  const res = replayRecord(JSON.parse(JSON.stringify(rec)));
  assert.ok(res.engine, JSON.stringify(res.error));
  assert.deepEqual(res.engine.board, e.board);
  assert.equal(res.engine.gameOver, true);
  assert.equal(res.engine.settlementData.winner, e.settlementData.winner);
  assert.deepEqual(res.engine.tree.getBranchHistory().map(n => n.dice), e.tree.getBranchHistory().map(n => n.dice));
});

test("record import rejects illegal or malformed records", () => {
  const e = new GameEngine({ seed: 8 });
  play(e, 10);
  const rec = buildRecord(e);
  assert.ok(replayRecord(rec).engine);
  const bad = JSON.parse(JSON.stringify(rec));
  bad.moves[3].to = "A1";
  assert.equal(replayRecord(bad).error.key, "importBadMove");
  assert.equal(replayRecord({ format: "nope" }).error.key, "importBadFormat");
  assert.equal(replayRecord(null).error.key, "importBadFormat");
  const bad2 = JSON.parse(JSON.stringify(rec));
  bad2.moves[0].die = 9;
  assert.equal(replayRecord(bad2).error.key, "importBadMove");
});

test("levels: ladder shape and legacy migration", () => {
  assert.ok(MAX_LEVEL >= 5);
  assert.equal(LEVELS.length, MAX_LEVEL);
  assert.equal(LEVELS[0].kind, "random");
  assert.equal(isTimedLevel(MAX_LEVEL), true);
  assert.equal(isTimedLevel(1), false);
  assert.equal(clampLevel(99), MAX_LEVEL);
  assert.equal(clampLevel(-3), 1);
  for (const algo of ["v1", "v2", "v3", "v4", "v5"]) {
    const lv = levelFromAlgo(algo);
    assert.ok(lv >= 1 && lv <= MAX_LEVEL, algo);
  }
  // 越強的舊演算法對應到不比較弱的新等級
  const order = ["v1", "v2", "v3", "v4", "v5"].map(a => LEGACY_ALGO_LEVEL[a]);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(levelFromAlgo("unknown"), MAX_LEVEL);
});

test("settings migration: old algorithms and cpu speed become levels and pace", () => {
  const s = migrateSettings({ blackAlgo: "v1", whiteAlgo: "v5", cpuSpeed: 1000, theme: "wood", komi: 5.5, blackName: "A" });
  assert.equal(s.blackLevel, levelFromAlgo("v1"));
  assert.equal(s.whiteLevel, levelFromAlgo("v5"));
  assert.equal(s.pace, "slow");
  assert.equal(s.theme, "wood");
  assert.equal(s.komi, 5.5);
  assert.equal(s.blackName, "A");
  for (const k of ["blackAlgo", "whiteAlgo", "cpuSpeed"]) assert.equal(k in s, false);
  const fresh = migrateSettings({});
  assert.equal(fresh.blackLevel, MAX_LEVEL);
  assert.equal(fresh.komi, 3.5);
  assert.equal(migrateSettings({ blackLevel: 99 }).blackLevel, MAX_LEVEL);
  // 已經是新格式就不動
  assert.equal(migrateSettings({ blackLevel: 2, blackAlgo: "v5" }).blackLevel, 2);
});
