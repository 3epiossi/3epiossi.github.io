/**
 * 🏅 走法評價：一步棋值得標記，是因為它帶來了「資訊」——
 *   1. 對勝負的影響：改變了局勢（拉鋸變底定、優勢變劣勢、在優劣之間擺盪）。勝負已定時下什麼都沒資訊。
 *   2. 對人的意外程度：很明顯的一步沒有資訊；看起來是壞棋卻是唯一正解，資訊最多。
 *
 * 勝率一律用勝率條上的勝率（校準、放大過的，由呼叫端傳 toProb 進來），下棋者角度，分五級：
 *   勝定 ≥ 90%、優勢 65～90%、拉鋸 35～65%、劣勢 10～35%、敗定 ≤ 10%
 *   這步的等級 = 下完的勝率；局面的等級 = 最佳步下完的勝率；格子的等級 = 那格配最好的那一組。
 *
 * 判斷順序（符合就停）：
 *   不標：只有一個格子可下；直接連成五（勝負已確定）；
 *         勝負已定（最佳步與這步都在勝定、或都在敗定）時不標失誤類與設陷阱
 *         （好手類照常判斷：它要求其他格子都比這步低一級，「只有這步能拿到勝定」代表勝負其實還沒定）
 *   失誤類（跟最佳步比，損失至少 5%）：
 *     ??  掉兩級以上        ?  掉一級        ?!  等級沒變但損失 ≥ 8%
 *   好手類（!! ! !?）只在勝負難料時才標。看「原本的局勢」＝對手下上一步之前，這一方的勝率：
 *     原本已經勝定（≥ 90%）→ 不標（守住或兌現本來就贏的局面，沒有資訊）
 *     原本已經敗定（≤ 10%）→ 只有起死回生才標：這步把局勢拉到拉鋸以上，而且是關鍵一手
 *     終盤（剩 7 格以內，引擎已經算到底）→ 只有逆轉才標：原本劣勢或敗定，對手翻車，這步拉到拉鋸以上
 *   失誤類：原本勝定、這步翻車掉下來，照常標；原本敗定、對手的錯也沒給到拉鋸以上的機會 → 不標（從頭到尾都是輸棋）
 *   好手類（下在最好的格子、選的組別跟最佳步一樣好）：
 *     關鍵一手 = 其他每個格子都比這步至少低一級，而且最接近的那格也差 10% 以上
 *       擋住對手下一手的五連 → 不標（棋盤上已經畫出連線，很明顯）
 *       再看多難找（difficultyOf，0～4 分：只看盤面看不出來、盤面有威脅、選哪組有差、可下格子 7 個以上）
 *         不到 2 分 → 不標（很好找）
 *         3 分以上，而且其他每個格子都差 20% 以上（只有這一步是好棋），而且不是對手上一步讓出 10% 以上之後 → !!
 *         對手上一步讓出 10% 以上（這步在懲罰對手的失誤）→ 只看盤面看不出來、而且選哪組有差，兩項都成立才標 !
 *         （原因：抓住對手的失誤），不會是 !!
 *         其他 → !
 *   !?  設陷阱：損失 < 5%，下完後對手三分之二以上的格子（至少 3 格）會讓局勢倒向你（對手掉兩級以上）；
 *       下完後自己下一手就能連成五（對手只能擋）不算
 *       （對手的最佳步是直接連成五時不算：那是對手自己的機會，不是陷阱）
 *
 * 數值是舊規則（抽棋、v8）時校準的：3／5／6／7 級互下 80 局 3573 步，每 100 步 !! 0.7、! 1.3、!? 1.0、?! 2.1、? 3.8、?? 0.7。
 * 4 組自選（v13）重新量（tests/mark-freq.js，3～6 級互下 160 局 4921 步）：原本的門檻下 !! 2.6、! 3.3、!? 3.7（好手類多了 2.5～4 倍，
 * !! 有 63% 出現在對手上一步讓出 10% 以上之後），所以加了 PUNISH_GAP、THREAT_LINES、提高 TRAP_SHARE、排除「下完自己就能連成五」的陷阱。
 * 調整後：!! 0.9、! 3.5（其中 1.3 是抓住對手的失誤，要「看不出來」和「選哪組有差」都成立）、!? 1.2、?! 2.2、? 3.2、?? 0.6。
 * 3 級幾乎只拿到失誤類，7 級幾乎都是好手類。
 * !! 的條件原本是「其他格子都低兩級」，60 局樣本裡幾乎不出現（0.26／100 步），而且跟 ! 看不出差別（找到率 54% 對 57%）。
 * 改成「其他每格差 20% 以上」後：弱的一方（3、5 級）只找到 17%（! 是 50%），強的一方（6、7 級）仍找到 77%，
 * 找到的人最後得分 80%、沒找到的 37%——強的找得到、弱的漏掉、漏掉代價大，才配叫 !!。
 */

