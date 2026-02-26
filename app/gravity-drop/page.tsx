'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   GRAVITY DROP — Gyroscope tilting board
   Guide the ball to an exit. Avoid holes.
   ═══════════════════════════════════════════════ */

const BALL_R = 10;
const HOLE_R = 14;
const EXIT_R = 16;
const FRICTION = 0.94;
const ACCEL = 0.35;
const GRID = 8; // procedural grid size

interface Vec2 { x: number; y: number }

function generateLevel(w: number, h: number, prizes: Prize[]): {
  holes: Vec2[];
  exits: { x: number; y: number; prize: Prize }[];
  walls: { x: number; y: number; w: number; h: number }[];
} {
  const margin = 50;
  const holes: Vec2[] = [];
  const walls: { x: number; y: number; w: number; h: number }[] = [];

  // Generate random holes (traps)
  const holeCount = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < holeCount; i++) {
    holes.push({
      x: margin + Math.random() * (w - margin * 2),
      y: margin * 2 + Math.random() * (h - margin * 4),
    });
  }

  // Generate small wall obstacles
  const wallCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < wallCount; i++) {
    const horizontal = Math.random() < 0.5;
    walls.push({
      x: margin + Math.random() * (w - margin * 2 - 60),
      y: margin * 2 + Math.random() * (h - margin * 4 - 20),
      w: horizontal ? 40 + Math.random() * 60 : 8,
      h: horizontal ? 8 : 40 + Math.random() * 60,
    });
  }

  // 3 exits at bottom with prizes
  const exits = [];
  const exitCount = 3;
  for (let i = 0; i < exitCount; i++) {
    exits.push({
      x: margin + ((w - margin * 2) / (exitCount + 1)) * (i + 1),
      y: h - margin,
      prize: selectRandomPrize(prizes),
    });
  }

  return { holes, exits, walls };
}

