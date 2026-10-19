/**
 * 運氣量表（誰會贏？的骰子旁、傑利蠑螈的牆名旁共用）：標籤、數值，下面一條從中間向左右長的短條，
 * 綠色往右是好運、紅色往左是壞運，一眼看得出好壞與大小。
 * 尺寸固定：還在算、沒有數值時顯示空的量表（數值是「—」），版面不會忽大忽小。
 *
 * @param {number|null|undefined} value 運氣（百分點）；沒有就是還在算或這回合沒有運氣
 * @param {{label: string, title?: string, range?: number}} o range：短條填滿一半時對應的數值，超過就頂到端點
 */
export function luckMeterHtml(value, { label, title = "", range = 8 } = {}) {
  const has = typeof value === "number" && Number.isFinite(value);
  const tone = !has ? "" : value > 0.05 ? "pos" : value < -0.05 ? "neg" : "";
  const half = has ? Math.min(1, Math.abs(value) / range) * 50 : 0;
  const side = has && value < 0 ? `right:50%;width:${half.toFixed(1)}%` : `left:50%;width:${half.toFixed(1)}%`;
  const num = has ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}` : "—";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<span class="luckMeter ${tone}${has ? "" : " pending"}" title="${esc(title)}"><span class="lmHead"><span class="lmLabel">${esc(label)}</span><b class="lmNum">${num}</b></span><span class="lmTrack"><i class="lmFill" style="${side}"></i></span></span>`;
}
