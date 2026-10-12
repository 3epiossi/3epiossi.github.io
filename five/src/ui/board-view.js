/**
 * ♟️ 五連黑白棋 - 棋盤視覺渲染元件 (Board View)
 * 每顆棋顯示它那一組的字（兩面相同），顏色代表歸誰。
 */

import { N, BLACK, WHITE } from "../core/constants.js";
import { posToCoord, inBounds } from "../core/rules.js";
import { tr, escapeHtml } from "../i18n.js";
import { letterOf, discLabel, groupOf, getSymbolSet } from "../core/five-rules.js";

/** 五連的棋：它那一組的字（兩面相同），顏色代表歸誰，顯示「α」 */
export function discHtmlFive(id, face, extraClass = "", keyMask = 0) {
  const cls = face === BLACK ? "black" : "white";
  const n = groupOf(id) + 1;
  const sym = escapeHtml(letterOf(n)); // 自訂文字是使用者輸入的，要跳脫
  // 棋上的字永遠是單色：白面（白棋）黑字、黑面（黑棋）白字。只有威脅連線用顏色：
  // 這顆棋在某條威脅連線裡（keyMask），字的底線用那一組的顏色，才知道是哪一條線
  const key = keyMask & (1 << (n - 1));
  const fn = key ? `<span class="fn keySym" style="--kc:${groupColor(n)}">${sym}</span>` : `<span class="fn">${sym}</span>`;
  return `<div class="disc fDisc ${cls} plain ${extraClass}">${fn}</div>`;
}

/** 每一組固定的顏色：只用在威脅連線與缺口圈（棋子上的字是單色的） */
export const SYMBOL_COLORS = ["#e5484d", "#3d8bfd", "#eab308", "#22c55e"];
/** 撲克花色的連線顏色：桃（♠）金黃、心（♥）血紅、方（♦）水藍、梅（♣）葉綠 */
export const SUIT_COLORS = ["#f2b705", "#b3001b", "#3fb8f0", "#3fa535"];
/** 第 n 組（1～4）的連線顏色（跟著目前的棋子文字） */
export const groupColor = (n) => (getSymbolSet() === "suits" ? SUIT_COLORS : SYMBOL_COLORS)[n - 1];

const PIECE_BG = { [BLACK]: "var(--piece-black-flat, #111827)", [WHITE]: "var(--piece-white-flat, #e2e8f0)" };
const PIECE_TEXT = { [BLACK]: "var(--fnBlack, #f8fafc)", [WHITE]: "var(--fnWhite, #1e293b)" };

/** 缺口裡那顆小棋：一方 → 那一方的顏色；雙方 → 左白右黑；外圈是連線的顏色 */
function gapDisc(x, y, r, owners, ring) {
  const stroke = `stroke:${ring};stroke-width:${Math.max(2, r * 0.18).toFixed(1)}`;
  if (owners.length === 1) return `<circle cx="${x}" cy="${y}" r="${r}" class="tGapDisc" style="fill:${PIECE_BG[owners[0]]};${stroke}"/>`;
  const half = (sweep, face) => `<path d="M${x},${y - r} A${r},${r} 0 0 ${sweep} ${x},${y + r} Z" style="fill:${PIECE_BG[face]}"/>`;
  return half(0, WHITE) + half(1, BLACK) + `<circle cx="${x}" cy="${y}" r="${r}" class="tGapDisc" style="fill:none;${stroke}"/>`;
}
const gapTextColor = (owners) => (owners.length === 1 ? PIECE_TEXT[owners[0]] : "#fff");

/** 走法評價的原因（ai/move-quality.js 的 why）→ 目前語言的一句話；等級用名稱顯示 */
export function markWhyText(mark) {
  if (!mark?.why) return "";
  const p = { ...mark.why.p };
  for (const k of ["from", "to", "lvl"]) if (typeof p[k] === "number") p[k] = tr(`lvl${p[k]}`);
  // 最佳步寫成「格子 組」，例如 E3 α（下對格子、選錯組時才看得出差在哪）
  if (p.at && p.disc != null) p.at = `${p.at} ${discLabel(p.disc)}`;
  if (p.grp != null) p.grp = discLabel(p.grp); // 組別（存那一組的棋，顯示時才換成目前的棋子文字）
  return tr(mark.why.key, p);
}