export default function GravityDrop({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);
  const mahoganyRgb = hexToRgb(MAHOGANY);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  const ballRef = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const tiltRef = useRef({ x: 0, y: 0 });
  const calibRef = useRef({ beta: 0, gamma: 0, calibrated: false });
  const levelRef = useRef<ReturnType<typeof generateLevel>>({ holes: [], exits: [], walls: [] });
  const touchFallbackRef = useRef<{ active: boolean; cx: number; cy: number }>({ active: false, cx: 0, cy: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  // Gyroscope
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      if (!calibRef.current.calibrated) {
        calibRef.current = { beta, gamma, calibrated: true };
      }
      const dy = (beta - calibRef.current.beta) / 40;
      const dx = (gamma - calibRef.current.gamma) / 40;
      tiltRef.current = { x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) };
    };

    const req = async () => {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        try {
          const p = await (DeviceOrientationEvent as any).requestPermission();
          if (p !== 'granted') return;
        } catch { return; }
      }
      window.addEventListener('deviceorientation', handleOrientation);
    };
    req();
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, []);

  // Touch fallback (desktop/no gyro)
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    touchFallbackRef.current = { active: true, cx, cy };
  };
  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!touchFallbackRef.current.active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    const { w, h } = sizeRef.current;
    tiltRef.current = {
      x: Math.max(-1, Math.min(1, (cx - w / 2) / (w / 2))),
      y: Math.max(-1, Math.min(1, (cy - h / 2) / (h / 2))),
    };
  };
  const handleTouchEnd = () => { touchFallbackRef.current.active = false; };

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

    // Init level
    levelRef.current = generateLevel(w, h, prizes);
    ballRef.current = { x: w / 2, y: 60, vx: 0, vy: 0 };
    calibRef.current.calibrated = false;
    tiltRef.current = { x: 0, y: 0 };

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background — wooden board look
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Wood grain
      ctx.globalAlpha = 0.03;
      for (let i = 0; i < h; i += 6) {
        ctx.strokeStyle = CREAM;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, i + Math.sin(i * 0.05) * 3);
        ctx.lineTo(w, i + Math.sin(i * 0.05 + 1) * 3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const level = levelRef.current;
      const ball = ballRef.current;

      // Edge border
      ctx.strokeStyle = GOLD + '30';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Draw walls
      for (const wall of level.walls) {
        const wg = ctx.createLinearGradient(wall.x, wall.y, wall.x + wall.w, wall.y + wall.h);
        wg.addColorStop(0, `rgba(${mahoganyRgb},0.8)`);
        wg.addColorStop(1, `rgba(${mahoganyRgb},0.5)`);
        ctx.fillStyle = wg;
        ctx.beginPath();
        ctx.roundRect(wall.x, wall.y, wall.w, wall.h, 3);
        ctx.fill();
        ctx.strokeStyle = GOLD + '30';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw holes (traps) — dark circles
      for (const hole of level.holes) {
        const hg = ctx.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, HOLE_R);
        hg.addColorStop(0, '#000');
        hg.addColorStop(0.7, '#0a0a0a');
        hg.addColorStop(1, `rgba(${mahoganyRgb},0.3)`);
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(hole.x, hole.y, HOLE_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw exits (goals)
      for (const exit of level.exits) {
        // Glow
        const eg = ctx.createRadialGradient(exit.x, exit.y, 0, exit.x, exit.y, EXIT_R * 2);
        eg.addColorStop(0, `rgba(${goldRgb},0.2)`);
        eg.addColorStop(1, 'transparent');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(exit.x, exit.y, EXIT_R * 2, 0, Math.PI * 2);
        ctx.fill();

        // Circle
        ctx.fillStyle = GOLD + '40';
        ctx.beginPath();
        ctx.arc(exit.x, exit.y, EXIT_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Emoji
        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(exit.prize.emoji, exit.x, exit.y);
      }

      // Ball physics
      ball.vx += tiltRef.current.x * ACCEL;
      ball.vy += tiltRef.current.y * ACCEL;
      ball.vx *= FRICTION;
      ball.vy *= FRICTION;
      ball.x += ball.vx;
      ball.y += ball.vy;

      // Wall collisions (edges)
      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx *= -0.5; }
      if (ball.x > w - BALL_R) { ball.x = w - BALL_R; ball.vx *= -0.5; }
      if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy *= -0.5; }
      if (ball.y > h - BALL_R) { ball.y = h - BALL_R; ball.vy *= -0.5; }

      // Wall obstacle collisions
      for (const wall of level.walls) {
        const closest = {
          x: Math.max(wall.x, Math.min(ball.x, wall.x + wall.w)),
          y: Math.max(wall.y, Math.min(ball.y, wall.y + wall.h)),
        };
        const dx = ball.x - closest.x;
        const dy = ball.y - closest.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < BALL_R && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;
          ball.x = closest.x + nx * BALL_R;
          ball.y = closest.y + ny * BALL_R;
          const dot = ball.vx * nx + ball.vy * ny;
          ball.vx -= 2 * dot * nx * 0.5;
          ball.vy -= 2 * dot * ny * 0.5;
          try { getSoundEngine().peg(1); } catch {}
        }
      }

      // Check hole collision (trap — restart ball)
      for (const hole of level.holes) {
        const dx = ball.x - hole.x;
        const dy = ball.y - hole.y;
        if (Math.sqrt(dx * dx + dy * dy) < HOLE_R - 2) {
          // Ball falls in hole — reset to top
          ball.x = w / 2;
          ball.y = 60;
          ball.vx = 0;
          ball.vy = 0;
          try { getSoundEngine().miss(); } catch {}
          break;
        }
      }

      // Check exit collision (win!)
      for (const exit of level.exits) {
        const dx = ball.x - exit.x;
        const dy = ball.y - exit.y;
        if (Math.sqrt(dx * dx + dy * dy) < EXIT_R) {
          setWonPrize(exit.prize);
          try { getSoundEngine().swish(); } catch {}
          setTimeout(() => setPhase('victory'), 500);
          return;
        }
      }

      // Draw ball
      const bg = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 0, ball.x, ball.y, BALL_R);
      bg.addColorStop(0, CREAM);
      bg.addColorStop(0.3, GOLD_BRIGHT);
      bg.addColorStop(0.7, GOLD);
      bg.addColorStop(1, SIENNA);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();

      // Ball highlight
      ctx.beginPath();
      ctx.arc(ball.x - 2, ball.y - 2, BALL_R * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${creamRgb},0.6)`;
      ctx.fill();

      // Shadow
      ctx.beginPath();
      ctx.arc(ball.x + 1, ball.y + 1, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fill();

      // Tilt indicator
      if (Math.abs(tiltRef.current.x) > 0.02 || Math.abs(tiltRef.current.y) > 0.02) {
        const ix = w / 2;
        const iy = 20;
        ctx.strokeStyle = `rgba(${goldRgb},0.1)`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(ix, iy, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.arc(ix + tiltRef.current.x * 10, iy + tiltRef.current.y * 10, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, goldRgb, creamRgb, mahoganyRgb]);

  const start = () => {
    setWonPrize(null);
    calibRef.current.calibrated = false;
    setPhase('playing');
  };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseMove={handleTouchMove}
          onMouseUp={handleTouchEnd}
        />
      )}

      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🔮</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Gravity Drop</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Inclinez votre téléphone pour guider la bille<br/>vers un cadeau. Évitez les trous !
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