import { flipsFor, getLegalMoves, posToCoord } from "../core/rules.js";
import { completesFive, findThreatGroups, groupOf, GROUPS } from "../core/five-rules.js";
import { othelloEvalV13 } from "./v13.js";

export const LEVEL_EDGES = [0.1, 0.35, 0.65, 0.9]; // 敗定｜劣勢｜拉鋸｜優勢｜勝定
/** 勝率 → 等級 0（敗定）～4（勝定） */
export const levelOf = (p) => (p >= 0.9 ? 4 : p >= 0.65 ? 3 : p >= 0.35 ? 2 : p > 0.1 ? 1 : 0);
export const WON = 4, LOST = 0;
export const MIN_LOSS = 0.05;      // 失誤類最少要損失這麼多（避免剛好卡在等級邊界的小差距）
export const DUBIOUS_LOSS = 0.08;  // 等級沒變時，損失這麼多才標 ?!
export const BEST_EPS = 0.01;      // 跟最佳步差這麼多以內，算下了最佳步
export const KEY_GAP = 0.10;       // 關鍵一手：最接近的格子至少差這麼多
export const ENDGAME = 7;          // 剩這麼多格以內：不標好手類
export const TRAP_SHARE = 2 / 3;   // 設陷阱：對手至少這個比例的格子會讓局勢倒向你
export const TRAP_MIN = 3;         //         而且至少這麼多格
export const PUNISH_GAP = 0.10;    // 對手上一步讓出這麼多勝率以上 → 這步是在懲罰對手的失誤，最多標 !
export const THREAT_LINES = 3;     // 難度的「盤面有威脅」：要有「四」，或至少這麼多條連線威脅（三或四）
export const KEY_DIFFICULTY = 2;       // 關鍵一手至少要有這麼多難度才標 !（見 difficultyOf；1 分幾乎擋不到東西，大部分局面都有一項）
export const BRILLIANT_DIFFICULTY = 3; // !! 要這麼多難度
export const BRILLIANT_GAP = 0.20;    // !! 其他每個格子都要差這麼多以上（只有這一步是好棋）

const CORNERS = [0, 7, 56, 63];
const X_CORNER = { 9: 0, 14: 7, 49: 56, 54: 63 };
const SYMBOLS = Array.from({ length: GROUPS }, (_, g) => g + 1); // 組別 1～4
const opp = (t) => 3 - t;
const coord = (sq) => posToCoord(sq >> 3, sq & 7);
const emptiesOf = (board) => board.reduce((n, row) => n + row.filter((d) => !d).length, 0);

/** 下在 sq 之後的棋盤（只看翻面與顏色；下的那顆棋的組別不影響盤面評估） */
function boardAfter(board, sq, turn, id = 0) {
  const r = sq >> 3, c = sq & 7;
  const nb = board.map((row) => row.map((d) => d && { ...d }));
  for (const [fr, fc] of flipsFor(board, r, c, turn)) nb[fr][fc].face = turn;
  nb[r][c] = { id, face: turn };
  return nb;
}

