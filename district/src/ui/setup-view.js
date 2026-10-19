/**
 * 劃區爭霸 (District) - 新局設定對話框
 *
 * 一個畫面完成所有開局設定：
 * 1. 政黨：名稱、顏色、玩家或電腦、數量（2～6 黨，順序即行動順序）。
 * 2. 棋盤形狀：內建圖形、上傳地圖圖片（自動取輪廓）、在預覽上直接塗改格子。
 * 3. 棋盤大小：N x N 外接正方形。
 */

import {
  DEFAULT_PARTY_PRESETS,
  DEFAULT_AI_LEVEL,
  MIN_PARTIES,
  MAX_PARTIES,
  MIN_BOARD_SIZE,
  MAX_BOARD_SIZE
} from "../core/constants.js";
import {
  PRESET_SHAPES,
  PRESET_SHAPE_MAP,
  maskFromPreset,
  createFullMask,
  countActiveCells,
  countIslands,
  validateMask,
  encodeMask,
  decodeMask
} from "../core/board-shapes.js";
import { DEFAULT_RULES } from "../core/constants.js";
import { classicSizeFor } from "./settings.js";
import { ICONS } from "./icons.js";
import { escapeHtml } from "./score-view.js";
import { t, fmtNum, presetName, partyDisplayName } from "../i18n.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** 進階規則選項：key 對應 DEFAULT_RULES；文字依目前語言取自 i18n（rule.<key>、rule.<key>.hint、rule.<key>.<值>） */
const RULE_SPECS = [
  { key: "families", multi: true, values: ["I4", "S4", "T4"] },
  { key: "bagScale", values: [0.6, 1, 1.5] },
  { key: "popContrast", values: ["flat", "normal", "extreme"] },
  { key: "partyClustering", values: ["mixed", "normal", "segregated"] }
];

function ruleRows() {
  return RULE_SPECS.map((spec) => ({
    key: spec.key,
    multi: spec.multi,
    label: t(`rule.${spec.key}`),
    hint: t(`rule.${spec.key}.hint`),
    options: spec.values.map((v) => [v, t(`rule.${spec.key}.${v}`)])
  }));
}

/**
 * 由圖片計算 N x N 覆蓋率格網。
 * 有透明背景時以不透明像素為陸地；否則以四周邊緣的平均色為背景，與背景差異大的像素為陸地。
 * 圖形會先裁到陸地外接框，再等比例置中縮放到棋盤。
 */
export function coverageFromImage(img, N, { invert = false } = {}) {
  const maxSide = 360;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 200) transparent++;
  const useAlpha = transparent > (w * h) * 0.02;

  let bg = [255, 255, 255];
  if (!useAlpha) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    const addPx = (x, y) => {
      const i = (y * w + x) * 4;
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
    };
    for (let x = 0; x < w; x++) { addPx(x, 0); addPx(x, h - 1); }
    for (let y = 0; y < h; y++) { addPx(0, y); addPx(w - 1, y); }
    bg = [sr / n, sg / n, sb / n];
  }

  const fg = new Uint8Array(w * h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let on = useAlpha
        ? data[i + 3] >= 128
        : Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) > 60;
      if (invert) on = !on;
      if (on) {
        fg[y * w + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return Array.from({ length: N }, () => Array(N).fill(0));

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cellPx = Math.max(bw, bh) / N;
  const offX = minX - (N * cellPx - bw) / 2;
  const offY = minY - (N * cellPx - bh) / 2;
  const samples = 6;
  const coverage = [];
  for (let r = 0; r < N; r++) {
    const row = [];
    for (let c = 0; c < N; c++) {
      let hit = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = Math.floor(offX + (c + (sx + 0.5) / samples) * cellPx);
          const y = Math.floor(offY + (r + (sy + 0.5) / samples) * cellPx);
          if (x >= 0 && x < w && y >= 0 && y < h && fg[y * w + x]) hit++;
        }
      }
      row.push(hit / (samples * samples));
    }
    coverage.push(row);
  }
  return coverage;
}

/** 以最近鄰重新取樣遮罩到新尺寸（塗改過的地圖改變大小時使用） */
function resampleMask(mask, N) {
  const M = mask.length;
  return Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => mask[Math.min(M - 1, Math.floor(((r + 0.5) * M) / N))][Math.min(M - 1, Math.floor(((c + 0.5) * M) / N))])
  );
}