/** 走法評價標記（棋盤最後一手右上角）的樣式與提示文字 */
export const MARK_CLASS = { "!!": "mk-brilliant", "!": "mk-good", "!?": "mk-interesting", "?!": "mk-dubious", "?": "mk-mistake", "??": "mk-blunder" };
export const MARK_TIP = { "!!": "markBrilliant", "!": "markGood", "!?": "markInteresting", "?!": "markDubious", "?": "markMistake", "??": "markBlunder" };

export class BoardView {
  /**
   * @param {(r:number, c:number) => number|null} [o.onCellPress] 在格子上按下時：回傳要按多久（毫秒）才算長按，null = 這格不是長按的對象
   * @param {(r:number, c:number) => void} [o.onCellHold] 按滿了（長按成立）
   */
  constructor({ boardContainer, onCellClick, onCellHover, onCellPress = null, onCellHold = null }) {
    this.boardEl = boardContainer;
    this.onCellClick = onCellClick;
    this.onCellHover = onCellHover;
    this.onCellPress = onCellPress;
    this.onCellHold = onCellHold;
    this.hold = null; // 正在按住的 { r, c, x, y, ms, t0, timer }
    this.swallowClick = false; // 長按成立後，放開時那一下 click 不算（不然會又換下一顆）
    this.cellElements = Array.from({ length: N }, () => Array(N).fill(null));
    this.prevKeys = Array.from({ length: N }, () => Array(N).fill(""));
    this.initDOM();
  }

