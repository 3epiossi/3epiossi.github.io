/**
 * 劃區爭霸 (District) - 棋盤輪廓（地圖遮罩）工具
 *
 * 遮罩 (mask) 是 N x N 的布林陣列：true 代表該格屬於棋盤（陸地），false 代表地圖外（海）。
 * 輪廓來源有三種：內建圖形（多邊形向量）、使用者上傳的地圖圖片（於 UI 端轉成覆蓋率格網）、手動塗格。
 */

import { MIN_ACTIVE_CELLS } from "./constants.js";

function regularPolygon(sides, rotation = 0) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

function heartPolygon() {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x, -y]);
  }
  return pts;
}

/**
 * 台灣本島概略輪廓（經度, 緯度），僅供遊戲棋盤使用的粗略近似。
 * 經度依北緯 23.7 度的 cos 值縮放，讓南北長、東西窄的比例接近實際。
 */
const TAIWAN_LON_LAT = [
  [121.51, 25.30], [121.75, 25.15], [122.00, 25.01], [121.83, 24.85], [121.87, 24.58],
  [121.68, 24.20], [121.62, 23.98], [121.50, 23.50], [121.38, 23.10], [121.15, 22.75],
  [120.95, 22.45], [120.85, 22.05], [120.84, 21.90], [120.74, 21.95], [120.70, 22.20],
  [120.60, 22.35], [120.45, 22.48], [120.27, 22.62], [120.15, 22.95], [120.10, 23.15],
  [120.14, 23.45], [120.20, 23.75], [120.33, 24.00], [120.47, 24.25], [120.65, 24.55],
  [120.88, 24.85], [121.03, 25.05], [121.25, 25.12], [121.41, 25.18]
];

function taiwanPolygon() {
  const k = Math.cos((23.7 * Math.PI) / 180);
  return TAIWAN_LON_LAT.map(([lon, lat]) => [lon * k, -lat]);
}

/**
 * 內建棋盤圖形。rings 為多邊形環（偶奇規則，可挖洞）；null 代表完整正方形。
 * defaultSize 為建議棋盤邊長。
 */
export const PRESET_SHAPES = [
  { id: "square", name: "正方形", rings: null, defaultSize: null },
  { id: "circle", name: "圓形", rings: [regularPolygon(48)], defaultSize: 14 },
  { id: "hexagon", name: "六角形", rings: [regularPolygon(6, Math.PI / 6)], defaultSize: 14 },
  { id: "diamond", name: "菱形", rings: [regularPolygon(4, Math.PI / 2)], defaultSize: 15 },
  {
    id: "cross",
    name: "十字",
    rings: [[[-1, -3], [1, -3], [1, -1], [3, -1], [3, 1], [1, 1], [1, 3], [-1, 3], [-1, 1], [-3, 1], [-3, -1], [-1, -1]]],
    defaultSize: 15
  },
  { id: "ring", name: "環形", rings: [regularPolygon(48), regularPolygon(32).map(([x, y]) => [x * 0.42, y * 0.42])], defaultSize: 16 },
  { id: "heart", name: "愛心", rings: [heartPolygon()], defaultSize: 16 },
  { id: "taiwan", name: "台灣", rings: [taiwanPolygon()], defaultSize: 24 }
];

export const PRESET_SHAPE_MAP = new Map(PRESET_SHAPES.map(s => [s.id, s]));

function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * 將多邊形環縮放置中於 N x N 格網，並以 4x4 超取樣計算每格覆蓋率
 * @returns {number[][]} 每格覆蓋率 0~1
 */
export function rasterizeRings(rings, N, samples = 4) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = N / Math.max(w, h);
  const offX = (N - w * scale) / 2;
  const offY = (N - h * scale) / 2;

  const coverage = [];
  for (let r = 0; r < N; r++) {
    const row = [];
    for (let c = 0; c < N; c++) {
      let hit = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const gx = c + (sx + 0.5) / samples;
          const gy = r + (sy + 0.5) / samples;
          const x = (gx - offX) / scale + minX;
          const y = (gy - offY) / scale + minY;
          if (pointInRings(x, y, rings)) hit++;
        }
      }
      row.push(hit / (samples * samples));
    }
    coverage.push(row);
  }
  return coverage;
}

/** 覆蓋率格網轉遮罩 */
export function coverageToMask(coverage, threshold = 0.5) {
  return coverage.map(row => row.map(v => v >= threshold));
}

/** 依內建圖形產生遮罩；正方形回傳 null */
export function maskFromPreset(shapeId, N) {
  const preset = PRESET_SHAPE_MAP.get(shapeId);
  if (!preset || !preset.rings) return null;
  return coverageToMask(rasterizeRings(preset.rings, N));
}

export function createFullMask(N, value = true) {
  return Array.from({ length: N }, () => Array(N).fill(value));
}

export function countActiveCells(mask) {
  if (!mask) return null;
  return mask.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
}

/** 遮罩是否等同完整正方形 */
export function isFullMask(mask) {
  return !mask || mask.every(row => row.every(Boolean));
}

/** 計算陸地連通塊（島嶼）數量 */
export function countIslands(mask) {
  if (!mask) return 1;
  const N = mask.length;
  const seen = mask.map(row => row.map(v => !v));
  let islands = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (seen[r][c]) continue;
      islands++;
      const stack = [[r, c]];
      seen[r][c] = true;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && !seen[nr][nc]) {
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
    }
  }
  return islands;
}

/** 檢查遮罩是否可開局；不合格時 reason 是代碼（"tooSmall"），文字由介面依語言顯示 */
export function validateMask(mask) {
  if (!mask) return { valid: true };
  const count = countActiveCells(mask);
  if (count < MIN_ACTIVE_CELLS) {
    return { valid: false, reason: "tooSmall", min: MIN_ACTIVE_CELLS, count };
  }
  return { valid: true };
}

/** 將遮罩以列字串編碼（"1" 陸地、"0" 海），供 localStorage 保存 */
export function encodeMask(mask) {
  if (!mask) return null;
  return mask.map(row => row.map(v => (v ? "1" : "0")).join("")).join("/");
}

export function decodeMask(str) {
  if (typeof str !== "string" || !str) return null;
  const rows = str.split("/");
  const N = rows.length;
  if (!rows.every(row => row.length === N && /^[01]+$/.test(row))) return null;
  return rows.map(row => Array.from(row, ch => ch === "1"));
}