const cornersOpenTo = (board, t) => new Set(getLegalMoves(board, t).map((m) => m.r * 8 + m.c).filter((s) => CORNERS.includes(s)));
/** 下完之後，對手多了可以下的角 */
const givesCorner = (board, nb, turn) => {
  const before = cornersOpenTo(board, opp(turn));
  return [...cornersOpenTo(nb, opp(turn))].some((s) => !before.has(s));
};
/** 這一步直接連成五（下的那顆棋的組別） */
const makesFive = (board, sq, discId, turn) => completesFive(board, sq, groupOf(discId) + 1, turn);
/** 下完之後，對手下一手有地方可以直接連成五（不看那一組還有沒有剩） */
const allowsFive = (nb, turn) => {
  for (let s = 0; s < 64; s++) {
    if (nb[s >> 3][s & 7]) continue;
    if (SYMBOLS.some((v) => completesFive(nb, s, v, opp(turn)))) return true;
  }
  return false;
};

/** 每個走法與每個格子的勝率（格子取最好的那一組） */
function probsOf(scores, toProb, empties) {
  const P = (s) => (s >= 0.999 ? 1 : s <= -0.999 ? 0 : toProb(s, empties));
  const moves = scores.map((x) => ({ key: x.sq, sq: x.sq & 63, p: P(x.score) }));
  const bySq = new Map();
  for (const m of moves) if (!bySq.has(m.sq) || m.p > bySq.get(m.sq).p) bySq.set(m.sq, m);
  const squares = [...bySq.values()].sort((a, b) => b.p - a.p);
  return { moves, squares, best: squares.length ? squares[0] : null };
}

/**
 * @param {object} o
 * @param {{sq:number, score:number}[]} o.scores 上一個局面每個走法的引擎分數（sq = 棋 × 64 + 格）
 * @param {number} o.played 實際下的走法（棋 × 64 + 格）
 * @param {object[][]} o.board 下這步之前的棋盤
 * @param {number} o.turn 下這步的一方
 * @param {(score:number, empties:number) => number} o.toProb 分數 → 勝率條上的勝率
 * @param {{scores:{sq:number,score:number}[]}|null} [o.next] 下完之後（輪到對手）的分析，判斷「設陷阱」用；沒有就不判斷
 * @param {number|null} [o.prevP] 對手下上一步之前，這一方的勝率（勝率條上的勝率）；判斷終盤「逆轉」用
 * @returns {{ sym: string|null, why: {key:string, p:object}|null, loss:number, best:number, played:number } | null}
 */
