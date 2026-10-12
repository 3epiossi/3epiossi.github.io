/**
 * 🎯 五連規則（4 組自選）
 *
 * 棋子：64 顆分成 4 組、每組 16 顆（id 0～15 第 1 組、16～31 第 2 組…，見 groupOf）。每顆棋只有一個字（組別），
 * 兩面相同，翻面只換顏色。雙方共用這 64 顆：輪到的人自己選要下哪一組（那組還有剩才能選）。
 *
 * 勝負：
 *   - 落子後，下棋者在同一直線（橫、直、斜）上有連續 5 顆己方、同一組的棋（五連），立刻獲勝。翻面造成的五連也算。
 *   - 整局都沒人連成五 → 比棋子數，多者勝，相同為平手。
 *
 * 規則變體（只給實驗用：tests/rule-variants.js、tests/g2-arena.js，搭配 v9～v12 引擎；網頁不設定，就是上面的規則）：
 *   在載入這個模組之前設定 globalThis.FIVE_RULES_VARIANT = { len, match, groups }
 *     len    連成幾顆獲勝（預設 5）
 *     match  "group"（預設）= 同一組才算；"symbol" = 舊規則（每顆棋左右兩個符號，任選一個能全部相同就算）
 *     groups 分成幾組（預設 4）
 *   所有「同一組」的判斷都經過 numberMask：它回傳組別的位元（舊規則是兩個符號的位元）。
 */

import { N, BLACK, WHITE } from "./constants.js";
import { flipsFor } from "./rules.js";

/** 舊規則（左右兩個符號）用的：左、右符號 1～8。只有實驗程式（match = "symbol"）還會用到 */
export const leftOf = (id) => (id & 7) + 1;
export const rightOf = (id) => (id >> 3) + 1;
export const valueOf = (id) => leftOf(id) * rightOf(id);
/**
 * 每一組的字（在「主題與外觀」設定）。
 *   suits   撲克牌的四個花色 ♠ ♥ ♦ ♣（桃、心、方、梅；預設）。跟棋子上其他字一樣是單色（黑棋白字、白棋黑字），
 *           後面加 U+FE0E 要求用文字樣式顯示，不然有些系統會把 ♥ ♦ 畫成彩色的表情符號
 *   greek   希臘小寫字母 α β γ δ。不用 A～D：容易跟棋盤座標的 A～H 搞混；也不用希臘大寫：Α Β 跟英文字母長得一樣
 *   custom  使用者自訂的 4 個字（中文、英文、希臘文、日文都可以，見 parseCustomSymbols）
 */
export const SUITS = ["♠\uFE0E", "♥\uFE0E", "♦\uFE0E", "♣\uFE0E"];
export const GREEK = ["α", "β", "γ", "δ"];
export const SYMBOL_COUNT = GREEK.length;
const SETS = { suits: SUITS, greek: GREEK };
export const DEFAULT_SYMBOL_SET = "suits";
let symbols = SUITS;
let symbolSet = DEFAULT_SYMBOL_SET;

/** 把一串文字切成「字」（一個字 = 一個字形，例如 é、👍🏽 都算一個字） */
function splitChars(text) {
  const str = String(text ?? "").normalize("NFC");
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(str)].map(x => x.segment);
  }
  return Array.from(str);
}

/**
 * 檢查使用者輸入的自訂字：去掉空白後要剛好 4 個字，而且彼此不同。
 * @returns {{ ok: true, chars: string[] } | { ok: false, reason: "count"|"dupe", count?: number, dupe?: string }}
 */
export function parseCustomSymbols(text) {
  const chars = splitChars(text).filter(ch => ch.trim() !== "");
  if (chars.length !== SYMBOL_COUNT) return { ok: false, reason: "count", count: chars.length };
  const seen = new Set();
  for (const ch of chars) {
    if (seen.has(ch)) return { ok: false, reason: "dupe", dupe: ch };
    seen.add(ch);
  }
  return { ok: true, chars };
}

