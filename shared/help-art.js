/**
 * 規則說明用的示意圖（內嵌 SVG，160x100）。顏色用固定色票，亮暗背景都看得清楚。
 */

const BLACK = "#111827";
const WHITE = "#f1f5f9";
const GREEN = "#14532d";
const GOLD = "#facc15";
const RED = "#e63946";
const BLUE = "#3a86ff";
const GRID = "rgba(148,163,184,0.35)";
const SUIT_COLORS = ["#facc15", "#ef4444", "#38bdf8", "#4ade80"];
const SUITS = ["♠︎", "♥︎", "♦︎", "♣︎"];

const svg = (body) => `<svg viewBox="0 0 160 100" role="img" aria-hidden="true">${body}</svg>`;

/** 棋子：face 是 "b" 或 "w"，g 是組別 0～3 */
function disc(x, y, face, g, r = 14) {
  const fill = face === "b" ? BLACK : WHITE;
  const ink = face === "b" ? "#f8fafc" : "#111827";
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${face === "b" ? "#475569" : "#94a3b8"}" stroke-width="1.5"/>
    <text x="${x}" y="${y + 5}" text-anchor="middle" font-size="${r * 1.2}" font-weight="800" fill="${ink}">${SUITS[g]}</text>
    <rect x="${x - r * 0.42}" y="${y + r * 0.58}" width="${r * 0.84}" height="2.5" rx="1.2" fill="${SUIT_COLORS[g]}"/>`;
}

function plainDisc(x, y, face, r = 13) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${face === "b" ? BLACK : WHITE}" stroke="${face === "b" ? "#475569" : "#94a3b8"}" stroke-width="1.5"/>`;
}

const arrow = (x1, y1, x2, y2, color = GOLD) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="3" stroke-linecap="round" fill="none"/>
  <path d="M${x2} ${y2}l-7 -5m7 5l-7 5" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

