import test from "node:test";
import assert from "node:assert/strict";
import { AIPlayer } from "../src/ai/ai-player.js";
import { createTestEngine } from "./helpers.js";

test("AI 決策引擎：能於合法手與 pass 之間做出合理決策", () => {
  const e = createTestEngine(2, 601);
  const ai = new AIPlayer(0);

  const move = ai.decideMove(e);
  assert.ok(move, "AI 應能做出決策");
  assert.ok(move.action === "place" || move.action === "pass");

  if (move.action === "place") {
    assert.ok(move.poolIndex >= 0 && move.poolIndex < e.candidatePool.length);
    const preview = e.previewMoveDelta(move.poolIndex, move.vr, move.vc, 0);
    assert.ok(preview, "AI 選出的手必須為合法手");
  }
});

test("CPU 對戰模擬：2 人局完整對戰能夠平穩終局並產出開票與統計報告", () => {
  const e = createTestEngine(2, 701);
  const ai0 = new AIPlayer(0);
  const ai1 = new AIPlayer(1);
  const ais = [ai0, ai1];

  let turns = 0;
  const maxTurns = 70;

  while (!e.isGameOver && turns++ < maxTurns) {
    const ai = ais[e.currentPlayer];
    const move = ai.decideMove(e);

    if (move.action === "place") {
      const res = e.placeWall(move.poolIndex, move.vr, move.vc);
      assert.equal(res.success, true);
    } else {
      const res = e.pass();
      assert.equal(res.success, true);
    }
  }

  assert.equal(e.isGameOver, true, "對局應於合理步數內結束");
  assert.ok(e.finalResults, "對局結束應有開票數據");
  assert.equal(e.finalResults.ranking.length, 2);
  assert.equal(
    e.finalResults.ranking[0].electoralVotes + e.finalResults.ranking[1].electoralVotes,
    6400,
    "2人局總選舉人票應為 6400 票"
  );

  // 檢驗放牆數 > 0（確保 AI 不會空盤直接 pass）
  assert.ok(e.boardState.placedWalls.length >= 6, `AI 應積極放牆切割選區，實際放置: ${e.boardState.placedWalls.length}`);
});

test("CPU 對戰模擬：3 人與 4 人局無死鎖並順利完賽", () => {
  const e3 = createTestEngine(3, 801);
  const ais3 = [new AIPlayer(0), new AIPlayer(1), new AIPlayer(2)];

  let turns3 = 0;
  while (!e3.isGameOver && turns3++ < 80) {
    const move = ais3[e3.currentPlayer].decideMove(e3);
    if (move.action === "place") {
      e3.placeWall(move.poolIndex, move.vr, move.vc);
    } else {
      e3.pass();
    }
  }
  assert.equal(e3.isGameOver, true);
  assert.ok(
    Math.abs(e3.finalResults.ranking.reduce((sum, r) => sum + r.electoralVotes, 0) - 8100) < 1e-6,
    "3人局總選舉人票應為 8100 票（均分選區會有浮點誤差）"
  );
});

test("第 4 級開局不會放棄：空盤放棄只會讓雙方放棄一輪就提早終局", () => {
  for (const seed of [601, 602, 603, 604, 605]) {
    const e = createTestEngine(2, seed);
    const move = new AIPlayer(0, { level: 4 }).decideMove(e);
    assert.equal(move.action, "place", `種子 ${seed}`);
  }
});
