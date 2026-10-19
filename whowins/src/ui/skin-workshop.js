/**
 * 🎨 骰子黑白棋 (Dice Othello) - 棋子外觀工坊 (Piece Skin Workshop)
 * 支援黑白雙方：
 * 1. 預設寶石色系 (Obsidian, Ruby, Sapphire, Pearl, Crystal, etc.)
 * 2. 自訂顏色 + 3D 球體立體光影 (Spherical Radial Gradient)
 * 3. 上傳圖片作為棋子圖案 (支援圓形遮罩與 3D 水晶高光反射)
 */

import { tr } from "../i18n.js";

export const DEFAULT_BLACK_PRESETS = [
  { id: "obsidian", label: "經典黑曜", color: "#111827", gradient: "radial-gradient(circle at 35% 30%, #64748b 0%, #111827 60%, #0b1220 100%)" },
  { id: "ruby", label: "烈焰赤紅", color: "#dc2626", gradient: "radial-gradient(circle at 35% 30%, #fca5a5 0%, #dc2626 55%, #450a0a 100%)" },
  { id: "sapphire", label: "蔚藍深海", color: "#2563eb", gradient: "radial-gradient(circle at 35% 30%, #93c5fd 0%, #1d4ed8 55%, #0f172a 100%)" },
  { id: "emerald", label: "翡翠墨玉", color: "#15803d", gradient: "radial-gradient(circle at 35% 30%, #86efac 0%, #15803d 55%, #052e16 100%)" },
  { id: "amethyst", label: "紫晶魅影", color: "#7e22ce", gradient: "radial-gradient(circle at 35% 30%, #d8b4fe 0%, #7e22ce 55%, #2e1065 100%)" },
  { id: "amber", label: "琥珀鎏金", color: "#d97706", gradient: "radial-gradient(circle at 35% 30%, #fef08a 0%, #d97706 55%, #713f12 100%)" }
];

export const DEFAULT_WHITE_PRESETS = [
  { id: "pearl", label: "經典珍珠", color: "#e2e8f0", gradient: "radial-gradient(circle at 35% 30%, #ffffff 0%, #e2e8f0 55%, #cbd5e1 100%)" },
  { id: "crystal", label: "冰晶雪白", color: "#f0f9ff", gradient: "radial-gradient(circle at 35% 30%, #ffffff 0%, #e0f2fe 50%, #7dd3fc 100%)" },
  { id: "rose", label: "玫瑰粉晶", color: "#fecdd3", gradient: "radial-gradient(circle at 35% 30%, #fff1f2 0%, #fecdd3 50%, #f43f5e 100%)" },
  { id: "mint", label: "薄荷碧玉", color: "#bbf7d0", gradient: "radial-gradient(circle at 35% 30%, #f0fdf4 0%, #bbf7d0 50%, #22c55e 100%)" },
  { id: "ivory", label: "曜金象牙", color: "#fef3c7", gradient: "radial-gradient(circle at 35% 30%, #fffbeb 0%, #fef3c7 50%, #f59e0b 100%)" },
  { id: "topaz", label: "幻彩天藍", color: "#bae6fd", gradient: "radial-gradient(circle at 35% 30%, #f0f9ff 0%, #bae6fd 50%, #0284c7 100%)" }
];

// 路徑箭頭顏色 Preset — 黑方偏深色、白方偏淺色
export const PATH_BLACK_PRESETS = DEFAULT_BLACK_PRESETS;
export const PATH_WHITE_PRESETS = DEFAULT_WHITE_PRESETS;

const SKIN_STORAGE_KEY = "dice_reversi_piece_skins_v2";

