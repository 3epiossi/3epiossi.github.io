/**
 * 🔊 五連黑白棋的音效：模擬實體棋子，不用電子「嗶」聲。
 * 全部用 Web Audio 即時合成（不用音檔）：
 *   - 落子：棋子敲在木棋盤上的「喀」——帶通濾波的雜訊（棋子）＋短促的低音（棋盤本體）＋一點高頻的脆響
 *   - 翻面：每翻一顆一聲輕的「嗒」，一顆接一顆，翻越多聲音越多（最多 8 聲）
 *   - 選池子裡的棋：手指撥動棋子的輕響
 *   - 跳過：手指在桌面輕敲兩下
 *   - 連成五：五顆棋依序輕敲、音高漸升，最後一聲清亮的收尾
 *   - 比子數結束：兩聲沉穩的落子
 * 共用的 src/ui/sound.js（「誰會贏？」在用）不動。
 */

class StoneSound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = true;
  }

  setEnabled(val) {
    this.enabled = !!val;
  }

  /** 第一次出聲時才建立 AudioContext（瀏覽器要求使用者互動之後才能播放） */
  ready() {
    if (!this.enabled || typeof window === "undefined") return false;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      // 總音量（各聲音的大小已經調過，疊在一起也不會破音；不用壓縮器，它剛啟動時會把第一聲壓小）
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      // 白雜訊（共用一段，每次從隨機位置開始播）
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  /** 一段濾過的雜訊：freq / q 決定「材質」，decay 決定聲音多乾脆 */
  click(t, { freq, q = 5, gain = 0.3, decay = 0.04, type = "bandpass" }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + decay + 0.02);
  }

  /** 棋盤本體的低音：很短、往下滑 */
  thump(t, { freq = 170, gain = 0.35, decay = 0.09 } = {}) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  /** 一顆棋落在棋盤上（strength 0～1：輕放到用力拍） */
  stone(t, strength = 1, pitch = 1) {
    const j = () => 0.94 + Math.random() * 0.12; // 每一聲都有一點不同，聽起來比較自然
    this.thump(t, { freq: 165 * pitch * j(), gain: 0.32 * strength, decay: 0.08 });
    this.click(t, { freq: 2300 * pitch * j(), q: 4, gain: 0.9 * strength, decay: 0.055 });
    this.click(t, { freq: 5200 * pitch * j(), q: 2, gain: 0.3 * strength, decay: 0.014 });
  }

  /** 落子；flips = 這一步翻了幾顆 */
  playPlace(flips = 0) {
    if (!this.ready()) return;
    const now = this.ctx.currentTime + 0.005;
    this.stone(now, 1);
    const n = Math.min(flips, 8);
    for (let i = 0; i < n; i++) {
      const t = now + 0.09 + i * 0.045;
      this.click(t, { freq: 3100 * (0.9 + Math.random() * 0.2), q: 6, gain: 0.55, decay: 0.022 });
    }
  }

  /** 從池子選一顆棋 */
  playPick() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime + 0.005;
    this.click(now, { freq: 3600, q: 4, gain: 0.45, decay: 0.025 });
  }

  /** 跳過：手指在桌面輕敲兩下 */
  playPass() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime + 0.005;
    for (const dt of [0, 0.16]) {
      this.thump(now + dt, { freq: 120, gain: 0.22, decay: 0.07 });
      this.click(now + dt, { freq: 900, q: 1.5, gain: 0.12, decay: 0.03, type: "lowpass" });
    }
  }

  /** 連成五：五顆依序輕敲、音高漸升，最後一聲清亮收尾 */
  playFive() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime + 0.3; // 等這一步的落子聲先響完
    for (let i = 0; i < 5; i++) this.stone(now + i * 0.11, 0.45 + i * 0.1, 1 + i * 0.09);
    const t = now + 5 * 0.11 + 0.05;
    // 收尾：像兩顆棋子互碰的清脆餘音
    for (const [f, g] of [[1760, 0.09], [2640, 0.05]]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(g, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.65);
    }
    this.click(t, { freq: 4200, q: 8, gain: 0.25, decay: 0.05 });
  }

  /** 比子數結束：兩聲沉穩的落子 */
  playGameEnd() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime + 0.05;
    this.stone(now, 0.8, 0.9);
    this.stone(now + 0.22, 1, 0.8);
  }
}

export const stoneSound = new StoneSound();
