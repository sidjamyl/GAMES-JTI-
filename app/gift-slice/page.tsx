'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   GIFT SLICE — Fruit Ninja style (polished)
   Swipe to slice gifts. Avoid bombs. 
   Glowing trails, screen shake, juice.
   ═══════════════════════════════════════════════ */

interface FlyingItem {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  rotation: number; rotSpeed: number;
  size: number;
  prize: Prize | null; // null = bomb
  sliced: boolean;
  sliceTime: number;
  halves: { x: number; y: number; vx: number; vy: number; rot: number; rotV: number }[];
  hue: number;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number; color: string;
}

const GRAVITY = 0.16;
const SPAWN_INTERVAL = 800;
const GAME_DURATION = 9000;
const GIFT_HUES = [0, 30, 50, 120, 200, 280, 340];

export default function GiftSlice({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);
  const itemsRef = useRef<FlyingItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const nextIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastSlicedRef = useRef<Prize | null>(null);
  const sliceTrailRef = useRef<{ x: number; y: number; age: number }[]>([]);
  const pointerRef = useRef({ x: 0, y: 0, down: false, prevX: 0, prevY: 0 });
  const comboRef = useRef(0);
  const scoreRef = useRef(0);
  const shakeRef = useRef({ x: 0, y: 0, decay: 0 });
  const timeRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const spawnItem = useCallback((w: number, h: number, prizes: Prize[]) => {
    const isBomb = Math.random() < 0.15;
    const x = 40 + Math.random() * (w - 80);
    const item: FlyingItem = {
      id: nextIdRef.current++, x, y: h + 50,
      vx: (Math.random() - 0.5) * 2.5,
      vy: -(h * 0.019 + Math.random() * h * 0.007),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.08,
      size: 40 + Math.random() * 10,
      prize: isBomb ? null : selectRandomPrize(prizes),
      sliced: false, sliceTime: 0, halves: [],
      hue: GIFT_HUES[Math.floor(Math.random() * GIFT_HUES.length)],
    };
    itemsRef.current.push(item);
  }, []);

  const addParticles = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particlesRef.current.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1,
        life: 0, maxLife: 25 + Math.random() * 20,
        size: 2 + Math.random() * 3, color,
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

    startTimeRef.current = Date.now();
    itemsRef.current = [];
    particlesRef.current = [];
    lastSpawnRef.current = 0;
    lastSlicedRef.current = null;
    comboRef.current = 0;
    scoreRef.current = 0;
    timeRef.current = 0;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      timeRef.current++;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Screen shake
      const shake = shakeRef.current;
      if (shake.decay > 0) {
        shake.x = (Math.random() - 0.5) * shake.decay * 8;
        shake.y = (Math.random() - 0.5) * shake.decay * 8;
        shake.decay *= 0.88;
        if (shake.decay < 0.01) shake.decay = 0;
      } else { shake.x = 0; shake.y = 0; }
      ctx.translate(shake.x, shake.y);
      ctx.clearRect(-10, -10, w + 20, h + 20);

      const now = Date.now();
      const elapsed = now - startTimeRef.current;

      // Background
      const bgGrad = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, h * 0.9);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(0.6, BG_MID);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-10, -10, w + 20, h + 20);

      // Subtle cross-hatch
      ctx.strokeStyle = `rgba(${goldRgb},0.025)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
      for (let i = 0; i < h; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }

      // Timer bar
      const progress = Math.max(0, 1 - elapsed / GAME_DURATION);
      ctx.fillStyle = `rgba(${goldRgb},0.08)`;
      ctx.fillRect(0, 0, w, 5);
      ctx.fillStyle = progress > 0.25 ? GOLD : '#ef4444';
      ctx.fillRect(0, 0, w * progress, 5);

      // Score
      ctx.textAlign = 'right';
      ctx.fillStyle = CREAM + '70';
      ctx.font = 'bold 16px system-ui';
      ctx.fillText(`${scoreRef.current}`, w - 16, 28);
      if (comboRef.current > 1) {
        ctx.fillStyle = GOLD_BRIGHT;
        ctx.font = 'bold 12px system-ui';
        ctx.fillText(`x${comboRef.current}`, w - 16, 44);
      }

      // Spawn
      if (now - lastSpawnRef.current > SPAWN_INTERVAL && elapsed < GAME_DURATION - 600) {
        spawnItem(w, h, prizes);
        lastSpawnRef.current = now;
        if (Math.random() < 0.35) setTimeout(() => { if (phaseRef.current === 'playing') spawnItem(w, h, prizes); }, 200);
      }

      // Items
      const items = itemsRef.current;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];

        if (!item.sliced) {
          item.vy += GRAVITY;
          item.x += item.vx;
          item.y += item.vy;
          item.rotation += item.rotSpeed;
          if (item.y > h + 80) { items.splice(i, 1); continue; }

          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.rotate(item.rotation);

          if (item.prize) {
            const s = item.size;
            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.beginPath(); ctx.roundRect(-s / 2 + 3, -s / 2 + 3, s, s, 8); ctx.fill();
            // Body
            const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
            grad.addColorStop(0, `hsl(${item.hue}, 55%, 55%)`);
            grad.addColorStop(1, `hsl(${item.hue}, 65%, 38%)`);
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, 8); ctx.fill();
            // Edge highlight
            ctx.strokeStyle = `hsla(${item.hue}, 60%, 72%, 0.5)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // Lid
            ctx.fillStyle = `hsla(${item.hue}, 55%, 68%, 0.25)`;
            ctx.fillRect(-s / 2 + 2, -s / 2 + 2, s - 4, s * 0.28);
            // Ribbon
            const ribbonHue = (item.hue + 40) % 360;
            ctx.strokeStyle = `hsla(${ribbonHue}, 70%, 80%, 0.65)`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, -s / 2); ctx.lineTo(0, s / 2);
            ctx.moveTo(-s / 2, 0); ctx.lineTo(s / 2, 0);
            ctx.stroke();
            // Bow
            ctx.fillStyle = `hsla(${ribbonHue}, 70%, 75%, 0.8)`;
            ctx.beginPath(); ctx.ellipse(-5, -s / 2, 7, 4, -0.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(5, -s / 2, 7, 4, 0.3, 0, Math.PI * 2); ctx.fill();
            // Emoji
            ctx.font = `${s * 0.36}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.prize.emoji, 0, 3);
          } else {
            // Bomb
            const s = item.size;
            ctx.shadowColor = '#ff3333';
            ctx.shadowBlur = 12 + Math.sin(timeRef.current * 0.15) * 5;
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath(); ctx.arc(0, 0, s / 2, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath(); ctx.arc(-s * 0.15, -s * 0.15, s * 0.2, 0, Math.PI * 2); ctx.fill();
            // Fuse
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(0, -s / 2); ctx.quadraticCurveTo(8, -s / 2 - 10, 4, -s / 2 - 16); ctx.stroke();
            ctx.fillStyle = `rgba(255, ${150 + Math.random() * 105}, 0, ${0.6 + Math.random() * 0.4})`;
            ctx.beginPath(); ctx.arc(4, -s / 2 - 16, 3, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();

          // Slice detection
          const p = pointerRef.current;
          if (p.down) {
            const dx = p.x - item.x;
            const dy = p.y - item.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const speed = Math.sqrt((p.x - p.prevX) ** 2 + (p.y - p.prevY) ** 2);
            if (dist < item.size * 0.6 && speed > 2.5) {
              item.sliced = true;
              item.sliceTime = now;
              const a = Math.atan2(p.y - p.prevY, p.x - p.prevX);
              item.halves = [
                { x: item.x, y: item.y, vx: Math.cos(a + 1.2) * 3.5, vy: -4 - Math.random() * 2, rot: item.rotation, rotV: 0.08 },
                { x: item.x, y: item.y, vx: Math.cos(a - 1.2) * 3.5, vy: -4 - Math.random() * 2, rot: item.rotation, rotV: -0.08 },
              ];
              if (item.prize) {
                lastSlicedRef.current = item.prize;
                comboRef.current++;
                scoreRef.current += 10 * comboRef.current;
                addParticles(item.x, item.y, `hsl(${item.hue}, 70%, 60%)`, 12);
                addParticles(item.x, item.y, GOLD_BRIGHT, 6);
                shakeRef.current.decay = Math.min(0.5, 0.15 * comboRef.current);
                try { getSoundEngine().impact(); } catch {}
              } else {
                addParticles(item.x, item.y, '#ff3333', 20);
                shakeRef.current.decay = 1;
                comboRef.current = 0;
                scoreRef.current = Math.max(0, scoreRef.current - 30);
                try { getSoundEngine().miss(); } catch {}
              }
            }
          }
        } else {
          const age = now - item.sliceTime;
          if (age > 1500) { items.splice(i, 1); continue; }
          for (const half of item.halves) {
            half.vy += GRAVITY;
            half.x += half.vx;
            half.y += half.vy;
            half.rot += half.rotV;
            ctx.save();
            ctx.translate(half.x, half.y);
            ctx.rotate(half.rot);
            ctx.globalAlpha = Math.max(0, 1 - age / 1500);
            if (item.prize) {
              const s = item.size * 0.45;
              ctx.fillStyle = `hsl(${item.hue}, 55%, 50%)`;
              ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, 4); ctx.fill();
            } else {
              ctx.fillStyle = '#2a2a2a';
              ctx.beginPath(); ctx.arc(0, 0, item.size * 0.25, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
          }
        }
      }

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life++;
        if (p.life > p.maxLife) { particlesRef.current.splice(i, 1); continue; }
        p.vy += 0.06; p.x += p.vx; p.y += p.vy; p.vx *= 0.98;
        const alpha = 1 - p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Slice trail with glow
      const trail = sliceTrailRef.current;
      for (let i = trail.length - 1; i >= 0; i--) { trail[i].age++; if (trail[i].age > 12) trail.splice(i, 1); }
      if (trail.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let t = 1; t < trail.length; t++) {
          const alpha = Math.max(0, 1 - trail[t].age / 12);
          const w2 = (1 - trail[t].age / 12);
          ctx.strokeStyle = `rgba(${goldRgb},${alpha * 0.3})`;
          ctx.lineWidth = w2 * 12;
          ctx.beginPath(); ctx.moveTo(trail[t - 1].x, trail[t - 1].y); ctx.lineTo(trail[t].x, trail[t].y); ctx.stroke();
          ctx.strokeStyle = `rgba(${creamRgb},${alpha * 0.9})`;
          ctx.lineWidth = w2 * 3;
          ctx.beginPath(); ctx.moveTo(trail[t - 1].x, trail[t - 1].y); ctx.lineTo(trail[t].x, trail[t].y); ctx.stroke();
        }
      }

      if (elapsed >= GAME_DURATION) {
        const prize = lastSlicedRef.current || selectRandomPrize(prizes);
        setWonPrize(prize);
        setTimeout(() => setPhase('victory'), 400);
        return;
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, spawnItem, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, goldRgb, creamRgb]);

  const handlePointerDown = (e: React.TouchEvent | React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    pointerRef.current = { x, y, down: true, prevX: x, prevY: y };
  };
  const handlePointerMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!pointerRef.current.down) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    pointerRef.current.prevX = pointerRef.current.x;
    pointerRef.current.prevY = pointerRef.current.y;
    pointerRef.current.x = x;
    pointerRef.current.y = y;
    sliceTrailRef.current.push({ x, y, age: 0 });
  };
  const handlePointerUp = () => { pointerRef.current.down = false; comboRef.current = 0; };

  const start = () => { setWonPrize(null); lastSlicedRef.current = null; setPhase('playing'); };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp}
          onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp} onMouseLeave={handlePointerUp} />
      )}
      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🗡️</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Gift Slice</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Tranchez les cadeaux avec votre doigt !<br/>Évitez les bombes 💣
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
