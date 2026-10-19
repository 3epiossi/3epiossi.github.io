/**
 * 🎮 骰子黑白棋 (Dice Othello) - 席位控制模型 (Seat Control Model)
 *
 * 單一事實來源：兩個席位，各自由「人類」或「CPU」操作。
 *   seats = { black: "human"|"cpu", white: "human"|"cpu" }
 *
 * 其餘只有兩個修飾旗標：
 *   paused — 凍結「輪到 CPU」的回合，讓使用者觀察或插手
 *   assist — 一次性請 CPU 代下 N 手，代下期間不改變席位歸屬
 *
 * 「CPU 對戰」不是一種模式，而是「兩個席位都設成 CPU」；
 * 「換我下」不是一種模式，而是「把這個席位設回人類」。
 * 因此不存在會與席位互相矛盾的全域旗標。
 */

import { BLACK } from "./constants.js";

export const VIEW = {
  LIVE: "live",     // 進行中的對局最新端點
  REVIEW: "review", // 檢視歷史局面 (唯讀)
  ENDED: "ended"    // 對局已結束 (終局)
};

export const CTRL = {
  HUMAN: "human",   // 人類操作
  CPU: "cpu",       // 電腦思考中 (啟動計時器)
  PAUSED: "paused", // CPU 回合但已被人類暫停
  NONE: "none"      // 非 LIVE 模式 (無操作者)
};

export const HUMAN = "human";
export const CPU_SEAT = "cpu";

/** 回合顏色 (BLACK/WHITE 數值) → seats 的鍵名 */
export function seatKey(turn) {
  return turn === BLACK ? "black" : "white";
}

export function createSession(seats = { black: HUMAN, white: CPU_SEAT }) {
  return {
    seats: {
      black: seats.black === CPU_SEAT ? CPU_SEAT : HUMAN,
      white: seats.white === CPU_SEAT ? CPU_SEAT : HUMAN
    },
    assist: null,
    paused: false
  };
}

/**
 * 純函式：從 Session 與當前遊戲狀態推導 UI 與控制權狀態
 *
 * @returns {Object} { view, ctrl, boardLocked, runCpuTimer, seats, seatOwner,
 *                     isCpuVsCpu, isAssisted, assistLeft }
 */
export function deriveUiState({ session, turn, gameOver, isAtTip, passPending = false }) {
  const seats = session.seats;
  const seatOwner = seats[seatKey(turn)];
  const isCpuVsCpu = seats.black === CPU_SEAT && seats.white === CPU_SEAT;
  const base = { seats, seatOwner, isCpuVsCpu, isAssisted: false, assistLeft: 0 };

  // 1. 若非最新端點，一律進入 REVIEW 模式 (唯讀，強制關閉 CPU)
  if (!isAtTip) {
    return { ...base, view: VIEW.REVIEW, ctrl: CTRL.NONE, boardLocked: true, runCpuTimer: false };
  }

  // 2. 若對局已結束，進入 ENDED 模式
  if (gameOver) {
    return { ...base, view: VIEW.ENDED, ctrl: CTRL.NONE, boardLocked: true, runCpuTimer: false };
  }

  // 3. LIVE：席位歸屬 (或一次性代下) 決定操作者
  const assisted = Boolean(session.assist && session.assist.color === turn && session.assist.left > 0);
  const wantsCpu = assisted || seatOwner === CPU_SEAT;

  let ctrl = CTRL.HUMAN;
  if (wantsCpu) {
    ctrl = session.paused ? CTRL.PAUSED : CTRL.CPU;
  }

  return {
    ...base,
    view: VIEW.LIVE,
    ctrl,
    boardLocked: ctrl !== CTRL.HUMAN || passPending,
    runCpuTimer: ctrl === CTRL.CPU && !passPending,
    isAssisted: assisted,
    assistLeft: assisted ? session.assist.left : 0
  };
}