export function classifyMove({ scores, played, board, turn, toProb, next = null, prevP = null }) {
  const empties = emptiesOf(board);
  const { moves, squares, best } = probsOf(scores, toProb, empties);
  const mine = moves.find((m) => m.key === played);
  if (!mine || !best) return null;
  const loss = best.p - mine.p, Lb = levelOf(best.p), Lm = levelOf(mine.p);
  const res = (sym, why = null) => ({ sym, why, loss, best: best.p, played: mine.p });
  const sq = played & 63, discId = played >> 6;

  if (squares.length <= 1) return res(null);
  if (makesFive(board, sq, discId, turn)) return res(null);
  // 勝負已定：最佳步與這步都在勝定（或都在敗定）。失誤類與設陷阱不標；
  // 好手類不受影響——它本來就要求其他格子比這步低一級，「只有這步能拿到勝定」代表勝負其實還沒定
  const decided = (Lb === WON && Lm === WON) || (Lb === LOST && Lm === LOST);
  // 原本的局勢：對手下上一步之前，這一方的勝率（不知道就用這個局面的最佳步）
  const before = prevP ?? best.p;
  // 原本就輸定、對手的錯也沒給到拉鋸以上的機會：從頭到尾都是輸棋，失誤也沒有資訊
  const hopeless = levelOf(before) === LOST && Lb <= 1;

  const nb = boardAfter(board, sq, turn, discId);

  // 失誤類：跟最佳步比，局勢掉了幾級
  if (!decided && !hopeless && loss >= MIN_LOSS) {
    const drop = Lb - Lm;
    if (drop >= 1 || loss >= DUBIOUS_LOSS) {
      // 最佳步：格子＋組別（存那一組的棋，顯示時才換成目前的棋子文字）
      const at = coord(best.sq), disc = best.key >> 6;
      let why;
      if (best.p >= 0.999 && makesFive(board, best.sq, disc, turn)) why = { key: "whyMissedFive", p: { at, disc } };
      // 下在最好的那一格、只是組別選錯：講清楚是組別的問題（提示格子上的數字是「這格配最好那一組」的勝率，不然看起來像是下對了還被標）
      else if (best.sq === sq) why = { key: "whyWrongGroup", p: { grp: disc, a: Math.round(100 * best.p), b: Math.round(100 * mine.p) } };
      else if (allowsFive(nb, turn)) why = { key: "whyAllowsFive", p: { at, disc } };
      else if (givesCorner(board, nb, turn)) why = { key: "whyGivesCorner", p: { at, disc } };
      else if (drop >= 1) why = { key: "whyDrop", p: { from: Lb, to: Lm, at, disc } };
      else why = { key: "whyLoose", p: { lvl: Lb, n: Math.round(loss * 100), at, disc } };
      return res(drop >= 2 ? "??" : drop === 1 ? "?" : "?!", why);
    }
  }

  // 好手類（!! ! !?）只在「勝負難料」時才有資訊。原本的局勢 = 對手下上一步之前，這一方的勝率（不知道就用這個局面的最佳步）：
  //   原本已經勝定 → 守住或兌現本來就贏的局面，不標
  //   原本已經敗定 → 只有起死回生（這步把局勢拉到拉鋸以上）才標
  //   終盤（引擎已經算到底）→ 只有對手翻車、這步把握機會逆轉（原本劣勢或敗定 → 拉鋸以上）才標
  const comeback = levelOf(before) <= (empties <= ENDGAME ? 1 : 0) && Lm >= 2;
  if (levelOf(before) === WON) return res(null);
  if ((levelOf(before) === LOST || empties <= ENDGAME) && !comeback) return res(null);

  // 好手類：關鍵一手
  if (loss < BEST_EPS && squares[0].sq === sq) {
    const others = squares.slice(1);
    const key = others.every((o) => levelOf(o.p) <= Lm - 1) && squares[0].p - others[0].p >= KEY_GAP;
    if (key) {
      const o = opp(turn);
      // 擋住對手的五連：棋盤上已經畫出連線，對人來說很明顯
      if (SYMBOLS.some((v) => completesFive(board, sq, v, o))) return res(null);
      const corner = givesCorner(board, nb, turn);
      const xc = X_CORNER[sq];
      const xSquare = xc != null && !board[xc >> 3][xc & 7];
      const d = difficultyOf({ board, turn, sq, squares, moves });
      // 對手上一步讓出 10% 以上：這步是在懲罰對手的失誤，局面是對手送的，最多標 !（4 組自選的連線很兇，
      // 對手一走錯常常只剩一步能抓住機會，原本有 63% 的 !! 是這種）
      const punish = prevP != null && best.p - prevP >= PUNISH_GAP;
      const clear = squares[0].p - others[0].p >= BRILLIANT_GAP && !punish; // 其他格子都差 20% 以上
      if (comeback) {
        return res(clear && d.score >= BRILLIANT_DIFFICULTY ? "!!" : "!", { key: "whyComeback", p: { from: levelOf(prevP), to: Lm } });
      }
      // 很好找的關鍵一手（一個難度都沒有，例如佔角、選擇很少、盤面一看就知道）不標
      if (d.score < KEY_DIFFICULTY) return res(null);
      if (clear && d.score >= BRILLIANT_DIFFICULTY) {
        return res("!!", { key: corner ? "whyBrilliantCorner" : xSquare ? "whyBrilliantX" : d.hidden ? "whyBrilliantQuiet" : "whyBrilliantHard", p: { to: Lm } });
      }
      const four = completesFourFor(nb, sq, turn);
      // 抓住對手的失誤：局面是對手送的，要真的不好找才標 !——只看盤面看不出來、而且選哪組有差，兩項都成立
      //（難度的另外兩項「盤面有威脅」「可下格子 7 個以上」在 4 組自選幾乎每步都成立，分不出難易）
      if (punish) return d.hidden && d.discMatters ? res("!", { key: "whyPunish", p: { from: levelOf(prevP), to: Lm } }) : res(null);
      return res("!", { key: four ? "whyOnlyFour" : "whyOnly", p: { from: levelOf(others[0].p), to: Lm } });
    }
  }

  // !?：設陷阱（終盤不標）。下完後自己下一手就能連成五 → 對手只能擋，不擋的格子當然都輸，那不是陷阱
  if (!decided && !comeback && loss < MIN_LOSS && next?.scores?.length && !allowsFive(nb, opp(turn))) {
    const op = probsOf(next.scores, toProb, emptiesOf(nb));
    if (op.best && op.best.p < 0.999 && op.squares.length >= 4) {
      const L0 = levelOf(op.best.p);
      const bad = op.squares.filter((s) => levelOf(s.p) <= L0 - 2).length;
      if (bad >= TRAP_MIN && bad / op.squares.length >= TRAP_SHARE) {
        return res("!?", { key: "whyTrap", p: { n: op.squares.length, k: bad } });
      }
    }
  }
  return res(null);
}

