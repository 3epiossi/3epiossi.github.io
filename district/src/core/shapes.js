/**
 * 劃區爭霸 (District) - 10 種固定方向牆塊定義 (I3, S3, T4)
 * 依據使用者最新規則需求：
 * - 牆塊共 3 個家族：I4（4 邊直線）、S4（ㄣ 字，中間兩根）、T4（T 字）
 * 
 * 坐標系統：
 * 頂點坐標 (vr, vc) 為格線交點。
 * 水平邊 (H, r, c) 連接頂點 (r, c) 與 (r, c+1)。
 * 垂直邊 (V, r, c) 連接頂點 (r, c) 與 (r+1, c)。
 * 每一形狀均以最小頂點外接框歸一化（min vr = 0, min vc = 0）。
 */

export const WALL_SHAPES = [
  // --- I4: 長度 4，一直線（2 種）---
  {
    id: "I4_H",
    type: "I4",
    length: 4,
    name: "I4 橫線",
    edges: [
      { type: "H", r: 0, c: 0 },
      { type: "H", r: 0, c: 1 },
      { type: "H", r: 0, c: 2 },
      { type: "H", r: 0, c: 3 }
    ],
    midpoints: [[0, 1], [0, 2], [0, 3]],
    endpoints: [[0, 0], [0, 4]]
  },
  {
    id: "I4_V",
    type: "I4",
    length: 4,
    name: "I4 直線",
    edges: [
      { type: "V", r: 0, c: 0 },
      { type: "V", r: 1, c: 0 },
      { type: "V", r: 2, c: 0 },
      { type: "V", r: 3, c: 0 }
    ],
    midpoints: [[1, 0], [2, 0], [3, 0]],
    endpoints: [[0, 0], [4, 0]]
  },

  // --- S4: 長度 4，ㄣ 字（中間兩根連續，兩端方向相反的轉角）（4 種）---
  // 中間為直邊 (2 種)
  {
    id: "S4_V_R",
    type: "S4",
    length: 4,
    name: "S4 直折右",
    edges: [
      { type: "H", r: 0, c: 0 },
      { type: "V", r: 0, c: 1 },
      { type: "V", r: 1, c: 1 },
      { type: "H", r: 2, c: 1 }
    ],
    midpoints: [[0, 1], [1, 1], [2, 1]],
    endpoints: [[0, 0], [2, 2]]
  },
  {
    id: "S4_V_L",
    type: "S4",
    length: 4,
    name: "S4 直折左",
    edges: [
      { type: "H", r: 0, c: 1 },
      { type: "V", r: 0, c: 1 },
      { type: "V", r: 1, c: 1 },
      { type: "H", r: 2, c: 0 }
    ],
    midpoints: [[0, 1], [1, 1], [2, 1]],
    endpoints: [[0, 2], [2, 0]]
  },
  // 中間為橫邊 (2 種)
  {
    id: "S4_H_D",
    type: "S4",
    length: 4,
    name: "S4 橫折下",
    edges: [
      { type: "V", r: 0, c: 0 },
      { type: "H", r: 1, c: 0 },
      { type: "H", r: 1, c: 1 },
      { type: "V", r: 1, c: 2 }
    ],
    midpoints: [[1, 0], [1, 1], [1, 2]],
    endpoints: [[0, 0], [2, 2]]
  },
  {
    id: "S4_H_U",
    type: "S4",
    length: 4,
    name: "S4 橫折上",
    edges: [
      { type: "V", r: 1, c: 0 },
      { type: "H", r: 1, c: 0 },
      { type: "H", r: 1, c: 1 },
      { type: "V", r: 0, c: 2 }
    ],
    midpoints: [[1, 0], [1, 1], [1, 2]],
    endpoints: [[2, 0], [0, 2]]
  },

  // --- T4: 長度 4，T 字（橫向 2 單位長度、縱向 2 單位長度）（4 種）---
  {
    id: "T4_D",
    type: "T4",
    length: 4,
    name: "T4 凸向下",
    edges: [
      { type: "H", r: 0, c: 0 },
      { type: "H", r: 0, c: 1 },
      { type: "V", r: 0, c: 1 },
      { type: "V", r: 1, c: 1 }
    ],
    midpoints: [[0, 1], [1, 1]],
    endpoints: [[0, 0], [0, 2], [2, 1]]
  },
  {
    id: "T4_U",
    type: "T4",
    length: 4,
    name: "T4 凸向上",
    edges: [
      { type: "H", r: 2, c: 0 },
      { type: "H", r: 2, c: 1 },
      { type: "V", r: 0, c: 1 },
      { type: "V", r: 1, c: 1 }
    ],
    midpoints: [[2, 1], [1, 1]],
    endpoints: [[2, 0], [2, 2], [0, 1]]
  },
  {
    id: "T4_R",
    type: "T4",
    length: 4,
    name: "T4 凸向右",
    edges: [
      { type: "V", r: 0, c: 0 },
      { type: "V", r: 1, c: 0 },
      { type: "H", r: 1, c: 0 },
      { type: "H", r: 1, c: 1 }
    ],
    midpoints: [[1, 0], [1, 1]],
    endpoints: [[0, 0], [2, 0], [1, 2]]
  },
  {
    id: "T4_L",
    type: "T4",
    length: 4,
    name: "T4 凸向左",
    edges: [
      { type: "V", r: 0, c: 2 },
      { type: "V", r: 1, c: 2 },
      { type: "H", r: 1, c: 0 },
      { type: "H", r: 1, c: 1 }
    ],
    midpoints: [[1, 2], [1, 1]],
    endpoints: [[0, 2], [2, 2], [1, 0]]
  }
];

export const SHAPE_MAP = new Map(WALL_SHAPES.map(s => [s.id, s]));

/** 依形狀與平移量 (vr, vc) 取得實際佔用的邊與中段頂點、端點 */
export function getPlacedGeometry(shape, vr, vc) {
  const edges = shape.edges.map(e => ({
    type: e.type,
    r: e.r + vr,
    c: e.c + vc
  }));

  const midpoints = shape.midpoints.map(([mr, mc]) => [mr + vr, mc + vc]);
  const endpoints = shape.endpoints.map(([er, ec]) => [er + vr, ec + vc]);

  return { edges, midpoints, endpoints };
}
