/**
 * 🔤 棋子文字顏色：直接借用棋子顏色。黑方棋面（深色）的字從白方的寶石色（淺色系）選，
 * 白方棋面（淺色）的字從黑方的寶石色（深色系）選，這樣字一定看得清楚。
 * 棋面只能選寶石預設色（不能自訂顏色、不能上傳圖片），所以黑方一定是深色、白方一定是淺色。
 */
import { DEFAULT_BLACK_PRESETS, DEFAULT_WHITE_PRESETS } from "../../../src/ui/skin-workshop.js";

const SHADOW_FOR_LIGHT = "0 1px 2px rgba(0, 0, 0, 0.55)";
const SHADOW_FOR_DARK = "0 1px 0 rgba(255, 255, 255, 0.7)";

/** 某一方棋面可以選的文字顏色（另一方的寶石色） */
export const textPaletteFor = (isBlack) => (isBlack ? DEFAULT_WHITE_PRESETS : DEFAULT_BLACK_PRESETS);

/** 實際要用的文字顏色：{ id, color, shadow }；選的不在色系裡（或還沒選）就用第一個 */
export function resolveTextColor(isBlack, chosenId) {
  const palette = textPaletteFor(isBlack);
  const pick = palette.find((p) => p.id === chosenId) || palette[0];
  return { id: pick.id, color: pick.color, shadow: isBlack ? SHADOW_FOR_LIGHT : SHADOW_FOR_DARK };
}

/** 棋面設定只接受寶石預設色；以前存的自訂色或圖片改用該方的第一個預設色 */
export function normalizeFace(conf, isBlack) {
  const presets = isBlack ? DEFAULT_BLACK_PRESETS : DEFAULT_WHITE_PRESETS;
  const p = (conf && conf.type === "preset" && presets.find((x) => x.id === conf.id)) || presets[0];
  return { type: "preset", id: p.id, label: p.label, color: p.color, gradient: p.gradient, imageData: null, gloss: true };
}
