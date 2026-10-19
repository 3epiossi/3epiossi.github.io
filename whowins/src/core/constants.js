/**
 * 🎲 骰子黑白棋 (Dice Othello) - 核心常數定義
 */

export const BOARD_SIZE = 8;
export const N = BOARD_SIZE;

export const PLAYER = Object.freeze({
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2
});

export const EMPTY = PLAYER.EMPTY;
export const BLACK = PLAYER.BLACK;
export const WHITE = PLAYER.WHITE;

export const FILES = "ABCDEFGH";

export const MOVE_TYPE = Object.freeze({
  SPAWN: "spawn",
  CAPTURE: "capture",
  PASS: "pass",
  ENDGAME: "endgame"
});

export const DEFAULT_KOMI = 3.5;

export const DEFAULT_BLACK_PRESETS = Object.freeze([
  { id: "obsidian", label: "經典黑曜", color: "#111827", gradient: "radial-gradient(circle at 35% 30%, #64748b 0%, #111827 60%, #0b1220 100%)" },
  { id: "ruby", label: "烈焰赤紅", color: "#dc2626", gradient: "radial-gradient(circle at 35% 30%, #fca5a5 0%, #dc2626 55%, #450a0a 100%)" },
  { id: "sapphire", label: "蔚藍深海", color: "#2563eb", gradient: "radial-gradient(circle at 35% 30%, #93c5fd 0%, #1d4ed8 55%, #0f172a 100%)" },
  { id: "emerald", label: "翡翠墨玉", color: "#15803d", gradient: "radial-gradient(circle at 35% 30%, #86efac 0%, #15803d 55%, #052e16 100%)" },
  { id: "amethyst", label: "紫晶魅影", color: "#7e22ce", gradient: "radial-gradient(circle at 35% 30%, #d8b4fe 0%, #7e22ce 55%, #2e1065 100%)" },
  { id: "amber", label: "琥珀鎏金", color: "#d97706", gradient: "radial-gradient(circle at 35% 30%, #fef08a 0%, #d97706 55%, #713f12 100%)" }
]);

export const DEFAULT_WHITE_PRESETS = Object.freeze([
  { id: "pearl", label: "經典珍珠", color: "#e2e8f0", gradient: "radial-gradient(circle at 35% 30%, #ffffff 0%, #e2e8f0 55%, #cbd5e1 100%)" },
  { id: "crystal", label: "冰晶雪白", color: "#f0f9ff", gradient: "radial-gradient(circle at 35% 30%, #ffffff 0%, #e0f2fe 50%, #7dd3fc 100%)" },
  { id: "rose", label: "玫瑰粉晶", color: "#fecdd3", gradient: "radial-gradient(circle at 35% 30%, #fff1f2 0%, #fecdd3 50%, #f43f5e 100%)" },
  { id: "mint", label: "薄荷碧玉", color: "#bbf7d0", gradient: "radial-gradient(circle at 35% 30%, #f0fdf4 0%, #bbf7d0 50%, #22c55e 100%)" },
  { id: "ivory", label: "曜金象牙", color: "#fef3c7", gradient: "radial-gradient(circle at 35% 30%, #fffbeb 0%, #fef3c7 50%, #f59e0b 100%)" },
  { id: "topaz", label: "幻彩天藍", color: "#bae6fd", gradient: "radial-gradient(circle at 35% 30%, #f0f9ff 0%, #bae6fd 50%, #0284c7 100%)" }
]);

export const THEMES = Object.freeze({
  neon: {
    id: "neon",
    name: "暗夜霓虹 (Cyber)",
    boardBg: "#0d2818",
    boardBorder: "#1e3a29",
    cellBg: "#14532d",
    cellHover: "#15803d",
    pageBg: "#0f172a"
  },
  classic: {
    id: "classic",
    name: "經典綠呢 (Classic)",
    boardBg: "#1a472a",
    boardBorder: "#2d5a3c",
    cellBg: "#22543d",
    cellHover: "#276749",
    pageBg: "#1e293b"
  },
  wood: {
    id: "wood",
    name: "古木棋盤 (Wood)",
    boardBg: "#3d2714",
    boardBorder: "#5c3d22",
    cellBg: "#5c3a21",
    cellHover: "#784b2a",
    pageBg: "#1a130e"
  },
  slate: {
    id: "slate",
    name: "深灰極簡 (Minimal)",
    boardBg: "#1e293b",
    boardBorder: "#334155",
    cellBg: "#334155",
    cellHover: "#475569",
    pageBg: "#0b0f19"
  }
});
