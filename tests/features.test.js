import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/core/game-engine.js";
import { BLACK, WHITE, MOVE_TYPE } from "../src/core/constants.js";
import {
  generateSphericalGradient,
  getPieceBackgroundCss,
  DEFAULT_BLACK_PRESETS
} from "../src/ui/skin-workshop.js";

test("generateSphericalGradient returns rich 3D radial-gradient", () => {
  const gradient = generateSphericalGradient("#2563eb");
  assert.ok(gradient.includes("radial-gradient(circle at 35% 30%"));
  assert.ok(gradient.includes("hsl("));
});

test("getPieceBackgroundCss supports presets, colors, and images", () => {
  // Preset
  const presetCss = getPieceBackgroundCss({
    type: "preset",
    gradient: DEFAULT_BLACK_PRESETS[0].gradient
  }, true);
  assert.equal(presetCss, DEFAULT_BLACK_PRESETS[0].gradient);

  // Custom Color
  const colorCss = getPieceBackgroundCss({
    type: "color",
    color: "#dc2626"
  }, true);
  assert.ok(colorCss.includes("radial-gradient(circle at 35% 30%"));

  // Custom Image with Gloss
  const imgCss = getPieceBackgroundCss({
    type: "image",
    imageData: "data:image/png;base64,test",
    gloss: true
  }, true);
  assert.ok(imgCss.includes('url("data:image/png;base64,test")'));
  assert.ok(imgCss.includes("radial-gradient"));
});

test("getBranchHistory preserves full timeline when previewing past nodes", () => {
  const engine = new GameEngine();
  engine.rollDice(1);
  engine.executeMove({
    from: { r: 7, c: 7 },
    to: { r: 6, c: 7 },
    fromR: 7,
    fromC: 7,
    toR: 6,
    toC: 7,
    type: MOVE_TYPE.SPAWN,
    path: [{ r: 7, c: 7 }, { r: 6, c: 7 }]
  });

  const history1 = engine.tree.getBranchHistory();
  assert.equal(history1.length, 2); // root + move 1

  // Jump back to root (step 0)
  engine.jumpToNode("root_0");

  // History list should STILL have 2 nodes, NOT truncated!
  const history2 = engine.tree.getBranchHistory();
  assert.equal(history2.length, 2);
  assert.equal(engine.tree.currentNodeId, "root_0");

  // Step forward from root should jump to step 1 without throwing ReferenceError
  const successForward = engine.jumpToNode(history2[1].id);
  assert.equal(successForward, true);
  assert.equal(engine.tree.currentNodeId, history2[1].id);
  assert.ok(engine.lastMove);
});

test("jumpToNode works when stepping back from an endgame state", () => {
  const engine = new GameEngine();
  engine.rollDice(1);
  engine.executeMove({
    from: { r: 7, c: 7 },
    to: { r: 6, c: 7 },
    fromR: 7,
    fromC: 7,
    toR: 6,
    toC: 7,
    type: MOVE_TYPE.SPAWN,
    path: [{ r: 7, c: 7 }, { r: 6, c: 7 }]
  });

  // Force endgame settlement
  engine.resolveEndgame("測試終局");
  assert.equal(engine.gameOver, true);

  const curr = engine.tree.getCurrentNode();
  assert.ok(curr.parentId);

  // Jump to parent of endgame node
  const successBack = engine.jumpToNode(curr.parentId);
  assert.equal(successBack, true);
  assert.equal(engine.tree.currentNodeId, curr.parentId);
});

test("rankCandidateMoves with dice = null analyzes across 1~6 rolls", async () => {
  const { rankCandidateMoves } = await import("../src/ai/ai-service.js");
  const engine = new GameEngine();
  // In initial state, diceValue is null
  assert.equal(engine.diceValue, null);

  const candidates = rankCandidateMoves(engine.board, engine.currentTurn, null, "v4", 3);
  assert.ok(candidates.length > 0);
  assert.ok(candidates[0].rankBadge);
  assert.ok(candidates[0].move.usedDiceVal >= 1 && candidates[0].move.usedDiceVal <= 6);
  assert.ok(candidates[0].explanation.summary.includes(`需 ${candidates[0].move.usedDiceVal} 步`));
});

test("Applying a candidate move with usedDiceVal from past state creates branch and sets diceValue", async () => {
  const { rankCandidateMoves } = await import("../src/ai/ai-service.js");
  const engine = new GameEngine();
  // Move 1
  engine.rollDice(1);
  engine.executeMove({
    from: { r: 7, c: 7 },
    to: { r: 6, c: 7 },
    fromR: 7,
    fromC: 7,
    toR: 6,
    toC: 7,
    type: MOVE_TYPE.SPAWN,
    path: [{ r: 7, c: 7 }, { r: 6, c: 7 }]
  });

  // Jump back to root (enters REVIEW mode)
  engine.jumpToNode("root_0");
  // 跳回歷史局面會保留下一步所用的骰點（此例為 1）
  assert.equal(engine.diceValue, 1);

  // In REVIEW mode, executeMove is blocked
  const candidates = rankCandidateMoves(engine.board, engine.currentTurn, null, "v4", 3);
  assert.ok(candidates.length > 0);
  const chosen = candidates[0].move;
  assert.ok(chosen.usedDiceVal != null);
  assert.equal(engine.executeMove(chosen), false);

  // Start from here establishes new branch
  const branched = engine.startFromHere("root_0");
  assert.equal(branched, true);
  assert.notEqual(engine.tree.activeBranchId, "main");
  assert.ok(engine.tree.activeBranchId.startsWith("branch_"));

  // Now executeMove succeeds
  const success = engine.executeMove(chosen);
  assert.equal(success, true);
  assert.equal(engine.lastMove.type, chosen.type);
});