export function hexToHsl(hex) {
  let c = (hex || "#000000").replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16) || 0;
  let r = ((num >> 16) & 255) / 255;
  let g = ((num >> 8) & 255) / 255;
  let b = (num & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function generateSphericalGradient(hex) {
  const [h, s, l] = hexToHsl(hex);
  const highL = Math.min(96, Math.max(l + 32, 75));
  const highS = Math.max(10, Math.round(s * 0.65));
  const highColor = `hsl(${h}, ${highS}%, ${highL}%)`;
  const midColor = `hsl(${h}, ${s}%, ${l}%)`;
  const shadowL = Math.max(6, Math.round(l * 0.42));
  const shadowS = Math.min(100, Math.round(s * 1.15));
  const shadowColor = `hsl(${h}, ${shadowS}%, ${shadowL}%)`;
  return `radial-gradient(circle at 35% 30%, ${highColor} 0%, ${midColor} 58%, ${shadowColor} 100%)`;
}

/** 平面版外觀（無 3D 高光立體感），給比分板、狀態列、棋譜的小棋子用 */
export function getFlatPieceCss(sideConfig, isBlackSide) {
  const fallback = isBlackSide ? DEFAULT_BLACK_PRESETS[0].color : DEFAULT_WHITE_PRESETS[0].color;
  if (sideConfig && sideConfig.type === "image" && sideConfig.imageData) {
    return `url("${sideConfig.imageData}") center/cover no-repeat`;
  }
  const color = sideConfig && sideConfig.color ? sideConfig.color : fallback;
  return color;
}

export function getPieceBackgroundCss(sideConfig, isBlackSide) {
  if (!sideConfig) {
    return isBlackSide ? DEFAULT_BLACK_PRESETS[0].gradient : DEFAULT_WHITE_PRESETS[0].gradient;
  }
  if (sideConfig.type === "image" && sideConfig.imageData) {
    if (sideConfig.gloss !== false) {
      return `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.12) 42%, rgba(0,0,0,0.45) 95%), url("${sideConfig.imageData}") center/cover no-repeat`;
    } else {
      return `url("${sideConfig.imageData}") center/cover no-repeat`;
    }
  }
  if (sideConfig.type === "color" && sideConfig.color) {
    return generateSphericalGradient(sideConfig.color);
  }
  if (sideConfig.type === "preset" && sideConfig.gradient) {
    return sideConfig.gradient;
  }
  return isBlackSide ? DEFAULT_BLACK_PRESETS[0].gradient : DEFAULT_WHITE_PRESETS[0].gradient;
}

export class SkinManager {
  constructor() {
    this.config = this.loadConfig();
    this.applyToDOM();
  }

  loadConfig() {
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(SKIN_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.black && parsed.white) {
            if (!parsed.pathBlack) parsed.pathBlack = "#111827";
            if (!parsed.pathBlackId) parsed.pathBlackId = "obsidian";
            if (!parsed.pathWhite) parsed.pathWhite = "#e2e8f0";
            if (!parsed.pathWhiteId) parsed.pathWhiteId = "pearl";
            if (!parsed.pathStyle) parsed.pathStyle = "step";
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load skin config from localStorage", e);
    }

    return {
      black: {
        type: "preset",
        id: "obsidian",
        label: "經典黑曜",
        color: "#111827",
        gradient: DEFAULT_BLACK_PRESETS[0].gradient,
        imageData: null,
        gloss: true
      },
      white: {
        type: "preset",
        id: "pearl",
        label: "經典珍珠",
        color: "#e2e8f0",
        gradient: DEFAULT_WHITE_PRESETS[0].gradient,
        imageData: null,
        gloss: true
      },
      pathBlack: "#111827",
      pathBlackId: "obsidian",
      pathWhite: "#e2e8f0",
      pathWhiteId: "pearl",
      pathStyle: "step"
    };
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SKIN_STORAGE_KEY, JSON.stringify(this.config));
      }
    } catch (e) {
      console.warn("Failed to save skin config", e);
    }
    this.applyToDOM();
  }

  resetDefaults() {
    const def = {
      black: {
        type: "preset",
        id: "obsidian",
        label: "經典黑曜",
        color: "#111827",
        gradient: DEFAULT_BLACK_PRESETS[0].gradient,
        imageData: null,
        gloss: true
      },
      white: {
        type: "preset",
        id: "pearl",
        label: "經典珍珠",
        color: "#e2e8f0",
        gradient: DEFAULT_WHITE_PRESETS[0].gradient,
        imageData: null,
        gloss: true
      },
      pathBlack: "#111827",
      pathBlackId: "obsidian",
      pathWhite: "#e2e8f0",
      pathWhiteId: "pearl",
      pathStyle: "step"
    };
    this.saveConfig(def);
    return def;
  }

  applyToDOM() {
    const blackCss = getPieceBackgroundCss(this.config.black, true);
    const whiteCss = getPieceBackgroundCss(this.config.white, false);
    const pathBlack = this.config.pathBlack || "#111827";
    const pathWhite = this.config.pathWhite || "#e2e8f0";
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--piece-black-bg", blackCss);
      document.documentElement.style.setProperty("--piece-white-bg", whiteCss);
      document.documentElement.style.setProperty("--piece-black-flat", getFlatPieceCss(this.config.black, true));
      document.documentElement.style.setProperty("--piece-white-flat", getFlatPieceCss(this.config.white, false));
      document.documentElement.style.setProperty("--path-black-fill", pathBlack);
      document.documentElement.style.setProperty("--path-white-fill", pathWhite);
      document.documentElement.dataset.pathStyle = this.config.pathStyle === "brush" ? "brush" : "step";
    }
  }

  static resizeImageToDataUrl(file, maxSize = 256) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        return reject(new Error(tr("notImage")));
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let w = img.width;
          let h = img.height;
          const scale = Math.min(maxSize / w, maxSize / h, 1);
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