  initDOM() {
    this.boardEl.innerHTML = "";
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.setAttribute("role", "button");
        cell.setAttribute("tabindex", "0");
        cell.setAttribute("aria-label", tr("cellEmpty", { c: posToCoord(r, c) }));
        this.boardEl.appendChild(cell);
        this.cellElements[r][c] = cell;
      }
    }
    // 五連威脅的連線畫在棋盤上方的獨立圖層（不擋點擊）
    this.threatSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.threatSvg.setAttribute("class", "threatLayer");
    this.threatSvg.setAttribute("aria-hidden", "true");
    this.boardEl.appendChild(this.threatSvg);

    const pick = (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return null;
      const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
      return inBounds(r, c) ? { r, c, cell } : null;
    };
    this.boardEl.addEventListener("click", (e) => {
      if (this.swallowClick) { this.swallowClick = false; return; }
      const p = pick(e);
      if (p && this.onCellClick) this.onCellClick(p.r, p.c);
    });
    // 長按：按在「正顯示著候選」的格子上，按滿指定時間就算（格子上有一圈進度環）；移動超過 10px（在捲動）、放開、移開就取消
    this.boardEl.addEventListener("pointerdown", (e) => {
      this.cancelHold();
      this.swallowClick = false;
      const p = pick(e);
      const ms = p && this.onCellPress ? this.onCellPress(p.r, p.c) : null;
      if (ms == null) return;
      this.hold = { r: p.r, c: p.c, x: e.clientX, y: e.clientY, ms, t0: performance.now(), timer: setTimeout(() => {
        const h = this.hold; if (!h) return;
        this.hold = null; this.swallowClick = true;
        setTimeout(() => { this.swallowClick = false; }, 400); // 放開時沒有 click（例如手指移到格子外）也不要一直留著，吃掉下一次真正的點擊
        this.clearHoldVisual(this.cellElements[h.r][h.c]);
        this.onCellHold?.(h.r, h.c);
      }, ms) };
      this.showHoldVisual(p.cell, ms, 0);
    });
    const endHold = () => this.cancelHold();
    this.boardEl.addEventListener("pointerup", endHold);
    this.boardEl.addEventListener("pointercancel", endHold);
    this.boardEl.addEventListener("pointermove", (e) => {
      if (this.hold && Math.hypot(e.clientX - this.hold.x, e.clientY - this.hold.y) > 10) this.cancelHold();
    });
    // 手機長按會跳出選單：在棋盤上不要
    this.boardEl.addEventListener("contextmenu", (e) => { if (this.hold || this.swallowClick) e.preventDefault(); });
    this.boardEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const p = pick(e);
      if (!p) return;
      e.preventDefault();
      if (this.onCellClick) this.onCellClick(p.r, p.c);
    });
    const hover = (isEnter) => (e) => {
      const p = pick(e);
      if (!p || !this.onCellHover) return;
      if (e.relatedTarget && p.cell.contains(e.relatedTarget)) return;
      this.onCellHover(p.r, p.c, isEnter, e.pointerType);
    };
    this.boardEl.addEventListener("pointerover", hover(true));
    this.boardEl.addEventListener("pointerout", hover(false));
  }

  /**
   * 長按的畫面：棋子外圍的虛線圈被黃色實線順時針填滿；同時有一根從 12 點開始順時針掃過的指針，
   * 掃過的扇形裡棋子變成 100% 不透明，其他地方還是半透明（做法：在半透明的棋上疊一顆不透明的同款棋，用扇形遮罩露出來）。見 five.css 的 holdRing、holdSweep。
   * elapsed：已經按了多久——畫面重畫時動畫要接著原本的進度走，不能從頭來
   */
  showHoldVisual(cell, ms, elapsed) {
    cell.style.setProperty("--hold-ms", `${ms}ms`);
    cell.style.setProperty("--hold-elapsed", `${Math.round(elapsed)}ms`);
    cell.classList.add("holding");
    const ghost = cell.querySelector(".disc.ghost");
    if (ghost) {
      const solid = ghost.cloneNode(true);
      solid.classList.remove("ghost");
      const sector = document.createElement("div");
      sector.className = "holdSector";
      sector.setAttribute("aria-hidden", "true");
      sector.appendChild(solid);
      cell.appendChild(sector);
    }
    cell.insertAdjacentHTML("beforeend", `<svg class="holdRing" viewBox="0 0 100 100" aria-hidden="true"><circle class="hrTrack" cx="50" cy="50" r="48.5"/><circle class="hrFill" cx="50" cy="50" r="48.5" pathLength="100"/></svg>`);
  }

  clearHoldVisual(cell) {
    cell.classList.remove("holding");
    cell.querySelector(".holdRing")?.remove();
    cell.querySelector(".holdSector")?.remove();
  }

  /** 取消正在進行的長按（放開、移動、換格子） */
  cancelHold() {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.clearHoldVisual(this.cellElements[this.hold.r][this.hold.c]);
    this.hold = null;
  }

  /**
   * @param {object} p
   * @param {Array}  p.board 棋盤
   * @param {Map<string,object>} p.legalMoves "r,c" → { five, flips }，可落子位置與是否直接成五
   * @param {object|null} p.lastMove 最後一手
   * @param {{sym:string}|null} p.lastMark 最後一手的評價標記（!! ! !? ?! ? ??）
   * @param {Map<number,{pct:number,best:boolean}>} p.hintLabels 提示模式：格子（r × 8 + c）→ 勝率
   * @param {object|null} p.previewGhostMove 預覽中的候選（顯示半透明棋）
   * @param {{id:number, face:number}|null} p.ghostDisc 預覽用的棋（手上那顆）
   * @param {{sq:number, i:number, n:number}|null} p.tapPick 選棋：這格正在試第 i 顆（共 n 顆），格子標出「i/n」
   */
  render({ board, legalMoves = new Map(), lastMove = null, hintLabels = new Map(), previewGhostMove = null, ghostDisc = null, lastMark = null, threatGroups = [], threatFocus = null, tapPick = null }) {
    const drawDisc = discHtmlFive;
    // 每顆棋在威脅連線裡的組別（位元）
    const keyMask = new Map();
    for (const g of threatGroups) for (const sq of g.cells) keyMask.set(sq, (keyMask.get(sq) || 0) | (1 << (g.v - 1)));
    const lastKey = lastMove && lastMove.r != null ? `${lastMove.r},${lastMove.c}` : null;

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = this.cellElements[r][c];
        const d = board[r][c];
        const key = `${r},${c}`;
        const coord = posToCoord(r, c);

        cell.className = "cell";
        cell.innerHTML = "";

        if (d) {
          const sig = `${d.id}:${d.face}`;
          const prev = this.prevKeys[r][c];
          let anim = "";
          if (prev !== sig) {
            if (!prev) anim = "drop";
            else if (prev.split(":")[0] === String(d.id)) anim = "flip";
          }
          this.prevKeys[r][c] = sig;
          cell.innerHTML = drawDisc(d.id, d.face, anim, keyMask.get(r * N + c) || 0);
          cell.setAttribute("aria-label", tr("cellDiscFivePlain", { c: coord, side: tr(d.face === BLACK ? "black" : "white"), disc: discLabel(d.id) }));
        } else {
          this.prevKeys[r][c] = "";
          cell.setAttribute("aria-label", tr("cellEmpty", { c: coord }));
        }

        const legal = legalMoves.get(key);
        const hint = hintLabels.get(r * N + c);
        if (legal && !d && hint) {
          // 提示模式：標出這格的勝率（取代綠點），最高的那格另外標色
          cell.classList.add("dest-spawn", "hinted");
          if (hint.best) cell.classList.add("hintBest");
          const lab = document.createElement("span");
          lab.className = "hintPct";
          lab.textContent = `${hint.pct}%`;
          cell.appendChild(lab);
          cell.setAttribute("aria-label", tr("cellHint", { c: coord, p: hint.pct }));
        } else if (legal && !d) {
          cell.classList.add("dest-spawn");
          if (legal.five) {
            // 這一步直接連成五連
            const badge = document.createElement("span");
            badge.className = "stepBadge bonus";
            badge.textContent = "★5";
            cell.appendChild(badge);
          }
          cell.setAttribute("aria-label", tr("cellLegal", { c: coord, n: legal.flips.length }));
        }

        if (lastKey === key) {
          cell.classList.add("lastMove");
          if (lastMark?.sym) {
            const mk = document.createElement("span");
            mk.className = `moveMark ${MARK_CLASS[lastMark.sym]}`;
            mk.textContent = lastMark.sym;
            mk.title = `${tr(MARK_TIP[lastMark.sym])}：${markWhyText(lastMark)}`;
            cell.appendChild(mk);
          }
        }

        if (previewGhostMove && previewGhostMove.r === r && previewGhostMove.c === c && ghostDisc && !d) {
          cell.classList.add("ghost-dest");
          if (tapPick && tapPick.sq === r * N + c) {
            cell.classList.add("tapPicking");
            cell.insertAdjacentHTML("beforeend", `<span class="tapCount">${tapPick.i}/${tapPick.n}</span>`);
          }
          // 預覽的棋也標出它在威脅連線裡靠的符號（threatGroups 已經把它算進去）
          cell.insertAdjacentHTML("afterbegin", drawDisc(ghostDisc.id, ghostDisc.face, "ghost", keyMask.get(r * N + c) || 0));
        }
      }
    }
    // 長按進行中：這一格重畫後，進度環接著原本的進度（格子的內容剛被清掉重畫）
    if (this.hold) this.showHoldVisual(this.cellElements[this.hold.r][this.hold.c], this.hold.ms, performance.now() - this.hold.t0);
    this.renderThreats(threatGroups, threatFocus, new Set(hintLabels.keys()));
  }

  /**
   * 五連威脅：每一組畫一條線穿過那幾顆棋，顏色是那組的共同符號。
   *   三：細虛線；四：粗實線，延伸到缺口，缺口畫圈並寫上需要的符號。
   * focus（滑鼠所在的格子）屬於某一組時，只突顯那一組，其他變淡（不另外加文字說明，連線本身就夠清楚）。
   */
  renderThreats(groups, focus, hinted = new Set()) {
    const svg = this.threatSvg;
    if (!svg) return;
    this.lastThreats = { groups, focus, hinted };
    if (!this.resizeBound) {
      // 棋盤大小改變（視窗縮放）時，連線位置跟著重算
      this.resizeBound = true;
      window.addEventListener("resize", () => this.lastThreats && this.renderThreats(this.lastThreats.groups, this.lastThreats.focus, this.lastThreats.hinted));
    }
    const W = this.boardEl.clientWidth, H = this.boardEl.clientHeight;
    // 棋盤沒顯示出來（大小是 0）時先不畫，等視窗大小改變時再重算
    if (!W || !H) { svg.innerHTML = ""; return; }
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const center = (sq) => {
      const el = this.cellElements[sq >> 3][sq & 7];
      return [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
    };
    const cellSize = this.cellElements[0][0].offsetWidth || 40;
    const focusIdx = focus == null ? -1 : groups.findIndex(g => g.cells.includes(focus) || g.gaps.includes(focus));
    let html = "";
    groups.forEach((g, i) => {
      const color = groupColor(g.v);
      const faded = focusIdx >= 0 && i !== focusIdx ? " faded" : "";
      const along = (sq) => (sq >> 3) * g.dir[0] + (sq & 7) * g.dir[1];
      const ends = [...g.cells, ...g.gaps].sort((a, b) => along(a) - along(b));
      let [x1, y1] = center(ends[0]), [x2, y2] = center(ends[ends.length - 1]);
      // 端點是缺口格時，線只畫到缺口格的邊緣，格子中間留給提示的勝率
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len, cut = cellSize * 0.42;
      if (g.gaps.includes(ends[0])) { x1 += ux * cut; y1 += uy * cut; }
      if (g.gaps.includes(ends[ends.length - 1])) { x2 -= ux * cut; y2 -= uy * cut; }
      const w = (g.kind === 4 ? 0.13 : 0.1) * cellSize;
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="tLine t${g.kind}${faded}" style="stroke:${color};stroke-width:${w.toFixed(1)}"/>`;
      for (const gap of g.gaps) {
        // 缺口：沿著格子邊緣（內縮一點，不跟提示最高格的外框重疊）畫連線顏色的虛線框；
        // 需要的符號平常放大在中間，提示模式下這格有勝率時改成右下角的小標籤
        const el = this.cellElements[gap >> 3][gap & 7];
        const inset = 4, bx = el.offsetLeft + inset, by = el.offsetTop + inset, bw = el.offsetWidth - inset * 2, bh = el.offsetHeight - inset * 2;
        const [cx, cy] = center(gap);
        const small = hinted.has(gap);
        const size = small ? cellSize * 0.3 : cellSize * 0.42;
        const lx = small ? el.offsetLeft + el.offsetWidth - size * 0.62 - 3 : cx;
        const ly = small ? el.offsetTop + el.offsetHeight - size * 0.62 - 3 : cy;
        // 符號畫在一顆「誰下在這裡會連成五」那一方顏色的棋上（雙方都會就一半白一半黑），外圈用連線的顏色
        const owners = g.gapOwners?.[gap] || [];
        const r = small ? size * 0.62 : size * 0.72;
        const label = gapDisc(lx, ly, r, owners, color) +
          `<text x="${lx}" y="${ly}" class="tGapText${owners.length === 1 ? " onDisc" : ""}" style="fill:${gapTextColor(owners)};font-size:${(r * 1.2).toFixed(1)}px">${escapeHtml(letterOf(g.v))}</text>`;
        html += `<g class="tGap${faded}"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${cellSize * 0.12}" style="stroke:${color};fill:${color}1f"/>${label}</g>`;
      }
    });
    svg.innerHTML = html;
  }
}
