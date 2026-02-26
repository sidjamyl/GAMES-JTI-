'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   STACK TOWER — Polished block stacking
   3D-perspective blocks, screen shake on perfect,
   particles, smooth camera, progressive difficulty.
   ═══════════════════════════════════════════════ */

interface Block {
  x: number; width: number; y: number;
  placed: boolean; hue: number;
  perfect: boolean;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
}

const BLOCK_H = 26;
const BASE_SPEED = 2.2;
const DEPTH = 6; // 3D depth offset

export default function StackTower({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  const blocksRef = useRef<Block[]>([]);
  const currentRef = useRef<Block | null>(null);
  const dirRef = useRef(1);
  const speedRef = useRef(BASE_SPEED);
  const gameOverRef = useRef(false);
  const offsetRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const fallingRef = useRef<{ x: number; y: number; w: number; vy: number; hue: number; rot: number; rotV: number }[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef({ amount: 0, decay: 0 });
  const perfectStreakRef = useRef(0);
  const timeRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const getHue = (i: number) => (i * 25 + 20) % 360;

  const getPrizeForHeight = useCallback((height: number, prizes: Prize[]): Prize => {
    const sorted = [...prizes].filter(p => p.quantity > 0).sort((a, b) => a.quantity - b.quantity);
    if (sorted.length === 0) return prizes[0];
    if (height >= 15) return sorted[0];
    if (height >= 10) return sorted[Math.min(1, sorted.length - 1)];
    if (height >= 7) return sorted[Math.min(2, sorted.length - 1)];
    if (height >= 4) return sorted[Math.floor(sorted.length * 0.6)];
    return sorted[sorted.length - 1];
  }, []);

  const addParticles = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 3;
      particlesRef.current.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2,
        life: 0, maxLife: 30 + Math.random() * 20,
        size: 2 + Math.random() * 2.5, color,
      });
    }
  };

  useEffect(() => {
    if (phase !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const w = rect.width;
    const h = rect.height;
    sizeRef.current = { w, h };

    const baseWidth = w * 0.45;
    const baseX = (w - baseWidth) / 2;
    const baseY = h - 70;
    blocksRef.current = [{ x: baseX, width: baseWidth, y: baseY, placed: true, hue: getHue(0), perfect: false }];
    currentRef.current = { x: 0, width: baseWidth, y: baseY - BLOCK_H, placed: false, hue: getHue(1), perfect: false };
    dirRef.current = 1;
    speedRef.current = BASE_SPEED;
    gameOverRef.current = false;
    offsetRef.current = 0;
    fallingRef.current = [];
    particlesRef.current = [];
    perfectStreakRef.current = 0;
    timeRef.current = 0;
    lastTimeRef.current = 0;

    const loop = () => {
      if (gameOverRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      const rawDt = lastTimeRef.current ? (now - lastTimeRef.current) / 16.667 : 1;
      const dt = Math.min(rawDt, 3);
      lastTimeRef.current = now;
      timeRef.current += dt;

      // Screen shake
      let sx = 0, sy = 0;
      if (shakeRef.current.amount > 0) {
        sx = (Math.random() - 0.5) * shakeRef.current.amount;
        sy = (Math.random() - 0.5) * shakeRef.current.amount;
        shakeRef.current.amount *= Math.pow(0.88, dt);
        if (shakeRef.current.amount < 0.2) shakeRef.current.amount = 0;
      }
      ctx.translate(sx, sy);
      ctx.clearRect(-10, -10, w + 20, h + 20);

      // Sky gradient — darker to lighter up
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      const blocks = blocksRef.current;
      const height = blocks.length - 1;
      // Sky changes color with height
      const skyHue = 220 + height * 3;
      bgGrad.addColorStop(0, `hsl(${skyHue}, 25%, ${12 + height * 0.5}%)`);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-10, -10, w + 20, h + 20);

      // Stars appear at height
      if (height > 8) {
        ctx.fillStyle = CREAM + '15';
        for (let i = 0; i < 20; i++) {
          const px = ((i * 137.5) % w);
          const py = ((i * 83.1) % (h * 0.5));
          const blink = Math.sin(timeRef.current * 0.02 + i * 2) * 0.5 + 0.5;
          ctx.globalAlpha = blink * 0.3;
          ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Camera scroll
      const targetOffset = Math.max(0, (blocks.length - 8) * BLOCK_H);
      offsetRef.current += (targetOffset - offsetRef.current) * 0.06 * dt;
      ctx.save();
      ctx.translate(0, offsetRef.current);

      // Draw placed blocks (3D perspective)
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        drawBlock3D(ctx, b.x, b.y, b.width, BLOCK_H, b.hue, b.perfect);
      }

      // Current moving block
      const cur = currentRef.current;
      if (cur && !cur.placed) {
        cur.x += speedRef.current * dirRef.current * dt;
        if (cur.x + cur.width > w) dirRef.current = -1;
        if (cur.x < 0) dirRef.current = 1;
        drawBlock3D(ctx, cur.x, cur.y, cur.width, BLOCK_H, cur.hue, false);
        // Glow on current
        ctx.shadowColor = `hsl(${cur.hue}, 60%, 55%)`;
        ctx.shadowBlur = 8;
        ctx.fillStyle = 'transparent';
        ctx.fillRect(cur.x, cur.y, cur.width, BLOCK_H - 2);
        ctx.shadowBlur = 0;
      }

      // Falling cut pieces (rotate as they fall)
      for (let i = fallingRef.current.length - 1; i >= 0; i--) {
        const p = fallingRef.current[i];
        p.vy += 0.35 * dt;
        p.y += p.vy * dt;
        p.rot += p.rotV * dt;
        if (p.y > h + offsetRef.current + 100) { fallingRef.current.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(p.x + p.w / 2, p.y + BLOCK_H / 2);
        ctx.rotate(p.rot);
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = `hsla(${p.hue}, 50%, 45%, 0.6)`;
        ctx.fillRect(-p.w / 2, -BLOCK_H / 2, p.w, BLOCK_H - 2);
        ctx.restore();
      }

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life += dt;
        if (p.life > p.maxLife) { particlesRef.current.splice(i, 1); continue; }
        p.vy += 0.05 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.98, dt);
        const alpha = 1 - p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.restore();

      // HUD
      ctx.fillStyle = CREAM + '70';
      ctx.font = 'bold 15px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`Étage ${height}`, 16, 26);

      // Height milestones
      ctx.fillStyle = CREAM + '25';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      const milestones = [
        { h: 4, label: '4 — Cadeau' },
        { h: 7, label: '7 — Rare' },
        { h: 10, label: '10 — Très rare' },
        { h: 15, label: '15 — Jackpot' },
      ];
      milestones.forEach((m, i) => {
        ctx.fillStyle = height >= m.h ? GOLD + '80' : CREAM + '20';
        ctx.fillText(m.label, w - 12, 20 + i * 14);
      });

      // Perfect streak indicator
      if (perfectStreakRef.current > 1) {
        ctx.fillStyle = GOLD_BRIGHT;
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`⚡ ${perfectStreakRef.current}x PARFAIT`, w / 2, 26);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    function drawBlock3D(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number, hue: number, perfect: boolean) {
      const d = DEPTH;
      // Side face (right)
      ctx.fillStyle = `hsl(${hue}, 50%, 30%)`;
      ctx.beginPath();
      ctx.moveTo(x + bw, y);
      ctx.lineTo(x + bw + d, y - d);
      ctx.lineTo(x + bw + d, y - d + bh - 2);
      ctx.lineTo(x + bw, y + bh - 2);
      ctx.closePath();
      ctx.fill();

      // Top face
      ctx.fillStyle = `hsl(${hue}, 55%, 55%)`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + d, y - d);
      ctx.lineTo(x + bw + d, y - d);
      ctx.lineTo(x + bw, y);
      ctx.closePath();
      ctx.fill();

      // Front face with gradient
      const fg = ctx.createLinearGradient(x, y, x, y + bh);
      fg.addColorStop(0, `hsl(${hue}, 55%, 52%)`);
      fg.addColorStop(1, `hsl(${hue}, 55%, 38%)`);
      ctx.fillStyle = fg;
      ctx.fillRect(x, y, bw, bh - 2);

      // Front highlight
      ctx.strokeStyle = `hsla(${hue}, 60%, 70%, 0.3)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + bw - 1, y + 1); ctx.stroke();

      // Perfect sparkle overlay
      if (perfect) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, y, bw, bh - 2);
      }
    }

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, goldRgb, creamRgb]);

  const placeBlock = () => {
    if (phaseRef.current !== 'playing' || gameOverRef.current) return;
    const cur = currentRef.current;
    if (!cur || cur.placed) return;
    const blocks = blocksRef.current;
    const prev = blocks[blocks.length - 1];

    const overlapLeft = Math.max(cur.x, prev.x);
    const overlapRight = Math.min(cur.x + cur.width, prev.x + prev.width);
    const overlapWidth = overlapRight - overlapLeft;

    if (overlapWidth <= 0) {
      // Miss — game over
      gameOverRef.current = true;
      try { getSoundEngine().miss(); } catch {}
      fallingRef.current.push({ x: cur.x, y: cur.y, w: cur.width, vy: 0, hue: cur.hue, rot: 0, rotV: (Math.random() - 0.5) * 0.05 });
      shakeRef.current.amount = 10;
      const height = blocks.length - 1;
      const prize = height > 0 ? getPrizeForHeight(height, prizes) : selectRandomPrize(prizes);
      setWonPrize(prize);
      setTimeout(() => setPhase('victory'), 800);
      return;
    }

    const isPerfect = Math.abs(overlapWidth - prev.width) < 4;

    // Cut overhangs
    if (cur.x < prev.x) {
      const cutW = prev.x - cur.x;
      if (cutW > 1) fallingRef.current.push({ x: cur.x, y: cur.y, w: cutW, vy: 0, hue: cur.hue, rot: 0, rotV: -0.03 });
    }
    if (cur.x + cur.width > prev.x + prev.width) {
      const cutW = (cur.x + cur.width) - (prev.x + prev.width);
      if (cutW > 1) fallingRef.current.push({ x: prev.x + prev.width, y: cur.y, w: cutW, vy: 0, hue: cur.hue, rot: 0, rotV: 0.03 });
    }

    cur.x = overlapLeft;
    cur.width = overlapWidth;
    cur.placed = true;
    cur.perfect = isPerfect;
    blocks.push(cur);

    if (isPerfect) {
      perfectStreakRef.current++;
      cur.width = Math.min(cur.width + 5, prev.width);
      addParticles(cur.x + cur.width / 2, cur.y, GOLD_BRIGHT, 15);
      addParticles(cur.x + cur.width / 2, cur.y, '#ffffff', 8);
      shakeRef.current.amount = 6;
      try { getSoundEngine().reveal(); } catch {}
    } else {
      perfectStreakRef.current = 0;
      shakeRef.current.amount = 3;
      try { getSoundEngine().impact(); } catch {}
    }

    const height = blocks.length - 1;
    if (height >= 20) {
      gameOverRef.current = true;
      const prize = getPrizeForHeight(height, prizes);
      setWonPrize(prize);
      try { getSoundEngine().victory(); } catch {}
      setTimeout(() => setPhase('victory'), 600);
      return;
    }

    speedRef.current = BASE_SPEED + height * 0.18;
    currentRef.current = {
      x: dirRef.current > 0 ? 0 : sizeRef.current.w - overlapWidth,
      width: overlapWidth, y: cur.y - BLOCK_H, placed: false,
      hue: getHue(height + 1), perfect: false,
    };
  };

  const start = () => { setWonPrize(null); gameOverRef.current = false; setPhase('playing'); };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={placeBlock} onMouseDown={placeBlock} />
      )}
      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="flex flex-col items-center gap-1">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="rounded" style={{
                width: `${80 - i * 8}px`, height: '16px',
                background: `hsl(${getHue(3 - i)}, 55%, 50%)`,
                animation: `fadeInUp 0.4s ease-out ${i * 0.1}s both`,
              }} />
            ))}
          </div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Stack Tower</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Empilez les blocs le plus haut possible !<br/>Plus c&apos;est haut, meilleur le cadeau
          </p>
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>Commencer</button>
        </div>
      )}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: BG_DARK }}>
          <div className="w-8 h-8 border-2 rounded-full" style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD, animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} onClose={() => setPhase('ready')} accentFrom={GOLD} accentTo={AMBER} />
      )}
    </div>
  );
}
