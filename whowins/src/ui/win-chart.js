/**
 * 勝率折線圖（取代棋譜清單）：x 軸是第幾手；y 軸和勝率條一樣，白方在上、黑方在下（與勝率條同一套校準換算）。
 * 上半部（白方佔優）是蒙上一層白的深灰底，下半部（黑方佔優）是黑底。
 *
 * - 主線一條線、每一手一個點；從歷史某一步開了分支時，主線變暗，分支從分岔點岔出另一條紫色的線。
 * - 點圖上任一處：跳到那一手（目前這條線還沒下到的「未來」區域不反應）。
 * - 滑鼠移過去：顯示那一手的棋譜文字、評價（!! ! !? ?! ? ??）與勝率。
 * - 走法評價（!! ! !? ?! ? ??）畫成線上的彩色圓點。
 */

import { tr, tx, escapeHtml } from "../i18n.js";

const W = 600, H = 300;
const PAD = { l: 34, r: 10, t: 10, b: 22 };
const MARK_COLOR = { "!!": "#1baca6", "!": "#22a06b", "!?": "#4f8cdb", "?!": "#ca8a04", "?": "#f59e0b", "??": "#dc2626" };

export class WinChart {
  /**
   * @param {object} o
   * @param {HTMLElement} o.container
   * @param {(step:number) => void} o.onPick 點到第 step 手
   */
  constructor({ container, onPick }) {
    this.container = container;
    this.onPick = onPick;
    this.data = null;
    container.innerHTML = `
      <div class="winChartWrap">
        <svg class="winChart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"></svg>
        <div class="winChartTip" hidden></div>
      </div>`;
    this.svg = container.querySelector("svg");
    this.tip = container.querySelector(".winChartTip");
    this.svg.addEventListener("click", (e) => {
      const step = this.stepAt(e);
      if (step != null) this.onPick?.(step);
    });
    this.svg.addEventListener("mousemove", (e) => this.showTip(e));
    this.svg.addEventListener("mouseleave", () => { this.tip.hidden = true; this.drawHover(null); });
  }

  /**
   * 橫軸：x = 0 是開局，之後每一手（含 PASS）一格。一局大約 80～150 手，先畫 100 格，
   * 超過就以 20 為單位放寬（畫面不會每下一手就縮放）。
   */
  get xMax() {
    const last = this.data ? this.data.lastStep : 0;
    return Math.max(100, Math.ceil(last / 20) * 20);
  }

  x(step) { return PAD.l + (W - PAD.l - PAD.r) * (step / this.xMax); }
  /** 黑方勝率 → y：黑方 0%（白方必勝）在最上面，黑方 100% 在最下面 */
  y(pct) { return PAD.t + (H - PAD.t - PAD.b) * (pct / 100); }

  /** 滑鼠位置對應的第幾手；超出目前這條線（未來）回傳 null */
  stepAt(e) {
    if (!this.data) return null;
    const rect = this.svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * W;
    const step = Math.round((sx - PAD.l) / (W - PAD.l - PAD.r) * this.xMax);
    if (step < 0 || step > this.data.lastStep) return null;
    return step;
  }

