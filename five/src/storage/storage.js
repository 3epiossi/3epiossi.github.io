/**
 * 📦 五連黑白棋 - 儲存管理層 (Storage Layer)
 * 與原專案使用不同的 localStorage 鍵，兩個遊戲的設定互不影響。
 * （棋子外觀與語言偏好是刻意共用的：skin 在 SkinManager、語言是 takuLang。）
 */

const STORAGE_KEYS = {
  SETTINGS: "weighted_othello_settings_v1",
  ONBOARDING: "weighted_othello_onboarding_v1",
  GAME: "weighted_othello_game_v1" // 進行中的對局（重新整理頁面後接著下）
};

const DEFAULTS = {
  theme: "neon",
  soundEnabled: true,
  animationLevel: "standard", // "full" | "standard" | "minimal"
  blackRole: "human",
  whiteRole: "cpu",
  v6Time: 500,        // AI 思考時間：最高級 CPU 每步、局面分析各級的基準（見 app.js 的 levelMs）。0.5 秒對 1 秒約 45%，見 README
  timeV2: true,       // 已套用「預設 0.5 秒」（見 getSettings）
  pace: "normal",
  opening: "standard", // 開局：standard（標準）／xot（隨機前幾手、雙方勝率接近，見 core/xot-openings.js）
  blackLevel: 6, // 黑方 CPU 的難度 1～6（6 = 完整的 v13）
  whiteLevel: 6, // 白方 CPU 的難度
  blackName: "",
  whiteName: "",
  symbolSet: "suits",   // 棋子文字：suits（♠♥♦♣，預設）／greek（α～δ）／custom（自訂）
  symbolsV2: true,      // 已套用「撲克花色是預設」（見 getSettings）
  customSymbols: "",    // 自訂的 4 個字
  textColorBlack: "",   // 黑方棋子的文字顏色（見 src/ui/text-colors.js；空字串 = 該色系的第一個）
  textColorWhite: ""    // 白方棋子的文字顏色
};

export const Storage = {
  getSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        const saved = { ...DEFAULTS, ...parsed };
        // 舊版只有一個共用的難度（aiLevel）：沿用到雙方，之後各自設定
        if (parsed.aiLevel != null) {
          if (parsed.blackLevel == null) saved.blackLevel = parsed.aiLevel;
          if (parsed.whiteLevel == null) saved.whiteLevel = parsed.aiLevel;
        }
        delete saved.aiLevel;
        // 預設思考時間從 1 秒改成 0.5 秒：存的是舊的預設值（1 秒）就改用新的預設，只換這一次
        if (!parsed.timeV2) {
          if (saved.v6Time === 1000 || saved.v6Time == null) saved.v6Time = 500;
          saved.timeV2 = true;
        }
        // 撲克花色變成預設之前，希臘字母是預設值（存檔裡一定有 greek）：沒換過的人改用新的預設，只換這一次
        if (!parsed.symbolsV2) {
          if (saved.symbolSet === "greek" || !saved.symbolSet) saved.symbolSet = "suits";
          saved.symbolsV2 = true;
        }
        // 已移除的欄位（舊版的演算法選擇與思考速度）不再保留
        for (const k of ["blackAlgo", "whiteAlgo", "aiDefaultsVersion", "cpuSpeed", "bonusLevel", "variant", "autoPickDisc"]) delete saved[k];
        return saved;
      }
    } catch (e) {}
    return { ...DEFAULTS };
  },

  saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {}
  },

  /** 進行中的對局：對局樹（含分支）與局面分析，見 app.js 的 saveGame */
  loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.GAME);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  saveGame(data) {
    try {
      localStorage.setItem(STORAGE_KEYS.GAME, JSON.stringify(data));
      return true;
    } catch (e) {
      return false; // 空間不夠或瀏覽器不給存：不影響遊戲本身
    }
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
  }
};
