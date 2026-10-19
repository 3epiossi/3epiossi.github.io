/**
 * 劃區爭霸 (District) - 棋盤視覺元件 (v6.0 自訂地圖輪廓版)
 *
 * 圖層由下而上：
 * 1. 連續政黨熱力圖：顏色＝領先政黨，深淺＝領先幅度；確定當選的選區直接換成勝選政黨色。
 * 2. 確定當選斜線：斜線密度代表該區人口占全國比例。
 * 3. 人口點圖：每格點數嚴格等於該格人口數。
 * 4. 棋格線、海岸線（地圖輪廓）、已放置牆塊、選區編號。
 * 5. 互動覆蓋層：游標預覽、AI 提示、選區/牆塊高亮。只有這一層會隨滑鼠重繪。
 *
 * 地圖輪廓：engine.map.cells[r][c].active === false 的棋格屬於地圖外（海），不繪製、不可放牆。
 */

import { canPlaceWall, isBoundaryVertex } from "../core/rules.js";
import { t, fmtNum } from "../i18n.js";
import { getPlacedGeometry } from "../core/shapes.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const BOARD_PX = 768;
const SUB_K = 8;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function hexToRgb(hex) {
  const num = parseInt(hex.replace("#", ""), 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixColors(hexA, hexB, weightA) {
  const w = Math.max(0, Math.min(1, weightA));
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: a.r * w + b.r * (1 - w),
    g: a.g * w + b.g * (1 - w),
    b: a.b * w + b.b * (1 - w)
  });
}

