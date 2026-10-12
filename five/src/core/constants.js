/**
 * ⚖️ 五連黑白棋 (Five-in-a-Row Othello) - 核心常數定義
 * 每顆棋子兩面各有 1～8 的權重，64 顆剛好是 8×8 所有 (白面, 黑面) 組合
 */

export const BOARD_SIZE = 8;
export const N = BOARD_SIZE;

// 與原專案 control-state.js 共用同一組數值
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const FILES = "ABCDEFGH";
export const DISC_COUNT = N * N;

export const DIRS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1]
]);

export const MOVE_TYPE = Object.freeze({
  PLACE: "place",
  PASS: "pass"
});

/** 公開池子的大小：輪到的人從池子挑一顆下，下完從袋子補一顆（實驗見 docs/pool-size-experiment.md） */
// 規則變體（只給實驗用，見 five-rules.js 開頭）：globalThis.FIVE_RULES_VARIANT.pool 可以改池子大小；網頁不設定，就是 4
export const POOL_SIZE = globalThis.FIVE_RULES_VARIANT?.pool ?? 4;
