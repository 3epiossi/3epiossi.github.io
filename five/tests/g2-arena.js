/**
 * 「2 組自選」規則的對戰場：任兩個引擎對打。成對開局：第 2k、2k+1 局用同一個開局（開局四顆與前幾手隨機著法都一樣），
 * 雙方交換顏色，開局本身的好壞互相抵銷（棋類引擎測試的標準做法），同樣局數下雜訊小很多。
 *
 *   node five/tests/g2-arena.js --a v10 --b v9 --games 40 --time 300 --seed 1 --out /tmp/x.jsonl
 *   node five/tests/g2-arena.js --a v10 --b v10 --b-params '{"lineEval":false}' ...   （對照實驗：關掉某個功能）
 *
 * 規則：64 顆棋分兩組（α、β），每一手自己選組別；同色、同一組的五顆連成一線獲勝，否則比棋子數。
 * --rule（勝負規則）
 *   five        五連立刻獲勝，沒人連成就比棋子數（預設）
 *   six         六連才立刻獲勝，沒人連成就比棋子數
 *   count5      連成不會結束，一路下到終局；先比五連數量（每一段連續 5 格同色同組算一個：六連 2 個、七連 3 個），一樣再比棋子數
 *   six-count5  六連立刻獲勝；沒人連成六，就照 count5 比
 * --groups   幾組（預設 2；4 = 每組 16 顆，開局中間四顆每組一顆）。v10 只支援 2 組
 *   four 規則（四連立刻獲勝）配 --groups 4 就是「4 組四連」
 * --supply
 *   shared     共用（預設）：兩組各 32 顆，雙方從同一份拿；開局四顆每組各兩顆、位置隨機
 *   perplayer  各自持有：黑方、白方各有 α、β 各 16 顆，只能用自己的；開局中間四顆是雙方各出一顆 α、一顆 β（位置隨機）
 *              自己某一組用完就只能下另一組；兩組都用完就 PASS
 *
 * 引擎（--a / --b）
 *   v11      v11（src/ai/v11.js）：2 組、六連專用（只能配 --rule six）；--a-params 可以給 {exactEmpties, v9:{…}, v10:{…}}
 *   v13      v13（src/ai/v13.js）：4 組自選連五專用的獨立引擎（--groups 4 --rule five）
 *   v12      v12（src/ai/v12.js）：N 組自選通用（4 組連五、4 組連六）；--a-params 可以給 {deep, v9:{…}}
 *   v10      v10（src/ai/v10.js），--a-params / --b-params 可以改參數（見 V10_PARAMS）
 *   v9line   v9 只看連線和棋子數（黑白棋的位置判斷全關）：懂連線、不太會黑白棋（2 組、4 組都能用）
 *   v9       v9 照這個規則搜尋（numberMask = 組別；池子當成很大，近似「每一組隨時都能選」）
 *   breaker  破壞者（src/ai/breaker.js）：黑白棋選格子、選組別盡量不讓盤上出現連線；能直接連成五就連
 *   builder  對照組：格子跟破壞者一樣（純黑白棋），組別反過來挑「讓自己連線最多」的
 *   randgroup 對照組：格子跟破壞者一樣，組別隨機
 *   gomoku   連線狂：v10 只看連線、不看黑白棋局勢（othelloEval = false），連線戰術（連五、擋四、VCF）跟 v10 一樣
 *
 * 每局輸出一列 JSON（threats：下完後盤上有三／有四的手數、新冒出來的三／四有幾條、總手數）：a 執哪色、勝方（a / b / draw）、是否五連結束、手數、比數、雙方平均搜尋深度與節點數。
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const RULES = {
  five: { winLen: 5 },
  six: { winLen: 6 },
  four: { winLen: 4 },
  // five、six 配 --groups 4 就是 4 組連五、4 組連六
  count5: { winLen: 5, instantWin: false, countFives: true },
  "six-count5": { winLen: 6, countFives: true }
};
const RULE_NAME = args.rule || "five", RULE = RULES[RULE_NAME];
if (!RULE) throw new Error(`沒有這個規則：${RULE_NAME}`);
// 一定要在載入規則模組之前：findFive／破壞者看的連線長度跟著「立刻獲勝」的長度
const G = Number(args.groups || 2); // 幾組（64 顆平均分）
if (64 % G || G < 2) throw new Error(`--groups 要能整除 64：${G}`);
globalThis.FIVE_RULES_VARIANT = { len: RULE.winLen, match: "group", groups: G, pool: 4 };

const fs = await import("fs");
const { findFive, groupOf, findThreatGroups } = await import("../src/core/five-rules.js");
const { applyMoveToBoard, getLegalMoves, createInitialBoard, hasLegalMove, isBoardFull } = await import("../src/core/rules.js");
const { BLACK, WHITE } = await import("../src/core/constants.js");
const { searchV10, V10_PARAMS } = await import("../src/ai/v10.js");
const { searchV11, V11_PARAMS } = await import("../src/ai/v11.js");
const { searchV12, V12_PARAMS } = await import("../src/ai/v12.js");
const { searchV13, V13_PARAMS } = await import("../src/ai/v13.js");
const { searchPoolV9 } = await import("../src/ai/v9.js");
const { breakerMove } = await import("../src/ai/breaker.js");
const { V9_PLAIN_PARAMS } = await import("../src/ai/v9/search.js");
const { mulberry32 } = await import("./helpers.js");

const GAMES = Number(args.games || 20), T = Number(args.time || 300), SEED = Number(args.seed || 1);
const OPENING = Number(args.opening ?? 4);
const OUT = args.out || "/tmp/g2-arena.jsonl";
const PER = args.supply === "perplayer";
const opp = (t) => (t === BLACK ? WHITE : BLACK);

/** 每一段連續 5 格同色同組算一個五連 */
function countFivesOf(board) {
  const fives = { [BLACK]: 0, [WHITE]: 0 };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let face = null, grp = null, ok = true;
    for (let q = 0; q < 5; q++) {
      const d = board[r + q * dr]?.[c + q * dc];
      if (!d) { ok = false; break; }
      if (face == null) { face = d.face; grp = groupOf(d.id); } else if (d.face !== face || groupOf(d.id) !== grp) { ok = false; break; }
    }
    if (ok) fives[face]++;
  }
  return fives;
}
/** sq 周圍 8 格裡，跟 sq 上的棋同色、同組的有幾顆 */
function sameColorNeighbors(board, sq, face) {
  const r = sq >> 3, c = sq & 7, g = groupOf(board[r][c].id);
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const d = (dr || dc) && board[r + dr]?.[c + dc];
    if (d && d.face === face && groupOf(d.id) === g) n++;
  }
  return n;
}

