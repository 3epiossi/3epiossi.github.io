/**
 * 新棋子規則（主數字 + 副數字，兩面相同）下的牌型機率
 *
 * 棋子：主數字 m（1～8，計分用）與副數字 s（1～8，當「花色」），64 顆剛好是所有 (m, s) 組合各一顆。
 * 兩面數字相同，翻面只換顏色。
 *
 * 牌型都看「同一直線上連續 3 顆己方的棋」，依直線上的順序讀數字。
 *
 * 1) 理論：64 顆棋依序取 3 顆（不放回，共 249,984 種排列），各候選牌型的精確機率
 * 2) 實戰：實際對局中，每次落子檢查「經過新棋、三格都是己方」的三連
 *    （隨機下 / 追牌型：每步挑能完成最高牌型的位置）
 *
 *   node five/tests/dual-odds.js --games 300
 */
import { GameEngine } from "../src/core/game-engine.js";
import { mulberry32 } from "./helpers.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const GAMES = Number(args.games || 300);

// 棋子 id → 主數字 / 副數字（沿用 0～63 的 id，只換解讀方式）
const MAIN = (id) => (id & 7) + 1;
const SUB = (id) => (id >> 3) + 1;

const ordered = (a, b, c) => (b === a + 1 && c === b + 1) || (b === a - 1 && c === b - 1);
const anyOrderSeq = (a, b, c) => { const x = [a, b, c].sort((p, q) => p - q); return x[1] === x[0] + 1 && x[2] === x[1] + 1; };
const same = (a, b, c) => a === b && b === c;
const ten = (a, b, c) => a + b + c === 10;

// 候選牌型（彼此不互斥，各自判斷）
const CANDIDATES = [
  ["mainTrips", "三條（主數字相同）", (m, s) => same(...m)],
  ["mainOrdered", "順子（主數字依序連號）", (m, s) => ordered(...m)],
  ["mainAnySeq", "順子・不限順序（主數字連號）", (m, s) => anyOrderSeq(...m)],
  ["mainTen", "湊十（主數字和 = 10）", (m, s) => ten(...m)],
  ["colour", "同花（副數字相同）", (m, s) => same(...s)],
  ["subOrdered", "副順（副數字依序連號）", (m, s) => ordered(...s)],
  ["subTen", "副湊十（副數字和 = 10）", (m, s) => ten(...s)],
  ["pureSeq", "同花順（主依序連號 + 副相同）", (m, s) => ordered(...m) && same(...s)],
  ["pureSeqAny", "同花順・不限順序", (m, s) => anyOrderSeq(...m) && same(...s)],
  ["colourTen", "同花湊十（主和 10 + 副相同）", (m, s) => ten(...m) && same(...s)],
  ["doubleSeq", "雙順（主、副都依序連號）", (m, s) => ordered(...m) && ordered(...s)],
  ["doubleTen", "雙十（主和 10 + 副和 10）", (m, s) => ten(...m) && ten(...s)],
  ["twins", "三對號（三顆都是主 = 副）", (m, s) => m[0] === s[0] && m[1] === s[1] && m[2] === s[2]],
  ["mirror", "鏡像（主副對調後跟另一顆相同… 三顆兩兩互為主副對調）", null]
].filter(c => c[2]);

const pct = (x) => (x < 0.001 ? (100 * x).toFixed(3) : (100 * x).toFixed(2)) + "%";

// ===== 1) 理論 =====
{
  const cnt = Object.fromEntries(CANDIDATES.map(([k]) => [k, 0]));
  let total = 0;
  for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) for (let k = 0; k < 64; k++) {
    if (i === j || j === k || i === k) continue;
    total++;
    const m = [MAIN(i), MAIN(j), MAIN(k)], s = [SUB(i), SUB(j), SUB(k)];
    for (const [key, , f] of CANDIDATES) if (f(m, s)) cnt[key]++;
  }
  console.log(`\n【理論】64 顆依序取 3 顆（${total} 種排列），各候選牌型的機率（彼此不互斥）`);
  for (const [key, name] of CANDIDATES) {
    const p = cnt[key] / total;
    console.log(`  ${name.padEnd(22, "　")} ${pct(p).padStart(8)}   約每 ${p ? Math.round(1 / p) : "∞"} 組三連出現一次`);
  }
  console.log("  （三條 + 同花不可能同時成立：主、副都相同就是同一顆棋）");
}

