'use client';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private _cache: Record<string, string> = {}; // path → blob URL cache
  private _preloading = false;

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

  /** Preload audio files into blob URL cache */
  preload() {
    if (this._preloading || typeof window === 'undefined') return;
    this._preloading = true;
    ['/sounds/applause.mp3', '/sounds/defeat.mp3'].forEach(async (path) => {
      try {
        const res = await fetch(path);
        if (res.ok) {
          const blob = await res.blob();
          this._cache[path] = URL.createObjectURL(blob);
        }
      } catch { /* ignore */ }
    });
  }

  /** Play an audio file — uses cache if preloaded, returns false if not available */
  private async _playFile(path: string, volume = 0.7, maxDuration = 3): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      let url = this._cache[path];

      // If not cached, fetch now
      if (!url) {
        const res = await Promise.race([
          fetch(path),
          new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        if (!res.ok) return false;
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        this._cache[path] = url;
      }

      const audio = new Audio(url);
      audio.volume = volume;

      // Cut off after maxDuration
      audio.addEventListener('timeupdate', () => {
        if (audio.currentTime >= maxDuration) {
          audio.pause();
        }
      });

      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  /** Victory applause — plays /sounds/applause.mp3 (max 3s), fallback to chime */
  async victory() {
    const ok = await this._playFile('/sounds/applause.mp3', 0.7, 3);
    if (!ok) this._victoryFallback();
  }

  /** Defeat sound — plays /sounds/defeat.mp3 (max 3s), fallback to sad tone */
  async defeat() {
    const ok = await this._playFile('/sounds/defeat.mp3', 0.7, 3);
    if (!ok) this._defeatFallback();
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