/** 確定性雜湊偽隨機產生器（確保同一局點子位置固定不閃爍） */
function createCellRng(seed, r, c) {
  let state = ((seed * 73856093) ^ ((r + 1) * 19349663) ^ ((c + 1) * 83492791)) >>> 0;
  if (state === 0) state = 1337;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BoardView {
  constructor(container, options = {}) {
    this.container = container;
    this.onPlaceWall = options.onPlaceWall || (() => {});
    this.selectedPoolIndex = null;
    this.selectedShape = null;
    this.interactive = true;
    this.engine = null;
    this.hoverPos = null;
    this.hoverCell = null;
    this.highlightRegionId = null;
    this.highlightWallId = null;
    this.hintMove = null;
    this.compareMode = false;
    this.compareRatio = 0.5;
    this.isDraggingDivider = false;
    this.lastPointerType = "mouse";

    this._cachedDotsSeed = null;
    this._cachedCellDots = null;
    this._staticKey = null;

    this._initElements();
  }

  _initElements() {
    this.container.innerHTML = "";

    this.svgWrapper = document.createElement("div");
    this.svgWrapper.classList.add("boardSvgWrapper");
    this.container.appendChild(this.svgWrapper);

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.classList.add("boardSvg");
    this.svgWrapper.appendChild(this.svg);

    // 游標旁浮動資訊卡：顯示棋格人口與放牆後的票數變化
    this.tip = document.createElement("div");
    this.tip.classList.add("boardTip");
    this.tip.style.display = "none";
    this.svgWrapper.appendChild(this.tip);

    this.legend = document.createElement("div");
    this.legend.classList.add("boardLegend");
    this.container.appendChild(this.legend);

    this.svg.addEventListener("pointermove", (e) => this._onPointerMove(e));
    this.svg.addEventListener("pointerleave", () => this._onPointerLeave());
    this.svg.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    this.svg.addEventListener("click", (e) => this._onClick(e));

    const stopDragging = (e) => {
      if (this.isDraggingDivider) {
        this.isDraggingDivider = false;
        try { if (e && e.pointerId) this.svg.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    this.svg.addEventListener("pointerup", stopDragging);
    this.svg.addEventListener("pointercancel", stopDragging);
  }

  get parties() {
    return this.engine ? this.engine.parties : [];
  }

  setEngine(engine) {
    this.engine = engine;
    this.boardSize = engine.boardSize;
    this.numPlayers = engine.numPlayers;
    this.compareMode = false;
    this.compareRatio = 0.5;
    this.isDraggingDivider = false;
    this.highlightRegionId = null;
    this.highlightWallId = null;
    this.hintMove = null;
    this.hoverCell = null;
    this.hoverPos = null;
    this._cachedDotsSeed = null;
    this._cachedCellDots = null;
    this._staticKey = null;
    this._nearestActive = null;
    this.render();
  }

  /** 進入對比時線在最左邊（先看劃區後的結果）；拖動後的位置保留 */
  setCompareMode(enabled, ratio = 0) {
    this.compareMode = !!enabled;
    if (ratio !== undefined) {
      this.compareRatio = Math.max(0, Math.min(1, ratio));
    }
    this.render();
  }

  setSelectedPiece(poolIndex, shape) {
    this.selectedPoolIndex = poolIndex;
    this.selectedShape = shape;
    this.renderOverlay();
  }

  /** 是否允許目前使用者放牆（電腦回合時關閉） */
  setInteractive(interactive) {
    this.interactive = Boolean(interactive);
    if (!this.interactive) this.hoverPos = null;
    this.renderOverlay();
  }

  setHighlightRegion(regionId) {
    if (this.highlightRegionId === regionId) return;
    this.highlightRegionId = regionId;
    this.renderOverlay();
  }

  setHighlightWall(wallId) {
    if (this.highlightWallId === wallId) return;
    this.highlightWallId = wallId;
    this.renderOverlay();
  }

  setHintMove(hintMove) {
    this.hintMove = hintMove;
    this.renderOverlay();
  }

  // ===========================================================================
  // 色彩計算
  // ===========================================================================

  /** 地圖外棋格對應到最近的陸地棋格，讓熱力圖在海岸線附近不會褪色 */
  _getNearestActive() {
    if (this._nearestActive) return this._nearestActive;
    const N = this.boardSize;
    const cells = this.engine.map.cells;
    const nearest = Array.from({ length: N }, () => Array(N).fill(null));
    const queue = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (cells[r][c].active !== false) {
          nearest[r][c] = [r, c];
          queue.push([r, c]);
        }
      }
    }
    let head = 0;
    while (head < queue.length) {
      const [r, c] = queue[head++];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N && !nearest[nr][nc]) {
          nearest[nr][nc] = nearest[r][c];
          queue.push([nr, nc]);
        }
      }
    }
    this._nearestActive = nearest;
    return nearest;
  }

  _resolveCell(r, c) {
    const N = this.boardSize;
    const rr = Math.max(0, Math.min(N - 1, r));
    const cc = Math.max(0, Math.min(N - 1, c));
    const [ar, ac] = this._getNearestActive()[rr][cc] || [rr, cc];
    return this.engine.map.cells[ar][ac];
  }

  /**
   * 在全盤連續座標 (gy, gx) 上平滑插值各政黨支持比例
   */
  _sampleContinuousSupport(gy, gx) {
    const numPlayers = this.engine.numPlayers;
    const getShare = (r, c, p) => {
      const cell = this._resolveCell(r, c);
      return cell.support[p] / (cell.population || 1);
    };

    const fy = gy - 0.5;
    const fx = gx - 0.5;
    const r0 = Math.floor(fy);
    const c0 = Math.floor(fx);
    const ty = fy - r0;
    const tx = fx - c0;
    const sy = ty * ty * (3 - 2 * ty);
    const sx = tx * tx * (3 - 2 * tx);

    const shares = Array(numPlayers).fill(0);
    for (let p = 0; p < numPlayers; p++) {
      const top = getShare(r0, c0, p) * (1 - sx) + getShare(r0, c0 + 1, p) * sx;
      const bot = getShare(r0 + 1, c0, p) * (1 - sx) + getShare(r0 + 1, c0 + 1, p) * sx;
      shares[p] = top * (1 - sy) + bot * sy;
    }
    const total = shares.reduce((a, b) => a + b, 0) || 1;
    return shares.map((v) => v / total);
  }

  /** 熱力圖色階：主色＝領先政黨，五五波處接近米白，鐵票區最濃 */
  _computeHeatmapColor(shares) {
    let bestP = 0;
    let bestVal = -1;
    let secondVal = -1;
    for (let p = 0; p < shares.length; p++) {
      if (shares[p] > bestVal) {
        secondVal = bestVal;
        bestVal = shares[p];
        bestP = p;
      } else if (shares[p] > secondVal) {
        secondVal = shares[p];
      }
    }

    const leadColor = this.parties[bestP] ? this.parties[bestP].color : "#94a3b8";
    const margin = Math.max(0, bestVal - Math.max(0, secondVal));
    const t = Math.min(1, Math.pow(margin / 0.48, 0.85));
    const paleBase = "#f4f6fb";

    if (t <= 0.80) {
      return mixColors(leadColor, paleBase, 0.06 + (t / 0.80) * 0.82);
    }
    const coreT = (t - 0.80) / 0.20;
    const vivid = mixColors(leadColor, paleBase, 0.88);
    const deepCore = mixColors("#1e1b4b", leadColor, 0.28);
    return mixColors(deepCore, vivid, coreT * 0.62);
  }

  _districtWinner(dist) {
    if (!dist) return null;
    if (dist.securedWinner !== null && dist.securedWinner !== undefined) return dist.securedWinner;
    return dist.winners && dist.winners.length === 1 ? dist.winners[0] : null;
  }

  /** 選票平分的選區（均分選區或平手選區）有資格分到票的政黨 id；其他選區回傳 null */
  _splitParties(dist) {
    if (!dist || !dist.isSecured) return null;
    if (dist.isVoid) return this.parties.map((_, i) => i);
    if (dist.winners && dist.winners.length > 1) return [...dist.winners];
    return null;
  }

  /** 確定當選選區底色：勝選政黨色，得票比例越高越濃 */
  _computeSecuredDistrictColor(dist) {
    if (!dist) return "#f1f5f9";
    const winnerId = this._districtWinner(dist);
    // 均分選區與平手選區（選票平分）統一使用中性灰底
    if (dist.isVoid || winnerId === null) return "#8b95a7";

    const color = this.parties[winnerId].color;
    const support = dist.support || [];
    const totalVotes = support.reduce((a, b) => a + b, 0) || 1;
    const winShare = (support[winnerId] || 0) / totalVotes;
    const minShare = 1 / (this.engine ? this.engine.numPlayers : 2);
    const dominance = Math.max(0, Math.min(1, (winShare - minShare) / (1 - minShare)));

    const paleBase = "#f8fafc";
    if (dominance <= 0.65) {
      return mixColors(color, paleBase, 0.35 + (dominance / 0.65) * 0.50);
    }
    const coreT = (dominance - 0.65) / 0.35;
    const vivid = mixColors(color, paleBase, 0.85);
    const deep = mixColors("#0f172a", color, 0.30);
    return mixColors(deep, vivid, coreT * 0.50);
  }

  /** 確定當選斜線：顏色同勝選政黨，密度代表該區人口占全國比例 */
  _computeSecuredDistrictHatch(dist, totalPopularVotes, S) {
    if (!dist) return null;
    const winnerId = this._districtWinner(dist);
    const isTie = winnerId === null;
    const party = isTie ? null : this.parties[winnerId];
    const support = dist.support || [];
    const totalVotes = support.reduce((a, b) => a + b, 0) || 1;
    const winShare = (isTie ? (support[0] || 0) : (support[winnerId] || 0)) / totalVotes;
    const minShare = 1 / (this.engine ? this.engine.numPlayers : 2);
    const dominance = isTie ? 0 : Math.max(0, Math.min(1, (winShare - minShare) / (1 - minShare)));

    let color;
    let opacity;
    if (isTie) {
      color = "#64748b";
      opacity = 0.82;
    } else {
      const darkCore = mixColors("#0f172a", party.color, 0.65);
      const lightTint = mixColors(party.color, "#ffffff", 0.70);
      color = dominance <= 0.5
        ? mixColors(party.color, lightTint, dominance / 0.5)
        : mixColors(darkCore, party.color, (dominance - 0.5) / 0.5);
      opacity = Number((0.68 + 0.28 * Math.pow(dominance, 0.75)).toFixed(2));
    }

    const distPop = dist.population || dist.votes || 100;
    const totalPop = totalPopularVotes || (this.engine ? this.engine.activeCellCount * 100 : 6400);
    const popRatio = distPop / totalPop;
    const curvedPop = Math.pow(Math.min(1, Math.max(0, (popRatio - 0.01) / 0.21)), 0.75);
    const scale = S ? S / 96 : 1;
    const spacing = Number(((25 - curvedPop * 17) * scale).toFixed(1));
    const width = Number(((2 + curvedPop * 0.8) * scale).toFixed(1));

    return {
      party,
      winnerId,
      winShare,
      dominance,
      color,
      opacity,
      popRatio,
      density: Number((1 / spacing).toFixed(4)),
      spacing,
      width,
      isTie
    };
  }

  // ===========================================================================
  // 人口點
  // ===========================================================================

  /** 為每一格生成剛好 cell.population 個點，跨格密度連續 */
  _ensureContinuousCellDots() {
    const N = this.boardSize;
    const seedKey = `${this.engine.seed}_${N}_${this.engine.activeCellCount}`;
    if (this._cachedDotsSeed === seedKey && this._cachedCellDots) {
      return this._cachedCellDots;
    }

    const cells = this.engine.map.cells;
    const getPop = (r, c) => this._resolveCell(r, c).population;

    const globalRng = createCellRng(this.engine.seed, 99, 99);
    const filaments = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const p = cells[r][c].population;
        if (p >= 115) {
          filaments.push({
            gy: r + 0.18 + 0.64 * globalRng(),
            gx: c + 0.18 + 0.64 * globalRng(),
            strength: (p - 95) / 42,
            sigma: 0.34 + 0.18 * globalRng()
          });
        }
      }
    }

    const density = (gy, gx) => {
      const fy = gy - 0.5;
      const fx = gx - 0.5;
      const r0 = Math.floor(fy);
      const c0 = Math.floor(fx);
      const ty = fy - r0;
      const tx = fx - c0;
      const sy = ty * ty * (3 - 2 * ty);
      const sx = tx * tx * (3 - 2 * tx);
      const basePop = (getPop(r0, c0) * (1 - sx) + getPop(r0, c0 + 1) * sx) * (1 - sy) +
        (getPop(r0 + 1, c0) * (1 - sx) + getPop(r0 + 1, c0 + 1) * sx) * sy;

      let filBoost = 0;
      for (const f of filaments) {
        const d2 = (gy - f.gy) ** 2 + (gx - f.gx) ** 2;
        if (d2 < 2.2) filBoost += f.strength * Math.exp(-d2 / (2 * f.sigma * f.sigma));
      }
      const norm = Math.max(0.02, (basePop - 12) / 273);
      return Math.pow(norm, 2.6) * (1 + 2.6 * filBoost);
    };

    const allCellDots = Array.from({ length: N }, () => Array(N));
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const pop = cells[r][c].population;
        const pts = [];
        if (pop > 0) {
          const rng = createCellRng(this.engine.seed, r, c);
          let maxW = 0.005;
          for (let sr = 0; sr < 5; sr++) {
            for (let sc = 0; sc < 5; sc++) {
              maxW = Math.max(maxW, density(r + (sr + 0.5) / 5, c + (sc + 0.5) / 5));
            }
          }
          let attempts = 0;
          while (pts.length < pop && attempts++ < pop * 40) {
            const u = 0.012 + 0.976 * rng();
            const v = 0.012 + 0.976 * rng();
            if (rng() * maxW <= density(r + v, c + u)) pts.push({ u, v });
          }
          while (pts.length < pop) {
            pts.push({ u: 0.015 + 0.97 * rng(), v: 0.015 + 0.97 * rng() });
          }
        }
        allCellDots[r][c] = pts;
      }
    }

    this._cachedDotsSeed = seedKey;
    this._cachedCellDots = allCellDots;
    return allCellDots;
  }

  // ===========================================================================
  // 幾何工具
  // ===========================================================================

  _isActive(r, c) {
    const N = this.boardSize;
    return r >= 0 && r < N && c >= 0 && c < N && this.engine.map.cells[r][c].active !== false;
  }

  /** 所有陸地棋格聯集的 path（供裁切與海岸填色） */
  _landPathD() {
    const S = this.S;
    let d = "";
    for (let r = 0; r < this.boardSize; r++) {
      for (let c = 0; c < this.boardSize; c++) {
        if (this._isActive(r, c)) d += `M${c * S} ${r * S}h${S}v${S}h${-S}z`;
      }
    }
    return d;
  }

  /** 棋格內部格線（兩側皆為陸地）與海岸線（恰一側為陸地） */
  _gridAndCoastPaths() {
    const N = this.boardSize;
    const S = this.S;
    let grid = "";
    let coast = "";
    for (let r = 0; r <= N; r++) {
      for (let c = 0; c < N; c++) {
        const a = this._isActive(r - 1, c);
        const b = this._isActive(r, c);
        if (a && b) grid += `M${c * S} ${r * S}h${S}`;
        else if (a !== b) coast += `M${c * S} ${r * S}h${S}`;
      }
    }
    for (let c = 0; c <= N; c++) {
      for (let r = 0; r < N; r++) {
        const a = this._isActive(r, c - 1);
        const b = this._isActive(r, c);
        if (a && b) grid += `M${c * S} ${r * S}v${S}`;
        else if (a !== b) coast += `M${c * S} ${r * S}v${S}`;
      }
    }
    return { grid, coast };
  }

  /** 把熱力圖畫在 canvas 上再嵌入 SVG（每手只算一次），無 canvas 環境時退回 SVG 方塊 */
  _buildHeatLayer(colorAt) {
    const N = this.boardSize;
    // 四周多畫一格寬的延伸區，避免模糊濾鏡在外框與海岸線處淡出
    const halo = SUB_K;
    const total = N * SUB_K + halo * 2;
    const step = this.S / SUB_K;
    const canvas = typeof document.createElement === "function" ? document.createElement("canvas") : null;
    const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;

    if (ctx) {
      canvas.width = total;
      canvas.height = total;
      for (let sr = 0; sr < total; sr++) {
        for (let sc = 0; sc < total; sc++) {
          ctx.fillStyle = colorAt(sr - halo, sc - halo);
          ctx.fillRect(sc, sr, 1, 1);
        }
      }
      return svgEl("image", {
        href: canvas.toDataURL(),
        x: -this.S,
        y: -this.S,
        width: this.boardInner + this.S * 2,
        height: this.boardInner + this.S * 2,
        preserveAspectRatio: "none",
        filter: "url(#heatmap-smooth)"
      });
    }

    const g = svgEl("g", { filter: "url(#heatmap-smooth)" });
    g.classList.add("continuousHeatmapLayer");
    for (let sr = 0; sr < total; sr++) {
      for (let sc = 0; sc < total; sc++) {
        g.appendChild(svgEl("rect", {
          x: ((sc - halo) * step).toFixed(1),
          y: ((sr - halo) * step).toFixed(1),
          width: (step + 0.9).toFixed(1),
          height: (step + 0.9).toFixed(1),
          fill: colorAt(sr - halo, sc - halo)
        }));
      }
    }
    return g;
  }

  // ===========================================================================
  // 主繪製
  // ===========================================================================

  render() {
    if (!this.engine) return;
    const N = this.boardSize;
    const S = Math.round(BOARD_PX / N);
    const pad = Math.round(S * 0.22);
    this.S = S;
    this.pad = pad;
    this.wallWidth = Math.max(5, S * 0.105);
    this.g = this.wallWidth / 2 + 1;
    this.boardInner = N * S;
    this.boardInnerW = N * S;
    this.boardInnerH = N * S;

    // 視窗只框住陸地的外接矩形，讓不規則地圖盡量放大
    let minR = N, maxR = -1, minC = N, maxC = -1;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!this._isActive(r, c)) continue;
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
    if (maxR < 0) { minR = 0; maxR = N - 1; minC = 0; maxC = N - 1; }
    this.viewX = minC * S;
    this.viewY = minR * S;
    this.totalW = (maxC - minC + 1) * S + pad * 2;
    this.totalH = (maxR - minR + 1) * S + pad * 2;
    this.svgWrapper.style.setProperty("--aspect", (this.totalW / this.totalH).toFixed(4));

    const staticKey = `${this.engine.version}|${this.compareMode}|${N}`;
    if (staticKey !== this._staticKey || !this.gOverlay) {
      this._staticKey = staticKey;
      this._renderStatic();
    }
    this._renderLegend();
    this.renderOverlay();
  }

  _renderStatic() {
    const N = this.boardSize;
    const S = this.S;
    const report = this.engine.getAnalyticsReport();
    const totalPop = report.totalPopularVotes || this.engine.activeCellCount * 100;

    this.svg.setAttribute("viewBox", `${this.viewX} ${this.viewY} ${this.totalW} ${this.totalH}`);
    this.svg.innerHTML = "";
    this.svg.style.cursor = this.compareMode ? "ew-resize" : "default";

    const landD = this._landPathD();
    const { grid, coast } = this._gridAndCoastPaths();

    const defs = svgEl("defs");
    const clip = svgEl("clipPath", { id: "land-clip" });
    clip.appendChild(svgEl("path", { d: landD }));
    defs.appendChild(clip);

    const heatFilter = svgEl("filter", { id: "heatmap-smooth", x: "0", y: "0", width: "100%", height: "100%" });
    heatFilter.appendChild(svgEl("feGaussianBlur", { stdDeviation: (S / 11).toFixed(2), edgeMode: "duplicate" }));
    defs.appendChild(heatFilter);

    for (const dist of report.districts) {
      if (!dist.isSecured) continue;
      const split = this._splitParties(dist);
      if (split) {
        // 平分選區：各有資格的政黨以等寬 45° 斜線輪流排列，每黨占相同面積
        const w = Math.max(5, S * 0.14);
        const total = w * split.length;
        const stripes = svgEl("pattern", {
          id: `split-stripes-${dist.id}`,
          width: total,
          height: total,
          patternUnits: "userSpaceOnUse",
          patternTransform: "rotate(45)"
        });
        split.forEach((partyId, i) => {
          stripes.appendChild(svgEl("rect", {
            x: (i * w).toFixed(2), y: 0, width: (w + 0.4).toFixed(2), height: total,
            fill: this.parties[partyId].color
          }));
        });
        defs.appendChild(stripes);
        continue;
      }
      const hatch = this._computeSecuredDistrictHatch(dist, totalPop, S);
      const pat = svgEl("pattern", {
        id: `secured-hatch-${dist.id}`,
        width: hatch.spacing,
        height: hatch.spacing,
        patternUnits: "userSpaceOnUse",
        patternTransform: "rotate(45)"
      });
      const half = (hatch.spacing / 2).toFixed(2);
      pat.appendChild(svgEl("line", {
        x1: half, y1: 0, x2: half, y2: hatch.spacing,
        stroke: hatch.color,
        "stroke-width": hatch.width,
        "stroke-opacity": hatch.opacity
      }));
      defs.appendChild(pat);
    }

    const vis = this._visibleBox();
    const sliderX = vis.x + vis.w * this.compareRatio;
    if (this.compareMode) {
      const cb = svgEl("clipPath", { id: "compare-before-clip" });
      cb.appendChild(svgEl("rect", { id: "compare-before-rect", x: vis.x, y: vis.y, width: (sliderX - vis.x).toFixed(1), height: vis.h }));
      defs.appendChild(cb);
      const ca = svgEl("clipPath", { id: "compare-after-clip" });
      ca.appendChild(svgEl("rect", { id: "compare-after-rect", x: sliderX.toFixed(1), y: vis.y, width: (vis.x + vis.w - sliderX).toFixed(1), height: vis.h }));
      defs.appendChild(ca);
    }
    this.svg.appendChild(defs);

    const gBoard = svgEl("g", { transform: `translate(${this.pad}, ${this.pad})` });
    this.svg.appendChild(gBoard);
    this.gBoard = gBoard;

    // 陸地底色（熱力圖 canvas 尚未載入前不會閃黑）
    const landBase = svgEl("path", { d: landD, fill: "#e8ecf4" });
    landBase.classList.add("landBase");
    gBoard.appendChild(landBase);

    const cellDistrictMap = new Map();
    for (const d of report.districts) {
      for (const [cr, cc] of d.cells) cellDistrictMap.set(`${cr},${cc}`, d);
    }
    const nearest = this._getNearestActive();
    const districtAt = (r, c) => {
      const rr = Math.max(0, Math.min(N - 1, r));
      const cc = Math.max(0, Math.min(N - 1, c));
      const [ar, ac] = nearest[rr][cc] || [rr, cc];
      return cellDistrictMap.get(`${ar},${ac}`);
    };

    const naturalAt = (sr, sc) => this._computeHeatmapColor(this._sampleContinuousSupport((sr + 0.5) / SUB_K, (sc + 0.5) / SUB_K));
    const securedCache = new Map();
    const afterAt = (sr, sc) => {
      const dist = districtAt(Math.floor(sr / SUB_K), Math.floor(sc / SUB_K));
      if (dist && dist.isSecured) {
        if (!securedCache.has(dist.id)) securedCache.set(dist.id, this._computeSecuredDistrictColor(dist));
        return securedCache.get(dist.id);
      }
      return naturalAt(sr, sc);
    };

    // 人口點 path
    const allCellDots = this._ensureContinuousCellDots();
    const parts = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const pt of allCellDots[r][c]) {
          parts.push(`M${(c * S + pt.u * S).toFixed(1)} ${(r * S + pt.v * S).toFixed(1)}l0.01 0`);
        }
      }
    }
    const dotsD = parts.join("");
    const buildDots = () => {
      const g = svgEl("g", { "pointer-events": "none" });
      g.classList.add("continuousPopulationDotsLayer");
      g.appendChild(svgEl("path", {
        d: dotsD,
        fill: "none",
        stroke: "#0f172a",
        "stroke-opacity": 0.8,
        "stroke-width": Math.max(1.2, S * 0.0225).toFixed(2),
        "stroke-linecap": "round"
      }));
      return g;
    };

    const buildHatch = () => {
      const g = svgEl("g", { "pointer-events": "none" });
      g.classList.add("securedDistrictHatchLayer");
      for (const dist of report.districts) {
        if (!dist.isSecured) continue;
        let d = "";
        for (const [r, c] of dist.cells) d += `M${c * S} ${r * S}h${S}v${S}h${-S}z`;
        const patternId = this._splitParties(dist) ? `split-stripes-${dist.id}` : `secured-hatch-${dist.id}`;
        const p = svgEl("path", { d, fill: `url(#${patternId})`, "fill-opacity": this._splitParties(dist) ? 0.88 : 1 });
        p.classList.add("securedHatchCell");
        p.setAttribute("data-district-id", String(dist.id));
        g.appendChild(p);
      }
      return g;
    };

    const buildLines = () => {
      const g = svgEl("g", { "pointer-events": "none" });
      g.appendChild(svgEl("path", { d: grid, fill: "none", stroke: "rgba(15, 23, 42, 0.30)", "stroke-width": 1 }));
      const coastPath = svgEl("path", {
        d: coast,
        fill: "none",
        stroke: "#cbd5e1",
        "stroke-width": Math.max(2, S * 0.035).toFixed(1),
        "stroke-linecap": "square"
      });
      coastPath.classList.add("coastline");
      g.appendChild(coastPath);
      return g;
    };

    const buildWalls = () => {
      const g = svgEl("g", { "pointer-events": "none" });
      for (const wall of this.engine.boardState.placedWalls) {
        const party = this.parties[wall.playerId];
        this._renderWallPiece(g, wall.geometry, party ? party.color : "#f59e0b");
      }
      return g;
    };

    const buildBadges = () => {
      const g = svgEl("g", { "pointer-events": "none" });
      g.classList.add("securedDistrictBadgesLayer");
      const k = Math.max(0.72, S / 96);
      for (const dist of report.districts) {
        if (!dist.isSecured || !dist.cells.length) continue;
        const avgR = dist.cells.reduce((s, [r]) => s + r, 0) / dist.cells.length;
        const avgC = dist.cells.reduce((s, [, c]) => s + c, 0) / dist.cells.length;
        let best = dist.cells[0];
        let minD = Infinity;
        for (const [r, c] of dist.cells) {
          const d = (r - avgR) ** 2 + (c - avgC) ** 2;
          if (d < minD) { minD = d; best = [r, c]; }
        }
        const cx = (best[1] + 0.5) * S;
        const cy = (best[0] + 0.5) * S;
        const winnerId = this._districtWinner(dist);
        const color = winnerId !== null ? this.parties[winnerId].color : "#94a3b8";
        const label = `${dist.displayId}`;
        const w = (label.length >= 3 ? 30 : label.length === 2 ? 25 : 20) * k;
        const h = 18 * k;
        const badge = svgEl("g");
        badge.classList.add("securedDistrictBadge");
        badge.appendChild(svgEl("rect", {
          x: (cx - w / 2).toFixed(1), y: (cy - h / 2).toFixed(1), width: w.toFixed(1), height: h.toFixed(1),
          rx: (h / 2).toFixed(1), fill: "#0b1120", "fill-opacity": 0.88, stroke: color, "stroke-width": 1.6
        }));
        const text = svgEl("text", {
          x: cx.toFixed(1), y: (cy + 3.8 * k).toFixed(1), "text-anchor": "middle",
          "font-size": (11 * k).toFixed(1), "font-weight": 800, fill: "#ffffff"
        });
        text.textContent = label;
        badge.appendChild(text);
        g.appendChild(badge);
      }
      return g;
    };

    const surface = svgEl("g", { "clip-path": "url(#land-clip)" });
    gBoard.appendChild(surface);

    if (this.compareMode) {
      const before = svgEl("g", { "clip-path": "url(#compare-before-clip)" });
      before.appendChild(this._buildHeatLayer(naturalAt));
      before.appendChild(buildDots());
      surface.appendChild(before);
      const after = svgEl("g", { "clip-path": "url(#compare-after-clip)" });
      after.appendChild(this._buildHeatLayer(afterAt));
      after.appendChild(buildHatch());
      after.appendChild(buildDots());
      surface.appendChild(after);
      gBoard.appendChild(buildLines());
      const wallsAfter = svgEl("g", { "clip-path": "url(#compare-after-clip)" });
      wallsAfter.appendChild(buildWalls());
      wallsAfter.appendChild(buildBadges());
      gBoard.appendChild(wallsAfter);
      gBoard.appendChild(this._buildCompareDivider(sliderX));
    } else {
      surface.appendChild(this._buildHeatLayer(afterAt));
      surface.appendChild(buildHatch());
      surface.appendChild(buildDots());
      gBoard.appendChild(buildLines());
      gBoard.appendChild(buildWalls());
      gBoard.appendChild(buildBadges());
    }

    this.gOverlay = svgEl("g", { "pointer-events": "none" });
    this.gOverlay.classList.add("boardOverlay");
    gBoard.appendChild(this.gOverlay);
  }

  /** 棋盤座標中目前可見的範圍（已扣除外框留白的平移） */
  _visibleBox() {
    return { x: this.viewX - this.pad, y: this.viewY - this.pad, w: this.totalW, h: this.totalH };
  }

  _buildCompareDivider(sliderX) {
    const v = this._visibleBox();
    const g = svgEl("g");
    g.classList.add("compareDividerGroup");
    g.appendChild(svgEl("line", { id: "compareDividerLine", x1: sliderX.toFixed(1), y1: v.y, x2: sliderX.toFixed(1), y2: v.y + v.h, stroke: "#ffffff", "stroke-width": 2.5, "pointer-events": "none" }));

    return g;
  }

  _updateDividerPos(clientX) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width) return;
    const v = this._visibleBox();
    const rawX = (clientX - rect.left) * (v.w / rect.width) + v.x;
    const x = Math.max(v.x, Math.min(v.x + v.w, rawX));
    this.compareRatio = (x - v.x) / v.w;
    const set = (sel, attrs) => {
      const el = this.svg.querySelector(sel);
      if (el) for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, val);
    };
    set("#compare-before-rect", { width: (x - v.x).toFixed(1) });
    set("#compare-after-rect", { x: x.toFixed(1), width: (v.x + v.w - x).toFixed(1) });
    set("#compareDividerLine", { x1: x.toFixed(1), x2: x.toFixed(1) });
  }

  _renderLegend() {
    if (this.compareMode) {
      this.legend.textContent = t("legendCompare");
      return;
    }
    this.legend.innerHTML = `
      <span><i class="lgSwatch heat"></i>${t("legendHeat")}</span>
      <span><i class="lgSwatch dots"></i>${t("legendDots")}</span>
      <span><i class="lgSwatch hatch"></i>${t("legendHatch")}</span>
    `;
  }

  /** 互動覆蓋層：只重繪這一層，滑鼠移動時不重算熱力圖 */
  renderOverlay() {
    if (!this.engine || !this.gOverlay) return;
    const S = this.S;
    const overlay = this.gOverlay;
    overlay.innerHTML = "";
    const report = this.engine.getAnalyticsReport();

    if (this.highlightRegionId !== null && !this.compareMode) {
      const dist = report.districts.find((d) => d.id === this.highlightRegionId);
      if (dist) {
        let d = "";
        for (const [r, c] of dist.cells) d += `M${c * S} ${r * S}h${S}v${S}h${-S}z`;
        overlay.appendChild(svgEl("path", { d, fill: "#facc15", "fill-opacity": 0.22, stroke: "#facc15", "stroke-width": 2 }));
      }
    }

    if (this.highlightWallId !== null && !this.compareMode) {
      const wall = this.engine.boardState.placedWalls.find((w) => w.id === this.highlightWallId);
      if (wall) this._renderWallPiece(overlay, wall.geometry, this.parties[wall.playerId].color, false, true, true);
    }

    if (this.hoverCell && !this.compareMode) {
      const { r, c } = this.hoverCell;
      overlay.appendChild(svgEl("rect", { x: c * S, y: r * S, width: S, height: S, fill: "none", stroke: "#0f172a", "stroke-width": 2, "stroke-opacity": 0.7 }));
    }

    if (this.hintMove && this.hintMove.action === "place" && this.hintMove.shape && !this.engine.isGameOver) {
      const d = this._buildWallPathD(getPlacedGeometry(this.hintMove.shape, this.hintMove.vr, this.hintMove.vc));
      if (d) {
        const hint = svgEl("g");
        hint.classList.add("aiHintWallPath");
        hint.appendChild(svgEl("path", { d, fill: "none", stroke: "#facc15", "stroke-width": (this.wallWidth + 6).toFixed(1), "stroke-opacity": 0.35, "stroke-linejoin": "round" }));
        hint.appendChild(svgEl("path", { d, fill: "none", stroke: "#facc15", "stroke-width": (this.wallWidth - 1).toFixed(1), "stroke-dasharray": "8 6", "stroke-linejoin": "round" }));
        overlay.appendChild(hint);
      }
    }

    const canPreview = this.interactive && this.selectedShape && this.hoverPos && !this.engine.isGameOver && !this.compareMode;
    let preview = null;
    let check = null;
    if (canPreview) {
      const { vr, vc } = this.hoverPos;
      check = canPlaceWall(this.engine.boardState, this.selectedShape, vr, vc);
      // 不合法的位置不畫牆（以前畫成紅色，會跟紅黨的牆搞混），只在提示框說明原因
      if (check.valid) {
        this._renderWallPiece(overlay, getPlacedGeometry(this.selectedShape, vr, vc), this.parties[this.engine.currentPlayer].color, true);
        preview = this.engine.previewMoveDelta(this.selectedPoolIndex, vr, vc);
      }
    }
    this._renderTip(canPreview ? { check, preview } : null);
  }

  _renderTip(placement) {
    const cell = this.hoverCell ? this.engine.map.cells[this.hoverCell.r][this.hoverCell.c] : null;
    if (!cell && !placement) {
      this.tip.style.display = "none";
      return;
    }

    let html = "";
    if (placement) {
      if (!placement.check.valid) {
        const reason = {
          ON_BORDER: t("errOnBorder"),
          MIDPOINT_ON_BORDER: t("errMidBorder"),
          OUT_OF_BOUNDS: t("errOut"),
          EDGE_OVERLAP: t("errOverlap"),
          MIDPOINT_SHARED: t("errShared"),
          MIDPOINT_OUT_OF_BOUNDS: t("errOut")
        }[placement.check.reason] || placement.check.detail;
        html += `<div class="tipHead invalid">${t("tipInvalid", { r: reason })}</div>`;
      } else if (placement.preview) {
        const p = placement.preview;
        const deltas = p.delta.map((d, i) => {
          const r = Math.round(d);
          if (r === 0) return "";
          return `<span class="tipDelta" style="color:${this.parties[i].color}">${this.parties[i].shortName} ${r > 0 ? "+" : ""}${r}</span>`;
        }).filter(Boolean).join("");
        const head = p.regionDelta > 0 ? t("tipNewDistricts", { n: p.regionDelta }) : t("tipExtend");
        html += `<div class="tipHead">${head}<span class="tipAction">${this.lastPointerType === "touch" ? t("tipTap") : t("tipClick")}</span></div>`;
        if (deltas) html += `<div class="tipDeltas">${deltas}</div>`;
      }
    }

    if (cell) {
      const total = cell.population || 1;
      const bar = cell.support.map((v, i) => `<i style="width:${(v / total) * 100}%;background:${this.parties[i].color}"></i>`).join("");
      const order = cell.support.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3);
      const pcts = order.map(([v, i]) => `<span style="color:${this.parties[i].color}">${this.parties[i].shortName} ${Math.round((v / total) * 100)}%</span>`).join("");
      html += `<div class="tipCell"><span class="tipPop">${t("tipVoters", { n: fmtNum(cell.population) })}</span>${pcts}</div><div class="tipBar">${bar}</div>`;
    }

    this.tip.innerHTML = html;
    this.tip.style.display = "block";
  }

  // ===========================================================================
  // 牆塊繪製
  // ===========================================================================

  _getOrderedVertices(geometry) {
    const { edges, endpoints } = geometry;
    if (!edges || !edges.length || !endpoints || endpoints.length < 2) return [];
    const adj = this._adjacency(edges);
    const start = endpoints[0];
    const chain = [start];
    const visited = new Set([`${start[0]},${start[1]}`]);
    let curr = start;
    while (true) {
      const next = (adj.get(`${curr[0]},${curr[1]}`) || []).find((nb) => !visited.has(`${nb[0]},${nb[1]}`));
      if (!next) break;
      visited.add(`${next[0]},${next[1]}`);
      chain.push(next);
      curr = next;
    }
    return chain;
  }

  _adjacency(edges) {
    const adj = new Map();
    const add = (u, v) => {
      const uk = `${u[0]},${u[1]}`;
      const vk = `${v[0]},${v[1]}`;
      if (!adj.has(uk)) adj.set(uk, []);
      if (!adj.has(vk)) adj.set(vk, []);
      adj.get(uk).push(v);
      adj.get(vk).push(u);
    };
    for (const e of edges) {
      if (e.type === "H") add([e.r, e.c], [e.r, e.c + 1]);
      else add([e.r, e.c], [e.r + 1, e.c]);
    }
    return adj;
  }

  /** 單一連續、端點平頭內縮的牆塊 path；端點落在外框或海岸線上時不內縮 */
  _buildWallPathD(geometry) {
    const { S, g } = this;
    const { edges } = geometry;
    if (!edges || !edges.length) return "";
    const vx = (vc) => vc * S;
    const vy = (vr) => vr * S;
    const state = this.engine.boardState;

    const terminal = ([vr, vc], [ar, ac]) => {
      let x = vx(vc);
      let y = vy(vr);
      if (!isBoundaryVertex(state, vr, vc)) {
        if (ar === vr) x += ac > vc ? g : -g;
        else y += ar > vr ? g : -g;
      }
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    };

    const adj = this._adjacency(edges);
    let junction = null;
    for (const [k, nbs] of adj.entries()) {
      if (nbs.length === 3) {
        junction = { v: k.split(",").map(Number), nbs };
        break;
      }
    }

    if (junction) {
      const [j, nbs] = [junction.v, junction.nbs];
      let a = null, b = null, stem = null;
      for (let i = 0; i < 3 && !a; i++) {
        for (let k = i + 1; k < 3; k++) {
          if (nbs[i][0] - j[0] === -(nbs[k][0] - j[0]) && nbs[i][1] - j[1] === -(nbs[k][1] - j[1])) {
            a = nbs[i];
            b = nbs[k];
            stem = nbs[3 - i - k];
            break;
          }
        }
      }
      const stemEnd = (adj.get(`${stem[0]},${stem[1]}`) || []).find((n) => !(n[0] === j[0] && n[1] === j[1])) || stem;
      return `M ${terminal(a, j)} L ${vx(j[1])} ${vy(j[0])} L ${terminal(b, j)} ` +
        `M ${vx(j[1])} ${vy(j[0])} L ${vx(stem[1])} ${vy(stem[0])} L ${terminal(stemEnd, stem)}`;
    }

    const verts = this._getOrderedVertices(geometry);
    if (verts.length < 2) return "";
    let d = `M ${terminal(verts[0], verts[1])}`;
    for (let i = 1; i < verts.length - 1; i++) d += ` L ${vx(verts[i][1])} ${vy(verts[i][0])}`;
    d += ` L ${terminal(verts[verts.length - 1], verts[verts.length - 2])}`;
    return d;
  }

  _renderWallPiece(container, geometry, color, isPreview = false, isValid = true, isHighlighted = false) {
    const w = this.wallWidth || 9;
    const d = this._buildWallPathD(geometry);
    if (!d) return;
    const group = svgEl("g");
    group.classList.add(isPreview ? "previewWallPath" : "placedWallPath");
    const stroke = (attrs) => group.appendChild(svgEl("path", { d, fill: "none", "stroke-linecap": "butt", "stroke-linejoin": "round", ...attrs }));
    if (isHighlighted) stroke({ stroke: "#facc15", "stroke-width": (w + 9).toFixed(1), "stroke-opacity": 0.75 });
    stroke({ stroke: "#090d16", "stroke-width": (w + 3.6).toFixed(1), "stroke-opacity": isPreview ? 0.7 : 1 });
    stroke({ stroke: color, "stroke-width": w.toFixed(1), "stroke-opacity": isPreview ? (isValid ? 0.9 : 0.75) : 1 });
    if (!isPreview) stroke({ stroke: "#ffffff", "stroke-opacity": 0.4, "stroke-width": Math.max(1.4, w * 0.24).toFixed(1) });
    container.appendChild(group);
  }

  // ===========================================================================
  // 指標事件
  // ===========================================================================

  _eventToBoard(e) {
    const rect = this.svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.totalW / rect.width) + this.viewX - this.pad;
    const y = (e.clientY - rect.top) * (this.totalH / rect.height) + this.viewY - this.pad;
    return { x: x / this.S, y: y / this.S };
  }

  /** 牆塊以游標為中心：錨點＝游標位置減去形狀外接框一半 */
  _anchorFor(gx, gy) {
    if (!this.selectedShape) return null;
    let maxR = 0;
    let maxC = 0;
    for (const e of this.selectedShape.edges) {
      maxR = Math.max(maxR, e.type === "V" ? e.r + 1 : e.r);
      maxC = Math.max(maxC, e.type === "H" ? e.c + 1 : e.c);
    }
    return { vr: Math.round(gy - maxR / 2), vc: Math.round(gx - maxC / 2) };
  }

  _onPointerDown(e) {
    this.lastPointerType = e.pointerType || "mouse";
    if (this.compareMode) {
      this.isDraggingDivider = true;
      this._updateDividerPos(e.clientX);
      try { this.svg.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  _onPointerMove(e) {
    if (!this.engine) return;
    if (this.compareMode) {
      if (this.isDraggingDivider) this._updateDividerPos(e.clientX);
      return;
    }
    if (e.pointerType === "touch") return;
    this._updateHover(e);
  }

  _updateHover(e) {
    const { x, y } = this._eventToBoard(e);
    const r = Math.floor(y);
    const c = Math.floor(x);
    const cell = this._isActive(r, c) ? { r, c } : null;
    const anchor = this.interactive && !this.engine.isGameOver ? this._anchorFor(x, y) : null;

    const rect = this.svgWrapper.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    this.tip.style.left = `${px}px`;
    this.tip.style.top = `${py}px`;
    this.tip.classList.toggle("flip", px > rect.width * 0.6);
    this.tip.classList.toggle("below", py < rect.height * 0.28);

    const cellChanged = (cell?.r !== this.hoverCell?.r) || (cell?.c !== this.hoverCell?.c);
    const posChanged = (anchor?.vr !== this.hoverPos?.vr) || (anchor?.vc !== this.hoverPos?.vc);
    this.hoverCell = cell;
    this.hoverPos = anchor;
    if (cellChanged || posChanged) this.renderOverlay();
    return posChanged;
  }

  _onPointerLeave() {
    if (this.lastPointerType === "touch") return;
    this.hoverCell = null;
    this.hoverPos = null;
    this.renderOverlay();
  }

  _onClick(e) {
    if (!this.engine || this.engine.isGameOver || this.compareMode || !this.interactive || !this.selectedShape) return;
    // 觸控：第一次點擊只預覽，同一位置再點一次才放置
    if (this.lastPointerType === "touch") {
      const changed = this._updateHover(e);
      if (changed) return;
    }
    if (!this.hoverPos) return;
    const { vr, vc } = this.hoverPos;
    if (!canPlaceWall(this.engine.boardState, this.selectedShape, vr, vc).valid) return;
    this.onPlaceWall(this.selectedPoolIndex, vr, vc);
  }
}
