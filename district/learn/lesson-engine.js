/**
 * 劃區爭霸規則學院：用正式的 GameEngine 搭建教學局面。
 * 每格的票數由教學設計者指定（[紅, 藍]），牆塊也是指定的順序，所以教學與實戰用同一套規則與畫面。
 */

import { GameEngine } from "../src/core/game-engine.js";
import { SHAPE_MAP } from "../src/core/shapes.js";
import { t } from "./i18n.js";

/** 教學用的兩個政黨；名稱跟著目前語言走（課程切換語言時會重新建立） */
export function lessonParties() {
  return [
    { name: t("redName"), color: "#e63946" },
    { name: t("blueName"), color: "#3a86ff" }
  ];
}
export const LESSON_PARTY_COLORS = ["#e63946", "#3a86ff"];

/**
 * @param {Object} o
 * @param {number[][][]} o.cells  每格 [紅, 藍] 的票數；size = cells.length
 * @param {string[]} [o.pieces]   依序抽出的牆塊代號（例如 "I4_V"）；用完就終局
 * @param {boolean[][]|null} [o.mask]  地圖輪廓
 * @param {object} [o.rules]      覆寫規則（教學預設：最小選區不限、手牌 1）
 */
export function makeLessonEngine({ cells, pieces = [], mask = null, rules = {}, parties = lessonParties() }) {
  const size = cells.length;
  const engine = new GameEngine({
    parties,
    boardSize: size,
    mask,
    seed: 1,
    rules: { minDistrictSize: 1, handSize: 1, ...rules }
  });

  let red = 0;
  let blue = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = engine.map.cells[r][c];
      if (cell.active === false) continue;
      const support = [...cells[r][c]];
      const pop = support.reduce((a, b) => a + b, 0);
      Object.assign(cell, { population: pop, electoralVotes: pop, support, trueSupport: support, pollSupport: support });
      red += support[0];
      blue += support[1];
    }
  }
  engine.map.targetTotals = [red, blue];
  engine.map.totalElectoralVotes = red + blue;

  setPieces(engine, pieces);
  return engine;
}

/** 重設牌袋為指定的牆塊順序（第一個先抽出） */
export function setPieces(engine, pieces) {
  let uid = 1;
  engine.wallBag = pieces.map((id) => ({ uid: uid++, shapeId: id, shape: SHAPE_MAP.get(id) })).reverse();
  engine.candidatePool = [];
  engine.discardPile = [];
  engine._refillHand();
  engine._bumpVersion();
}

/** 把 [紅%] 的矩陣轉成每格 100 票的 [紅, 藍] */
export function fromRedPercent(grid) {
  return grid.map((row) => row.map((r) => [r, 100 - r]));
}

/** 教學用：單人操作紅黨，每次落子後輪回紅黨，不讓藍黨插手 */
export function keepRedTurn(engine) {
  if (!engine.isGameOver) engine.currentPlayer = 0;
}

/** 紅藍各拿多少選舉人票（已結算的整局或目前暫定） */
export function tallyOf(engine) {
  const report = engine.getAnalyticsReport();
  const [red, blue] = report.partyStats.map((p) => (engine.isGameOver ? p.electoralVotes : p.provisionalElectoralVotes));
  return { red, blue, report };
}