  /**
   * @param {object} d
   * @param {{step:number, black:number|null, mark:string|null, log:any, why?:string, luck?:number, loss?:number}[]} d.main 主線各手（black = 黑方勝率 %，還沒分析是 null）
   * @param {{fork:number, points:object[]}|null} d.branch 分支（從分岔點起）
   * @param {number} d.current 目前在第幾手
   * @param {number} d.lastStep 目前這條線最後一手
   */
  render(d) {
    this.data = d;
    const X = (s) => this.x(s).toFixed(1), Y = (p) => this.y(p).toFixed(1);
    const path = (pts) => {
      let out = "", pen = false;
      for (const p of pts) {
        if (p.black == null) { pen = false; continue; }
        out += `${pen ? "L" : "M"}${X(p.step)},${Y(p.black)} `;
        pen = true;
      }
      return out;
    };
    // 每一手一個點；有評價（!! ! !? ?! ? ??）的點放大並用評價的顏色
    const dots = (pts, cls) => pts.filter(p => p.black != null).map(p => p.mark
      ? `<circle cx="${X(p.step)}" cy="${Y(p.black)}" r="4.4" fill="${MARK_COLOR[p.mark]}" class="wcMarkDot"/>`
      : `<circle cx="${X(p.step)}" cy="${Y(p.black)}" r="2.6" class="${cls}"/>`).join("");

    let grid = "";
    const plotW = W - PAD.l - PAD.r, halfH = (H - PAD.t - PAD.b) / 2;
    grid += `<rect x="${PAD.l}" y="${PAD.t}" width="${plotW}" height="${halfH}" class="wcWhiteHalf"/>`;
    grid += `<rect x="${PAD.l}" y="${PAD.t + halfH}" width="${plotW}" height="${halfH}" class="wcBlackHalf"/>`;
    grid += `<rect x="${PAD.l}" y="${PAD.t}" width="${plotW}" height="${halfH * 2}" class="wcFrame"/>`;
    // 刻度：離中線越遠，佔優的一方勝率越高（最上面是白方 100%、最下面是黑方 100%）
    for (const p of [0, 25, 50, 75, 100]) {
      grid += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(p)}" y2="${Y(p)}" class="${p === 50 ? "wcMid" : "wcGrid"}"/>`;
      const label = p === 50 ? "50" : String(Math.max(p, 100 - p));
      grid += `<text x="${PAD.l - 5}" y="${(this.y(p) + 3.5).toFixed(1)}" class="wcLabel" text-anchor="end">${label}</text>`;
    }
    grid += `<text x="${PAD.l + 6}" y="${PAD.t + 13}" class="wcSide white">${tr("white")}</text>`;
    grid += `<text x="${PAD.l + 6}" y="${H - PAD.b - 6}" class="wcSide black">${tr("black")}</text>`;
    for (let s = 0; s <= this.xMax; s += 20) {
      grid += `<line x1="${X(s)}" x2="${X(s)}" y1="${PAD.t}" y2="${H - PAD.b}" class="wcGrid"/>`;
      grid += `<text x="${X(s)}" y="${H - 6}" class="wcLabel" text-anchor="middle">${s}</text>`;
    }
    // 還沒下到的區域畫暗一點
    const future = `<rect x="${X(d.lastStep)}" y="${PAD.t}" width="${(this.x(this.xMax) - this.x(d.lastStep)).toFixed(1)}" height="${H - PAD.t - PAD.b}" class="wcFuture"/>`;
    const cur = `<line x1="${X(d.current)}" x2="${X(d.current)}" y1="${PAD.t}" y2="${H - PAD.b}" class="wcCurrent${d.branch ? " inBranch" : ""}"/>`;
    // 分支研究中：主線變暗，分支用紫色畫在上面
    const mainCls = d.branch ? "wcMain dim" : "wcMain";
    const main = `<g class="${mainCls}"><path d="${path(d.main)}"/>${dots(d.main, "wcDot")}</g>`;
    const branch = d.branch ? `<g class="wcBranch"><path d="${path(d.branch.points)}"/>${dots(d.branch.points, "wcDot")}</g>` : "";
    this.svg.innerHTML = grid + future + main + branch + cur + `<line class="wcHover" y1="${PAD.t}" y2="${H - PAD.b}" visibility="hidden"/>`;
    this.svg.setAttribute("aria-label", tr("chartAria"));
  }

  drawHover(step) {
    const l = this.svg.querySelector(".wcHover");
    if (!l) return;
    if (step == null) { l.setAttribute("visibility", "hidden"); return; }
    l.setAttribute("x1", this.x(step)); l.setAttribute("x2", this.x(step));
    l.setAttribute("visibility", "visible");
  }

  /** 滑鼠移到某一手：顯示棋譜文字、評價與勝率 */
  showTip(e) {
    const step = this.stepAt(e);
    this.drawHover(step);
    if (step == null) { this.tip.hidden = true; return; }
    const line = this.data.branch && step >= this.data.branch.fork
      ? this.data.branch.points.find(p => p.step === step)
      : this.data.main.find(p => p.step === step);
    if (!line) { this.tip.hidden = true; return; }
    const b = line.black == null ? "…" : `${Math.round(line.black)}%`;
    const w = line.black == null ? "…" : `${100 - Math.round(line.black)}%`;
    // 骰運與棋力損失（下這一手的人的角度，勝率百分點）：兩者相加 = 這一手之後的勝率 - 擲骰前的勝率
    const sg = (x) => (x > 0 ? `+${x}` : `${x}`);
    const split = line.luck != null && line.loss != null
      ? `<div class="wcTipLuck">${escapeHtml(tr("chartTipLuck", { luck: sg(Math.round(line.luck)), loss: Math.round(line.loss) }))}</div>` : "";
    this.tip.innerHTML = `<div>${escapeHtml(tx(line.log))}${MARK_COLOR[line.mark] ? ` <b style="color:${MARK_COLOR[line.mark]}">${escapeHtml(line.mark)}</b>` : ""}</div>${line.why ? `<div class="wcTipWhy">${escapeHtml(line.why)}</div>` : ""}${split}<div class="wcTipPct">${escapeHtml(tr("chartTipBoth", { w, b }))}</div>`;
    this.tip.hidden = false;
    const rect = this.container.getBoundingClientRect();
    const left = Math.min(Math.max(e.clientX - rect.left + 12, 4), rect.width - 220);
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${e.clientY - rect.top + 12}px`;
  }
}