function makePlayer(name, paramsJson) {
  let params = paramsJson ? { ...V10_PARAMS, ...JSON.parse(paramsJson) } : V10_PARAMS;
  const stats = { depth: 0, nodes: 0, ms: 0, n: 0 };
  let fn;
  if (name === "gomoku") params = { ...params, othelloEval: false }; // 連線狂：只看連線
  if (name === "v13") {
    if (G !== 4 || RULE_NAME !== "five" || PER) throw new Error("v13 只用在 4 組、連五、共用（--groups 4 --rule five）");
    const p13 = { ...V13_PARAMS, ...(paramsJson ? JSON.parse(paramsJson) : {}) };
    return { stats, fn: (board, turn, left) => {
      const r = searchV13(board, turn, groupOf, { timeMs: T, params: p13 });
      stats.depth += r.depth; stats.nodes += r.nodes; stats.ms += r.ms; stats.n++;
      return { sq: r.sq, disc: left[r.group][left[r.group].length - 1] };
    } };
  }
  if (name === "v12") {
    const extra = paramsJson ? JSON.parse(paramsJson) : {};
    const p12 = { ...V12_PARAMS, ...extra, v9: { ...V12_PARAMS.v9, ...(extra.v9 || {}) } };
    return { stats, fn: (board, turn, left) => {
      const reps = left.filter(L => L.length).map(L => L[L.length - 1]);
      const r = searchV12(board, turn, reps, { timeMs: T, params: p12 });
      stats.depth += r.depth; stats.n++;
      return { sq: r.sq, disc: r.disc };
    } };
  }
  if (name === "v11") {
    if (G !== 2 || RULE_NAME !== "six") throw new Error("v11 只用在 2 組、六連（--rule six）");
    const extra = paramsJson ? JSON.parse(paramsJson) : {};
    const p11 = { ...V11_PARAMS, ...extra, v10: { ...V11_PARAMS.v10, ...(extra.v10 || {}) }, v9: { ...V11_PARAMS.v9, ...(extra.v9 || {}) } };
    return { stats, fn: (board, turn, left, supply) => {
      const reps = left.filter(L => L.length).map(L => L[L.length - 1]);
      const r = searchV11(board, turn, groupOf, { timeMs: T, params: p11, supply, reps });
      stats.depth += r.depth; stats.n++;
      return { sq: r.sq, disc: left[r.group][left[r.group].length - 1] };
    } };
  }
  if ((name === "v10" || name === "gomoku") && G !== 2) throw new Error("v10 只支援 2 組");
  if (name === "v10" || name === "gomoku") {
    fn = (board, turn, left, supply) => {
      const r = searchV10(board, turn, groupOf, { timeMs: T, params, supply, rule: RULE });
      stats.depth += r.depth; stats.nodes += r.nodes; stats.ms += r.ms; stats.n++;
      return { sq: r.sq, disc: left[r.group][left[r.group].length - 1] };
    };
  } else if (name === "v9" || name === "v9line") {
    // v9line：連線照算，黑白棋的位置判斷全部關掉（只剩棋子數）＝ 懂連線、不太會黑白棋
    const OFF = { mobEarly: 0, mobLate: 0, frontier: 0, corner: 0, xSquare: 0, cSquare: 0, parity: 0, edgeBonus: 0 };
    const p9 = { ...V9_PLAIN_PARAMS, ...(name === "v9line" ? OFF : {}), ...(paramsJson ? JSON.parse(paramsJson) : {}) };
    fn = (board, turn, left) => {
      const choices = left.filter(L => L.length).map(L => L[L.length - 1]);
      const r = searchPoolV9(board, turn, choices, { timeMs: T, poolSize: 64, params: p9 });
      stats.depth += r.depth; stats.nodes += r.nodes || 0; stats.n++;
      return { sq: r.bestSq, disc: r.disc };
    };
  } else if (name === "breaker") {
    fn = (board, turn, left) => {
      const choices = left.filter(L => L.length).map(L => L[L.length - 1]);
      const m = breakerMove(board, turn, choices, { timeMs: T, takeWin: RULE.instantWin !== false });
      stats.n++;
      return m;
    };
  } else if (name === "builder" || name === "randgroup") {
    // 對照組：格子跟破壞者一模一樣（純黑白棋搜尋），只有選組別不同
    //   builder    選讓自己五連最多、再來是周圍同色同組最多的組別（盡量連線）
    //   randgroup  組別隨機
    const OTH = { ...V9_PLAIN_PARAMS, five: false };
    fn = (board, turn, left) => {
      const choices = left.filter(L => L.length).map(L => L[L.length - 1]);
      const r = searchPoolV9(board, turn, [choices[0]], { timeMs: T, params: OTH });
      stats.depth += r.depth; stats.n++;
      if (name === "randgroup") return { sq: r.bestSq, disc: choices[Math.floor(Math.random() * choices.length)] };
      const mv = getLegalMoves(board, turn).find(x => x.r * 8 + x.c === r.bestSq);
      let best = null;
      for (const d of choices) {
        const nb = applyMoveToBoard(board, mv, d, turn);
        if (RULE.instantWin !== false && findFive(nb, turn)) return { sq: r.bestSq, disc: d };
        const key = countFivesOf(nb)[turn] * 100 + sameColorNeighbors(nb, r.bestSq, turn) + Math.random() * 0.5;
        if (!best || key > best.key) best = { disc: d, key };
      }
      return { sq: r.bestSq, disc: best.disc };
    };
  } else throw new Error(`沒有這個引擎：${name}`);
  return { fn, stats };
}

