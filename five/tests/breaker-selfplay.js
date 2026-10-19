/**
 * 破壞者互下：雙方都用黑白棋的方法爭勝、都盡量不讓盤上出現連線（src/ai/breaker.js）。
 * 看在不同規則下，就算兩邊都不想，三、四、甚至五連還會不會冒出來。
 *
 *   node five/tests/breaker-selfplay.js --rule group-free --games 40 --time 300 --seed 1 --out /tmp/x.jsonl
 *
 * --rule
 *   current     現行規則：抽棋、池子 4 顆、每顆兩個文字，有共同文字的五顆同色連成一線獲勝
 *   group-bag   分組：64 顆分成四組（α／β／γ／δ，每組 16 顆），抽棋、池子 4 顆，同一組的五顆同色連成一線獲勝
 *   group-free  分組＋自選組別：沒有棋袋和池子，四組棋擺在棋盤旁，輪到的人自己選要下哪一組（那組下完了就不能選）；
 *               開局四組各一顆擺在中間。同一組的五顆同色連成一線獲勝
 *   group2-free 同上，但只分 2 組（每組 32 顆）；開局每組各兩顆、位置隨機
 * --take-win 1：能直接連成獲勝就連（預設 0：完全不主動連線，只量「躲不掉」的連線）
 * --random-opening N：前 N 手的格子隨機挑（棋或組別仍由破壞者選）。破壞者選格子只看黑白棋、不看棋子，
 *   不加這個的話每一局的黑白棋幾乎一模一樣（同一局一直重複），先手勝率就沒有意義。預設 8
 *
 * 每局輸出一列 JSON：勝方、是否五連結束（誰連成的）、中盤平均的三／四、
 * 「躲不掉」的步數（最好的選擇下完，盤上的連線還是變多）、整局盤上連線分數的最大值，
 * 以及三、四出現的頻率：下完後盤上有三（有四）的手數、新冒出來的三（四）有幾條、整局有沒有出現過三（四）。
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const RULE = args.rule || "group-free";
const VARIANT = { current: { len: 5, match: "symbol", pool: 4 }, "group-bag": { len: 5, match: "group", pool: 4 }, "group-free": { len: 5, match: "group", pool: 4 }, "group2-free": { len: 5, match: "group", groups: 2, pool: 4 } }[RULE];
if (!VARIANT) throw new Error(`沒有這個規則：${RULE}`);
globalThis.FIVE_RULES_VARIANT = VARIANT; // 一定要在載入規則模組之前

const fs = await import("fs");
const { GameEngine } = await import("../src/core/game-engine.js");
const { breakerMove, lineScore } = await import("../src/ai/breaker.js");
const { findThreatGroups, findFive, groupOf } = await import("../src/core/five-rules.js");
const { applyMoveToBoard, getLegalMoves, createInitialBoard, hasLegalMove, isBoardFull } = await import("../src/core/rules.js");
const { BLACK, WHITE } = await import("../src/core/constants.js");
const { mulberry32 } = await import("./helpers.js");

const GAMES = Number(args.games || 20), T = Number(args.time || 300), SEED = Number(args.seed || 1);
const TAKE_WIN = args["take-win"] === "1";
const RANDOM_OPENING = Number(args["random-opening"] ?? 8);
const { breakerDiscFor } = await import("../src/ai/breaker.js");

/** 這一手：開局前 RANDOM_OPENING 手格子隨機，之後交給破壞者 */
function choose(board, me, choices, rng, ply) {
  if (ply < RANDOM_OPENING) {
    const ms = getLegalMoves(board, me);
    const mv = ms[Math.floor(rng() * ms.length)];
    return { sq: mv.r * 8 + mv.c, disc: breakerDiscFor(board, me, mv.r * 8 + mv.c, choices, { rng, takeWin: TAKE_WIN }) };
  }
  return breakerMove(board, me, choices, { timeMs: T, rng, takeWin: TAKE_WIN });
}
const OUT = args.out || `/tmp/breaker-selfplay-${RULE}.jsonl`;
const opp = (t) => (t === BLACK ? WHITE : BLACK);