function maskThumbSvg(mask, N) {
  const m = mask || createFullMask(N);
  let d = "";
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) if (m[r][c]) d += `M${c} ${r}h1v1h-1z`;
  }
  return `<svg viewBox="-0.5 -0.5 ${N + 1} ${N + 1}" class="thumbSvg" aria-hidden="true"><path d="${d}"/></svg>`;
}

export class SetupView {
  constructor(root, { onStart, onClose }) {
    this.root = root;
    this.onStart = onStart;
    this.onClose = onClose;
    this.draft = null;
    this.image = null;
    this.imageInvert = false;
    this.imageThreshold = 0.5;
    this.mask = null;
  }

  open(settings, { canCancel = true } = {}) {
    this.draft = JSON.parse(JSON.stringify(settings));
    this.canCancel = canCancel;
    this.source = this.draft.shapeId === "custom" ? "paint" : "preset";
    this.mask = this.draft.shapeId === "custom"
      ? decodeMask(this.draft.customMask)
      : (maskFromPreset(this.draft.shapeId, this.draft.boardSize) || createFullMask(this.draft.boardSize));
    this.root.classList.add("open");
    this.root.setAttribute("aria-hidden", "false");
    this._renderShell();
    this._renderParties();
    this._renderShapes();
    this._renderPreview();
    this._renderRules();
  }

  /** 語言切換：視窗開著時，用目前的設定草稿重畫 */
  relocalize() {
    if (!this.isOpen()) return;
    const activeTab = this.root.querySelector(".uiTab.on")?.dataset.tab || "party";
    this._renderShell();
    this._renderParties();
    this._renderShapes();
    this._renderPreview();
    this._renderRules();
    this.root.querySelectorAll(".uiTab").forEach((tab) => tab.classList.toggle("on", tab.dataset.tab === activeTab));
    this.root.querySelectorAll(".uiPanel").forEach((panel) => { panel.hidden = panel.dataset.panel !== activeTab; });
  }

  close() {
    this.root.classList.remove("open");
    this.root.setAttribute("aria-hidden", "true");
  }

  isOpen() {
    return this.root.classList.contains("open");
  }

