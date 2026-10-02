import test from "node:test";
import assert from "node:assert/strict";
import { VIEW, CTRL, HUMAN, CPU_SEAT, seatKey, createSession, deriveUiState } from "../src/core/control-state.js";
import { BLACK, WHITE } from "../src/core/constants.js";

test("seatKey maps turn colour to seat name", () => {
  assert.equal(seatKey(BLACK), "black");
  assert.equal(seatKey(WHITE), "white");
});

test("deriveUiState table-driven tests (seat control model)", () => {
  // 1. 席位 human、無 assist -> LIVE HUMAN
  {
    const session = createSession({ black: HUMAN, white: CPU_SEAT });
    const ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: true });
    assert.equal(ui.view, VIEW.LIVE);
    assert.equal(ui.ctrl, CTRL.HUMAN);
    assert.equal(ui.boardLocked, false);
    assert.equal(ui.runCpuTimer, false);
    assert.equal(ui.seatOwner, HUMAN);
  }

  // 2. 席位 cpu -> LIVE CPU
  {
    const session = createSession({ black: HUMAN, white: CPU_SEAT });
    const ui = deriveUiState({ session, turn: WHITE, gameOver: false, isAtTip: true });
    assert.equal(ui.view, VIEW.LIVE);
    assert.equal(ui.ctrl, CTRL.CPU);
    assert.equal(ui.boardLocked, true);
    assert.equal(ui.runCpuTimer, true);
  }

  // 3. 席位 cpu、paused = true -> LIVE PAUSED
  {
    const session = createSession({ black: HUMAN, white: CPU_SEAT });
    session.paused = true;
    const ui = deriveUiState({ session, turn: WHITE, gameOver: false, isAtTip: true });
    assert.equal(ui.ctrl, CTRL.PAUSED);
    assert.equal(ui.boardLocked, true);
    assert.equal(ui.runCpuTimer, false);
  }

  // 4. 席位 human、assist = { color: 目前, left: 2 } -> LIVE CPU (席位仍是 human)
  {
    const session = createSession({ black: HUMAN, white: CPU_SEAT });
    session.assist = { color: BLACK, left: 2 };
    const ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: true });
    assert.equal(ui.ctrl, CTRL.CPU);
    assert.equal(ui.runCpuTimer, true);
    assert.equal(ui.isAssisted, true);
    assert.equal(ui.assistLeft, 2);
    assert.equal(ui.seatOwner, HUMAN);
  }

  // 5. 席位 human、assist = { color: 對手, left: 2 } -> LIVE HUMAN
  {
    const session = createSession({ black: HUMAN, white: HUMAN });
    session.assist = { color: WHITE, left: 2 };
    const ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: true });
    assert.equal(ui.ctrl, CTRL.HUMAN);
    assert.equal(ui.runCpuTimer, false);
  }

  // 6. 雙方席位皆 cpu -> CPU 對戰，isCpuVsCpu 為真
  {
    const session = createSession({ black: CPU_SEAT, white: CPU_SEAT });
    const ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: true });
    assert.equal(ui.ctrl, CTRL.CPU);
    assert.equal(ui.isCpuVsCpu, true);
  }

  // 7. 任何情況、isAtTip = false -> REVIEW (ctrl = NONE)
  {
    const session = createSession({ black: CPU_SEAT, white: CPU_SEAT });
    const ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: false });
    assert.equal(ui.view, VIEW.REVIEW);
    assert.equal(ui.ctrl, CTRL.NONE);
    assert.equal(ui.boardLocked, true);
    assert.equal(ui.runCpuTimer, false);
  }

  // 8. 任何情況、gameOver = true 且在最新 -> ENDED (ctrl = NONE)
  {
    const session = createSession({ black: HUMAN, white: CPU_SEAT });
    const ui = deriveUiState({ session, turn: BLACK, gameOver: true, isAtTip: true });
    assert.equal(ui.view, VIEW.ENDED);
    assert.equal(ui.ctrl, CTRL.NONE);
    assert.equal(ui.runCpuTimer, false);
  }

  // 9. PASS 動畫進行中不得同時啟動 CPU 計時器
  {
    const session = createSession({ black: CPU_SEAT, white: CPU_SEAT });
    const ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: true, passPending: true });
    assert.equal(ui.ctrl, CTRL.CPU);
    assert.equal(ui.runCpuTimer, false);
  }
});

test("把席位改回 human 後，CPU 不得再接手 (回歸測試：換我下失效)", () => {
  // 使用者情境：設定雙方都是 CPU -> 觀戰 -> 暫停 -> 換我下
  const session = createSession({ black: CPU_SEAT, white: CPU_SEAT });
  session.paused = true;

  let ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: true });
  assert.equal(ui.ctrl, CTRL.PAUSED);

  // 「換我下」＝ 把當前回合的席位設回 human 並解除暫停
  session.seats[seatKey(BLACK)] = HUMAN;
  session.paused = false;

  ui = deriveUiState({ session, turn: BLACK, gameOver: false, isAtTip: true });
  assert.equal(ui.ctrl, CTRL.HUMAN, "換我下之後必須真的輪到人類操作");
  assert.equal(ui.boardLocked, false, "棋盤必須解鎖讓使用者落子");
  assert.equal(ui.runCpuTimer, false, "CPU 計時器不得再啟動");
  assert.equal(session.seats.black, HUMAN);
});
