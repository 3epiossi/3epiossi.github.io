/**
 * 可重現的骰子：每局有一個種子（32 位元整數），第 step 手（對局樹的步數）擲出的點數
 * 只由 (種子, step) 決定。所以同一局重播、或從歷史某一步開分支，同一步擲出的點數都一樣；
 * 棋譜只要記下種子，就能還原整局的骰子（沒有被研究模式指定過的話）。
 */

/** 新局的種子：優先用 crypto，沒有就用 Math.random */
export function randomSeed() {
  try {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  } catch (_) { /* 沒有 crypto */ }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** 種子文字（使用者輸入）→ 32 位元整數；空字串回傳 null；非數字的文字用雜湊 */
export function parseSeed(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (/^\d{1,10}$/.test(s) && Number(s) < 4294967296) return Number(s) >>> 0;
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/** 第 step 手擲出的點數 1～6 */
export function seededDie(seed, step) {
  let h = ((seed >>> 0) ^ Math.imul(step + 1, 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return 1 + Math.floor((h / 4294967296) * 6);
}
