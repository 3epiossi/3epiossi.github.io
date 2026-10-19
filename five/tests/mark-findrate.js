/**
 * 標記的「找到率」：在每個局面假裝下了最佳步，如果這步會被標成某個好手（!!、!），
 * 統計各等級的 CPU 實際上有沒有下到這一步。好的定義應該是：弱的常常找不到、強的大多找得到；
 * 弱的也幾乎都找得到，表示那一步其實很明顯（問應手）。
 *
 *   node five/tests/mark-findrate.js --tune '{"obviousDepth":2}' five/tests/results/mark14-*.jsonl
 */
import fs from "fs";
import { classifyMove, MARK_TUNE } from "../src/ai/move-quality.js";
import { displayWinProb } from "../src/ui/eval-bar.js";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const tune = { ...MARK_TUNE, ...JSON.parse(arg("tune", "{}")) };
const files = argv.filter((f) => f.endsWith(".jsonl"));
const emptiesOf = (b) => b.flat().filter((d) => !d).length;
const stat = {};
for (const f of files) for (const line of fs.readFileSync(f, "utf8").trim().split("\n")) {
  const P = JSON.parse(line).positions;
  for (let i = 0; i < P.length; i++) {
    const pos = P[i];
    if (pos.played == null || !pos.scores?.length) continue;
    let prevP = null;
    const gp = P[i - 1];
    if (gp?.scores?.length) {
      const best = Math.max(...gp.scores.map((x) => x[1]));
      const p = best >= 0.999 ? 1 : best <= -0.999 ? 0 : displayWinProb(best, emptiesOf(gp.board));
      prevP = gp.turn === pos.turn ? p : 1 - p;
    }
    const prevWin = [];
    for (let k = 1; k <= tune.turnWindow && i - k >= 0; k++) {
      const q = P[i - k];
      if (!q?.scores?.length) continue;
      const best = Math.max(...q.scores.map((x) => x[1]));
      const p = best >= 0.999 ? 1 : best <= -0.999 ? 0 : displayWinProb(best, emptiesOf(q.board));
      prevWin.push(q.turn === pos.turn ? p : 1 - p);
    }
    const scores = pos.scores.map(([sq, score]) => ({ sq, score }));
    const top = scores.reduce((a, b) => (b.score > a.score ? b : a));
    const m = classifyMove({ scores, played: top.sq, board: pos.board, turn: pos.turn, toProb: displayWinProb, prevP, prevWin, tune });
    if (!m?.sym || !["!!", "!"].includes(m.sym)) continue;
    const k = `${m.sym} ${pos.lvl} 級`;
    const s = (stat[k] ||= { n: 0, found: 0 });
    s.n++;
    if ((pos.played & 63) === (top.sq & 63)) s.found++;
  }
}
for (const k of Object.keys(stat).sort()) console.log(`${k}：${stat[k].n} 次，找到 ${(100 * stat[k].found / stat[k].n).toFixed(0)}%`);
