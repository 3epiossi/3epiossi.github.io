/**
 * 劃區爭霸 (District) - 對局設定（政黨、棋盤形狀）與 localStorage 保存
 */

import {
  DEFAULT_PARTY_PRESETS,
  DEFAULT_AI_LEVEL,
  normalizeAiLevel,
  GAME_MODES,
  MIN_PARTIES,
  MAX_PARTIES,
  MIN_BOARD_SIZE,
  MAX_BOARD_SIZE,
  normalizeHexColor,
  normalizeRules
} from "../core/constants.js";
import { PRESET_SHAPE_MAP, maskFromPreset, decodeMask, encodeMask, isFullMask } from "../core/board-shapes.js";
import { partyDisplayName } from "../i18n.js";

const STORAGE_KEY = "district.settings.v1";
const GAME_KEY = "district.game.v1";
/** 電腦強度（每個政黨各自設定，在計分列上調整） */
export { AI_LEVEL_IDS } from "../core/constants.js";

/** 經典模式建議尺寸：2 黨 8、3 黨 9、4 黨以上 10 */
export function classicSizeFor(numParties) {
  return GAME_MODES[numParties] ? GAME_MODES[numParties].boardSize : 10;
}

export function defaultSettings() {
  return {
    parties: DEFAULT_PARTY_PRESETS.slice(0, 2).map((p, i) => ({ ...p, type: i === 0 ? "human" : "cpu", level: DEFAULT_AI_LEVEL })),
    shapeId: "taiwan",
    boardSize: 24,
    customMask: null,
    rules: normalizeRules(null),
    seed: null
  };
}

/** 地圖種子：0～999999 的整數；null 代表每局隨機 */
export function normalizeSeed(value) {
  const n = Number(value);
  return value !== null && value !== "" && Number.isInteger(n) && n >= 0 && n <= 999999 ? n : null;
}

export function normalizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;

  let parties = Array.isArray(raw.parties) ? raw.parties.slice(0, MAX_PARTIES) : base.parties;
  parties = parties.map((p, i) => {
    const preset = DEFAULT_PARTY_PRESETS[i % DEFAULT_PARTY_PRESETS.length];
    return {
      name: typeof p?.name === "string" && p.name.trim() ? p.name.trim().slice(0, 12) : preset.name,
      color: normalizeHexColor(p?.color, preset.color),
      type: p?.type === "cpu" ? "cpu" : "human",
      level: normalizeAiLevel(p?.level)
    };
  });
  while (parties.length < MIN_PARTIES) {
    const preset = DEFAULT_PARTY_PRESETS[parties.length];
    parties.push({ ...preset, type: "cpu" });
  }

  const size = Number.isInteger(raw.boardSize)
    ? Math.max(MIN_BOARD_SIZE, Math.min(MAX_BOARD_SIZE, raw.boardSize))
    : classicSizeFor(parties.length);
  const shapeId = raw.shapeId === "custom" || PRESET_SHAPE_MAP.has(raw.shapeId) ? raw.shapeId : "square";
  let customMask = shapeId === "custom" ? decodeMask(raw.customMask) : null;
  const rules = normalizeRules(raw.rules);
  const seed = normalizeSeed(raw.seed);
  if (shapeId === "custom" && !customMask) {
    return { ...base, parties, boardSize: size, rules, seed };
  }
  if (customMask) {
    return { parties, shapeId, boardSize: customMask.length, customMask: encodeMask(customMask), rules, seed };
  }
  return { parties, shapeId, boardSize: size, customMask: null, rules, seed };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch (_) {
    return defaultSettings();
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {
    // 私密瀏覽或停用儲存時略過，不影響遊戲
  }
}

/** 依設定計算遮罩；完整正方形回傳 null */
export function resolveMask(settings) {
  const mask = settings.shapeId === "custom"
    ? decodeMask(settings.customMask)
    : maskFromPreset(settings.shapeId, settings.boardSize);
  return isFullMask(mask) ? null : mask;
}

/** 轉成 GameEngine 建構參數 */
export function toEngineOptions(settings) {
  return {
    parties: settings.parties.map(({ name, color }, i) => ({ name: partyDisplayName(name, i), color })),
    boardSize: settings.boardSize,
    mask: resolveMask(settings),
    rules: settings.rules
  };
}

/** 進行中的對局（開局參數與每一步），重新整理或離開再回來時接著下 */
export function loadGame() {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function saveGame(data) {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(data));
  } catch (_) {
    // 私密瀏覽或空間不足時略過
  }
}
