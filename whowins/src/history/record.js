/**
 * 棋譜的匯出與匯入（純邏輯，不碰畫面）。
 * 棋譜記下種子、貼目、每一手的點數與走法；匯入時用規則引擎逐手重放並檢查每一步都合法，
 * 所以壞掉的棋譜不會造出非法局面（失敗時回傳錯誤，不動目前的對局）。
 */

import { MOVE_TYPE, BLACK, WHITE, DEFAULT_KOMI } from "../core/constants.js";
import { posToCoord } from "../core/rules.js";
import { GameEngine } from "../core/game-engine.js";

export const RECORD_FORMAT = "who-will-win-record";

const sideName = (t) => (t === BLACK ? "black" : "white");
const rows = (b) => b.map((row) => row.join(""));
const parseCoord = (c) => ({ c: "ABCDEFGH".indexOf(String(c)[0]), r: Number(String(c).slice(1)) - 1 });

/**
 * 目前這條線的棋譜物件。
 * @param {GameEngine} engine
 * @param {object} x 其他資訊：seats、levels、thinkMs、coachMs，與 pctOf(node)、markOf(node)（評價文字）等回呼
 */
export function buildRecord(engine, x = {}) {
  const tree = engine.tree;
  const line = tree.getBranchHistory();
  const moves = [];
  for (let i = 1; i < line.length; i++) {
    const prev = line[i - 1], node = line[i], m = node.move;
    const pct = x.pctOf ? x.pctOf(node) : null;
    moves.push({
      step: node.stepIdx,
      type: m ? m.type : "pass",
      player: sideName(prev.turn),
      free: !!prev.isFreePickTurn,
      die: node.dice,
      actor: node.actor || "unknown",
      cpuLevel: node.cpuLevel ?? null,
      from: m && m.type === MOVE_TYPE.CAPTURE ? posToCoord(m.fromR ?? m.from.r, m.fromC ?? m.from.c) : null,
      to: m ? posToCoord(m.toR ?? m.to.r, m.toC ?? m.to.c) : null,
      before: { turn: sideName(prev.turn), board: rows(prev.board) },
      mark: node.mark?.sym ? { sym: node.mark.sym, why: node.mark.why, text: x.markText ? x.markText(node.mark) : "" } : null,
      luckPct: node.luck != null ? Math.round(node.luck * 1000) / 10 : null,
      lossPct: node.loss != null ? Math.round(node.loss * 1000) / 10 : null,
      blackWinPct: pct == null ? null : Math.round(pct * 10) / 10
    });
  }
  const last = line[line.length - 1];
  const branch = tree.branches.get(tree.activeBranchId);
  const st = last.settlementData;
  return {
    format: RECORD_FORMAT, version: 1,
    rules: "骰子決定步數的增殖黑白棋；每手的點數由種子決定（seed + 步數），自選點數的回合（對手 PASS 後）點數記在 die。",
    exportedAt: new Date().toISOString(),
    seed: tree.seed, komi: engine.komi,
    seats: x.seats ?? null, levels: x.levels ?? null, thinkMs: x.thinkMs ?? null, coachMs: x.coachMs ?? null,
    line: tree.activeBranchId === "main" ? "main" : { branch: tree.activeBranchId, forkStep: branch?.forkStepIdx ?? null },
    start: { board: rows(line[0].board) },
    result: last.gameOver ? {
      winner: st?.winner === BLACK ? "black" : st?.winner === WHITE ? "white" : "draw",
      black: st?.bTotal ?? null, white: st?.wFinal ?? null, margin: st?.margin ?? null
    } : null,
    moves
  };
}

/**
 * 重放棋譜。成功回傳 { engine }（新引擎，對局樹是重放出來的）；失敗回傳 { error: { key, params } }。
 */
export function replayRecord(rec) {
  if (!rec || rec.format !== RECORD_FORMAT || !Array.isArray(rec.moves)) return { error: { key: "importBadFormat", params: {} } };
  const bad = (n) => ({ error: { key: "importBadMove", params: { n } } });
  const seed = Number.isFinite(rec.seed) ? rec.seed >>> 0 : 0;
  const komi = Number.isFinite(rec.komi) ? rec.komi : DEFAULT_KOMI;
  const trial = new GameEngine({ komi, seed });
  let board = null;
  const startRows = rec.start?.board;
  if (Array.isArray(startRows)) {
    if (startRows.length !== 8 || startRows.some((s) => !/^[012]{8}$/.test(String(s)))) return { error: { key: "importBadFormat", params: {} } };
    board = startRows.map((s) => [...String(s)].map(Number));
  }
  trial.resetGame({ seed, board });
  for (const m of rec.moves) {
    const die = Number(m.die);
    if (!(die >= 1 && die <= 6)) return bad(m.step);
    trial.rollDice(die);
    if (m.type === "pass") {
      if (trial.legalMoves().length > 0 || !trial.passTurn()) return bad(m.step);
      continue;
    }
    if (m.type !== "spawn" && m.type !== "capture") return bad(m.step);
    const to = parseCoord(m.to), from = m.from ? parseCoord(m.from) : null;
    const found = trial.legalMoves().find((x) => x.usedDiceVal === die && x.toR === to.r && x.toC === to.c &&
      (m.type === "capture" ? x.type === MOVE_TYPE.CAPTURE && from && x.fromR === from.r && x.fromC === from.c : x.type === MOVE_TYPE.SPAWN));
    if (!found || !trial.executeMove(found)) return bad(m.step);
    const node = trial.tree.getCurrentNode();
    node.actor = m.actor || "unknown";
    if (m.cpuLevel != null) node.cpuLevel = m.cpuLevel;
  }
  return { engine: trial };
}