/** 換字組：suits、greek，或 custom（customText 要能通過 parseCustomSymbols）；不認得或不合格就用預設的撲克花色 */
export function setSymbolSet(name, customText = "") {
  if (name === "custom") {
    const p = parseCustomSymbols(customText);
    if (p.ok) { symbols = p.chars; symbolSet = "custom"; return; }
  }
  symbolSet = SETS[name] ? name : DEFAULT_SYMBOL_SET;
  symbols = SETS[symbolSet];
}
export function getSymbolSet() { return symbolSet; }
/** 第 n 組（1～4）的字（預設 ♠ ♥ ♦ ♣） */
export const letterOf = (n) => symbols[n - 1];
/** 棋子的顯示：它那一組的字（第二個參數是舊介面留下的，不用） */
export const discLabel = (id) => letterOf(groupOf(id) + 1);
const VARIANT = { len: 5, match: "group", groups: 4, ...(globalThis.FIVE_RULES_VARIANT || {}) };
/** 目前的規則變體（網頁是 { len: 5, match: "group", groups: 4 }） */
export const RULE_VARIANT = Object.freeze({ ...VARIANT });
/** 幾組（網頁 4 組） */
export const GROUPS = VARIANT.groups;
/** 每組幾顆（網頁 16 顆） */
export const GROUP_SIZE = 64 / VARIANT.groups;
/** 棋子的組別 0～GROUPS−1：id 依序平均分（4 組時 0～15 第 0 組、16～31 第 1 組…） */
export const groupOf = (id) => Math.floor(id * VARIANT.groups / 64);
/**
 * 棋子的「符號」集合：第 v-1 位元代表含有符號 v。
 * 分組規則下是組別的位元（第 groupOf 位），共同符號的判斷就是「同一組」；舊規則是左右兩個符號。
 */
export const numberMask = VARIANT.match === "group"
  ? (id) => 1 << groupOf(id)
  : (id) => (1 << (leftOf(id) - 1)) | (1 << (rightOf(id) - 1));

/** 連成幾顆獲勝（現行規則 5；規則變體可以改，見檔案開頭） */
export const FIVE = VARIANT.len;
const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** 盤上所有五連窗口（每個窗口是 FIVE 個 [r, c]；現行規則 5 個、共 96 個） */
export const FIVE_WINDOWS = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  for (const [dr, dc] of AXES) {
    const cells = Array.from({ length: FIVE }, (_, k) => [r + k * dr, c + k * dc]);
    if (cells.every(([y, x]) => y >= 0 && y < N && x >= 0 && x < N)) FIVE_WINDOWS.push(cells);
  }
}

/**
 * 找出 player 已連成的五連。回傳 { value, cells } 或 null。
 * 落子前不可能已有五連（否則比賽早就結束），所以掃整個棋盤即可。
 */
export function findFive(board, player) {
  for (const cells of FIVE_WINDOWS) {
    let mask = 0xFF;
    for (const [y, x] of cells) {
      const d = board[y][x];
      if (!d || d.face !== player) { mask = 0; break; }
      mask &= numberMask(d.id);
    }
    if (mask) return { value: 31 - Math.clz32(mask & -mask) + 1, cells: cells.map(c => [...c]) };
  }
  return null;
}

/**
 * 剛下在 (r, c) 的這顆棋，有沒有替自己做出「四」：經過這格的某個五連窗口裡，
 * 有 4 顆同色而且同一組的棋，剩下 1 格是空的（再補一顆就連成五）。走法評價 !? 用。
 */
export function makesFourAt(board, r, c) {
  const face = board[r]?.[c]?.face;
  if (face == null) return false;
  for (const cells of FIVE_WINDOWS) {
    if (!cells.some(([y, x]) => y === r && x === c)) continue;
    let mask = 0xFF, mine = 0, empty = 0;
    for (const [y, x] of cells) {
      const d = board[y][x];
      if (!d) { empty++; continue; }
      if (d.face !== face) { mask = 0; break; }
      mine++;
      mask &= numberMask(d.id);
    }
    if (mask && mine === FIVE - 1 && empty === 1) return true;
  }
  return false;
}

