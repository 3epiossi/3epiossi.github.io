/**
 * 劃區爭霸 (District) - 核心常數設定
 */

/** 預設政黨色票（依座位順序取用；玩家可自訂名稱與顏色） */
export const DEFAULT_PARTY_PRESETS = [
  { name: "藍黨", color: "#3a86ff" },
  { name: "綠黨", color: "#10b981" },
  { name: "紅黨", color: "#e63946" },
  { name: "黃黨", color: "#f59e0b" },
  { name: "紫黨", color: "#9b5de5" },
  { name: "粉黨", color: "#f15bb5" }
];

export const MIN_PARTIES = 2;
export const MAX_PARTIES = 6;

export const MIN_BOARD_SIZE = 6;
export const MAX_BOARD_SIZE = 24;

/** 最少可用棋格數（太小的地圖放不下牆塊，無法劃區） */
export const MIN_ACTIVE_CELLS = 12;

function hexToRgba(hex, alpha) {
  const num = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

/** 正規化顏色字串為 #rrggbb；無效時回傳 fallback */
export function normalizeHexColor(color, fallback = "#94a3b8") {
  if (typeof color !== "string") return fallback;
  const s = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return fallback;
}

/**
 * 由使用者設定建立完整政黨物件陣列
 * @param {Array<{name?: string, color?: string}>} list
 */
export function buildParties(list) {
  return list.map((p, id) => {
    const preset = DEFAULT_PARTY_PRESETS[id % DEFAULT_PARTY_PRESETS.length];
    const name = (p && typeof p.name === "string" && p.name.trim()) ? p.name.trim().slice(0, 12) : preset.name;
    const color = normalizeHexColor(p && p.color, preset.color);
    return {
      id,
      key: `p${id}`,
      name,
      shortName: Array.from(name)[0],
      color,
      bgLight: hexToRgba(color, 0.16),
      bgStrong: color
    };
  });
}

/** 預設政黨（向前相容：舊程式與測試以 PARTIES[i] 取用） */
export const PARTIES = buildParties(DEFAULT_PARTY_PRESETS);

/**
 * 可自訂的規則與機制（預設值即經典規則）
 * - handSize：手上同時可選的牆塊數
 * - families：牌袋包含的牆塊家族（至少一種）
 * - bagScale：牌袋份量倍率
 * - minDistrictSize：小於此格數的選區是均分選區，選舉人票平分給所有政黨
 * - passRounds：所有政黨連續放棄幾輪後結束
 * - popContrast：城鄉人口差距 flat | normal | extreme
 * - partyClustering：政黨支持者分布 mixed | normal | segregated
 * - compensation：先手補償倍率 (0 = 不補償)，套用在各模式的 k 上
 * - aiLevel：電腦強度 1～4 級（定義在 ai/ai-player.js 的 AI_LEVELS）；舊存檔的 easy | normal | hard 換成 2 | 3 | 4
 */
export const DEFAULT_RULES = {
  handSize: 1,
  families: ["I4", "S4", "T4"],
  bagScale: 1,
  minDistrictSize: 2,
  passRounds: 1,
  popContrast: "normal",
  partyClustering: "normal",
  compensation: 1,
  aiLevel: 3
};

/** 電腦強度的級數與預設（各級的參數在 ai/ai-player.js 的 AI_LEVELS，相鄰兩級勝率的量測數據寫在那裡） */
export const AI_LEVEL_IDS = [1, 2, 3, 4];
export const DEFAULT_AI_LEVEL = 3;
const LEGACY_AI_LEVEL = { easy: 2, normal: 3, hard: 4 };

/** 把舊存檔的 easy / normal / hard 或任何不合法的值換成 1～4 級 */
export function normalizeAiLevel(v) {
  if (LEGACY_AI_LEVEL[v]) return LEGACY_AI_LEVEL[v];
  const n = Number(v);
  return AI_LEVEL_IDS.includes(n) ? n : DEFAULT_AI_LEVEL;
}

export const RULE_CHOICES = {
  handSize: [1, 2, 3, 4],
  bagScale: [0.6, 1, 1.5],
  minDistrictSize: [1, 2, 3, 4],
  passRounds: [1, 2],
  popContrast: ["flat", "normal", "extreme"],
  partyClustering: ["mixed", "normal", "segregated"],
  compensation: [0, 1, 2],
  aiLevel: [1, 2, 3, 4]
};

const WALL_FAMILIES = ["I4", "S4", "T4"];
const LEGACY_FAMILY = { I3: "I4", S3: "S4" };

/** 正規化規則：不合法的值退回預設 */
export function normalizeRules(raw) {
  const rules = { ...DEFAULT_RULES };
  if (!raw || typeof raw !== "object") return rules;
  for (const [key, choices] of Object.entries(RULE_CHOICES)) {
    if (choices.includes(raw[key])) rules[key] = raw[key];
  }
  rules.aiLevel = normalizeAiLevel(raw.aiLevel ?? rules.aiLevel);
  if (Array.isArray(raw.families)) {
    // 舊版存檔的家族名稱（I3、S3）換成現在的 I4、S4
    const migrated = raw.families.map((f) => LEGACY_FAMILY[f] || f);
    const fams = WALL_FAMILIES.filter((f) => migrated.includes(f));
    if (fams.length) rules.families = fams;
  }
  return rules;
}

/** 城鄉人口差距：單格人口範圍與冪次曲線（越大越兩極） */
export const POPULATION_PROFILES = {
  flat: { range: [60, 150], curve: 1.2 },
  normal: { range: [15, 285], curve: 2.3 },
  extreme: { range: [5, 420], curve: 3.2 }
};

/** 政黨支持者分布：據點影響半徑（相對地圖邊長）與隨機擾動 */
export const CLUSTERING_PROFILES = {
  mixed: { sigma: 0.46, noise: 0.10 },
  normal: { sigma: 0.28, noise: 0.06 },
  segregated: { sigma: 0.17, noise: 0.03 }
};

/** 經典正方形棋盤模式（無自訂地圖時使用，維持既有平衡數據） */
export const GAME_MODES = {
  2: {
    numPlayers: 2,
    boardSize: 8,
    totalCells: 64,
    totalEdges: 112,
    bagCopiesPerShape: 5,
    totalBagPieces: 50,
    initialK: -5 // 先手補償：外框視為牆後後手略占優，因此先手多 10 人支持者（負值偏向先手）
  },
  3: {
    numPlayers: 3,
    boardSize: 9,
    totalCells: 81,
    totalEdges: 144,
    bagCopiesPerShape: 7,
    totalBagPieces: 70,
    initialK: -30 // 先手補償步階（負值偏向先行動的政黨）
  },
  4: {
    numPlayers: 4,
    boardSize: 10,
    totalCells: 100,
    totalEdges: 180,
    bagCopiesPerShape: 7,
    totalBagPieces: 70,
    initialK: -40 // 先手補償步階（負值偏向先行動的政黨）
  }
};

/**
 * 5、6 黨沒有經典模式，先手補償步階以此為基準再依格數縮放。
 * 量測顯示線性補償無法同時拉平首尾座位，因此預設不補償。
 */
export const EXTRA_PARTY_K = { 5: 0, 6: 0 };

/**
 * 雙人自訂地圖的先手補償：每個可用棋格補幾個人（負值偏向先手）。
 * 台灣 24x24（147 格）量測：k = -100 先手勝率 50.75%（400 盤）；其他形狀（愛心、正方形、六角形、圓形）約 50~56%。
 * 補償值的單位是「人」，所以要跟地圖總人口成比例，之前縮放自 8x8 的 -5 對大地圖幾乎沒有補償。
 */
export const TWO_PARTY_K_PER_CELL = -0.65;

/** 每 N 格放 1 份牆塊形狀（自訂地圖用，經典模式約 11.6～14.3） */
export const CELLS_PER_BAG_COPY = 12.5;

/** 全盤平均每格基準人口（實際每格人口會依都會/鄉村密度在 15 ~ 285 之間變化，全盤總和恆為 可用格數 * 100） */
export const CELL_POPULATION = 100;

export const CELL_POPULATION_RANGE = [15, 285];

export const POLL_SETTINGS = {
  districtBiasRange: [-3, 3], // 象限系統性民調偏差（百分比基準）
  cellErrorRange: [-4, 4]     // 單格隨機抽樣誤差（百分比基準）
};
