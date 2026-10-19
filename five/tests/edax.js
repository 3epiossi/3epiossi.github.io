/**
 * Edax（本機測試用的黑白棋引擎，edax/bin）的 NBoard 介面：問它「這個盤面每一步各值幾分」。
 * 只在本機測試用（edax/ 不上傳）。棋子的組別 Edax 不管，只看黑白。
 *
 *   const e = new Edax({ depth: 10 });
 *   await e.hints(board, BLACK)   // → [{ sq, score }]（score：輪到的一方的棋子差，由高到低）
 *   e.close();
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { BLACK } from "../src/core/constants.js";

const BIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../edax/bin");

export class Edax {
  constructor({ depth = 10 } = {}) {
    this.depth = depth;
    this.proc = spawn("./mEdax-armv8.5-a+crypto", ["-nboard", "-n", "1", "-book-usage", "off", "-q", "-h", "20"], { cwd: BIN_DIR });
    this.buf = "";
    this.waiters = [];
    this.lines = [];
    this.ping = 0;
    this.proc.stdout.on("data", (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        this.lines.push(line);
        const m = /^pong (\d+)/.exec(line);
        if (m && this.waiters.length && this.waiters[0].id === Number(m[1])) {
          const w = this.waiters.shift();
          const out = this.lines; this.lines = [];
          w.resolve(out);
        }
      }
    });
    this.send("nboard 1");
    this.send(`set depth ${depth}`);
  }
  send(s) { this.proc.stdin.write(s + "\n"); }
  sync() {
    const id = ++this.ping;
    return new Promise((resolve) => { this.waiters.push({ id, resolve }); this.send(`ping ${id}`); });
  }
  /** board：8×8，null 或 { face }；回傳每一步的分數（輪到的一方的角度，棋子差） */
  async hints(board, toMove, n = 64, depth = this.depth) {
    let s = "";
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const d = board[r][c];
      s += !d ? "-" : d.face === BLACK ? "*" : "O";
    }
    if (depth !== this.curDepth) { this.send(`set depth ${depth}`); this.curDepth = depth; }
    this.send(`game (;GM[Othello]PC[x]PB[a]PW[b]RE[?]TI[0:00]TY[8]BO[8 ${s} ${toMove === BLACK ? "*" : "O"}];)`);
    this.send(`hint ${n}`);
    const lines = await this.sync();
    const out = [];
    for (const l of lines) {
      const m = /^search ([a-hA-H])([1-8])\S*\s+(-?[\d.]+)/.exec(l);
      if (!m) continue;
      const sq = (Number(m[2]) - 1) * 8 + (m[1].toLowerCase().charCodeAt(0) - 97);
      out.push({ sq, score: Number(m[3]) });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }
  close() { try { this.send("quit"); this.proc.stdin.end(); } catch { /* 已經關了 */ } }
}