  _renderShell() {
    this.root.innerHTML = `
      <div class="sheetDialog setupDialog" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
        <div class="sheetHeader">
          <h2 id="setupTitle">${t("setupTitle")}</h2>
          ${this.canCancel ? `<button type="button" class="iconOnly" data-act="close" title="${t("close")}">${ICONS.close}</button>` : ""}
        </div>
        <div class="uiTabs" role="tablist">
          <button type="button" role="tab" class="uiTab on" data-tab="party" aria-selected="true">${t("tabParty")}</button>
          <button type="button" role="tab" class="uiTab" data-tab="shape" aria-selected="false">${t("tabBoard")}</button>
          <button type="button" role="tab" class="uiTab" data-tab="rules" aria-selected="false">${t("tabRules")}<i class="uiDot" data-out="rulesDot" hidden></i></button>
        </div>
        <div class="sheetBody setupBody">
          <div class="uiPanel" data-panel="party">
            <div class="sectionHead"><h3>${t("partyHead")}</h3><span class="muted">${t("partyHint")}</span></div>
            <div class="partyList"></div>
            <button type="button" class="btn btnGhost" data-act="addParty">${ICONS.plus}<span>${t("addParty")}</span></button>
          </div>
          <div class="uiPanel" data-panel="shape" hidden>
            <div class="sectionHead"><h3>${t("shapeHead")}</h3><span class="muted">${t("shapeHint")}</span></div>
            <div class="shapeGrid"></div>
            <div class="imageControls" hidden>
              <label class="checkLine"><input type="checkbox" data-ctl="invert"> ${t("invert")}</label>
              <label class="rangeLine">${t("threshold")} <input type="range" min="0.2" max="0.8" step="0.05" data-ctl="threshold"></label>
            </div>
            <div class="previewWrap">
              <div class="maskPreview"></div>
              <div class="previewSide">
                <label class="rangeLine sizeLine">${t("boardSize")} <strong data-out="size"></strong>
                  <input type="range" min="${MIN_BOARD_SIZE}" max="${MAX_BOARD_SIZE}" step="1" data-ctl="size">
                </label>
                <div class="maskStats" data-out="stats"></div>
                <div class="maskError" data-out="error"></div>
              </div>
            </div>
          </div>
          <div class="uiPanel" data-panel="rules" hidden>
            <div class="sectionHead"><h3>${t("rulesHead")}</h3><span class="muted" data-out="rulesSummary">${this._rulesSummary()}</span></div>
            <div class="ruleGrid"></div>
            <button type="button" class="linkBtn resetRules" data-act="resetRules">${t("resetRules")}</button>
          </div>
        </div>
        <div class="sheetFooter">
          ${this.canCancel ? `<button type="button" class="btn btnGhost" data-act="close">${t("cancel")}</button>` : ""}
          <button type="button" class="btn btnPrimary" data-act="start">${t("start")}</button>
        </div>
        <input type="file" accept="image/*" data-ctl="file" hidden>
      </div>
    `;

    this.root.onclick = (e) => {
      if (e.target === this.root && this.canCancel) this._close();
    };
    this.root.querySelectorAll("[data-act='close']").forEach((b) => b.addEventListener("click", () => this._close()));
    this.root.querySelector("[data-act='addParty']").addEventListener("click", () => this._addParty());
    this.root.querySelector("[data-act='start']").addEventListener("click", () => this._start());

    const size = this.root.querySelector("[data-ctl='size']");
    size.value = String(this.draft.boardSize);
    size.addEventListener("input", () => this._setSize(Number(size.value)));

    this.root.querySelector("[data-act='resetRules']").addEventListener("click", () => {
      this.draft.rules = JSON.parse(JSON.stringify(DEFAULT_RULES));
      this._renderRules();
    });

    const fileInput = this.root.querySelector("[data-ctl='file']");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) this._loadImage(file);
      fileInput.value = "";
    });

    const invert = this.root.querySelector("[data-ctl='invert']");
    invert.addEventListener("change", () => {
      this.imageInvert = invert.checked;
      this._rasterizeImage();
    });
    const threshold = this.root.querySelector("[data-ctl='threshold']");
    threshold.value = String(this.imageThreshold);
    threshold.addEventListener("input", () => {
      this.imageThreshold = Number(threshold.value);
      this._applyCoverage();
    });
  }

  _close() {
    this.close();
    this.onClose?.();
  }

  // ---------------------------------------------------------------------------
  // 進階規則
  // ---------------------------------------------------------------------------

  _rulesSummary() {
    const rules = this.draft.rules;
    const changed = ruleRows().filter((row) => JSON.stringify(rules[row.key]) !== JSON.stringify(DEFAULT_RULES[row.key])).length;
    return changed ? t("rulesChanged", { n: changed }) : t("rulesClassic");
  }

  _renderRules() {
    const grid = this.root.querySelector(".ruleGrid");
    const rules = this.draft.rules;
    grid.innerHTML = ruleRows().map((row) => {
      const buttons = row.options.map(([value, text]) => {
        const on = row.multi ? rules[row.key].includes(value) : rules[row.key] === value;
        return `<button type="button" class="${on ? "on" : ""}" data-key="${row.key}" data-value="${value}">${text}</button>`;
      }).join("");
      return `
        <div class="ruleRow">
          <div class="ruleLabel"><strong>${row.label}</strong><span>${row.hint}</span></div>
          <div class="segToggle textOnly" role="group" aria-label="${row.label}">${buttons}</div>
        </div>`;
    }).join("");

    grid.querySelectorAll("[data-key]").forEach((btn) => btn.addEventListener("click", () => {
      const row = ruleRows().find((r) => r.key === btn.dataset.key);
      const option = row.options.find(([value]) => String(value) === btn.dataset.value);
      const value = option[0];
      if (row.multi) {
        const list = rules[row.key];
        const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
        if (!next.length) return;
        rules[row.key] = row.options.map(([v]) => v).filter((v) => next.includes(v));
      } else {
        rules[row.key] = value;
      }
      this._renderRules();
    }));
    const summary = this.root.querySelector("[data-out='rulesSummary']");
    if (summary) summary.textContent = this._rulesSummary();
    const dot = this.root.querySelector("[data-out='rulesDot']");
    if (dot) dot.hidden = this._rulesSummary() === t("rulesClassic");
  }

  // ---------------------------------------------------------------------------
  // 政黨
  // ---------------------------------------------------------------------------

  _renderParties() {
    const list = this.root.querySelector(".partyList");
    const parties = this.draft.parties;
    list.innerHTML = parties.map((p, i) => `
      <div class="partyRow" data-i="${i}">
        <span class="partyOrder">${i + 1}</span>
        <label class="colorPick" style="--c:${p.color}" title="${t("pickColor")}"><input type="color" value="${p.color}" data-f="color"></label>
        <input type="text" class="nameInput" maxlength="12" value="${escapeHtml(partyDisplayName(p.name, i))}" data-f="name" aria-label="${t("partyName")}">
        <div class="segToggle" role="group" aria-label="${t("control")}">
          <button type="button" class="${p.type === "human" ? "on" : ""}" data-type="human">${ICONS.user}<span>${t("human")}</span></button>
          <button type="button" class="${p.type === "cpu" ? "on" : ""}" data-type="cpu">${ICONS.cpu}<span>${t("cpu")}</span></button>
        </div>
        <button type="button" class="iconOnly" data-f="remove" title="${t("remove")}" ${parties.length <= MIN_PARTIES ? "disabled" : ""}>${ICONS.close}</button>
      </div>`).join("");

    list.querySelectorAll(".partyRow").forEach((row) => {
      const i = Number(row.dataset.i);
      const party = this.draft.parties[i];
      const color = row.querySelector("[data-f='color']");
      color.addEventListener("input", () => {
        party.color = color.value;
        row.querySelector(".colorPick").style.setProperty("--c", color.value);
      });
      row.querySelector("[data-f='name']").addEventListener("input", (e) => {
        party.name = e.target.value;
      });
      row.querySelectorAll("[data-type]").forEach((btn) => btn.addEventListener("click", () => {
        party.type = btn.dataset.type;
        this._renderParties();
      }));
      row.querySelector("[data-f='remove']").addEventListener("click", () => this._removeParty(i));
    });
    this.root.querySelector("[data-act='addParty']").disabled = parties.length >= MAX_PARTIES;
  }

  _addParty() {
    const parties = this.draft.parties;
    if (parties.length >= MAX_PARTIES) return;
    const used = new Set(parties.map((p) => p.color.toLowerCase()));
    const preset = DEFAULT_PARTY_PRESETS.find((p) => !used.has(p.color)) || DEFAULT_PARTY_PRESETS[parties.length % DEFAULT_PARTY_PRESETS.length];
    this._partyCountChanging(parties.length, parties.length + 1);
    parties.push({ name: preset.name, color: preset.color, type: "cpu", level: DEFAULT_AI_LEVEL });
    this._renderParties();
  }

  _removeParty(i) {
    const parties = this.draft.parties;
    if (parties.length <= MIN_PARTIES) return;
    this._partyCountChanging(parties.length, parties.length - 1);
    parties.splice(i, 1);
    this._renderParties();
  }

  /** 正方形棋盤且仍是經典尺寸時，跟著政黨數換成對應的經典尺寸 */
  _partyCountChanging(from, to) {
    if (this.draft.shapeId === "square" && this.draft.boardSize === classicSizeFor(from)) {
      this._setSize(classicSizeFor(to));
      this.root.querySelector("[data-ctl='size']").value = String(this.draft.boardSize);
    }
  }

  // ---------------------------------------------------------------------------
  // 棋盤形狀
  // ---------------------------------------------------------------------------

  _renderShapes() {
    const grid = this.root.querySelector(".shapeGrid");
    const tiles = PRESET_SHAPES.map((s) => {
      const N = 12;
      const active = this.source === "preset" && this.draft.shapeId === s.id;
      return `<button type="button" class="shapeTile ${active ? "on" : ""}" data-shape="${s.id}">${maskThumbSvg(maskFromPreset(s.id, N), N)}<span>${presetName(s.id)}</span></button>`;
    }).join("");
    grid.innerHTML = `${tiles}
      <button type="button" class="shapeTile ${this.source === "image" ? "on" : ""}" data-shape="upload">${ICONS.upload}<span>${t("upload")}</span></button>
      <button type="button" class="shapeTile ${this.source === "paint" ? "on" : ""}" data-shape="paint">${ICONS.brush}<span>${t("paint")}</span></button>`;

    grid.querySelectorAll("[data-shape]").forEach((btn) => btn.addEventListener("click", () => {
      const id = btn.dataset.shape;
      if (id === "upload") {
        this.root.querySelector("[data-ctl='file']").click();
      } else if (id === "paint") {
        this.source = "paint";
        this.draft.shapeId = "custom";
        this._afterMaskChange();
      } else {
        this._selectPreset(id);
      }
    }));
    this.root.querySelector(".imageControls").hidden = this.source !== "image";
  }

  _selectPreset(id) {
    const preset = PRESET_SHAPE_MAP.get(id);
    this.source = "preset";
    this.draft.shapeId = id;
    const size = preset.defaultSize || classicSizeFor(this.draft.parties.length);
    this.root.querySelector("[data-ctl='size']").value = String(size);
    this._setSize(size);
  }

  _setSize(N) {
    this.draft.boardSize = N;
    if (this.source === "preset") {
      this.mask = maskFromPreset(this.draft.shapeId, N) || createFullMask(N);
    } else if (this.source === "image" && this.image) {
      this._rasterizeImage();
      return;
    } else {
      this.mask = resampleMask(this.mask, N);
    }
    this._afterMaskChange();
  }

  _loadImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      this.image = img;
      this.source = "image";
      this.draft.shapeId = "custom";
      // 上傳的地圖預設用較大的棋盤，輪廓比較不鋸齒
      if (this.draft.boardSize < 20) {
        this.draft.boardSize = 20;
        this.root.querySelector("[data-ctl='size']").value = "20";
      }
      this.imageInvert = false;
      this.root.querySelector("[data-ctl='invert']").checked = false;
      this._rasterizeImage();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this._setError(t("imgError"));
    };
    img.src = url;
  }

  _rasterizeImage() {
    if (!this.image) return;
    this.coverage = coverageFromImage(this.image, this.draft.boardSize, { invert: this.imageInvert });
    this._applyCoverage();
  }

  _applyCoverage() {
    if (!this.coverage) return;
    this.mask = this.coverage.map((row) => row.map((v) => v >= this.imageThreshold));
    this._afterMaskChange();
  }

  _afterMaskChange() {
    this._renderShapes();
    this._renderPreview();
  }

  _renderPreview() {
    const N = this.draft.boardSize;
    const mask = this.mask;
    const wrap = this.root.querySelector(".maskPreview");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${N} ${N}`);
    svg.classList.add("maskSvg");
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", c + 0.04);
        rect.setAttribute("y", r + 0.04);
        rect.setAttribute("width", 0.92);
        rect.setAttribute("height", 0.92);
        rect.setAttribute("rx", 0.12);
        rect.dataset.r = r;
        rect.dataset.c = c;
        rect.classList.add(mask[r][c] ? "land" : "sea");
        svg.appendChild(rect);
      }
    }
    wrap.innerHTML = "";
    wrap.appendChild(svg);

    // 拖曳塗格：第一下決定要塗成陸地或海，拖過的格子都套用同一狀態
    let paintValue = null;
    const paintAt = (target) => {
      if (!target || target.tagName !== "rect") return;
      const r = Number(target.dataset.r);
      const c = Number(target.dataset.c);
      if (paintValue === null) paintValue = !this.mask[r][c];
      if (this.mask[r][c] === paintValue) return;
      this.mask[r][c] = paintValue;
      target.classList.toggle("land", paintValue);
      target.classList.toggle("sea", !paintValue);
      if (this.source !== "paint") {
        this.source = "paint";
        this.draft.shapeId = "custom";
        this._renderShapes();
      }
      this._renderStats();
    };
    svg.addEventListener("pointerdown", (e) => {
      paintValue = null;
      try { svg.setPointerCapture(e.pointerId); } catch (_) {}
      paintAt(e.target);
      e.preventDefault();
    });
    svg.addEventListener("pointermove", (e) => {
      if (paintValue === null) return;
      paintAt(document.elementFromPoint(e.clientX, e.clientY));
    });
    const end = () => { paintValue = null; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    this.root.querySelector("[data-out='size']").textContent = `${N} × ${N}`;
    this._renderStats();
  }

  _renderStats() {
    const count = countActiveCells(this.mask);
    const islands = countIslands(this.mask);
    this.root.querySelector("[data-out='stats']").textContent =
      t("maskStats", { n: count, islands: islands > 1 ? t("maskIslands", { k: islands }) : "", v: fmtNum(count * 100) });
    const check = validateMask(this.mask);
    this._setError(check.valid ? "" : t("maskTooSmall", { min: check.min, n: check.count }));
  }

  _setError(msg) {
    const el = this.root.querySelector("[data-out='error']");
    if (el) el.textContent = msg;
    const start = this.root.querySelector("[data-act='start']");
    if (start) start.disabled = Boolean(msg);
  }

  _start() {
    if (!validateMask(this.mask).valid) return;
    const draft = this.draft;
    draft.parties = draft.parties.map((p, i) => ({
      ...p,
      name: p.name.trim() || partyDisplayName("", i)
    }));
    if (this.source === "preset") {
      draft.customMask = null;
    } else {
      draft.shapeId = "custom";
      draft.customMask = encodeMask(this.mask);
    }
    this.close();
    this.onStart(draft);
  }
}