export const ART = {
  // ===== 五連黑白棋 =====
  "five-groups": svg(`
    <rect x="6" y="22" width="148" height="56" rx="12" fill="${GREEN}"/>
    ${[0, 1, 2, 3].map((g) => disc(32 + g * 32, 50, g % 2 ? "w" : "b", g)).join("")}`),

  "five-flank": svg(`
    <rect x="6" y="22" width="148" height="56" rx="12" fill="${GREEN}"/>
    <path d="M44 22v56M82 22v56M120 22v56" stroke="${GRID}"/>
    ${plainDisc(25, 50, "b")}${plainDisc(63, 50, "w")}${plainDisc(101, 50, "w")}
    <circle cx="137" cy="50" r="6" fill="#a3e635"/>
    <path d="M122 28q-50 -24 -97 0" stroke="${GOLD}" stroke-width="2.5" fill="none" stroke-dasharray="4 4"/>`),

  "five-line": svg(`
    <rect x="6" y="22" width="148" height="56" rx="12" fill="${GREEN}"/>
    <path d="M14 50H146" stroke="${GOLD}" stroke-width="5" stroke-linecap="round" opacity="0.9"/>
    ${[0, 1, 2, 3, 4].map((i) => disc(22 + i * 29, 50, i === 1 || i === 3 ? "w" : "b", 2, 12.5)).join("")}`),

  "five-count": svg(`
    <rect x="6" y="22" width="148" height="56" rx="12" fill="${GREEN}"/>
    ${plainDisc(42, 50, "b", 17)}${plainDisc(118, 50, "w", 17)}
    <text x="42" y="56" text-anchor="middle" font-size="17" font-weight="800" fill="#f8fafc">33</text>
    <text x="118" y="56" text-anchor="middle" font-size="17" font-weight="800" fill="#111827">31</text>
    <text x="80" y="55" text-anchor="middle" font-size="16" font-weight="700" fill="#cbd5e1">vs</text>`),

  // ===== 劃區爭霸 =====
  "district-map": svg(`
    ${(() => {
      const cols = [["#e63946", "#f08a93", "#cbd5e1", "#8db3ff"], ["#e8747c", "#e63946", "#8db3ff", "#3a86ff"], ["#cbd5e1", "#8db3ff", "#3a86ff", "#2563eb"]];
      let out = "";
      cols.forEach((row, r) => row.forEach((c, i) => {
        out += `<rect x="${20 + i * 30}" y="${12 + r * 25}" width="28" height="23" rx="3" fill="${c}"/>`;
        for (let k = 0; k < 5; k++) out += `<circle cx="${24 + i * 30 + ((k * 7 + r * 3) % 21)}" cy="${18 + r * 25 + ((k * 5 + i * 4) % 14)}" r="1.1" fill="#0f172a"/>`;
      }));
      return out;
    })()}`),

  "district-walls": svg(`
    ${(() => {
      let out = "";
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const left = c < 2;
        out += `<rect x="${20 + c * 30}" y="${12 + r * 25}" width="28" height="23" rx="3" fill="${left ? "#f08a93" : "#8db3ff"}"/>`;
      }
      return out;
    })()}
    <path d="M80 8V90" stroke="${GOLD}" stroke-width="6" stroke-linecap="butt"/>
    <path d="M80 37H124" stroke="${GOLD}" stroke-width="6"/>`),

  "district-win": svg(`
    <rect x="16" y="46" width="52" height="42" rx="6" fill="${RED}"/>
    <rect x="76" y="46" width="30" height="42" rx="6" fill="${BLUE}"/>
    <rect x="114" y="46" width="30" height="42" rx="6" fill="${BLUE}"/>
    <text x="42" y="73" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">52%</text>
    <text x="91" y="73" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">24%</text>
    <text x="129" y="73" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">24%</text>
    <path d="M24 30l9 -10l9 10l9 -10l9 10v8H24z" fill="${GOLD}"/>`),

  "district-gerry": svg(`
    <rect x="10" y="14" width="36" height="72" rx="6" fill="#1d4ed8"/>
    <rect x="52" y="14" width="46" height="72" rx="6" fill="#f08a93"/>
    <rect x="104" y="14" width="46" height="72" rx="6" fill="#f08a93"/>
    <path d="M49 10V90M101 10V90" stroke="${GOLD}" stroke-width="5"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${18 + (i % 2) * 14}" y="${24 + Math.floor(i / 2) * 20}" width="9" height="9" rx="2" fill="#93c5fd" opacity="0.85"/>`).join("")}
    <text x="28" y="76" text-anchor="middle" font-size="9" font-weight="700" fill="#dbeafe">99%</text>
    <text x="75" y="54" text-anchor="middle" font-size="11" font-weight="800" fill="#7f1d1d">51%</text>
    <text x="127" y="54" text-anchor="middle" font-size="11" font-weight="800" fill="#7f1d1d">51%</text>`),

  // ===== 誰會贏？ =====
  "dice-roll": svg(`
    <rect x="28" y="22" width="56" height="56" rx="12" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
    ${[[44, 38], [68, 38], [44, 62], [68, 62]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5" fill="#111827"/>`).join("")}
    ${arrow(96, 50, 142, 50)}
    <text x="119" y="40" text-anchor="middle" font-size="13" font-weight="800" fill="${GOLD}">4</text>`),

  "dice-spawn": svg(`
    <rect x="6" y="22" width="148" height="56" rx="12" fill="${GREEN}"/>
    ${plainDisc(30, 50, "b")}
    <path d="M44 50H108" stroke="${GOLD}" stroke-width="3" stroke-dasharray="5 5"/>
    ${plainDisc(126, 50, "b")}
    <circle cx="126" cy="50" r="19" fill="none" stroke="${GOLD}" stroke-width="2" stroke-dasharray="3 4"/>`),

  "dice-capture": svg(`
    <rect x="6" y="22" width="148" height="56" rx="12" fill="${GREEN}"/>
    ${plainDisc(30, 50, "b")}
    ${arrow(46, 50, 96, 50)}
    ${plainDisc(124, 50, "w")}
    <path d="M114 40l20 20m0 -20l-20 20" stroke="${RED}" stroke-width="4" stroke-linecap="round"/>`),

  "dice-pass": svg(`
    <rect x="28" y="24" width="104" height="52" rx="26" fill="rgba(148,163,184,0.15)" stroke="#94a3b8" stroke-width="2"/>
    <text x="80" y="57" text-anchor="middle" font-size="22" font-weight="900" fill="#e2e8f0">PASS</text>
    <path d="M118 36l12 14l-12 14" stroke="${GOLD}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
};
