/**
 * 三個遊戲共用的語言基礎：語言偏好存在 localStorage 的 takuLang（五連黑白棋、誰會贏、劃區爭霸共用），
 * 切換時送出 window 的 langchange 事件。
 *
 * createT({ zh: {...}, en: {...}, ja: {...} }) 回傳 t(key, vars)：找不到的 key 退回中文、再退回 key 本身；
 * 字串裡的 {name} 會換成 vars.name。
 */

export const LANGS = ["zh", "en", "ja"];

export function getLang() {
  let lang = "zh";
  try { lang = localStorage.getItem("takuLang") || "zh"; } catch (_) { /* 私密瀏覽 */ }
  return LANGS.includes(lang) ? lang : "zh";
}

export function htmlLang(lang) {
  return lang === "ja" ? "ja" : lang === "en" ? "en" : "zh-Hant";
}

/** 設定語言並通知頁面；五連黑白棋與誰會贏有自己的 setLang（會翻譯整頁），優先用它 */
export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  if (typeof window.setLang === "function" && window.setLang !== setLang) {
    window.setLang(lang);
    return;
  }
  try { localStorage.setItem("takuLang", lang); } catch (_) { /* 私密瀏覽 */ }
  document.documentElement.lang = htmlLang(lang);
  window.currentLang = lang;
  window.dispatchEvent(new Event("langchange"));
}

/** 頁面載入時呼叫一次：把 <html lang> 設成目前語言 */
export function initLang() {
  const lang = getLang();
  document.documentElement.lang = htmlLang(lang);
  window.currentLang = lang;
  return lang;
}

export function onLang(callback) {
  window.addEventListener("langchange", callback);
  return () => window.removeEventListener("langchange", callback);
}

export function createT(dicts) {
  return function t(key, vars) {
    const lang = getLang();
    let text = dicts[lang]?.[key] ?? dicts.zh?.[key] ?? key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
    return text;
  };
}

/** 數字依語言格式化（千分位） */
export function fmtNum(n) {
  return Number(n).toLocaleString(getLang() === "zh" ? "zh-TW" : getLang() === "ja" ? "ja-JP" : "en-US");
}
