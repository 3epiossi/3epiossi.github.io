/**
 * 讀網頁「匯出棋譜」存下的 JSON 檔，重新分析每一手並統計走法評價（分開看人與 CPU）。
 *
 *   node five/tests/record-review.js ~/Downloads/five-othello-*.json
 *
 * 每個局面用 v8 分析（時間 = 網頁 AI 教練的思考時間：CPU 的兩倍），套 ai/move-quality.js 的定義，
 * 與棋譜裡網頁當時標的記號並列（兩者可能不同：搜尋時間、分析到齊的時機不一樣）。
 *
 * 最後印出「標記準不準」：每種標記的局面最佳勝率、這步下完的勝率、後來實際贏的比例，
 * 以及對手下一手的平均損失與被標失誤的比例（設陷阱之後，對手真的比較常出錯嗎）。只算有結果的棋譜。
 */
import fs from "fs";
import { searchPoolV8 } from "../src/ai/v8.js";
import { classifyMove } from "../src/ai/move-quality.js";
import { displayWinProb } from "../src/ui/eval-bar.js";

const SYMS = ["!!", "!", "!?", "?!", "?", "??"];
const unpack = (b) => b.map(row => row.map(x => (x ? { id: x[0], face: x[1] } : null)));
const faceOf = (s) => (s === "black" ? 1 : 2);
const emptiesOf = (b) => b.flat().filter(d => !d).length;
const P = (s, e) => (s >= 0.999 ? 1 : s <= -0.999 ? 0 : displayWinProb(s, e));

const files = process.argv.slice(2);
if (!files.length) { console.error("用法：node five/tests/record-review.js 棋譜.json ..."); process.exit(1); }
const total = {};
const check = {}; // 標記 → { n, best, played, won, oppN, oppLoss, oppErr }
for (const f of files) {
  const rec = JSON.parse(fs.readFileSync(f, "utf8"));
  if (rec.format !== "five-othello-record") { console.error(`${f}：不是五連黑白棋的棋譜`); continue; }
  // 跟網頁的 AI 教練一樣的時間（舊的棋譜沒有 coachMs：用 CPU 思考時間的兩倍）
  const timeMs = rec.coachMs || 2 * (rec.thinkMs || 1000);
  const places = rec.moves.filter(m => m.type === "place");
  // 每個局面（下之前）分析一次
  const analyses = places.map(m => {
    const board = unpack(m.before.board);
    const r = searchPoolV8(board, faceOf(m.before.turn), m.before.pool, { timeMs, multiPV: true });
    return r ? { board, scores: r.scores.map(x => ({ sq: x.key, score: x.score })), best: r.scores[0].score } : null;
  });
  console.log(`\n${f}（${places.length} 手，結果：${rec.result ? `${rec.result.winner}${rec.result.byFive ? "（五連）" : ""}` : "未結束"}）`);
  const results = [];
  places.forEach((m, i) => {
    const a = analyses[i];
    if (!a) { results.push(null); return; }
    const nx = places[i + 1] && places[i + 1].player !== m.player ? analyses[i + 1] : null;
    const pv = i > 0 && places[i - 1].player !== m.player ? analyses[i - 1] : null;
    const prevP = pv ? 1 - P(pv.best, emptiesOf(pv.board)) : null;
    const res = classifyMove({ scores: a.scores, played: m.disc * 64 + m.sq, board: a.board, turn: faceOf(m.player), toProb: displayWinProb, next: nx ? { scores: nx.scores } : null, prevP });
    results.push(res);
    const sym = res?.sym || "";
    const who = m.actor === "cpu" ? `CPU${m.cpuLevel ?? ""}` : m.actor === "human" ? "人" : "?";
    (total[who] ||= { n: 0 }).n++;
    if (sym) total[who][sym] = (total[who][sym] || 0) + 1;
    if (sym || m.mark) console.log(`  ${String(m.step).padStart(2)} ${m.player === "black" ? "黑" : "白"}(${who}) ${m.coord} ${m.label}  重新分析：${sym.padEnd(2) || "  "} 網頁當時：${m.mark?.sym || "-"}  ${res?.why ? res.why.key : ""}`);
  });
  // 標記準不準：只算有結果的棋譜
  if (rec.result) {
    const scoreOf = (player) => (rec.result.winner === "draw" ? 0.5 : rec.result.winner === player ? 1 : 0);
    places.forEach((m, i) => {
      const res = results[i];
      if (!res) return;
      const o = (check[res.sym || "無標記"] ||= { n: 0, best: 0, played: 0, won: 0, oppN: 0, oppLoss: 0, oppErr: 0 });
      o.n++; o.best += res.best; o.played += res.played; o.won += scoreOf(m.player);
      const nr = results[i + 1];
      if (nr && places[i + 1].player !== m.player) { o.oppN++; o.oppLoss += nr.loss; if (["?!", "?", "??"].includes(nr.sym)) o.oppErr++; }
    });
  }
}
if (Object.keys(check).length) {
  console.log("\n標記準不準（有結果的棋譜）：");
  console.log("  標記   步數  局面最佳  這步下完  實際贏  ｜ 對手下一手：平均損失  被標失誤");
  for (const k of ["!!", "!", "!?", "無標記", "?!", "?", "??"]) {
    const o = check[k]; if (!o) continue;
    const f = (x) => `${(100 * x / o.n).toFixed(0)}%`.padStart(6);
    console.log(`  ${k.padEnd(5)} ${String(o.n).padStart(4)}  ${f(o.best)}   ${f(o.played)}  ${f(o.won)}  ｜ ${o.oppN ? `${(100 * o.oppLoss / o.oppN).toFixed(1)}%`.padStart(8) : "       -"}  ${o.oppN ? `${(100 * o.oppErr / o.oppN).toFixed(0)}%`.padStart(8) : "       -"}`);
  }
}
console.log("\n每 100 步：");
for (const [who, o] of Object.entries(total)) console.log(`  ${who.padEnd(5)} ${String(o.n).padStart(4)} 步  ` + SYMS.map(s => `${s} ${(100 * (o[s] || 0) / o.n).toFixed(1)}`).join("  "));