/**
 * 這一步有多難找（0～4 分，每項 1 分）。用 3／5 級 CPU 的失誤驗證過：在「好選擇數量」相同的局面裡，
 * 每一項成立時失誤率都明顯比較高（72 局 2100 個局面；例如最佳步看不出來 21% → 39%、盤面有三條以上威脅 21% → 38%）。
 *   hidden：只看盤面（v13 的黑白棋靜態評估，不往下算），這一格不在所有可下格子的前 20%
 *   threats：盤面上有「四」，或至少 THREAT_LINES 條連線威脅（4 組自選幾乎每個局面都有三，只要有就算的話等於白送一分）
 *   discMatters：這一格配不同的組別，勝率差 2% 以上（除了選格子還要選對組別）
 *   many：可下的格子 7 個以上
 */
export function difficultyOf({ board, turn, sq, squares, moves }) {
  const evals = squares.map((s) => ({ sq: s.sq, v: othelloEvalV13(boardAfter(board, s.sq, turn), turn, groupOf) }))
    .sort((a, b) => b.v - a.v);
  const rank = evals.findIndex((e) => e.sq === sq) / Math.max(1, evals.length - 1);
  const hidden = rank > 0.2;
  const gs = findThreatGroups(board);
  const threats = gs.some((g) => g.kind === 4) || gs.length >= THREAT_LINES;
  const atSq = moves.filter((m) => m.sq === sq).map((m) => m.p);
  const discMatters = atSq.length > 1 && Math.max(...atSq) - Math.min(...atSq) >= 0.02;
  const many = squares.length >= 7;
  return { score: hidden + threats + discMatters + many, hidden, threats, discMatters, many };
}

/** 下完之後，經過這格有沒有替自己做出「四」（同色、同一組、再補一顆就連成五） */
function completesFourFor(nb, sq, turn) {
  for (let s = 0; s < 64; s++) {
    if (nb[s >> 3][s & 7]) continue;
    for (const v of SYMBOLS) {
      if (!completesFive(nb, s, v, turn)) continue;
      // 這個五連窗口要經過剛下的那格
      const dr = (s >> 3) - (sq >> 3), dc = (s & 7) - (sq & 7);
      if (Math.max(Math.abs(dr), Math.abs(dc)) <= 4 && (dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return true;
    }
  }
  return false;
}