/** 雙方分數（棋子數）。weighted = true 是舊規則留下的（每顆 = 左 × 右），網頁用 false */
export function fiveScores(board, weighted = true) {
  const s = { black: 0, white: 0 };
  for (const row of board) for (const d of row) {
    if (!d) continue;
    const v = weighted ? valueOf(d.id) : 1;
    if (d.face === BLACK) s.black += v; else s.white += v;
  }
  return s;
}

/**
 * 五連的威脅（借用五子棋的說法），給棋盤標示用。不分黑白：棋子會被翻面，
 * 現在是對方的棋，之後也可能翻成自己的，所以只看「是不是同一組」：
 *   四：某個五連窗口裡有 4 顆棋（不論黑白）都是第 v 組，剩下 1 格是空的（缺口）
 *   三：某個五連窗口裡有 3 顆棋（不論黑白）都是第 v 組，剩下 2 格是空的
 *   花五（kind 5）：某個五連窗口 5 格都是第 v 組，可是黑白混在一起（同色的話遊戲早就結束了）。
 *     還不算贏，但只要有一方把另一色的棋全部翻過來就連成五；mixed 記著黑、白各幾顆
 * 同一條直線、同一組、棋子有重疊的窗口合併成一組（例如同一排的兩個三），
 * 這樣畫出來每一組都是一條線，不會疊在一起。
 * 那一組剩下的棋（雙方共用，每組 GROUP_SIZE 顆減掉盤上的）不夠補滿空格的窗口不算：再也不可能連成五。
 *
 * @returns {{ kind: 3|4|5, v: number, dir: number[], cells: number[], gaps: number[], mixed?: {black:number, white:number} }[]}
 *   v：第幾組（1～4）；cells：這一組的棋（格子 r × 8 + c，沿著方向排好）；gaps：四的缺口格（補上第 v 組就連成五）
 */
