'use client';

class SoundEngine {
  private ctx: AudioContext | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Short woody impact */
  impact() {
    const ctx = this.getCtx();
    const len = ctx.sampleRate * 0.12;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
    }
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    src.buffer = buf;
    src.connect(f).connect(g).connect(ctx.destination);
    f.type = 'bandpass';
    f.frequency.value = 800;
    g.gain.setValueAtTime(0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    src.start();
  }

  /** Peg bounce click */
  peg(pitch = 0) {
    const ctx = this.getCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g).connect(ctx.destination);
    o.type = 'triangle';
    o.frequency.value = 1200 + pitch * 80;
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    o.start();
    o.stop(ctx.currentTime + 0.04);
  }

  /** Satisfying "swish" landing */
  swish() {
    const ctx = this.getCtx();
    const len = ctx.sampleRate * 0.25;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    }
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    src.buffer = buf;
    src.connect(f).connect(g).connect(ctx.destination);
    f.type = 'lowpass';
    f.frequency.value = 600;
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    src.start();
  }

  /** Card flip / reveal sound */
  reveal() {
    const ctx = this.getCtx();
    [520, 660, 784].forEach((freq, i) => {
      const delay = i * 0.06;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g).connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.2, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + 0.15);
    });
  }

  /** Victory applause — plays /sounds/applause.mp3 if available, fallback to simple fanfare */
  victory() {
    if (typeof window !== 'undefined') {
      const audio = new Audio('/sounds/applause.mp3');
      audio.volume = 0.7;
      audio.play().catch(() => this._victoryFallback());
      return;
    }
    this._victoryFallback();
  }

  /** Defeat sound — plays /sounds/defeat.mp3 if available, fallback to synthesized tone */
  defeat() {
    if (typeof window !== 'undefined') {
      const audio = new Audio('/sounds/defeat.mp3');
      audio.volume = 0.7;
      audio.play().catch(() => this._defeatFallback());
      return;
    }
    this._defeatFallback();
  }

  /** Fallback defeat sound (descending sad tone) */
  private _defeatFallback() {
    const ctx = this.getCtx();
    const notes = [440, 370, 311, 261];
    notes.forEach((freq, i) => {
      const t = i * 0.15;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g).connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.5);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.5);
    });
  }

  /** Fallback victory sound (synthesized chime) */
  private _victoryFallback() {
    const ctx = this.getCtx();
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const t = i * 0.1;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g).connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.4);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.4);
    });
  }

  /** Swoosh for launching */
  swoosh() {
    const ctx = this.getCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g).connect(ctx.destination);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }

  /** Soft error / miss buzz */
  miss() {
    const ctx = this.getCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g).connect(ctx.destination);
    o.type = 'square';
    o.frequency.value = 150;
    g.gain.setValueAtTime(0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }
}

let instance: SoundEngine | null = null;
export function getSoundEngine(): SoundEngine {
  if (!instance) instance = new SoundEngine();
  return instance;
}
