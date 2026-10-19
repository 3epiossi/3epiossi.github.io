/**
 * 儲存管理層：設定、進行中的對局、新手引導。
 * 設定鍵沿用舊版（dice_othello_settings_v2），舊存檔裡的 v1~v5 演算法設定與思考速度，在讀取時轉成新的等級與節奏。
 */

import { levelFromAlgo, MAX_LEVEL } from "../engine/levels.js";

const STORAGE_KEYS = {
  SETTINGS: "dice_othello_settings_v2",
  ONBOARDING: "dice_othello_onboarding_v2",
  GAME: "dice_othello_game_v3" // 進行中的對局（重新整理頁面後接著下）
};

const DEFAULTS = {
  theme: "neon",
  soundEnabled: true,
  animationLevel: "standard", // "full" | "standard" | "minimal"
  blackRole: "human",
  whiteRole: "cpu",
  blackLevel: MAX_LEVEL, // 黑方 CPU 的難度 1~MAX_LEVEL
  whiteLevel: MAX_LEVEL,
  thinkMs: 500,          // AI 思考時間：最高級 CPU 每步、局面分析各級的基準（見 app.js 的 levelMs）
  pace: "normal",        // 下棋節奏：slow / normal / fast / instant
  autoRoll: false,       // 輪到人類時自動擲骰（預設要點骰子）
  komi: 3.5,
  blackName: "",
  whiteName: ""
};

const OLD_SPEED_TO_PACE = { 150: "instant", 350: "fast", 600: "normal", 1000: "slow" };

/** 讀進來的設定 → 現行格式（也給測試用）。舊的演算法選擇、CPU 速度換成新的等級、節奏，已移除的欄位刪掉。 */
export function migrateSettings(parsed) {
  const saved = { ...DEFAULTS, ...parsed };
  if (parsed.blackLevel == null && parsed.blackAlgo) saved.blackLevel = levelFromAlgo(parsed.blackAlgo);
  if (parsed.whiteLevel == null && parsed.whiteAlgo) saved.whiteLevel = levelFromAlgo(parsed.whiteAlgo);
  if (parsed.pace == null && parsed.cpuSpeed != null) saved.pace = OLD_SPEED_TO_PACE[parsed.cpuSpeed] || "normal";
  for (const k of ["blackAlgo", "whiteAlgo", "cpuSpeed", "showAiHints", "hintTopN", "aiCoachAutoExpand", "flipped"]) delete saved[k];
  saved.blackLevel = Math.min(MAX_LEVEL, Math.max(1, Math.round(Number(saved.blackLevel)) || MAX_LEVEL));
  saved.whiteLevel = Math.min(MAX_LEVEL, Math.max(1, Math.round(Number(saved.whiteLevel)) || MAX_LEVEL));
  return saved;
}

export const Storage = {
  getSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) return migrateSettings(JSON.parse(raw));
    } catch (e) {}
    return { ...DEFAULTS };
  },

  saveSettings(settings) {
    try { localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings)); } catch (e) {}
  },

  /** 進行中的對局：對局樹（含分支、種子）與局面分析，見 app.js 的 saveGame */
  loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.GAME);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  saveGame(data) {
    try { localStorage.setItem(STORAGE_KEYS.GAME, JSON.stringify(data)); } catch (e) {}
  },

  clearGame() {
    try { localStorage.removeItem(STORAGE_KEYS.GAME); } catch (e) {}
  },

  hasSeenOnboarding() {
    try { return localStorage.getItem(STORAGE_KEYS.ONBOARDING) === "true"; } catch (e) { return false; }
  },

  setOnboardingSeen() {
    try { localStorage.setItem(STORAGE_KEYS.ONBOARDING, "true"); } catch (e) {}
  }
};