const A = makePlayer(args.a || "v10", args["a-params"]);
const B = makePlayer(args.b || "v9", args["b-params"]);

for (let g = 0; g < GAMES; g++) {
  const rng = mulberry32(SEED * 7919 + (g >> 1)); // 成對開局：兩局用同一個亂數（同一個開局）
  const aColor = g % 2 ? WHITE : BLACK;
  // 庫存：共用 = 兩組各一份；各自持有 = 黑方、白方各一份（α 16 顆、β 16 顆）
  const shuffle = (L) => { for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } return L; };
  const S = 64 / G; // 每組幾顆
  const ids = (g, part) => Array.from({ length: PER ? S / 2 : S }, (_, i) => g * S + (PER ? part * S / 2 : 0) + i);
  const groupsList = Array.from({ length: G }, (_, i) => i);
  const stock = PER
    ? { [BLACK]: groupsList.map(i => shuffle(ids(i, 0))), [WHITE]: groupsList.map(i => shuffle(ids(i, 1))) }
    : (() => { const sh = groupsList.map(i => shuffle(ids(i, 0))); return { [BLACK]: sh, [WHITE]: sh }; })();
  // 開局中間四顆（依 createInitialBoard 的順序：白、黑、黑、白）：共用 = 每組兩顆隨機排；各自持有 = 雙方各出一顆 α、一顆 β
  const faces = [WHITE, BLACK, BLACK, WHITE];
  if (PER && G !== 2) throw new Error("各自持有只做了 2 組");
  // 共用：2 組 = 每組兩顆；4 組 = 每組一顆（位置隨機）
  const initGroups = PER ? (() => { const bw = { [BLACK]: shuffle([0, 1]), [WHITE]: shuffle([0, 1]) }; return faces.map(f => bw[f].pop()); })() : shuffle([0, 1, 2, 3].map(i => i % G));
  let k = 0;
  let board = createInitialBoard(() => { const f = faces[k], g = initGroups[k++]; return stock[f][g].pop(); });
  let turn = BLACK, winner = null, byFive = false, ply = 0;
  const sa = { ...A.stats }, sb = { ...B.stats };
  const canPlay = (t) => hasLegalMove(board, t) && stock[t].some(L => L.length);
  // 「三」「四」的頻率（跟盤面標示一樣，不分黑白、只看同一組：三 = 窗口裡 3 顆同組＋2 格空，四 = 4 顆同組＋1 格空）
  const th = { with3: 0, with4: 0, new3: 0, new4: 0, plies: 0 };
  const tKey = (x) => `${x.kind}:${x.dir}:${[...x.cells].join(",")}`;
  let prevThreats = new Set();
  const trackThreats = () => {
    const gs = findThreatGroups(board), keys = new Set(gs.map(tKey));
    th.plies++;
    if (gs.some(x => x.kind === 3)) th.with3++;
    if (gs.some(x => x.kind === 4)) th.with4++;
    for (const x of gs) if (!prevThreats.has(tKey(x))) x.kind === 3 ? th.new3++ : th.new4++;
    prevThreats = keys;
  };
  const supplyOf = (t) => (PER ? { mine: stock[t].map(L => L.length), theirs: stock[opp(t)].map(L => L.length) } : null);
  for (;;) {
    if (isBoardFull(board) || (!canPlay(turn) && !canPlay(opp(turn)))) break;
    if (!canPlay(turn)) { turn = opp(turn); continue; }
    const left = stock[turn];
    let m;
    if (ply < OPENING) { // 開局隨機：格子和組別都隨機
      const ms = getLegalMoves(board, turn), mv = ms[Math.floor(rng() * ms.length)];
      const gs = left.map((L, i) => (L.length ? i : -1)).filter(i => i >= 0);
      const gg = gs[Math.floor(rng() * gs.length)];
      m = { sq: mv.r * 8 + mv.c, disc: left[gg][left[gg].length - 1] };
    } else m = (turn === aColor ? A : B).fn(board, turn, left, supplyOf(turn));
    const mv = getLegalMoves(board, turn).find(x => x.r * 8 + x.c === m.sq);
    if (!mv) throw new Error(`不合法的一步：${m.sq}`);
    const L = left[groupOf(m.disc)], at = L.indexOf(m.disc);
    if (at < 0) throw new Error(`自己那一組已經沒有這顆棋：${m.disc}`);
    L.splice(at, 1);
    board = applyMoveToBoard(board, mv, m.disc, turn);
    ply++;
    trackThreats();
    if (RULE.instantWin !== false && findFive(board, turn)) { winner = turn; byFive = true; break; }
    turn = opp(turn);
  }
  // 五連計數：每一段連續 5 格同色同組算一個
  const fives = RULE.countFives && !byFive ? countFivesOf(board) : { [BLACK]: 0, [WHITE]: 0 };
  if (fives[BLACK] !== fives[WHITE]) winner = fives[BLACK] > fives[WHITE] ? BLACK : WHITE;
  let b = 0, w = 0;
  for (const row of board) for (const d of row) if (d) d.face === BLACK ? b++ : w++;
  const endedBy = byFive ? "line" : winner != null ? "fives" : "discs";
  if (winner == null) winner = b === w ? 0 : b > w ? BLACK : WHITE;
  const per = (now, before) => (now.n - before.n ? { depth: +((now.depth - before.depth) / (now.n - before.n)).toFixed(2), knps: now.ms - before.ms ? +((now.nodes - before.nodes) / (now.ms - before.ms)).toFixed(1) : null } : null);
  fs.appendFileSync(OUT, JSON.stringify({
    a: args.a || "v10", b: args.b || "v9", rule: RULE_NAME, groups: G, supply: PER ? "perplayer" : "shared", aColor, g, endedBy, fivesBlack: fives[BLACK], fivesWhite: fives[WHITE],
    result: winner === 0 ? "draw" : winner === aColor ? "a" : "b", byFive, ply, black: b, white: w,
    aStats: per(A.stats, sa), bStats: per(B.stats, sb), threats: th
  }) + "\n");
}