export function findThreatGroups(board) {
  const byKey = new Map(); // 「方向:直線:符號」→ 這條線上的候選
  // 每一組還剩幾顆（舊規則沒有組別的庫存，當成補得到）
  const left = Array(8).fill(Infinity);
  if (VARIANT.match === "group") {
    left.fill(GROUP_SIZE, 0, GROUPS);
    for (const row of board) for (const d of row) if (d) left[groupOf(d.id)]--;
  }
  for (const cells of FIVE_WINDOWS) {
    let mask = 0xFF;
    const discs = [], empty = [];
    for (const [y, x] of cells) {
      const d = board[y][x];
      if (!d) { empty.push(y * N + x); continue; }
      discs.push(y * N + x);
      mask &= numberMask(d.id);
    }
    if (!mask) continue;
    // 四＝差一顆、三＝差兩顆（現行規則就是 4 顆／3 顆；規則變體的四連是 3 顆／2 顆）
    const kind = discs.length === FIVE ? 5 : discs.length === FIVE - 1 && empty.length === 1 ? 4 : discs.length === FIVE - 2 && empty.length === 2 ? 3 : 0;
    if (!kind) continue;
    const [r0, c0] = cells[0], [r1, c1] = cells[1];
    const dir = [r1 - r0, c1 - c0];
    // 同一條直線的編號：橫排看列、直排看行、斜線看 r − c 或 r + c
    const line = dir[0] === 0 ? r0 : dir[1] === 0 ? c0 : dir[1] === 1 ? r0 - c0 : r0 + c0;
    for (let v = 1; v <= 8; v++) {
      if (!(mask & (1 << (v - 1)))) continue;
      if (empty.length > left[v - 1]) continue; // 這一組剩的不夠補滿
      const key = `${dir}:${line}:${v}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ kind, v, dir, cells: new Set(discs), gaps: kind === 4 ? [empty[0]] : [] });
    }
  }
  const groups = [];
  for (const cands of byKey.values()) {
    // 有共同棋子的候選合併（反覆合併到不能再合）
    const merged = [];
    for (const c of cands) {
      let target = merged.find(m => [...c.cells].some(s => m.cells.has(s)));
      if (!target) { merged.push({ ...c, cells: new Set(c.cells), gaps: [...c.gaps] }); continue; }
      for (const s of c.cells) target.cells.add(s);
      target.kind = Math.max(target.kind, c.kind);
      for (const g of c.gaps) if (!target.gaps.includes(g)) target.gaps.push(g);
    }
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < merged.length && !changed; i++) for (let j = i + 1; j < merged.length && !changed; j++) {
        if ([...merged[j].cells].some(s => merged[i].cells.has(s))) {
          for (const s of merged[j].cells) merged[i].cells.add(s);
          merged[i].kind = Math.max(merged[i].kind, merged[j].kind);
          for (const g of merged[j].gaps) if (!merged[i].gaps.includes(g)) merged[i].gaps.push(g);
          merged.splice(j, 1);
          changed = true;
        }
      }
    }
    for (const m of merged) {
      const along = (s) => (s >> 3) * m.dir[0] + (s & 7) * m.dir[1];
      const g = { kind: m.kind, v: m.v, dir: m.dir, cells: [...m.cells].sort((a, b) => along(a) - along(b)), gaps: m.kind >= 4 ? m.gaps : [] }; // 花五跟同一條線的四合併時，四的缺口留著
      if (m.kind === 5) {
        // 花五：只畫同一組的棋（三、四併進來的也算在這條線上），數一下黑白各幾顆
        let black = 0;
        for (const sq of g.cells) if (board[sq >> 3][sq & 7].face === BLACK) black++;
        g.mixed = { black, white: g.cells.length - black };
      }
      groups.push(g);
    }
  }
  // 花五、四排在前面（畫在上層、滑鼠指到時優先）
  groups.sort((a, b) => b.kind - a.kind);
  return groups;
}

/** 舊介面（集合形式），測試與其他地方用：哪些棋屬於四、哪些屬於三、缺口要補什麼 */
export function findThreats(board) {
  const fours = new Set(), threes = new Set(), gaps = new Map();
  for (const g of findThreatGroups(board)) {
    if (g.kind !== 5) for (const s of g.cells) (g.kind === 4 ? fours : threes).add(s);
    for (const s of g.gaps) gaps.set(s, (gaps.get(s) || 0) | (1 << (g.v - 1)));
  }
  for (const s of fours) threes.delete(s);
  return { fours, threes, gaps };
}

/**
 * face 這一方把一顆第 v 組的棋下在 gap，會不會在經過 gap 的直線上連成五（同色、同一組）。
 * 要是合法的一步（至少翻一顆），而且翻面也算進去：例如缺口下面是「黑黑黑白」，白棋下在缺口會把三顆黑翻成白，
 * 就連成五；黑棋下在缺口不會翻到那三顆，白的那顆還在，就連不成。
 */
export function completesFive(board, gap, v, face) {
  const r = Math.floor(gap / N), c = gap % N;
  if (board[r][c]) return false;
  const flips = flipsFor(board, r, c, face);
  if (!flips.length) return false;
  const flipped = new Set(flips.map(([fr, fc]) => fr * N + fc));
  const bit = 1 << (v - 1);
  for (const cells of FIVE_WINDOWS) {
    if (!cells.some(([y, x]) => y === r && x === c)) continue;
    let ok = true;
    for (const [y, x] of cells) {
      if (y === r && x === c) continue; // 下的那顆是第 v 組
      const d = board[y][x];
      if (!d || !(numberMask(d.id) & bit) || (d.face !== face && !flipped.has(y * N + x))) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * 替「四」的缺口標上：哪一方下在這裡真的會連成五（gapOwners：缺口 → [BLACK／WHITE]）。
 * 雙方都連不成的缺口不顯示（從 gaps 拿掉），連線照畫。
 */
export function withGapOwners(board, groups) {
  return groups.map((g) => {
    if (!g.gaps.length) return { ...g, gapOwners: {} };
    const gapOwners = {};
    const gaps = g.gaps.filter((gap) => {
      const owners = [BLACK, WHITE].filter((face) => completesFive(board, gap, g.v, face));
      if (owners.length) gapOwners[gap] = owners;
      return owners.length > 0;
    });
    return { ...g, gaps, gapOwners };
  });
}
