/**
 * 📦 骰子黑白棋 (Dice Othello) - 儲存管理層 (Storage Layer)
 */

const STORAGE_KEYS = {
  SETTINGS: "dice_othello_settings_v2",
  SKINS: "dice_reversi_piece_skins_v1",
  RECENT_GAMES: "dice_othello_recent_games_v2",
  ONBOARDING: "dice_othello_onboarding_v2"
};

export const Storage = {
  getSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      theme: "neon",
      soundEnabled: true,
      animationLevel: "standard", // "full" | "standard" | "minimal"
      cpuSpeed: 600,
      showAiHints: true,
      hintTopN: 2,
      aiCoachAutoExpand: true
    };
  },

  saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {}
  },

  hasSeenOnboarding() {
    try {
      return localStorage.getItem(STORAGE_KEYS.ONBOARDING) === "true";
    } catch (e) {
      return false;
    }
  },

  setOnboardingSeen() {
    try {
      localStorage.setItem(STORAGE_KEYS.ONBOARDING, "true");
    } catch (e) {}
  },

  saveRecentGame(gameSummary) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RECENT_GAMES);
      let list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
      list.unshift({ ...gameSummary, date: Date.now() });
      if (list.length > 20) list = list.slice(0, 20);
      localStorage.setItem(STORAGE_KEYS.RECENT_GAMES, JSON.stringify(list));
    } catch (e) {}
  },

  getRecentGames() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RECENT_GAMES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
};
