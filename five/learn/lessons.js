/**
 * 五連黑白棋規則學院：8 課。每一課的棋盤都用正式的規則引擎判斷，所以教學和實戰一致。
 */

import { BLACK, WHITE, N } from "../src/core/constants.js";
import { getLegalMoves, posToCoord } from "../src/core/rules.js";
import { FIVE_WINDOWS } from "../src/core/five-rules.js";
import { MiniBoard, GroupPicker, GROUP_COLORS, symbolOf, groupLabel } from "./mini-board.js";
import { t } from "./i18n.js";
import {
  FIVE_POSITIONS, parseBoard, playMove, remainingInGroup, winningMoves, playoutDemo, PASS_DEMO_SEED
} from "./positions.js";

const sym = (g) => `<b style="color:${GROUP_COLORS[g]}">${symbolOf(g)}</b>`;
/** 四組符號：說明文字裡的 {s0}～{s3} */
const S = () => ({ s0: sym(0), s1: sym(1), s2: sym(2), s3: sym(3) });
const who = (player) => (player === BLACK ? t("whoBlack") : t("whoWhite"));
const coord = (r, c) => `<b>${posToCoord(r, c)}</b>`;
const cloneBoard = (b) => b.map((row) => row.map((d) => (d ? { ...d } : null)));

/** 一個可以下棋的教學舞台：棋盤＋組別選擇列。回傳控制器，換局面用 reset(board, player) */
function playStage(ctx, { board, player = BLACK, groups = [0, 1, 2, 3], showHints = true, pickGroup = true, onMove, onIllegal }) {
  const stage = ctx.stage;
  stage.innerHTML = `<div class="playStage"><div class="boardSlot"></div>${pickGroup ? `<div class="pickerWrap"><div class="pickerLabel">${t("pickerLabel")}</div><div class="pickerSlot"></div></div>` : ""}</div>`;
  const state = { board, start: board, player, group: groups[0], over: false, last: null, flips: [] };
  const mb = new MiniBoard(stage.querySelector(".boardSlot"), { onCell: (r, c) => click(r, c) });
  const picker = pickGroup
    ? new GroupPicker(stage.querySelector(".pickerSlot"), { onPick: (g) => { state.group = g; draw(); } })
    : null;

  function counts(b) {
    return [0, 1, 2, 3].map((g) => remainingInGroup(b, g));
  }

  function draw(extra = {}) {
    const hints = showHints && !state.over ? getLegalMoves(state.board, state.player) : [];
    mb.render(state.board, { hints, flips: state.flips, last: state.last, ...extra });
    picker?.set({ selected: state.group, enabled: [0, 1, 2, 3].map((g) => groups.includes(g)), counts: counts(state.board) });
  }

  function click(r, c) {
    if (state.over) return;
    const res = playMove(state.board, r, c, state.group, state.player);
    if (!res) {
      onIllegal?.(r, c, state);
      return;
    }
    state.board = res.board;
    state.flips = res.flips;
    state.last = { r, c };
    const info = { r, c, group: state.group, flips: res.flips, five: res.five, player: state.player, board: res.board };
    if (res.five) state.over = true;
    draw({ glow: res.five ? res.five.cells : [] });
    onMove?.(info, state);
  }

  const api = {
    state,
    mb,
    reset(nextBoard = state.start, nextPlayer = player) {
      state.board = cloneBoard(nextBoard);
      state.player = nextPlayer;
      state.over = false;
      state.last = null;
      state.flips = [];
      draw();
    },
    draw,
    setBoard(b, extra) { state.board = b; draw(extra); }
  };
  state.board = cloneBoard(board);
  draw();
  return api;
}

/** 這一手落子後，下棋的人有沒有「同色的五顆，但不是同一組」 */
function sameColorFiveWithoutGroup(board, player) {
  return FIVE_WINDOWS.some((cells) => cells.every(([y, x]) => board[y][x] && board[y][x].face === player));
}

