/**
 * 劃區爭霸規則學院：7 課。棋盤、牆塊規則、計票全部用正式的 GameEngine 與 BoardView，教學和實戰一致。
 */

import { GameEngine } from "../src/core/game-engine.js";
import { AIPlayer } from "../src/ai/ai-player.js";
import { canPlaceWall } from "../src/core/rules.js";
import { BoardView } from "../src/ui/board-view.js";
import { ScoreView } from "../src/ui/score-view.js";
import { shapeSvg } from "../src/ui/pool-view.js";
import { makeLessonEngine, keepRedTurn, tallyOf, lessonParties } from "./lesson-engine.js";
import { t } from "./i18n.js";
import { shapeName, fmtNum } from "../src/i18n.js";
import {
  CRACK_MAP, CRACK_PIECES, CRACK_SOLUTION, CUT_MAP, CUT_PIECES, PACK_MAP, PACK_PIECES,
  SANDBOX_MASK, SANDBOX_MAP, SANDBOX_PIECES, SPLIT_MAP, SPLIT_PIECES
} from "./maps.js";

const RED = "#e63946";
const BLUE = "#3a86ff";
const red = (text) => `<b style="color:${RED}">${text}</b>`;
const blue = (text) => `<b style="color:${BLUE}">${text}</b>`;
/** 說明文字裡的 {red}、{blue}（帶顏色的政黨名稱）與 {cr}、{cb}（顏色名稱） */
const P = () => ({ red: red(t("redName")), blue: blue(t("blueName")), cr: red(t("colRed")), cb: blue(t("colBlue")) });

/** 每個選區一句話：「選區 3（4 格，400 票）：紅黨拿下」 */
function describeDistricts(report) {
  return report.districts.map((d) => {
    let what;
    if (d.isVoid) what = t("lineSplit");
    else if (d.winners.length === 1) what = t("lineWin", { who: d.winners[0] === 0 ? red(t("redName")) : blue(t("blueName")) });
    else what = t("lineTie");
    return `<li>${t("line", { id: d.displayId, n: d.cellCount, v: fmtNum(d.electoralVotes), what })}</li>`;
  }).join("");
}

/**
 * 棋盤舞台：計分列 + 棋盤 + 手牌列。回傳控制器。
 * build() 要回傳一個新的教學引擎；onPlaced(engine) 每次落子後呼叫；onHover(cell) 游標移動時呼叫。
 */
function boardStage(ctx, { build, onPlaced, onHover, onPointer }) {
  ctx.stage.innerHTML = `
    <div class="dStage">
      <div class="scoreboard dScore"></div>
      <div class="boardContainer dBoard"></div>
      <div class="dHand" aria-label="${t("handLabel")}"></div>
    </div>`;
  const scoreEl = ctx.stage.querySelector(".dScore");
  const boardEl = ctx.stage.querySelector(".dBoard");
  const handEl = ctx.stage.querySelector(".dHand");
  const score = new ScoreView(scoreEl);
  const state = { engine: null, selected: 0 };
  const board = new BoardView(boardEl, {
    onPlaceWall: (idx, vr, vc) => {
      const res = state.engine.placeWall(idx, vr, vc);
      if (!res.success) return;
      keepRedTurn(state.engine);
      state.selected = 0;
      board.hintMove = null;
      select(0);
      refresh();
      onPlaced?.(state.engine, { idx, vr, vc });
    }
  });

  function select(i) {
    const hand = state.engine.candidatePool;
    state.selected = Math.min(i, Math.max(0, hand.length - 1));
    board.setSelectedPiece(hand.length ? state.selected : null, hand.length ? hand[state.selected].shape : null);
  }

  function renderHand() {
    const e = state.engine;
    const hand = e.candidatePool;
    const left = e.wallBag.length + hand.length;
    handEl.innerHTML = e.isGameOver
      ? `<span class="dHandNote">${t("handEnd")}</span>`
      : `${hand.map((p, i) => `<button type="button" class="dPiece ${i === state.selected ? "on" : ""}" data-i="${i}" title="${shapeName(p.shape.id)}">${shapeSvg(p.shape, RED)}</button>`).join("")}<span class="dHandNote">${t("handLeft", { n: left })}</span>`;
    handEl.querySelectorAll(".dPiece").forEach((btn) => btn.addEventListener("click", () => {
      select(Number(btn.dataset.i));
      renderHand();
    }));
  }

  function refresh() {
    score.render(state.engine, ["human", "human"]);
    board.setInteractive(!state.engine.isGameOver);
    board.render();
    renderHand();
  }

  function load() {
    state.engine = build();
    board.setEngine(state.engine);
    select(0);
    refresh();
  }

  board.svg.addEventListener("pointermove", (e) => {
    // BoardView 自己的 pointermove 先跑，這裡再讀它更新過的游標位置
    onHover?.(board.hoverCell, board.hoverPos, state.engine);
    onPointer?.(e);
  });

  load();
  return { state, board, load, refresh, select };
}

