/** 舊 v1~v5 引擎的代理人（用舊 rules.js 與 ai-service.js），對戰新引擎基準用。 */
import { findBestMoveForCPU } from "./legacy/ai/ai-service.js";
import { clearTranspositionTable } from "./legacy/ai/evaluator.js";
import { mkMove } from "../src/engine/core.js";

export function oldAgent(algo = "v5") {
  const encode = (res, die) => {
    const m = res.chosen;
    const toR = m.toR ?? m.to.r, toC = m.toC ?? m.to.c;
    const to = (toR << 3) | toC;
    if (m.type === "capture") {
      const fr = m.fromR ?? m.from.r, fc = m.fromC ?? m.from.c;
      return mkMove((fr << 3) | fc, to, 1, die);
    }
    return mkMove(to, to, 0, die);
  };
  return {
    name: "old " + algo,
    choose(pos, die) {
      const grid = pos.toGrid();
      if (die) {
        const res = findBestMoveForCPU(grid, pos.turn, die, algo);
        return res && res.chosen ? encode(res, die) : -1;
      }
      let best = null, bd = 0, bs = -Infinity;
      for (let d = 1; d <= 6; d++) {
        const res = findBestMoveForCPU(grid, pos.turn, d, algo);
        if (res && res.chosen && res.maxScore > bs) { bs = res.maxScore; best = res; bd = d; }
      }
      return best ? encode(best, bd) : -1;
    },
    reset() { clearTranspositionTable(); }
  };
}
