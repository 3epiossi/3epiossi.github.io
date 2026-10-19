/**
 * 設定視窗「外觀」分頁：棋盤主題、黑白棋子外觀（寶石、自訂色、上傳圖片）、移動路徑樣式與顏色。
 * host 是主程式（提供 skinManager、settings、applyTheme、render）。
 */

import { ModalManager } from "./modal-manager.js";
import { tr } from "../i18n.js";
import {
  SkinManager, DEFAULT_BLACK_PRESETS, DEFAULT_WHITE_PRESETS, PATH_BLACK_PRESETS, PATH_WHITE_PRESETS, getPieceBackgroundCss
} from "./skin-workshop.js";

export class SkinPanel {
  constructor(host) {
    this.host = host;
  }

  openSkinModal() {
    ModalManager.open("skinModal");
    const sb = document.getElementById("soundToggleBtn");
    if (sb) sb.textContent = this.host.settings.soundEnabled ? "🔊" : "🔇";
    this.bindSkinEventsOnce();
    this.renderSkinWorkshop();
  }

  renderSkinWorkshop() {
    const config = this.host.skinManager.config;

    // 0. 主題風格設定
    const curTheme = this.host.settings.theme || "neon";
    const themeChips = document.querySelectorAll("#themePresetGroup .skinPresetChip");
    themeChips.forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.theme === curTheme);
    });

    document.querySelectorAll("#pathStyleGroup .skinPresetChip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.pathStyle === (config.pathStyle || "step"));
    });

    // 1. 黑方設定
    const bConfig = config.black;
    const bBadge = document.getElementById("blackSkinBadge");
    const bDisc = document.getElementById("blackPreviewDisc");
    const bColorInput = document.getElementById("blackColorInput");
    const bColorDot = document.getElementById("blackColorDot");
    const bClearBtn = document.getElementById("blackClearImgBtn");
    const bGlossToggle = document.getElementById("blackGlossToggle");

    if (bBadge) bBadge.textContent = bConfig.type === "preset" ? tr("p_" + bConfig.id) : (bConfig.type === "image" ? tr("customImage") : tr("customColor"));
    if (bDisc) bDisc.style.background = getPieceBackgroundCss(bConfig, true);
    if (bColorInput && bConfig.color) bColorInput.value = bConfig.color;
    if (bColorDot && bConfig.color) bColorDot.style.background = bConfig.color;
    if (bClearBtn) bClearBtn.style.display = bConfig.type === "image" ? "inline-flex" : "none";
    if (bGlossToggle) bGlossToggle.checked = bConfig.gloss !== false;

    const bPresetGroup = document.getElementById("blackPresetGroup");
    if (bPresetGroup) {
      bPresetGroup.innerHTML = "";
      DEFAULT_BLACK_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip ${bConfig.type === "preset" && bConfig.id === p.id ? "active" : ""}`;
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color}"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.host.skinManager.saveConfig({
            black: {
              type: "preset",
              id: p.id,
              label: p.label,
              color: p.color,
              gradient: p.gradient,
              imageData: null,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.host.render();
        });
        bPresetGroup.appendChild(chip);
      });
    }

    // 2. 白方設定
    const wConfig = config.white;
    const wBadge = document.getElementById("whiteSkinBadge");
    const wDisc = document.getElementById("whitePreviewDisc");
    const wColorInput = document.getElementById("whiteColorInput");
    const wColorDot = document.getElementById("whiteColorDot");
    const wClearBtn = document.getElementById("whiteClearImgBtn");
    const wGlossToggle = document.getElementById("whiteGlossToggle");

    if (wBadge) wBadge.textContent = wConfig.type === "preset" ? tr("p_" + wConfig.id) : (wConfig.type === "image" ? tr("customImage") : tr("customColor"));
    if (wDisc) wDisc.style.background = getPieceBackgroundCss(wConfig, false);
    if (wColorInput && wConfig.color) wColorInput.value = wConfig.color;
    if (wColorDot && wConfig.color) wColorDot.style.background = wConfig.color;
    if (wClearBtn) wClearBtn.style.display = wConfig.type === "image" ? "inline-flex" : "none";
    if (wGlossToggle) wGlossToggle.checked = wConfig.gloss !== false;

    const wPresetGroup = document.getElementById("whitePresetGroup");
    if (wPresetGroup) {
      wPresetGroup.innerHTML = "";
      DEFAULT_WHITE_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip ${wConfig.type === "preset" && wConfig.id === p.id ? "active" : ""}`;
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color}"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.host.skinManager.saveConfig({
            white: {
              type: "preset",
              id: p.id,
              label: p.label,
              color: p.color,
              gradient: p.gradient,
              imageData: null,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.host.render();
        });
        wPresetGroup.appendChild(chip);
      });
    }

    // 3. 路徑箭頭顏色 Preset Chips
    const bPathColor = config.pathBlack || "#111827";
    const bPathId    = config.pathBlackId || "obsidian";
    const wPathColor = config.pathWhite || "#e2e8f0";
    const wPathId    = config.pathWhiteId || "pearl";

    const bPathGroup = document.getElementById("blackPathPresetGroup");
    if (bPathGroup) {
      bPathGroup.innerHTML = "";
      PATH_BLACK_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip compact ${bPathId === p.id ? "active" : ""}`;
        chip.title = tr("p_" + p.id);
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color};"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.host.skinManager.saveConfig({ pathBlack: p.color, pathBlackId: p.id });
          this.renderSkinWorkshop();
        });
        bPathGroup.appendChild(chip);
      });
    }

    const wPathGroup = document.getElementById("whitePathPresetGroup");
    if (wPathGroup) {
      wPathGroup.innerHTML = "";
      PATH_WHITE_PRESETS.forEach((p) => {
        const chip = document.createElement("button");
        chip.className = `skinPresetChip compact ${wPathId === p.id ? "active" : ""}`;
        chip.title = tr("p_" + p.id);
        chip.innerHTML = `<span class="skinPresetDot" style="background:${p.color};"></span><span>${tr("p_" + p.id)}</span>`;
        chip.addEventListener("click", () => {
          this.host.skinManager.saveConfig({ pathWhite: p.color, pathWhiteId: p.id });
          this.renderSkinWorkshop();
        });
        wPathGroup.appendChild(chip);
      });
    }

    // 自訂路徑色彩（拖曳選色時不重建整組 chips，避免選色器被銷毀）
    const addCustomPathChip = (group, side, curColor, curId) => {
      if (!group) return;
      const isBlack = side === "black";
      const chip = document.createElement("label");
      chip.className = `skinPresetChip compact customPathChip ${curId === "custom" ? "active" : ""}`;
      chip.title = window.t("skinPathCustom");
      const dot = document.createElement("span");
      dot.className = "skinPresetDot";
      dot.style.background = curId === "custom" ? curColor : "conic-gradient(#f43f5e, #f59e0b, #22c55e, #38bdf8, #a855f7, #f43f5e)";
      const text = document.createElement("span");
      text.textContent = window.t("skinPathCustom");
      const input = document.createElement("input");
      input.type = "color";
      input.value = /^#[0-9a-f]{6}$/i.test(curColor) ? curColor : (isBlack ? "#111827" : "#e2e8f0");
      input.style.cssText = "position:absolute;opacity:0;width:0;height:0;pointer-events:none;";
      chip.style.position = "relative";
      chip.append(dot, text, input);
      input.addEventListener("input", () => {
        const hex = input.value;
        dot.style.background = hex;
        group.querySelectorAll(".skinPresetChip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        this.host.skinManager.saveConfig(isBlack ? { pathBlack: hex, pathBlackId: "custom" } : { pathWhite: hex, pathWhiteId: "custom" });
        const headDot = document.getElementById(isBlack ? "blackPathColorDot" : "whitePathColorDot");
        if (headDot) headDot.style.background = hex;
        this.host.render();
      });
      group.appendChild(chip);
    };
    addCustomPathChip(bPathGroup, "black", bPathColor, bPathId);
    addCustomPathChip(wPathGroup, "white", wPathColor, wPathId);

    // 顏色預覽點
    const bPathDot = document.getElementById("blackPathColorDot");
    const wPathDot = document.getElementById("whitePathColorDot");
    if (bPathDot) bPathDot.style.background = bPathColor;
    if (wPathDot) wPathDot.style.background = wPathColor;
  }

  bindSkinEventsOnce() {
    if (this._skinEventsBound) return;
    this._skinEventsBound = true;

    document.getElementById("pathStyleGroup")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-path-style]");
      if (!chip) return;
      this.host.skinManager.saveConfig({ pathStyle: chip.dataset.pathStyle });
      this.renderSkinWorkshop();
      this.host.render();
    });

    // 黑方色彩選擇
    const bColorInput = document.getElementById("blackColorInput");
    if (bColorInput) {
      bColorInput.addEventListener("input", (e) => {
        const hex = e.target.value;
        this.host.skinManager.saveConfig({
          black: {
            type: "color",
            id: "custom-black",
            label: "自訂色彩",
            color: hex,
            gradient: null,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.host.render();
      });
    }

    // 白方色彩選擇
    const wColorInput = document.getElementById("whiteColorInput");
    if (wColorInput) {
      wColorInput.addEventListener("input", (e) => {
        const hex = e.target.value;
        this.host.skinManager.saveConfig({
          white: {
            type: "color",
            id: "custom-white",
            label: "自訂色彩",
            color: hex,
            gradient: null,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.host.render();
      });
    }

    // 黑方上傳圖片
    const bImgInput = document.getElementById("blackImgInput");
    if (bImgInput) {
      bImgInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await SkinManager.resizeImageToDataUrl(file, 256);
          this.host.skinManager.saveConfig({
            black: {
              type: "image",
              id: "custom-img-black",
              label: "自訂圖片",
              color: null,
              gradient: null,
              imageData: dataUrl,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.host.render();
        } catch (err) {
          alert(tr("imgReadFail") + (err?.message || err));
        }
        bImgInput.value = "";
      });
    }

    // 白方上傳圖片
    const wImgInput = document.getElementById("whiteImgInput");
    if (wImgInput) {
      wImgInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await SkinManager.resizeImageToDataUrl(file, 256);
          this.host.skinManager.saveConfig({
            white: {
              type: "image",
              id: "custom-img-white",
              label: "自訂圖片",
              color: null,
              gradient: null,
              imageData: dataUrl,
              gloss: true
            }
          });
          this.renderSkinWorkshop();
          this.host.render();
        } catch (err) {
          alert(tr("imgReadFail") + (err?.message || err));
        }
        wImgInput.value = "";
      });
    }

    // 移除黑棋圖片
    const bClearBtn = document.getElementById("blackClearImgBtn");
    if (bClearBtn) {
      bClearBtn.addEventListener("click", () => {
        const def = DEFAULT_BLACK_PRESETS[0];
        this.host.skinManager.saveConfig({
          black: {
            type: "preset",
            id: def.id,
            label: def.label,
            color: def.color,
            gradient: def.gradient,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.host.render();
      });
    }

    // 移除白棋圖片
    const wClearBtn = document.getElementById("whiteClearImgBtn");
    if (wClearBtn) {
      wClearBtn.addEventListener("click", () => {
        const def = DEFAULT_WHITE_PRESETS[0];
        this.host.skinManager.saveConfig({
          white: {
            type: "preset",
            id: def.id,
            label: def.label,
            color: def.color,
            gradient: def.gradient,
            imageData: null,
            gloss: true
          }
        });
        this.renderSkinWorkshop();
        this.host.render();
      });
    }

    // 水晶高光開關
    const bGloss = document.getElementById("blackGlossToggle");
    if (bGloss) {
      bGloss.addEventListener("change", (e) => {
        const cur = this.host.skinManager.config.black;
        this.host.skinManager.saveConfig({
          black: { ...cur, gloss: e.target.checked }
        });
        this.renderSkinWorkshop();
        this.host.render();
      });
    }

    const wGloss = document.getElementById("whiteGlossToggle");
    if (wGloss) {
      wGloss.addEventListener("change", (e) => {
        const cur = this.host.skinManager.config.white;
        this.host.skinManager.saveConfig({
          white: { ...cur, gloss: e.target.checked }
        });
        this.renderSkinWorkshop();
        this.host.render();
      });
    }

    // 黑方路徑色彩（preset 點擊由 renderSkinWorkshop 動態建立，此處無需額外綁定）
    // 白方路徑色彩（同上）

    // 棋盤主題切換
    const themeChips = document.querySelectorAll("#themePresetGroup .skinPresetChip");
    themeChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const theme = chip.dataset.theme;
        if (theme) {
          this.host.applyTheme(theme);
          this.renderSkinWorkshop();
        }
      });
    });

    // 重設全部預設
    const resetBtn = document.getElementById("skinResetDefaultBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this.host.applyTheme("neon");
        this.host.skinManager.resetDefaults();
        this.renderSkinWorkshop();
        this.host.render();
      });
    }
  }
}
