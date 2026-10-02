/**
 * ♟️ 骰子黑白棋 (Dice Othello) - 棋盤視覺渲染元件 (Board View)
 * 實踐視覺語意系統、DOM 參照快取、事件代理、手機觸控自適應與無障礙標籤
 */

import { N, EMPTY, BLACK, WHITE, MOVE_TYPE } from "../core/constants.js";
import { posToCoord, inBounds } from "../core/rules.js";
import { tr } from "../i18n.js";

export class BoardView {
  constructor({ boardContainer, svgOverlay, onCellClick, onCellHover }) {
    this.boardEl = boardContainer;
    this.svgEl = svgOverlay;
    this.onCellClick = onCellClick;
    this.onCellHover = onCellHover;

    this.cellElements = Array.from({ length: N }, () => Array(N).fill(null));
    this.previewMove = null;

    this.initDOM();
  }

  setFlipped(flipped) {
    this.flipped = !!flipped;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const el = this.cellElements[r][c];
        el.style.gridRow = this.flipped ? String(N - r) : "";
        el.style.gridColumn = this.flipped ? String(N - c) : "";
      }
    }
    const cols = "ABCDEFGH".split(""), rows = "12345678".split("");
    if (this.flipped) { cols.reverse(); rows.reverse(); }
    document.querySelector(".coordTop")?.replaceChildren(...cols.map(x => Object.assign(document.createElement("span"), { textContent: x })));
    document.querySelector(".coordLeft")?.replaceChildren(...rows.map(x => Object.assign(document.createElement("span"), { textContent: x })));
  }

  initDOM() {
    this.boardEl.innerHTML = "";

    // 建立 64 格 DOM 並快取
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

    // 事件代理 (Event Delegation)
    this.boardEl.addEventListener("click", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      if (inBounds(r, c) && this.onCellClick) {
        this.onCellClick(r, c);
      }
    });

    this.boardEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const cell = e.target.closest(".cell");
        if (!cell) return;
        e.preventDefault();
        const r = Number(cell.dataset.r);
        const c = Number(cell.dataset.c);
        if (inBounds(r, c) && this.onCellClick) {
          this.onCellClick(r, c);
        }
      }
    });

    // 指標懸停預覽
    this.boardEl.addEventListener("pointerover", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell || !this.onCellHover) return;
      if (e.relatedTarget && cell.contains(e.relatedTarget)) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      if (inBounds(r, c)) {
        this.onCellHover(r, c, true);
      }
    });

    this.boardEl.addEventListener("pointerout", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell || !this.onCellHover) return;
      if (e.relatedTarget && cell.contains(e.relatedTarget)) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      if (inBounds(r, c)) {
        this.onCellHover(r, c, false);
      }
    });
  }

  /**
   * 取得某格於棋盤容器內的中心像素座標
   */
  getCellCenter(r, c) {
    const cell = this.cellElements[r][c];
    if (!cell) return { x: 0, y: 0 };
    const rect = cell.getBoundingClientRect();
    const boardRect = this.boardEl.getBoundingClientRect();
    return {
      x: rect.left - boardRect.left + rect.width / 2,
      y: rect.top - boardRect.top + rect.height / 2
    };
  }

  /**
   * 生成 SVG 路徑字串：2 點直線 + 多點低 tension Catmull-Rom（圓滑轉角不過彎）
   */
  buildSmoothPath(pts) {
    if (pts.length < 2) return "";
    if (pts.length === 2) {
      // 2 點：純直線（路徑本身已透過 stroke-linecap=round 達到圓角效果）
      return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
    }
    // 多點：Catmull-Rom 轉 cubic Bezier，tension=0.18（圓滑但保持方向感）
    const t = 0.18;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) * t;
      const cp1y = p1.y + (p2.y - p0.y) * t;
      const cp2x = p2.x - (p3.x - p1.x) * t;
      const cp2y = p2.y - (p3.y - p1.y) * t;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x} ${p2.y}`;
    }
    return d;
  }

  /**
   * 中心線依弧長均勻取樣，回傳 { samples:[{x,y,nx,ny}], length }
   */
  sampleCenterline(pts, radius = 24) {
    const clean = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = clean[clean.length - 1], b = pts[i], c = pts[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) > 1e-3) clean.push(b);
    }
    clean.push(pts[pts.length - 1]);

    // 直線段 + 轉角處以二次貝茲圓角
    const dense = [{ x: clean[0].x, y: clean[0].y }];
    for (let i = 1; i < clean.length - 1; i++) {
      const a = clean[i - 1], b = clean[i], c = clean[i + 1];
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      const r = Math.min(radius, l1 * 0.5, l2 * 0.5);
      const s1 = { x: b.x + (a.x - b.x) * r / l1, y: b.y + (a.y - b.y) * r / l1 };
      const e1 = { x: b.x + (c.x - b.x) * r / l2, y: b.y + (c.y - b.y) * r / l2 };
      dense.push(s1);
      for (let k = 1; k < 10; k++) {
        const t = k / 10, u = 1 - t;
        dense.push({
          x: u * u * s1.x + 2 * u * t * b.x + t * t * e1.x,
          y: u * u * s1.y + 2 * u * t * b.y + t * t * e1.y
        });
      }
      dense.push(e1);
    }
    dense.push({ x: clean[clean.length - 1].x, y: clean[clean.length - 1].y });

    const cum = [0];
    for (let i = 1; i < dense.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
    }
    const length = cum[cum.length - 1] || 1;
    const M = Math.max(32, Math.ceil(length / 3));
    const samples = [];
    let j = 0;
    for (let i = 0; i < M; i++) {
      const target = (i / (M - 1)) * length;
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const seg = (cum[j + 1] - cum[j]) || 1;
      const u = (target - cum[j]) / seg;
      samples.push({
        x: dense[j].x + (dense[j + 1].x - dense[j].x) * u,
        y: dense[j].y + (dense[j + 1].y - dense[j].y) * u
      });
    }
    for (let i = 0; i < M; i++) {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(M - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      samples[i].nx = -ty / tl;
      samples[i].ny = tx / tl;
    }
    return { samples, length };
  }

  /**
   * 繪製行棋路徑：水墨毛筆筆觸箭頭。
   * 錐形筆身（尾細腹粗）+ 多條飛白鬃毛 + 帶倒鉤的粗糙箭頭 + 飛墨點。
   * 亂數以走法座標為種子，同一手每次重繪外觀一致。
   */
  drawMovePath(move, isAiHint = false, hintPlayer = null) {
    if (!this.svgEl || !move) {
      this.clearMovePath();
      return;
    }
    if (document.documentElement.dataset.pathStyle === "brush") {
      this.drawBrushPath(move, isAiHint, hintPlayer);
    } else {
      this.drawStepPath(move, isAiHint, hintPlayer);
    }
  }

  /** 步數指示路徑（預設）：虛線流動 + 起點光環 + 逐步編號圓點 + 終點大徽章 */
  drawStepPath(move, isAiHint = false, hintPlayer = null) {
    let pathData = move.path;
    if (!pathData || pathData.length < 2) {
      const fromR = move.fromR != null ? move.fromR : (move.from ? move.from.r : null);
      const fromC = move.fromC != null ? move.fromC : (move.from ? move.from.c : null);
      const toR = move.toR != null ? move.toR : (move.to ? move.to.r : null);
      const toC = move.toC != null ? move.toC : (move.to ? move.to.c : null);
      if (fromR == null || toR == null) { this.clearMovePath(); return; }
      pathData = [{ r: fromR, c: fromC }, { r: toR, c: toC }];
    }

    this.svgEl.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const who = isAiHint && hintPlayer != null ? hintPlayer : move.player;
    const isBlack = who === BLACK;
    const isCapture = move.type === MOVE_TYPE.CAPTURE;
    const color = isBlack ? "var(--path-black-fill, #111827)" : "var(--path-white-fill, #e2e8f0)";
    const badgeBg = isBlack ? "#0b1329" : "#ffffff";
    const badgeText = isBlack ? "#ffffff" : "#78350f";

    const cs = this.cellElements[0][0].getBoundingClientRect().width || 56;
    const k = cs / 56;
    const pts = pathData.map(pt => this.getCellCenter(pt.r, pt.c));
    const start = pts[0], end = pts[pts.length - 1], prev = pts[pts.length - 2];
    const trim = 13.5 * k;
    const dl = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
    const lineEnd = dl > trim ? { x: end.x - (end.x - prev.x) / dl * trim, y: end.y - (end.y - prev.y) / dl * trim } : end;
    const d = [...pts.slice(0, -1), lineEnd].map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ");

    const add = (parent, tag, attrs, style) => {
      const el = document.createElementNS(NS, tag);
      for (const key in attrs) el.setAttribute(key, attrs[key]);
      if (style) for (const key in style) el.style.setProperty(key, style[key]);
      parent.appendChild(el);
      return el;
    };

    const defs = add(this.svgEl, "defs", {});
    const marker = add(defs, "marker", { id: "stepArrowHead", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto" });
    add(marker, "path", { d: "M 0 1 L 7 4 L 0 7 z" }, { fill: color });

    const g = add(this.svgEl, "g", { opacity: isAiHint ? "0.6" : "1" });
    g.style.filter = "drop-shadow(0 0 3px rgba(0,0,0,0.55))";

    add(g, "path", { d, fill: "none", "stroke-width": (6.5 * k).toFixed(1), "stroke-linecap": "round", "stroke-linejoin": "round", opacity: "0.35" }, { stroke: color });
    add(g, "path", {
      d, fill: "none", "stroke-width": (3.5 * k).toFixed(1), "stroke-linecap": "round", "stroke-linejoin": "round",
      "stroke-dasharray": `${6 * k} ${4 * k}`, "marker-end": "url(#stepArrowHead)", class: "animated-path-dash"
    }, { stroke: color });

    add(g, "circle", { cx: start.x, cy: start.y, r: 14 * k, "fill-opacity": "0.3", "stroke-width": 1.8, class: "pulse-start-ring" }, { fill: color, stroke: color });
    add(g, "circle", { cx: start.x, cy: start.y, r: 4.5 * k }, { fill: color });

    for (let i = 1; i < pts.length - 1; i++) {
      add(g, "circle", { cx: pts[i].x, cy: pts[i].y, r: 9.5 * k, fill: badgeBg, "stroke-width": 1.8 }, { stroke: color });
      const t = add(g, "text", {
        x: pts[i].x, y: pts[i].y, dy: "0.35em", "text-anchor": "middle",
        "font-size": (10 * k).toFixed(1), "font-weight": 800, fill: badgeText, class: "path-waypoint-text"
      });
      t.textContent = String(i);
    }

    const ringAttrs = { cx: end.x, cy: end.y, r: 17.5 * k, "fill-opacity": "0.3", "stroke-width": 2, class: "pulse-end-ring" };
    if (isCapture) ringAttrs["stroke-dasharray"] = "3 3";
    add(g, "circle", ringAttrs, { fill: color, stroke: color });
    add(g, "circle", { cx: end.x, cy: end.y, r: 12 * k, fill: badgeBg, "stroke-width": 2.4 }, { stroke: color });
    const et = add(g, "text", {
      x: end.x, y: end.y, dy: "0.35em", "text-anchor": "middle",
      "font-size": (12 * k).toFixed(1), "font-weight": 900, fill: badgeText, class: "path-waypoint-text"
    });
    et.textContent = String(pts.length - 1);
  }

  /** 毛筆筆觸路徑（可選） */
  drawBrushPath(move, isAiHint = false, hintPlayer = null) {
    let pathData = move.path;
    if (!pathData || pathData.length < 2) {
      const fromR = move.fromR != null ? move.fromR : (move.from ? move.from.r : null);
      const fromC = move.fromC != null ? move.fromC : (move.from ? move.from.c : null);
      const toR   = move.toR   != null ? move.toR   : (move.to   ? move.to.r   : null);
      const toC   = move.toC   != null ? move.toC   : (move.to   ? move.to.c   : null);
      if (fromR == null || toR == null) { this.clearMovePath(); return; }
      pathData = [{ r: fromR, c: fromC }, { r: toR, c: toC }];
    }

    this.svgEl.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const who = isAiHint && hintPlayer != null ? hintPlayer : move.player;
    const color = who === BLACK ? "var(--path-black-fill, #111827)" : "var(--path-white-fill, #e2e8f0)";

    let seed = 2166136261;
    for (const p of pathData) seed = Math.imul(seed ^ (p.r * 8 + p.c + 1), 16777619);
    const rand = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rr = (a, b) => a + (b - a) * rand();

    const pts = pathData.map(pt => this.getCellCenter(pt.r, pt.c));
    const cs0 = this.cellElements[0][0].getBoundingClientRect().width || 64;
    const { samples, length: L } = this.sampleCenterline(pts, cs0 * 0.5);
    const M = samples.length;

    // 距離 d、側向偏移 lat → 座標
    const P = (d, lat) => {
      const fi = Math.min(M - 1, Math.max(0, (d / L) * (M - 1)));
      const i0 = Math.floor(fi), i1 = Math.min(M - 1, i0 + 1), u = fi - i0;
      const a = samples[i0], b = samples[i1];
      const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
      const nx = a.nx + (b.nx - a.nx) * u, ny = a.ny + (b.ny - a.ny) * u;
      return [x + nx * lat, y + ny * lat];
    };
    const poly = (arr) => arr.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const add = (parent, tag, attrs) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      parent.appendChild(el);
      return el;
    };

    const defs = add(this.svgEl, "defs", {});
    defs.innerHTML = `
      <filter id="brushInk" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>`;
    const g = add(this.svgEl, "g", { filter: "url(#brushInk)", opacity: isAiHint ? "0.55" : "1" });

    const cs = this.cellElements[0][0].getBoundingClientRect().width || 64;
    const S = (cs / 64) * 1.25;
    const headLen = Math.min(36 * S, L * 0.42);
    const headHalf = 24 * S;
    const baseD = L - headLen;
    const bodyEnd = Math.min(L, baseD + 12 * S);
    const MAXW = 13 * S;

    // 筆身寬度：尾部寬，微微起伏
    const W = (d) => {
      const u = Math.min(1, d / (bodyEnd * 0.5));
      return MAXW * (0.82 + 0.18 * Math.sin(u * Math.PI / 2));
    };

    // ① 墨色主體：全寬，邊緣帶毛刺
    const tailZone = Math.min(26 * S, bodyEnd * 0.4);
    const left = [], right = [];
    for (let d = tailZone; d <= bodyEnd; d += 3) {
      const j = d < tailZone + 8 * S ? 2.2 : 1;
      left.push(P(d, W(d) * 0.5 + rr(-j, j) * S));
      right.push(P(d, -W(d) * 0.5 + rr(-j, j) * S));
    }
    add(g, "path", {
      d: poly(left.concat(right.reverse())) + "Z",
      fill: color, opacity: "0.82"
    });

    // ② 飛白鬃毛：平行、長短不一、帶斷墨
    const K = 22;
    for (let k = 0; k < K; k++) {
      const u = -1 + (2 * k) / (K - 1) + rr(-0.06, 0.06);
      const e = Math.abs(u);
      const d0 = rand() < 0.7 ? rr(0, tailZone * 0.9) : rr(0, tailZone * 1.4);
      const d1 = bodyEnd * rr(0.82, 1) - e * rr(0, 0.12) * bodyEnd;
      const phase = rr(0, 6.28), freq = rr(0.04, 0.09), amp = rr(0.3, 1.1) * S;
      const cuts = rand() < 0.55 ? [rr(d0 + (d1 - d0) * 0.3, d0 + (d1 - d0) * 0.7)] : [];
      const gap = rr(6, 16) * S;
      const segs = [];
      let a = d0;
      for (const c of cuts) { segs.push([a, c - gap / 2]); a = c + gap / 2; }
      segs.push([a, d1]);
      const sw = rr(1.2, 2.8) * S * (1 - e * 0.25);
      const op = rr(0.5, 0.95) * (1 - e * 0.25);
      for (const [s0, s1] of segs) {
        if (s1 - s0 < 4) continue;
        const line = [];
        for (let d = s0; d <= s1; d += 3) {
          line.push(P(d, u * W(d) * 0.56 + Math.sin(d * freq + phase) * amp));
        }
        add(g, "path", {
          d: poly(line), fill: "none", stroke: color,
          "stroke-width": sw.toFixed(2), "stroke-linecap": "round",
          "stroke-linejoin": "round", opacity: op.toFixed(2)
        });
      }
    }

    // ③ 箭頭：帶倒鉤的多邊形，邊緣細分抖動成粗糙毛邊
    const keys = [
      [L, 0],
      [baseD - 4 * S, headHalf],
      [baseD + 2 * S, MAXW * 0.45],
      [baseD + 2 * S, -MAXW * 0.45],
      [baseD - 4 * S, -headHalf]
    ];
    const rough = [];
    for (let i = 0; i < keys.length; i++) {
      const a = keys[i], b = keys[(i + 1) % keys.length];
      const steps = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const jitter = ((s === 0 && (i === 0 || i === 1 || i === 4)) ? 0.4 : 2) * S;
        rough.push(P(a[0] + (b[0] - a[0]) * t + rr(-jitter, jitter),
                     a[1] + (b[1] - a[1]) * t + rr(-jitter, jitter)));
      }
    }
    add(g, "path", { d: poly(rough) + "Z", fill: color, opacity: "1" });

    // 箭頭內的墨色深淺條紋 + 順向飛白
    for (let k = 0; k < 9; k++) {
      const u = -0.85 + (1.7 * k) / 8 + rr(-0.05, 0.05);
      const dStart = baseD + rr(0, 4) * S;
      const dEnd = L - (rr(4, 14) + Math.abs(u) * 14) * S;
      const line = [];
      for (let t = 0; t <= 1.001; t += 0.1) {
        const d = dStart + (dEnd - dStart) * t;
        line.push(P(d, u * headHalf * (1 - 0.55 * t) * (1 - t * t * 0.4)));
      }
      const dark = k % 2 === 0;
      add(g, "path", {
        d: poly(line), fill: "none",
        stroke: dark ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)",
        "stroke-width": (rr(0.9, 1.8) * S).toFixed(2), "stroke-linecap": "round"
      });
    }

    // ④ 飛墨點
    for (let i = 0; i < 16; i++) {
      const d = rr(L * 0.1, L * 0.98);
      const side = rand() < 0.5 ? 1 : -1;
      const [x, y] = P(d, side * (MAXW * 0.5 + rr(3, 12) * S));
      add(g, "circle", {
        cx: x.toFixed(1), cy: y.toFixed(1), r: (rr(0.5, 1.7) * S).toFixed(2),
        fill: color, opacity: rr(0.35, 0.75).toFixed(2)
      });
    }
  }

  clearMovePath() {
    if (this.svgEl) {
      this.svgEl.innerHTML = "";
    }
  }


  /**
   * 渲染完整棋盤狀態 (棋子、合法走法標記、高亮選取、AI 推薦光暈)
   */
  render({
    board,
    currentTurn,
    selectedCell,
    legalMoves = { spawns: [], captures: [] },
    lastMove,
    endgameFilledCells = new Set(),
    activeAiHints = [],
    previewGhostMove = null,
    piecesWithMoves = new Set()
  }) {
    // For capture preview: determine which cells to suppress
    let ghostFromR = -1, ghostFromC = -1, ghostToR = -1, ghostToC = -1;
    const isCapturePreview = previewGhostMove && previewGhostMove.type === MOVE_TYPE.CAPTURE;
    if (previewGhostMove) {
      ghostFromR = previewGhostMove.fromR != null ? previewGhostMove.fromR : (previewGhostMove.from ? previewGhostMove.from.r : -1);
      ghostFromC = previewGhostMove.fromC != null ? previewGhostMove.fromC : (previewGhostMove.from ? previewGhostMove.from.c : -1);
      ghostToR = previewGhostMove.toR != null ? previewGhostMove.toR : (previewGhostMove.to ? previewGhostMove.to.r : -1);
      ghostToC = previewGhostMove.toC != null ? previewGhostMove.toC : (previewGhostMove.to ? previewGhostMove.to.c : -1);
    }

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = this.cellElements[r][c];
        const val = board[r][c];

        // 重設 class
        cell.className = "cell";
        cell.innerHTML = "";

        const coordName = posToCoord(r, c);

        // 1. 棋子本體 — for capture previews, suppress the attacker (from) and victim (to)
        const suppressPiece = isCapturePreview && (
          (r === ghostFromR && c === ghostFromC) ||
          (r === ghostToR && c === ghostToC)
        );
        if (val === BLACK && !suppressPiece) {
          const disc = document.createElement("div");
          disc.className = "disc black";
          cell.appendChild(disc);
          cell.setAttribute("aria-label", tr("cellBlack", { c: coordName }));
        } else if (val === WHITE && !suppressPiece) {
          const disc = document.createElement("div");
          disc.className = "disc white";
          cell.appendChild(disc);
          cell.setAttribute("aria-label", tr("cellWhite", { c: coordName }));
        } else if (val === BLACK || val === WHITE) {
          cell.setAttribute("aria-label", tr(val === BLACK ? "cellBlack" : "cellWhite", { c: coordName }));
        } else {
          cell.setAttribute("aria-label", tr("cellEmpty", { c: coordName }));
        }

        // 2. 可行動棋子高亮 (黃色輕微外框)
        if (piecesWithMoves.has(`${r},${c}`)) {
          cell.classList.add("can-act");
        }

        // 3. 當前選中棋子 (亮黃色選中態)
        if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
          cell.classList.add("selected");
        }

        // 4. 合法落子目標標記 (綠色生子、紅色吃子)
        const spawnMove = legalMoves.spawns.find(m => (m.toR != null ? m.toR : m.to.r) === r && (m.toC != null ? m.toC : m.to.c) === c);
        const captureMove = legalMoves.captures.find(m => (m.toR != null ? m.toR : m.to.r) === r && (m.toC != null ? m.toC : m.to.c) === c);

        if (spawnMove) {
          cell.classList.add("dest-spawn");
          const stepInfo = spawnMove.usedDiceVal ? " " + tr("stepsParen", { n: spawnMove.usedDiceVal }) : "";
          cell.title = tr("tipSpawn", { c: coordName, s: stepInfo });
          cell.setAttribute("aria-label", tr("cellSpawnable", { c: coordName, s: stepInfo }));

          if (spawnMove.usedDiceVal) {
            const badge = document.createElement("div");
            badge.className = "stepBadge";
            badge.textContent = tr("steps", { n: spawnMove.usedDiceVal });
            cell.appendChild(badge);
          }
        }

        if (captureMove) {
          cell.classList.add("dest-capture");
          const stepInfo = captureMove.usedDiceVal ? " " + tr("stepsParen", { n: captureMove.usedDiceVal }) : "";
          cell.title = tr("tipCapture", { c: coordName, s: stepInfo });
          cell.setAttribute("aria-label", tr("cellCapturable", { c: coordName, s: stepInfo }));

          if (captureMove.usedDiceVal) {
            const badge = document.createElement("div");
            badge.className = "stepBadge capture";
            badge.textContent = tr("steps", { n: captureMove.usedDiceVal });
            cell.appendChild(badge);
          }
        }

        // 5. 最後一步痕跡
        if (lastMove) {
          const lToR = lastMove.toR != null ? lastMove.toR : (lastMove.to ? lastMove.to.r : -1);
          const lToC = lastMove.toC != null ? lastMove.toC : (lastMove.to ? lastMove.to.c : -1);
          if (lToR === r && lToC === c) {
            cell.classList.add("lastMove");
          }
        }

        // 6. 終局勢力填滿格子
        if (endgameFilledCells && endgameFilledCells.has(`${r},${c}`)) {
          cell.classList.add("filled-territory");
        }

        // 7. AI 提示高亮 (紫色光芒)
        const hint = activeAiHints.find(h => {
          const m = h.move;
          return m && (m.toR != null ? m.toR : m.to.r) === r && (m.toC != null ? m.toC : m.to.c) === c;
        });
        if (hint) {
          cell.classList.add("ai-recommended");
          const rankBadge = document.createElement("div");
          rankBadge.className = "aiRankBadge";
          rankBadge.textContent = hint.rank === 1 ? "👑" : (hint.rank === 2 ? "🥈" : "🥉");
          cell.appendChild(rankBadge);
        }

        // 8. 預覽幽靈棋子 (Preview Ghost Disc)
        if (previewGhostMove) {
          const pToR = previewGhostMove.toR != null ? previewGhostMove.toR : previewGhostMove.to.r;
          const pToC = previewGhostMove.toC != null ? previewGhostMove.toC : previewGhostMove.to.c;
          if (pToR === r && pToC === c) {
            cell.classList.add("ghost-dest");
            const ghostDisc = document.createElement("div");
            ghostDisc.className = `disc ghost ${currentTurn === BLACK ? "black" : "white"}`;
            cell.appendChild(ghostDisc);
          }
        }
      }
    }

    // 繪製路徑
    if (previewGhostMove) {
      this.drawMovePath(previewGhostMove, true, currentTurn);
    } else if (lastMove) {
      this.drawMovePath(lastMove, false);
    } else {
      this.clearMovePath();
    }
  }
}
