'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   GIFT SLICE — Fruit Ninja style
   Swipe to slice gifts. Avoid bombs. Last sliced = prize.
   ═══════════════════════════════════════════════ */

interface FlyingItem {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotSpeed: number;
  size: number;
  prize: Prize | null; // null = bomb
  sliced: boolean;
  sliceTime: number;
  halves: { x: number; y: number; vx: number; vy: number; rot: number }[];
}

const GRAVITY = 0.18;
const SPAWN_INTERVAL = 900;
const GAME_DURATION = 8000; // 8 seconds

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
  const nextIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastSlicedRef = useRef<Prize | null>(null);
  const sliceTrailRef = useRef<{ x: number; y: number; age: number }[]>([]);
  const pointerRef = useRef<{ x: number; y: number; down: boolean; prevX: number; prevY: number }>({
    x: 0, y: 0, down: false, prevX: 0, prevY: 0,
  });
  const comboRef = useRef(0);
  const scoreRef = useRef(0);
  const bombHitRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const spawnItem = useCallback((w: number, h: number, prizes: Prize[]) => {
    const isBomb = Math.random() < 0.2; // 20% bombs
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? w * 0.1 + Math.random() * w * 0.3 : w * 0.6 + Math.random() * w * 0.3;
    const item: FlyingItem = {
      id: nextIdRef.current++,
      x,
      y: h + 40,
      vx: (Math.random() - 0.5) * 3,
      vy: -(h * 0.018 + Math.random() * h * 0.008),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.1,
      size: 36 + Math.random() * 12,
      prize: isBomb ? null : selectRandomPrize(prizes),
      sliced: false,
      sliceTime: 0,
      halves: [],
    };
    itemsRef.current.push(item);
  }, []);

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
    lastSpawnRef.current = 0;
    lastSlicedRef.current = null;
    comboRef.current = 0;
    scoreRef.current = 0;
    bombHitRef.current = false;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const now = Date.now();
      const elapsed = now - startTimeRef.current;

      // Background
      const bgGrad = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, h);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(0.5, BG_MID);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Timer bar
      const progress = Math.max(0, 1 - elapsed / GAME_DURATION);
      ctx.fillStyle = `rgba(${goldRgb},0.1)`;
      ctx.fillRect(0, 0, w, 4);
      ctx.fillStyle = progress > 0.2 ? GOLD : '#ef4444';
      ctx.fillRect(0, 0, w * progress, 4);

      // Score display
      ctx.fillStyle = CREAM + '60';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(`Score: ${scoreRef.current}`, w - 16, 24);

      // Spawn items
      if (now - lastSpawnRef.current > SPAWN_INTERVAL && elapsed < GAME_DURATION - 500) {
        spawnItem(w, h, prizes);
        lastSpawnRef.current = now;
        // Spawn extra sometimes
        if (Math.random() < 0.3) {
          setTimeout(() => spawnItem(w, h, prizes), 200);
        }
      }

      // Update & draw items
      const items = itemsRef.current;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];

        if (!item.sliced) {
          item.vy += GRAVITY;
          item.x += item.vx;
          item.y += item.vy;
          item.rotation += item.rotSpeed;

          // Remove if fallen off screen
          if (item.y > h + 80) {
            items.splice(i, 1);
            continue;
          }

          // Draw item
          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.rotate(item.rotation);

          if (item.prize) {
            // Gift box
            const s = item.size;
            const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
            grad.addColorStop(0, GOLD + 'dd');
            grad.addColorStop(1, AMBER + 'dd');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.roundRect(-s / 2, -s / 2, s, s, 8);
            ctx.fill();
            ctx.strokeStyle = CREAM + '40';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Ribbon cross
            ctx.strokeStyle = CREAM + '60';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, -s / 2);
            ctx.lineTo(0, s / 2);
            ctx.moveTo(-s / 2, 0);
            ctx.lineTo(s / 2, 0);
            ctx.stroke();

            // Emoji
            ctx.font = `${s * 0.45}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.prize.emoji, 0, 2);
          } else {
            // Bomb
            const s = item.size;
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = `${s * 0.5}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('💣', 0, 2);
          }
          ctx.restore();

          // Slice detection
          const p = pointerRef.current;
          if (p.down) {
            const dx = p.x - item.x;
            const dy = p.y - item.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const speed = Math.sqrt((p.x - p.prevX) ** 2 + (p.y - p.prevY) ** 2);

            if (dist < item.size * 0.6 && speed > 3) {
              item.sliced = true;
              item.sliceTime = now;

              // Create halves
              const angle = Math.atan2(p.y - p.prevY, p.x - p.prevX);
              item.halves = [
                { x: item.x, y: item.y, vx: Math.cos(angle + 1) * 3, vy: -3, rot: 0.1 },
                { x: item.x, y: item.y, vx: Math.cos(angle - 1) * 3, vy: -3, rot: -0.1 },
              ];

              if (item.prize) {
                lastSlicedRef.current = item.prize;
                comboRef.current++;
                scoreRef.current += 10 * comboRef.current;
                try { getSoundEngine().impact(); } catch {}
              } else {
                // Bomb hit!
                bombHitRef.current = true;
                comboRef.current = 0;
                try { getSoundEngine().miss(); } catch {}
              }
            }
          }
        } else {
          // Animate sliced halves
          const age = now - item.sliceTime;
          if (age > 1200) {
            items.splice(i, 1);
            continue;
          }

          for (const half of item.halves) {
            half.vy += GRAVITY;
            half.x += half.vx;
            half.y += half.vy;
            half.rot += 0.05;

            ctx.save();
            ctx.translate(half.x, half.y);
            ctx.rotate(half.rot);
            ctx.globalAlpha = Math.max(0, 1 - age / 1200);

            if (item.prize) {
              const s = item.size * 0.5;
              ctx.fillStyle = GOLD + 'aa';
              ctx.beginPath();
              ctx.roundRect(-s / 2, -s / 2, s, s, 4);
              ctx.fill();
            } else {
              ctx.fillStyle = '#333';
              ctx.beginPath();
              ctx.arc(0, 0, item.size * 0.3, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }

          // Slice particles
          if (age < 400) {
            const particleCount = item.prize ? 6 : 3;
            for (let p = 0; p < particleCount; p++) {
              const a = (p / particleCount) * Math.PI * 2 + age * 0.01;
              const r = age * 0.15;
              const px = item.x + Math.cos(a) * r;
              const py = item.y + Math.sin(a) * r;
              const alpha = 1 - age / 400;
              ctx.beginPath();
              ctx.arc(px, py, 2, 0, Math.PI * 2);
              ctx.fillStyle = item.prize
                ? `rgba(${goldRgb},${alpha})`
                : `rgba(255,60,60,${alpha})`;
              ctx.fill();
            }
          }
        }
      }

      // Draw slice trail
      const trail = sliceTrailRef.current;
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].age++;
        if (trail[i].age > 10) { trail.splice(i, 1); continue; }
      }
      if (trail.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < trail.length; i++) {
          const alpha = Math.max(0, 1 - trail[i].age / 10);
          const width = (1 - trail[i].age / 10) * 4;
          ctx.strokeStyle = `rgba(${creamRgb},${alpha * 0.8})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
      }

      // Bomb flash overlay
      if (bombHitRef.current) {
        ctx.fillStyle = 'rgba(255,0,0,0.15)';
        ctx.fillRect(0, 0, w, h);
        bombHitRef.current = false;
      }

      // Game end
      if (elapsed >= GAME_DURATION) {
        const prize = lastSlicedRef.current || selectRandomPrize(prizes);
        setWonPrize(prize);
        setTimeout(() => setPhase('victory'), 400);
        return; // stop loop
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, spawnItem, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, goldRgb, creamRgb]);

  const handlePointerDown = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    pointerRef.current = { x, y, down: true, prevX: x, prevY: y };
  };

  const handlePointerMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!pointerRef.current.down) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    pointerRef.current.prevX = pointerRef.current.x;
    pointerRef.current.prevY = pointerRef.current.y;
    pointerRef.current.x = x;
    pointerRef.current.y = y;
    sliceTrailRef.current.push({ x, y, age: 0 });
  };

  const handlePointerUp = () => {
    pointerRef.current.down = false;
    sliceTrailRef.current = [];
  };

  const start = () => {
    setWonPrize(null);
    lastSlicedRef.current = null;
    setPhase('playing');
  };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
        />
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
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
            boxShadow: `0 12px 40px -10px ${GOLD}80`,
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