export const lessons = [
  {
    id: "discs",
    mount(ctx) {
      // 固定排列：每一組 16 顆，顏色交錯
      const rows = [];
      const order = [];
      for (let g = 0; g < 4; g++) for (let k = 0; k < 16; k++) order.push(g);
      let a = 12345;
      for (let i = order.length - 1; i > 0; i--) {
        a = (a * 1103515245 + 12345) & 0x7fffffff;
        const j = a % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (let r = 0; r < N; r++) {
        let row = "";
        for (let c = 0; c < N; c++) row += ((r * 3 + c * 5) % 2 === 0 ? "b" : "w") + order[r * N + c];
        rows.push(row);
      }
      const board = parseBoard(rows);
      const stage = ctx.stage;
      stage.innerHTML = `<div class="playStage"><div class="boardSlot"></div><div class="pickerWrap"><div class="pickerLabel">${t("discs.picker")}</div><div class="pickerSlot"></div></div></div>`;
      const mb = new MiniBoard(stage.querySelector(".boardSlot"));
      let focus = null;
      let flipped = false;
      const shown = () => {
        if (!flipped) return board;
        return board.map((row) => row.map((d) => (d ? { ...d, face: d.face === BLACK ? WHITE : BLACK } : null)));
      };
      const picker = new GroupPicker(stage.querySelector(".pickerSlot"), {
        onPick: (g) => {
          focus = g;
          mb.render(shown(), { focusGroup: focus });
          goals.check("view" + g);
          ctx.feedback(t("discs.info", { sym: sym(g) }), "info");
        }
      });
      picker.set({ selected: -1 });
      mb.render(board);

      ctx.setText(t("discs.text", S()));
      const goals = ctx.setGoals([
        ...[0, 1, 2, 3].map((g) => ({ id: "view" + g, text: t("discs.goalView", { name: groupLabel(g) }) })),
        { id: "flip", text: t("discs.goalFlip") }
      ]);
      ctx.actions([{
        label: t("discs.flipAll"),
        onClick: () => {
          flipped = !flipped;
          mb.render(shown(), { focusGroup: focus });
          goals.check("flip");
          ctx.feedback(t("discs.flipDone"), "ok");
        }
      }]);
    }
  },

  {
    id: "flank",
    mount(ctx) {
      const play = playStage(ctx, {
        board: FIVE_POSITIONS.opening,
        pickGroup: false,
        onMove(info) {
          goals.check("legal");
          const n = info.flips.length;
          ctx.feedback(t("flank.done", { c: coord(info.r, info.c), n }), "ok");
        },
        onIllegal(r, c) {
          const empty = !play.state.board[r][c];
          ctx.feedback(t(empty ? "flank.illegal" : "flank.occupied", { c: coord(r, c) }), "warn");
          if (empty) goals.check("illegal");
        }
      });
      ctx.setText(t("flank.text"));
      const goals = ctx.setGoals([
        { id: "illegal", text: t("flank.goalIllegal") },
        { id: "legal", text: t("flank.goalLegal") }
      ]);
      ctx.actions([{ label: t("retry"), onClick: () => { play.reset(); ctx.feedback(""); } }]);
    }
  },

  {
    id: "group",
    mount(ctx) {
      const play = playStage(ctx, {
        board: FIVE_POSITIONS.openingGroups,
        onMove(info) {
          const used = `${sym(info.group)} <b>${t("gname" + info.group)}</b>`;
          if (info.group === 2) {
            goals.check("pick");
            ctx.feedback(t("group.pickOk", { used, c: coord(info.r, info.c), ...S() }), "ok");
          } else {
            ctx.feedback(t("group.pickOther", { used, ...S() }), "info");
          }
          goals.check("any");
        },
        onIllegal(r, c) { ctx.feedback(t("illegalFlank", { c: posToCoord(r, c) }), "warn"); }
      });
      ctx.setText(t("group.text", S()));
      const goals = ctx.setGoals([
        { id: "any", text: t("group.goalAny") },
        { id: "pick", text: t("group.goalPick", S()) }
      ]);
      ctx.actions([{ label: t("retry"), onClick: () => { play.reset(); ctx.feedback(""); } }]);
    }
  },

  {
    id: "five",
    mount(ctx) {
      const play = playStage(ctx, {
        board: FIVE_POSITIONS.fiveByPlacing,
        onMove(info, state) {
          if (info.five) {
            goals.check("win");
            ctx.feedback(t("five.win", S()), "ok");
            return;
          }
          if (sameColorFiveWithoutGroup(info.board, info.player)) {
            goals.check("wrong");
            ctx.feedback(t("five.wrong", { sg: sym(info.group) }), "warn");
          } else {
            ctx.feedback(t("five.no"), "info");
          }
        },
        onIllegal(r, c) { ctx.feedback(t("illegalFlank", { c: posToCoord(r, c) }), "warn"); }
      });
      ctx.setText(t("five.text", S()));
      const goals = ctx.setGoals([
        { id: "wrong", text: t("five.goalWrong", S()) },
        { id: "win", text: t("five.goalWin") }
      ]);
      ctx.actions([
        { label: t("retry"), onClick: () => { play.reset(); ctx.feedback(""); } },
        { label: t("hintBtn"), onClick: () => ctx.feedback(t("five.hint", { c: coord(3, 3), ...S() }), "info") }
      ]);
    }
  },

  {
    id: "flip5",
    mount(ctx) {
      const play = playStage(ctx, {
        board: FIVE_POSITIONS.fiveByFlipping,
        onMove(info) {
          if (info.five) {
            goals.check("win");
            ctx.feedback(t("flip5.win", { c: coord(info.r, info.c), ...S() }), "ok");
          } else if (info.flips.length >= 2) {
            ctx.feedback(t("flip5.miss", { n: info.flips.length, sg: sym(info.group), ...S() }), "warn");
          } else {
            ctx.feedback(t("flip5.no"), "info");
          }
        },
        onIllegal(r, c) { ctx.feedback(t("illegalFlank", { c: posToCoord(r, c) }), "warn"); }
      });
      ctx.setText(t("flip5.text", S()));
      const goals = ctx.setGoals([{ id: "win", text: t("flip5.goal") }]);
      ctx.actions([
        { label: t("retry"), onClick: () => { play.reset(); ctx.feedback(""); } },
        { label: t("hintBtn"), onClick: () => ctx.feedback(t("flip5.hint", { c: coord(5, 4) }), "info") }
      ]);
    }
  },

  {
    id: "defend",
    mount(ctx) {
      const base = FIVE_POSITIONS.defend;
      const play = playStage(ctx, {
        board: base,
        onMove(info) {
          const wins = winningMoves(info.board, WHITE);
          if (!wins.length) {
            goals.check("block");
            ctx.feedback(t("defend.ok", { c: coord(info.r, info.c), g: coord(2, 4) }), "ok");
          } else {
            const w = wins[0];
            ctx.feedback(t("defend.fail", { sg: sym(w.group), w: coord(w.r, w.c) }), "bad");
          }
        },
        onIllegal(r, c) { ctx.feedback(t("illegalFlank", { c: posToCoord(r, c) }), "warn"); }
      });
      const decorate = () => {
        play.draw({ glow: [[2, 0], [2, 1], [2, 2], [2, 3]] });
        play.mb.mark([[2, 4]], "gap");
      };
      decorate();
      const origReset = play.reset;
      play.reset = (...a) => { origReset(...a); decorate(); };
      ctx.setText(t("defend.text", { gap: coord(2, 4), ...S() }));
      const goals = ctx.setGoals([{ id: "block", text: t("defend.goal") }]);
      ctx.actions([
        { label: t("retry"), onClick: () => { play.reset(); ctx.feedback(""); } },
        { label: t("hintBtn"), onClick: () => ctx.feedback(t("defend.hint", { gap: coord(2, 4) }), "info") }
      ]);
    }
  },

  {
    id: "pass",
    mount(ctx) {
      const demo = playoutDemo(PASS_DEMO_SEED);
      const stage = ctx.stage;
      stage.innerHTML = '<div class="playStage"><div class="boardSlot"></div><div class="quiz"></div></div>';
      const passer = who(demo.passPlayer);
      const other = who(demo.passPlayer === BLACK ? WHITE : BLACK);
      const mb = new MiniBoard(stage.querySelector(".boardSlot"), {
        onCell: (r, c) => {
          if (phase !== "pass") return;
          ctx.feedback(t("pass.click", { c: coord(r, c), who: passer }), "warn");
        }
      });
      const quiz = stage.querySelector(".quiz");
      let phase = "pass";
      mb.render(demo.passBoard);
      const goals = ctx.setGoals([
        { id: "pass", text: t("pass.goalPass", { who: passer }) },
        { id: "count", text: t("pass.goalCount") }
      ]);
      ctx.setText(t("pass.text", { who: passer }));

      const showQuiz = () => {
        quiz.innerHTML = `
          <div class="quizQ">${t("pass.quizQ")}</div>
          <div class="quizBtns"><button type="button" class="btn" data-a="1">${t("pass.blackWins")}</button><button type="button" class="btn" data-a="2">${t("pass.whiteWins")}</button></div>`;
        quiz.querySelectorAll("[data-a]").forEach((btn) => btn.addEventListener("click", () => {
          const ans = Number(btn.dataset.a);
          const s = demo.counts;
          const right = ans === demo.winner;
          goals.check("count");
          mb.render(demo.finalBoard);
          quiz.innerHTML = `<div class="quizQ">${t("pass.final", { b: s.black, w: s.white })}</div>`;
          const winner = who(demo.winner);
          ctx.feedback(right
            ? t("pass.right", { winner, d: Math.abs(s.black - s.white), who: passer })
            : t("pass.wrong", { b: s.black, w: s.white, winner }), right ? "ok" : "warn");
        }));
      };

      ctx.actions([{
        label: t("pass.btn", { who: passer }),
        primary: true,
        onClick: () => {
          if (phase !== "pass") return;
          phase = "count";
          goals.check("pass");
          ctx.feedback(t("pass.passed", { who: passer, other }), "ok");
          showQuiz();
        }
      }]);
    }
  },

  {
    id: "race",
    mount(ctx) {
      const play = playStage(ctx, {
        board: FIVE_POSITIONS.raceToFive,
        onMove(info) {
          if (info.five) {
            goals.check("win");
            ctx.feedback(t("race.win"), "ok");
            return;
          }
          const wins = winningMoves(info.board, WHITE);
          if (wins.length) {
            const w = wins[0];
            ctx.feedback(t("race.lose", { sg: sym(w.group), w: coord(w.r, w.c) }), "bad");
          } else {
            ctx.feedback(t("race.no"), "info");
          }
        },
        onIllegal(r, c) { ctx.feedback(t("illegalFlank", { c: posToCoord(r, c) }), "warn"); }
      });
      const decorate = () => {
        play.draw({ glow: [[2, 0], [2, 1], [2, 2], [2, 3]] });
        play.mb.mark([[2, 4]], "gap");
      };
      decorate();
      const origReset = play.reset;
      play.reset = (...a) => { origReset(...a); decorate(); };
      ctx.setText(t("race.text", { gap: coord(2, 4), ...S() }));
      const goals = ctx.setGoals([{ id: "win", text: t("race.goal") }]);
      ctx.actions([
        { label: t("retry"), onClick: () => { play.reset(); ctx.feedback(""); } },
        { label: t("hintBtn"), onClick: () => ctx.feedback(t("race.hint"), "info") }
      ]);
    }
  }
];