/** 一局的統計 */
function newStats() { return { mid3: 0, mid4: 0, midN: 0, forced: 0, moves: 0, maxLine: 0, with3: 0, with4: 0, new3: 0, new4: 0 }; }
/** 一組連線的識別：方向＋棋子位置（同一條線多一顆棋就算新的） */
const groupKey = (x) => `${x.kind}:${x.dir}:${x.cells.join(",")}`;
function record(st, before, after) {
  st.moves++;
  const ga = findThreatGroups(after), gb = new Set(findThreatGroups(before).map(groupKey));
  if (ga.some(x => x.kind === 3)) st.with3++;
  if (ga.some(x => x.kind === 4)) st.with4++;
  for (const x of ga) if (!gb.has(groupKey(x))) { if (x.kind === 3) st.new3++; else st.new4++; }
  const ls = lineScore(after);
  if (ls > lineScore(before)) st.forced++;
  st.maxLine = Math.max(st.maxLine, ls);
  const empties = after.flat().filter(x => !x).length;
  if (empties <= 40 && empties > 15) {
    const gs = findThreatGroups(after);
    st.mid3 += gs.filter(x => x.kind === 3).length; st.mid4 += gs.filter(x => x.kind === 4).length; st.midN++;
  }
}
const countDiscs = (b) => { let k = 0, w = 0; for (const row of b) for (const d of row) if (d) d.face === BLACK ? k++ : w++; return { b: k, w }; };

/** 抽棋的規則（current、group-bag）：用遊戲引擎本身（棋袋、池子、PASS、終局都照原本的規則） */
function playBag(g) {
  const rng = mulberry32(SEED * 7919 + g);
  const e = new GameEngine({ rng: mulberry32(SEED * 1000 + g) });
  const st = newStats();
  let fiveBy = null;
  while (!e.gameOver) {
    if (!e.legalMoves().length) { e.passTurn(); continue; }
    const me = e.currentTurn, before = e.board;
    const m = choose(e.board, me, e.pool, rng, st.moves);
    e.executeMove(m.sq >> 3, m.sq & 7, m.disc);
    record(st, before, e.board);
    if (e.settlementData?.byFive) fiveBy = me;
  }
  const s = e.settlementData;
  return { winner: s.winner, byFive: !!s.byFive, fiveBy, ...countDiscs(e.board), ...st };
}

/** 自選組別：沒有棋袋和池子，每一手從還有剩的組別裡選 */
function playFree(g) {
  const rng = mulberry32(SEED * 7919 + g);
  // 每組的棋（id 依 groupOf 分組）；開局四顆：四組時各出一顆，兩組時各出兩顆（位置隨機）
  const G = VARIANT.groups || 4;
  const left = Array.from({ length: G }, () => []);
  for (let id = 0; id < 64; id++) left[groupOf(id)].push(id);
  for (const L of left) for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; }
  const order = Array.from({ length: 4 }, (_, i) => i % G).sort(() => rng() - 0.5);
  let k = 0;
  let board = createInitialBoard(() => left[order[k++]].pop());
  let turn = BLACK, winner = null, byFive = false, fiveBy = null;
  const st = newStats();
  for (;;) {
    if (isBoardFull(board) || (!hasLegalMove(board, turn) && !hasLegalMove(board, opp(turn)))) break;
    if (!hasLegalMove(board, turn)) { turn = opp(turn); continue; } // PASS
    const choices = left.filter(L => L.length).map(L => L[L.length - 1]); // 每組還有剩的代表棋
    const m = choose(board, turn, choices, rng, st.moves);
    const mv = getLegalMoves(board, turn).find(x => x.r * 8 + x.c === m.sq);
    const before = board;
    board = applyMoveToBoard(board, mv, m.disc, turn);
    left[groupOf(m.disc)].pop();
    record(st, before, board);
    if (findFive(board, turn)) { winner = turn; byFive = true; fiveBy = turn; break; }
    turn = opp(turn);
  }
  const c = countDiscs(board);
  if (winner == null) winner = c.b === c.w ? 0 : c.b > c.w ? BLACK : WHITE;
  return { winner, byFive, fiveBy, ...c, ...st };
}

for (let g = 0; g < GAMES; g++) {
  const r = RULE.endsWith("-free") ? playFree(g) : playBag(g);
  const n = r.midN || 1;
  fs.appendFileSync(OUT, JSON.stringify({ rule: RULE, takeWin: TAKE_WIN, g, winner: r.winner, byFive: r.byFive, fiveBy: r.fiveBy, black: r.b, white: r.w, moves: r.moves, forced: r.forced, maxLine: r.maxLine, t3: r.mid3 / n, t4: r.mid4 / n, with3: r.with3, with4: r.with4, new3: r.new3, new4: r.new4 }) + "\n");
}
