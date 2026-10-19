/**
 * 誰會贏？ 音效合成器 (Web Audio API Synthesizer)
 * 純程式即時合成，零外部依賴、零網路延遲
 */

class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensureContext() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
  }

  /** 一小段帶通濾波的白噪音：木頭、骰子、棋子互相敲擊的「喀」聲 */
  click(t, { dur = 0.03, freq = 2200, q = 1.2, gain = 0.25 } = {}) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  /** 低頻的「叩」：棋子落在木棋盤上的共鳴 */
  thump(t, { f0 = 190, f1 = 80, dur = 0.07, gain = 0.2 } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  /** 搖骰子：骰子在杯裡與桌面上彈跳，一連串由密到疏、由強到弱的敲擊，最後落定一聲 */
  playDiceRoll() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    let t = now;
    const n = 11;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      this.click(t, { dur: 0.018 + Math.random() * 0.012, freq: 1500 + Math.random() * 2600, q: 2 + Math.random() * 2, gain: 0.2 * (1 - 0.6 * k) });
      if (i % 3 === 0) this.thump(t, { f0: 260 + Math.random() * 120, f1: 120, dur: 0.04, gain: 0.08 * (1 - 0.5 * k) });
      t += 0.028 + k * 0.05 + Math.random() * 0.02;
    }
    // 落定
    this.click(t + 0.02, { dur: 0.04, freq: 1800, q: 1.4, gain: 0.28 });
    this.thump(t + 0.02, { f0: 220, f1: 90, dur: 0.08, gain: 0.16 });
  }

  /** 生子：棋子輕輕落在木棋盤上，一聲短促的「啪」 */
  playSpawn() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.click(now, { dur: 0.03, freq: 2400, q: 1.3, gain: 0.3 });
    this.thump(now, { f0: 200, f1: 85, dur: 0.07, gain: 0.2 });
  }

  /** 吃子：棋子用力拍下去，緊接著被吃掉的棋子被拿起碰到其他棋子的一聲輕響 */
  playCapture() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.click(now, { dur: 0.04, freq: 1900, q: 1.1, gain: 0.4 });
    this.thump(now, { f0: 170, f1: 65, dur: 0.1, gain: 0.3 });
    this.click(now + 0.075, { dur: 0.025, freq: 3200, q: 2, gain: 0.16 });
  }

  playPass() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.linearRampToValueAtTime(180, now + 0.2);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  playVictory() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.38);
    });
  }
}

export const sound = new SoundManager();
