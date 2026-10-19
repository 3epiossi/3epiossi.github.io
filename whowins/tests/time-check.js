/** 每步用時檢查：最高級（吃滿思考時間）在各階段局面下，每步實際花多久。node whowins/tests/time-check.js [--timeMs 500] */
import { Position } from "../src/engine/core.js";
import { Searcher } from "../src/engine/search.js";
import { chooseCode } from "../src/engine/service.js";
import { LEVELS } from "../src/engine/levels.js";
import { playGame, levelAgent, makeRng } from "./lib.js";

const timeMs = Number(process.argv[3] || 500);
const rng = makeRng(99);
const positions = [];
for (let g = 0; g < 6; g++) {
  const mk = () => levelAgent({ depth: 1, eps: 0.2 }, { rng });
  playGame({ black: mk(), white: mk(), diceSeed: 500 + g, onSample: (p) => { if (positions.length % 9 === 0) positions.push(p.clone()); else positions.push(null); } });
}
const ps = positions.filter(Boolean);
const s = new Searcher();
const times = [];
for (const p of ps) {
  s.clearTT();
  const die = 1 + Math.floor(rng() * 6);
  const t0 = Date.now();
  chooseCode(s, p, die, LEVELS[LEVELS.length - 1], { timeMs });
  times.push(Date.now() - t0);
}
times.sort((a, b) => a - b);
console.log(`positions ${times.length}, limit ${timeMs}ms: median ${times[times.length >> 1]}ms, p95 ${times[Math.floor(times.length * 0.95)]}ms, max ${times[times.length - 1]}ms`);