// ===== 2) 實戰 =====
const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];
function triplesAt(board, r, c, player) {
  const out = [];
  for (const [dr, dc] of AXES) {
    for (let st = -2; st <= 0; st++) {
      const cells = [0, 1, 2].map(k => [r + (st + k) * dr, c + (st + k) * dc]);
      if (cells.some(([y, x]) => y < 0 || y > 7 || x < 0 || x > 7)) continue;
      const ds = cells.map(([y, x]) => board[y][x]);
      if (ds.some(d => !d || d.face !== player)) continue;
      out.push({ m: ds.map(d => MAIN(d.id)), s: ds.map(d => SUB(d.id)) });
    }
  }
  return out;
}

// 「追牌型」玩家的偏好：越稀有的牌型越想湊（只用來排序，不是正式加分）
const RARITY = Object.fromEntries(CANDIDATES.map(([k]) => [k, 0]));
Object.assign(RARITY, { mainTen: 1, mainOrdered: 3, mainAnySeq: 1, colour: 6, mainTrips: 7, pureSeq: 30, pureSeqAny: 15, colourTen: 25, doubleSeq: 20, doubleTen: 10, subOrdered: 3, subTen: 1, twins: 40 });
const scoreTriples = (ts) => {
  let v = 0;
  for (const t of ts) for (const [key, , f] of CANDIDATES) if (f(t.m, t.s)) v += RARITY[key];
  return v;
};

function simulate(label, chase) {
  const per = Object.fromEntries(CANDIDATES.map(([k]) => [k, 0]));
  let moves = 0, windows = 0;
  for (let g = 0; g < GAMES; g++) {
    const rng = mulberry32(5000 + g);
    const e = new GameEngine({ rng });
    while (!e.gameOver) {
      const legal = e.legalMoves();
      if (!legal.length) { e.passTurn(); continue; }
      const player = e.currentTurn;
      let pick;
      if (chase) {
        let best = -1, cands = [];
        for (const m of legal) {
          const save = e.board[m.r][m.c];
          // 暫時落子（只為了讀三連，翻面也要算）
          const flipped = m.flips.map(([y, x]) => [y, x, e.board[y][x].face]);
          e.board[m.r][m.c] = { id: e.hand, face: player };
          for (const [y, x] of m.flips) e.board[y][x].face = player;
          const v = scoreTriples(triplesAt(e.board, m.r, m.c, player));
          for (const [y, x, f] of flipped) e.board[y][x].face = f;
          e.board[m.r][m.c] = save;
          if (v > best) { best = v; cands = [m]; } else if (v === best) cands.push(m);
        }
        pick = cands[Math.floor(rng() * cands.length)];
      } else {
        pick = legal[Math.floor(rng() * legal.length)];
      }
      e.executeMove(pick.r, pick.c);
      const ts = triplesAt(e.board, pick.r, pick.c, player);
      moves++; windows += ts.length;
      for (const t of ts) for (const [key, , f] of CANDIDATES) if (f(t.m, t.s)) per[key]++;
    }
  }
  console.log(`\n【實戰：${label}】${GAMES} 局，每步平均 ${(windows / moves).toFixed(2)} 組三連；每局出現次數（雙方合計）`);
  for (const [key, name] of CANDIDATES) {
    console.log(`  ${name.padEnd(22, "　")} ${(per[key] / GAMES).toFixed(2).padStart(6)} 次/局`);
  }
}

simulate("隨機下", false);
simulate("追牌型（每步挑最稀有的牌型）", true);
