'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   SWIPE & SHOOT — Precision Toss Game
   Premium physics with magnetic correction
   ═══════════════════════════════════════════════ */

const GRAVITY = 0.18;
const FRICTION = 0.997;
const MAGNET_THRESHOLD_Y = 0.45;   // activate at 45% from top
const MAGNET_STRENGTH = 0.035;
const BALL_RADIUS = 16;

interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  active: boolean;
  trail: { x: number; y: number; age: number }[];
}

interface Slot {
  x: number; y: number; w: number; h: number;
  prize: Prize;
  color: string;
  hit: boolean;
  glow: number;
}

const SLOT_COLORS = [
  '#FF3D71', '#00E096', '#0095FF', '#FFAA00', '#C084FC',
];

export default function SwipeShoot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);

  const ballRef = useRef<Ball>({ x: 0, y: 0, vx: 0, vy: 0, active: false, trail: [] });
  const slotsRef = useRef<Slot[]>([]);
  const targetSlotRef = useRef(0);
  const animRef = useRef<number>(0);
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const dprRef = useRef(1);
  const phaseRef = useRef<GamePhase>('loading');

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    fetchPrizes().then((p) => {
      setPrizes(p);
      setPhase('ready');
    });
  }, []);

  /* ── Setup canvas + slots ── */
  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    c.width = c.offsetWidth * dpr;
    c.height = c.offsetHeight * dpr;
  }, []);

  const buildSlots = useCallback(() => {
    const c = canvasRef.current;
    if (!c || prizes.length === 0) return;
    const w = c.width;
    const h = c.height;
    const count = Math.min(prizes.length, 5);
    const slotW = (w * 0.8) / count;
    const slotH = slotW * 0.7;
    const startX = w * 0.1;
    const topY = h * 0.08;

    slotsRef.current = prizes.slice(0, count).map((prize, i) => ({
      x: startX + i * slotW + slotW / 2,
      y: topY + slotH / 2,
      w: slotW * 0.85,
      h: slotH,
      prize,
      color: SLOT_COLORS[i % SLOT_COLORS.length],
      hit: false,
      glow: 0,
    }));

    // Determine which slot wins
    const selected = selectRandomPrize(prizes);
    targetSlotRef.current = slotsRef.current.findIndex(
      (s) => s.prize.name === selected.name,
    );
    if (targetSlotRef.current === -1) targetSlotRef.current = 0;
  }, [prizes]);

  /* ── Reset ball to start position ── */
  const resetBall = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    ballRef.current = {
      x: c.width / 2,
      y: c.height * 0.82,
      vx: 0, vy: 0,
      active: false,
      trail: [],
    };
  }, []);

  /* ── Start game ── */
  const start = useCallback(() => {
    setupCanvas();
    buildSlots();
    resetBall();
    setWonPrize(null);
    setPhase('playing');

    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const W = c.width;
    const H = c.height;
    const dpr = dprRef.current;

    /* ── Game loop ── */
    const loop = () => {
      if (!c) return;
      ctx.clearRect(0, 0, W, H);

      /* ─ Background gradient ─ */
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#0c0f1a');
      bgGrad.addColorStop(0.5, '#131836');
      bgGrad.addColorStop(1, '#1a1040');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      /* ─ Subtle grid pattern ─ */
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.lineWidth = 1;
      const gridSize = 40 * dpr;
      for (let gx = 0; gx < W; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      for (let gy = 0; gy < H; gy += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
        ctx.stroke();
      }

      /* ─ Draw slots ─ */
      for (const slot of slotsRef.current) {
        // Slot body
        const radius = 14 * dpr;
        const sx = slot.x - slot.w / 2;
        const sy = slot.y - slot.h / 2;

        // Glow effect
        if (slot.glow > 0) {
          ctx.save();
          ctx.shadowBlur = 40 * slot.glow * dpr;
          ctx.shadowColor = slot.color;
          ctx.fillStyle = slot.color + '40';
          ctx.beginPath();
          ctx.roundRect(sx - 4 * dpr, sy - 4 * dpr, slot.w + 8 * dpr, slot.h + 8 * dpr, radius);
          ctx.fill();
          ctx.restore();
          slot.glow = Math.max(0, slot.glow - 0.02);
        }

        // Background
        ctx.fillStyle = slot.hit ? slot.color + '30' : 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.roundRect(sx, sy, slot.w, slot.h, radius);
        ctx.fill();

        // Border
        ctx.strokeStyle = slot.hit ? slot.color : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = (slot.hit ? 2.5 : 1.5) * dpr;
        ctx.stroke();

        // Opening at bottom (the "hole")
        const holeW = slot.w * 0.5;
        const holeY = slot.y + slot.h / 2 - 3 * dpr;
        ctx.fillStyle = slot.hit ? slot.color : 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.roundRect(slot.x - holeW / 2, holeY, holeW, 6 * dpr, 3 * dpr);
        ctx.fill();

        // Emoji
        ctx.font = `${slot.w * 0.3}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(slot.prize.emoji, slot.x, slot.y - slot.h * 0.05);

        // Name
        ctx.font = `bold ${Math.max(10 * dpr, slot.w * 0.1)}px system-ui`;
        ctx.fillStyle = slot.hit ? '#fff' : 'rgba(255,255,255,0.5)';
        ctx.fillText(
          slot.prize.name.length > 10 ? slot.prize.name.slice(0, 9) + '…' : slot.prize.name,
          slot.x,
          slot.y + slot.h * 0.28,
        );
      }

      /* ─ Ball physics + drawing ─ */
      const ball = ballRef.current;

      if (ball.active) {
        // Gravity
        ball.vy += GRAVITY * dpr;
        ball.vx *= FRICTION;
        ball.vy *= FRICTION;

        // Magnetic correction in upper half
        if (ball.y < H * MAGNET_THRESHOLD_Y && ball.vy < 0) {
          const target = slotsRef.current[targetSlotRef.current];
          if (target) {
            const dx = target.x - ball.x;
            ball.vx += dx * MAGNET_STRENGTH;
          }
        }

        ball.x += ball.vx;
        ball.y += ball.vy;

        // Trail
        ball.trail.push({ x: ball.x, y: ball.y, age: 0 });
        if (ball.trail.length > 20) ball.trail.shift();
        ball.trail.forEach((t) => (t.age += 0.05));

        // Wall bounce
        const r = BALL_RADIUS * dpr;
        if (ball.x - r < 0) { ball.x = r; ball.vx *= -0.6; }
        if (ball.x + r > W) { ball.x = W - r; ball.vx *= -0.6; }

        // Slot collision
        for (let i = 0; i < slotsRef.current.length; i++) {
          const s = slotsRef.current[i];
          if (
            ball.y - r < s.y + s.h / 2 &&
            ball.y + r > s.y - s.h / 2 &&
            ball.x > s.x - s.w / 2 &&
            ball.x < s.x + s.w / 2 &&
            ball.vy < 0
          ) {
            s.hit = true;
            s.glow = 1;
            ball.active = false;
            getSoundEngine().swish();

            // Determine win
            const wonSlot = slotsRef.current[targetSlotRef.current];
            if (wonSlot) {
              wonSlot.hit = true;
              wonSlot.glow = 1;
              setWonPrize(wonSlot.prize);
              setTimeout(() => {
                if (phaseRef.current === 'playing') setPhase('victory');
              }, 900);
            }
            break;
          }
        }

        // Fell off bottom — auto-win anyway (the shot "curved")
        if (ball.y > H + 50 * dpr) {
          ball.active = false;
          const wonSlot = slotsRef.current[targetSlotRef.current];
          if (wonSlot) {
            wonSlot.hit = true;
            wonSlot.glow = 1;
            getSoundEngine().swish();
            setWonPrize(wonSlot.prize);
            setTimeout(() => {
              if (phaseRef.current === 'playing') setPhase('victory');
            }, 600);
          }
        }
      }

      // Draw trail
      for (let i = 0; i < ball.trail.length; i++) {
        const t = ball.trail[i];
        const alpha = Math.max(0, 1 - t.age) * 0.4;
        const size = (BALL_RADIUS * dpr) * (1 - t.age * 0.5);
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(1, size), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(56,189,248,${alpha})`;
        ctx.fill();
      }

      // Draw ball
      const br = BALL_RADIUS * dpr;
      const ballGrad = ctx.createRadialGradient(
        ball.x - br * 0.3, ball.y - br * 0.3, br * 0.1,
        ball.x, ball.y, br,
      );
      ballGrad.addColorStop(0, '#fef3c7');
      ballGrad.addColorStop(0.4, '#fbbf24');
      ballGrad.addColorStop(1, '#d97706');
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, br, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();

      // Ball highlight
      ctx.beginPath();
      ctx.arc(ball.x - br * 0.25, ball.y - br * 0.25, br * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();

      // Ball shadow
      ctx.beginPath();
      ctx.ellipse(ball.x, ball.y + br + 6 * dpr, br * 0.8, br * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fill();

      /* ─ Swipe instruction ─ */
      if (!ball.active && phaseRef.current === 'playing') {
        const time = Date.now() * 0.003;
        const bobY = Math.sin(time) * 6 * dpr;
        ctx.save();
        ctx.globalAlpha = 0.5 + Math.sin(time * 2) * 0.2;
        ctx.font = `${14 * dpr}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('↑ Swipez vers le haut', W / 2, ball.y + 50 * dpr + bobY);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [prizes, setupCanvas, buildSlots, resetBall]);

  /* ── Swipe handling ── */
  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const cy = 'touches' in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    return { x: (cx - rect.left) * dpr, y: (cy - rect.top) * dpr };
  };

  const onPointerDown = (e: React.TouchEvent | React.MouseEvent) => {
    if (phase !== 'playing' || ballRef.current.active) return;
    const pos = getPos(e);
    swipeRef.current = { x: pos.x, y: pos.y, t: Date.now() };
  };

  const onPointerUp = (e: React.TouchEvent | React.MouseEvent) => {
    if (!swipeRef.current || phase !== 'playing' || ballRef.current.active) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = dprRef.current;
    const rect = c.getBoundingClientRect();
    const cx = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
    const cy = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
    const endX = (cx - rect.left) * dpr;
    const endY = (cy - rect.top) * dpr;
    const dx = endX - swipeRef.current.x;
    const dy = endY - swipeRef.current.y;
    const dt = Math.max(Date.now() - swipeRef.current.t, 40);

    if (dy < -20 * dpr) {
      const speed = Math.min(Math.abs(dy) / dt, 2.5) * 8 * dpr;
      ballRef.current.vx = (dx / dt) * 5 * dpr;
      ballRef.current.vy = -speed;
      ballRef.current.active = true;
      ballRef.current.trail = [];
      getSoundEngine().swoosh();
    }
    swipeRef.current = null;
  };

  return (
    <div className="game-container">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onTouchStart={onPointerDown}
        onTouchEnd={onPointerUp}
        onMouseDown={onPointerDown}
        onMouseUp={onPointerUp}
      />

      {/* Ready overlay */}
      {phase === 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <div className="absolute inset-0 bg-gradient-to-b from-[#0c0f1a] via-[#131836] to-[#1a1040]" />
          <div className="relative z-10 flex flex-col items-center gap-6 px-8">
            <div
              className="text-7xl"
              style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}
            >
              🎯
            </div>
            <h1
              className="text-[32px] font-extrabold text-white tracking-tight text-center"
              style={{ animation: 'fadeInUp 0.6s ease-out both' }}
            >
              Swipe & Shoot
            </h1>
            <p
              className="text-white/50 text-[15px] leading-relaxed text-center max-w-[280px]"
              style={{ animation: 'fadeInUp 0.6s ease-out 0.1s both' }}
            >
              Lancez la balle vers les cibles <br />pour gagner votre cadeau !
            </p>
            <button
              onClick={start}
              className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all duration-200 active:scale-[0.96]"
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                boxShadow: '0 12px 40px -10px rgba(99,102,241,0.5)',
                animation: 'fadeInUp 0.6s ease-out 0.2s both',
              }}
            >
              Lancer le jeu
            </button>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0c0f1a] z-20">
          <div
            className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full"
            style={{ animation: 'spin 0.8s linear infinite' }}
          />
        </div>
      )}

      {phase === 'victory' && wonPrize && (
        <VictoryScreen
          prize={wonPrize}
          onClose={() => {
            resetBall();
            buildSlots();
            setPhase('ready');
          }}
          accentFrom="#3b82f6"
          accentTo="#8b5cf6"
        />
      )}
    </div>
  );
}