export const lessons = [
  {
    id: "map",
    mount(ctx) {
      const hovered = new Set();
      const stage = boardStage(ctx, {
        build: () => makeLessonEngine({ cells: CRACK_MAP, pieces: [] }),
        onHover(cell, _pos, engine) {
          if (!cell) return;
          const c = engine.map.cells[cell.r][cell.c];
          hovered.add(`${cell.r},${cell.c}`);
          if (c.support[0] >= 90) goals.check("red");
          if (c.support[1] >= 90) goals.check("blue");
          if (hovered.size >= 5) goals.check("explore");
        }
      });
      stage.board.setInteractive(false);
      ctx.setText(t("map.text", P()));
      const goals = ctx.setGoals([
        { id: "explore", text: t("map.goalExplore") },
        { id: "red", text: t("map.goalRed", P()) },
        { id: "blue", text: t("map.goalBlue", P()) }
      ]);
      ctx.feedback(t("map.note"), "info");
    }
  },

  {
    id: "wall",
    mount(ctx) {
      const stage = boardStage(ctx, {
        build: () => makeLessonEngine({ cells: CUT_MAP, pieces: CUT_PIECES }),
        onPlaced(engine) {
          const { red: r, blue: b, report } = tallyOf(engine);
          if (r > 0) goals.check("win");
          ctx.feedback(t("wall.result", { n: report.numDistricts, list: describeDistricts(report), r, b, extra: r > 0 ? t("wall.extra", P()) : "", ...P() }), r > 0 ? "ok" : "warn");
        }
      });
      ctx.setText(t("wall.text", P()));
      const goals = ctx.setGoals([{ id: "win", text: t("wall.goal", P()) }]);
      ctx.actions([{ label: t("retry"), onClick: () => { stage.load(); ctx.feedback(""); } }]);
    }
  },

  {
    id: "rules",
    mount(ctx) {
      let count = 0;
      const seen = new Set();
      const REASONS = {
        EDGE_OVERLAP: "overlap",
        MIDPOINT_SHARED: "shared",
        ON_BORDER: "border",
        MIDPOINT_ON_BORDER: "border"
      };
      const stage = boardStage(ctx, {
        build: () => makeLessonEngine({
          cells: SANDBOX_MAP, mask: SANDBOX_MASK, pieces: SANDBOX_PIECES, rules: { handSize: 3 }
        }),
        onPlaced() {
          count++;
          if (count >= 3) goals.check("place");
          ctx.feedback(count === 1 ? t("rules.placed") : "", "info");
        },
        onHover(_cell, pos, engine) {
          if (!pos || engine.isGameOver) return;
          const shape = engine.candidatePool[stage.state.selected]?.shape;
          if (!shape) return;
          const check = canPlaceWall(engine.boardState, shape, pos.vr, pos.vc);
          if (check.valid) return;
          const key = REASONS[check.reason];
          if (key && !seen.has(key)) {
            seen.add(key);
            goals.check(key);
            const msg = t(`rules.${key}`);
            ctx.feedback(msg, "ok");
          }
        }
      });
      ctx.setText(t("rules.text"));
      const goals = ctx.setGoals([
        { id: "place", text: t("rules.goalPlace") },
        { id: "overlap", text: t("rules.goalOverlap") },
        { id: "shared", text: t("rules.goalShared") },
        { id: "border", text: t("rules.goalBorder") }
      ]);
      ctx.actions([{ label: t("retry"), onClick: () => { stage.load(); count = 0; ctx.feedback(""); } }]);
    }
  },

  {
    id: "packing",
    mount(ctx) {
      const stage = boardStage(ctx, {
        build: () => makeLessonEngine({ cells: PACK_MAP, pieces: PACK_PIECES }),
        onPlaced(engine) {
          const { red: r, blue: b, report } = tallyOf(engine);
          const blueWaste = report.partyStats[1].surplusWastedVotes;
          if (r > b) {
            goals.check("win");
            ctx.feedback(t("packing.ok", { w: blueWaste, list: describeDistricts(report), ...P() }), "ok");
          } else {
            ctx.feedback(t("packing.fail", { r, b, list: describeDistricts(report), ...P() }), "warn");
          }
        }
      });
      ctx.setText(t("packing.text", P()));
      const goals = ctx.setGoals([{ id: "win", text: t("packing.goal", P()) }]);
      ctx.actions([{ label: t("retry"), onClick: () => { stage.load(); ctx.feedback(""); } }]);
    }
  },

  {
    id: "cracking",
    mount(ctx) {
      const stage = boardStage(ctx, {
        build: () => makeLessonEngine({ cells: CRACK_MAP, pieces: CRACK_PIECES }),
        onPlaced(engine) {
          if (!engine.isGameOver) {
            ctx.feedback(t("cracking.first"), "info");
            return;
          }
          const { red: r, blue: b, report } = tallyOf(engine);
          const share = report.partyStats[0].voteShare;
          const surplus = report.partyStats[1].surplusWastedVotes;
          const lost = report.partyStats[1].lostWastedVotes;
          if (r > b) {
            goals.check("win");
            ctx.feedback(t("cracking.ok", { share: share.toFixed(1), r, s: surplus, l: lost, list: describeDistricts(report), ...P() }), "ok");
          } else {
            ctx.feedback(t("cracking.fail", { r, b, ...P() }), "warn");
          }
        }
      });
      ctx.setText(t("cracking.text", P()));
      const goals = ctx.setGoals([{ id: "win", text: t("cracking.goal", P()) }]);
      ctx.actions([
        { label: t("retry"), onClick: () => { stage.board.setHintMove(null); stage.load(); ctx.feedback(""); } },
        {
          label: t("hintBtn"),
          onClick: () => {
            const e = stage.state.engine;
            const done = e.boardState.placedWalls.length;
            const piece = e.candidatePool[0];
            if (!piece || done >= CRACK_SOLUTION.length) { ctx.feedback(t("cracking.used"), "info"); return; }
            const [, vr, vc] = CRACK_SOLUTION[done];
            const matches = e.boardState.placedWalls.every((w, i) => w.vr === CRACK_SOLUTION[i][1] && w.vc === CRACK_SOLUTION[i][2]);
            if (!matches) { ctx.feedback(t("cracking.impossible"), "warn"); return; }
            stage.board.setHintMove({ action: "place", vr, vc, shape: piece.shape, deltaForPlayer: 0 });
            ctx.feedback(t("cracking.hintShown"), "info");
          }
        }
      ]);
    }
  },

  {
    id: "secured",
    mount(ctx) {
      const check = (engine) => {
        const report = engine.getAnalyticsReport();
        if (report.districts.some((d) => d.isVoid)) goals.check("split");
        if (!engine.isGameOver && report.districts.some((d) => d.isSecured && !d.isVoid && d.winners.length === 1)) goals.check("secured");
        return report;
      };
      const stage = boardStage(ctx, {
        build: () => makeLessonEngine({ cells: SPLIT_MAP, pieces: SPLIT_PIECES, rules: { minDistrictSize: 2 } }),
        onPlaced(engine) {
          const report = check(engine);
          const voids = report.districts.filter((d) => d.isVoid).length;
          ctx.feedback(voids ? t("secured.splitNow", { n: voids }) : "", "info");
        }
      });
      ctx.setText(t("secured.text"));
      const goals = ctx.setGoals([
        { id: "split", text: t("secured.goalSplit") },
        { id: "secured", text: t("secured.goalSecured") }
      ]);
      ctx.actions([{ label: t("retry"), onClick: () => { stage.load(); ctx.feedback(""); } }]);
    }
  },

  {
    id: "match",
    mount(ctx) {
      let engine;
      let ai;
      let timer = null;
      ctx.stage.innerHTML = `
        <div class="dStage">
          <div class="scoreboard dScore"></div>
          <div class="boardContainer dBoard"></div>
          <div class="dHand"></div>
        </div>`;
      const scoreEl = ctx.stage.querySelector(".dScore");
      const handEl = ctx.stage.querySelector(".dHand");
      const score = new ScoreView(scoreEl);
      const board = new BoardView(ctx.stage.querySelector(".dBoard"), {
        onPlaceWall: (idx, vr, vc) => {
          if (engine.currentPlayer !== 0) return;
          if (engine.placeWall(idx, vr, vc).success) afterMove();
        }
      });

      function renderHand() {
        if (engine.isGameOver) { handEl.innerHTML = ""; return; }
        const piece = engine.candidatePool[0];
        handEl.innerHTML = `${piece ? `<span class="dPiece on">${shapeSvg(piece.shape, engine.currentPlayer === 0 ? RED : BLUE)}</span>` : ""}
          <span class="dHandNote">${engine.currentPlayer === 0 ? t("match.yourTurn", P()) : t("match.cpuTurn", P())}</span>`;
      }

      function refresh() {
        score.render(engine, ["human", "cpu"]);
        const mine = !engine.isGameOver && engine.currentPlayer === 0;
        board.setInteractive(mine);
        board.setSelectedPiece(mine && engine.candidatePool[0] ? 0 : null, mine && engine.candidatePool[0] ? engine.candidatePool[0].shape : null);
        board.render();
        renderHand();
      }

      function afterMove() {
        refresh();
        if (engine.isGameOver) return finish();
        if (engine.currentPlayer === 1) {
          timer = setTimeout(() => {
            const move = ai.decideMove(engine);
            if (move.action === "place") engine.placeWall(move.poolIndex, move.vr, move.vc);
            else engine.pass();
            afterMove();
          }, 380);
        }
      }

      function finish() {
        const [r, b] = engine.getAnalyticsReport().partyStats.map((p) => p.electoralVotes);
        goals.check("finish");
        const winner = r === b ? t("match.tie") : r > b ? t("match.win", P()) : t("match.lose", P());
        ctx.feedback(t("match.result", { r: Math.round(r), b: Math.round(b), winner, extra: r > b ? "" : t("match.extra"), ...P() }), r > b ? "ok" : "info");
      }

      function newGame() {
        clearTimeout(timer);
        engine = new GameEngine({
          parties: lessonParties(),
          boardSize: 6,
          seed: Math.floor(Math.random() * 100000),
          rules: { minDistrictSize: 2 }
        });
        ai = new AIPlayer(1);
        board.setEngine(engine);
        ctx.feedback("");
        refresh();
      }

      ctx.setText(t("match.text", P()));
      const goals = ctx.setGoals([{ id: "finish", text: t("match.goal") }]);
      ctx.actions([
        {
          label: t("match.pass"),
          onClick: () => {
            if (engine.isGameOver || engine.currentPlayer !== 0) return;
            engine.pass();
            afterMove();
          }
        },
        { label: t("match.again"), onClick: () => newGame() }
      ]);
      newGame();
      return () => clearTimeout(timer);
    }
  }
];

