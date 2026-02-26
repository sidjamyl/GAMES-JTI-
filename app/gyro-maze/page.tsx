'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   GYRO MAZE — Tilt-controlled labyrinth
   Roll the ball through the maze to the gift.
   Uses DeviceOrientation (gyroscope) on mobile,
   mouse/touch drag on desktop as fallback.
   Always rigged: player always reaches the goal.
   ═══════════════════════════════════════════════ */

const ACCENT_FROM = '#10b981';
const ACCENT_TO = '#06b6d4';

const BALL_RADIUS = 10;
const TRAP_RADIUS = 9;
const GOAL_RADIUS = 16;
const WALL_THICKNESS = 4;
const FRICTION = 0.92;
const GRAVITY_SCALE = 0.45;
const MAX_SPEED = 6;

// Maze definition: walls as [x1, y1, x2, y2] in 0-1 normalized coords
// A compact maze that's solvable but has traps
const MAZE_WALLS: [number, number, number, number][] = [
  // Outer walls
  [0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0],
  // Inner maze structure
  [0.25, 0, 0.25, 0.35],
  [0.25, 0.35, 0.55, 0.35],
  [0.5, 0, 0.5, 0.2],
  [0.75, 0.15, 0.75, 0.5],
  [0.55, 0.5, 1, 0.5],
  [0, 0.55, 0.35, 0.55],
  [0.35, 0.55, 0.35, 0.75],
  [0.55, 0.65, 0.55, 0.85],
  [0.55, 0.85, 0.85, 0.85],
  [0.15, 0.75, 0.55, 0.75],
  [0.75, 0.5, 0.75, 0.72],
  [0, 0.35, 0.12, 0.35],
];

// Trap holes (cause a small penalty / teleport back)
const TRAP_POSITIONS: [number, number][] = [
  [0.38, 0.18],
  [0.62, 0.42],
  [0.18, 0.68],
  [0.82, 0.68],
  [0.45, 0.62],
];

// Ball start and goal
const BALL_START: [number, number] = [0.12, 0.12];
const GOAL_POS: [number, number] = [0.88, 0.92];

interface BallState {
  x: number; y: number;
  vx: number; vy: number;
}

export default function GyroMaze() {
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [hasGyro, setHasGyro] = useState<boolean | null>(null);
  const [gyroPermission, setGyroPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [trapHits, setTrapHits] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballRef = useRef<BallState>({ x: 0, y: 0, vx: 0, vy: 0 });
  const tiltRef = useRef({ x: 0, y: 0 }); // normalized -1..1
  const animRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0, mazeX: 0, mazeY: 0, mazeSize: 0 });
  const startTimeRef = useRef(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trappedRef = useRef(false);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
  const trapCooldownRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Load prizes
  useEffect(() => {
    fetchPrizes().then((p) => {
      setPrizes(p);
      setPhase('ready');
    });
  }, []);

  // Detect gyroscope
  useEffect(() => {
    const hasOrientation = 'DeviceOrientationEvent' in window;
    setHasGyro(hasOrientation);
  }, []);

  const requestGyroPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const perm = await DOE.requestPermission();
        setGyroPermission(perm === 'granted' ? 'granted' : 'denied');
        return perm === 'granted';
      } catch {
        setGyroPermission('denied');
        return false;
      }
    }
    setGyroPermission('granted');
    return true;
  }, []);

  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = c.offsetWidth * dpr;
    const h = c.offsetHeight * dpr;
    c.width = w;
    c.height = h;

    // Maze is a square centered on canvas
    const padding = 30 * dpr;
    const mazeSize = Math.min(w - padding * 2, h * 0.65);
    const mazeX = (w - mazeSize) / 2;
    const mazeY = h * 0.18;
    sizeRef.current = { w, h, mazeX, mazeY, mazeSize };
  }, []);

  const resetBall = useCallback(() => {
    const { mazeX, mazeY, mazeSize } = sizeRef.current;
    ballRef.current = {
      x: mazeX + BALL_START[0] * mazeSize,
      y: mazeY + BALL_START[1] * mazeSize,
      vx: 0, vy: 0,
    };
  }, []);

  // Convert maze-normalized coords to canvas coords
  const toCanvas = useCallback((nx: number, ny: number) => {
    const { mazeX, mazeY, mazeSize } = sizeRef.current;
    return { x: mazeX + nx * mazeSize, y: mazeY + ny * mazeSize };
  }, []);

  // Line-circle collision
  const lineCircleCollide = useCallback((
    x1: number, y1: number, x2: number, y2: number,
    cx: number, cy: number, r: number
  ): { hit: boolean; nx: number; ny: number; pen: number } => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { hit: false, nx: 0, ny: 0, pen: 0 };
    const ux = dx / len;
    const uy = dy / len;
    const fx = cx - x1;
    const fy = cy - y1;
    let t = fx * ux + fy * uy;
    t = Math.max(0, Math.min(len, t));
    const closestX = x1 + ux * t;
    const closestY = y1 + uy * t;
    const distX = cx - closestX;
    const distY = cy - closestY;
    const dist = Math.sqrt(distX * distX + distY * distY);
    if (dist < r + WALL_THICKNESS * dprRef.current * 0.5) {
      const pen = r + WALL_THICKNESS * dprRef.current * 0.5 - dist;
      const nx = dist > 0 ? distX / dist : 0;
      const ny = dist > 0 ? distY / dist : 1;
      return { hit: true, nx, ny, pen };
    }
    return { hit: false, nx: 0, ny: 0, pen: 0 };
  }, []);

  const startGame = useCallback(async () => {
    if (hasGyro && gyroPermission === 'prompt') {
      await requestGyroPermission();
    }
    setupCanvas();
    resetBall();
    setTrapHits(0);
    setElapsed(0);
    setWonPrize(null);
    trappedRef.current = false;
    trapCooldownRef.current = 0;
    startTimeRef.current = Date.now();
    setPhase('playing');

    // Elapsed timer
    elapsedIntervalRef.current = setInterval(() => {
      if (phaseRef.current === 'playing') {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
  }, [hasGyro, gyroPermission, requestGyroPermission, setupCanvas, resetBall]);

  // Gyroscope input
  useEffect(() => {
    if (phase !== 'playing') return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = (e.gamma || 0) / 45; // left-right tilt, -1..1
      const beta = ((e.beta || 0) - 30) / 45; // front-back tilt, shifted for holding angle
      tiltRef.current = {
        x: Math.max(-1, Math.min(1, gamma)),
        y: Math.max(-1, Math.min(1, beta)),
      };
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [phase]);

  // Touch/mouse fallback for desktop
  const onPointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (phase !== 'playing') return;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = { active: true, lastX: cx - rect.left, lastY: cy - rect.top };
  }, [phase]);

  const onPointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!dragRef.current.active || phase !== 'playing') return;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = cx - rect.left;
    const y = cy - rect.top;
    const dx = x - dragRef.current.lastX;
    const dy = y - dragRef.current.lastY;
    tiltRef.current = {
      x: Math.max(-1, Math.min(1, dx * 0.05)),
      y: Math.max(-1, Math.min(1, dy * 0.05)),
    };
    dragRef.current.lastX = x;
    dragRef.current.lastY = y;
  }, [phase]);

  const onPointerUp = useCallback(() => {
    dragRef.current.active = false;
    tiltRef.current = { x: 0, y: 0 };
  }, []);

  // Game loop
  useEffect(() => {
    if (phase !== 'playing') return;

    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      if (phaseRef.current !== 'playing') return;
      const { w: W, h: H, mazeX, mazeY, mazeSize } = sizeRef.current;
      const dpr = dprRef.current;
      const ball = ballRef.current;

      ctx.clearRect(0, 0, W, H);

      /* ── Background ── */
      const bg = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, H);
      bg.addColorStop(0, '#0f2a1f');
      bg.addColorStop(0.5, '#081510');
      bg.addColorStop(1, '#030a07');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      /* ── Maze board background ── */
      const boardPad = 8 * dpr;
      ctx.fillStyle = 'rgba(16,185,129,0.04)';
      ctx.beginPath();
      ctx.roundRect(mazeX - boardPad, mazeY - boardPad, mazeSize + boardPad * 2, mazeSize + boardPad * 2, 16 * dpr);
      ctx.fill();
      ctx.strokeStyle = 'rgba(16,185,129,0.15)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      // Inner board darker
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(mazeX, mazeY, mazeSize, mazeSize);

      /* ── Trap holes ── */
      for (const [tx, ty] of TRAP_POSITIONS) {
        const tp = toCanvas(tx, ty);
        const tr = TRAP_RADIUS * dpr;
        // Hole shadow
        const holeGrad = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, tr * 1.5);
        holeGrad.addColorStop(0, 'rgba(0,0,0,0.8)');
        holeGrad.addColorStop(0.6, 'rgba(0,0,0,0.4)');
        holeGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = holeGrad;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, tr * 1.5, 0, Math.PI * 2);
        ctx.fill();
        // Hole
        ctx.fillStyle = '#1a0505';
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, tr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(239,68,68,0.3)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }

      /* ── Goal ── */
      const goal = toCanvas(GOAL_POS[0], GOAL_POS[1]);
      const gr = GOAL_RADIUS * dpr;
      // Goal glow
      const time = Date.now() * 0.003;
      const glowPulse = 0.5 + Math.sin(time) * 0.3;
      ctx.save();
      ctx.shadowBlur = 25 * dpr * glowPulse;
      ctx.shadowColor = ACCENT_FROM;
      ctx.fillStyle = 'rgba(16,185,129,0.15)';
      ctx.beginPath();
      ctx.arc(goal.x, goal.y, gr * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Goal circle
      const goalGrad = ctx.createRadialGradient(goal.x, goal.y, 0, goal.x, goal.y, gr);
      goalGrad.addColorStop(0, 'rgba(16,185,129,0.3)');
      goalGrad.addColorStop(1, 'rgba(6,182,212,0.15)');
      ctx.fillStyle = goalGrad;
      ctx.beginPath();
      ctx.arc(goal.x, goal.y, gr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ACCENT_FROM;
      ctx.lineWidth = 2 * dpr;
      ctx.stroke();
      // Gift emoji
      ctx.font = `${gr * 1.1}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎁', goal.x, goal.y);

      /* ── Maze walls ── */
      ctx.strokeStyle = 'rgba(16,185,129,0.5)';
      ctx.lineWidth = WALL_THICKNESS * dpr;
      ctx.lineCap = 'round';
      for (const [x1, y1, x2, y2] of MAZE_WALLS) {
        const p1 = toCanvas(x1, y1);
        const p2 = toCanvas(x2, y2);
        // Wall glow
        ctx.save();
        ctx.shadowBlur = 6 * dpr;
        ctx.shadowColor = 'rgba(16,185,129,0.2)';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      }

      /* ── Physics ── */
      if (!trappedRef.current) {
        const tilt = tiltRef.current;
        ball.vx += tilt.x * GRAVITY_SCALE * dpr;
        ball.vy += tilt.y * GRAVITY_SCALE * dpr;
        ball.vx *= FRICTION;
        ball.vy *= FRICTION;

        // Clamp speed
        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (speed > MAX_SPEED * dpr) {
          const scale = (MAX_SPEED * dpr) / speed;
          ball.vx *= scale;
          ball.vy *= scale;
        }

        ball.x += ball.vx;
        ball.y += ball.vy;

        const br = BALL_RADIUS * dpr;

        // Wall collisions
        for (const [x1, y1, x2, y2] of MAZE_WALLS) {
          const p1 = toCanvas(x1, y1);
          const p2 = toCanvas(x2, y2);
          const col = lineCircleCollide(p1.x, p1.y, p2.x, p2.y, ball.x, ball.y, br);
          if (col.hit) {
            ball.x += col.nx * col.pen;
            ball.y += col.ny * col.pen;
            // Reflect velocity
            const dot = ball.vx * col.nx + ball.vy * col.ny;
            ball.vx -= 1.8 * dot * col.nx;
            ball.vy -= 1.8 * dot * col.ny;
            ball.vx *= 0.5;
            ball.vy *= 0.5;
            getSoundEngine().peg(Math.floor(Math.random() * 5));
          }
        }

        // Trap collision
        if (trapCooldownRef.current <= 0) {
          for (const [tx, ty] of TRAP_POSITIONS) {
            const tp = toCanvas(tx, ty);
            const dx = ball.x - tp.x;
            const dy = ball.y - tp.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < (TRAP_RADIUS + BALL_RADIUS * 0.5) * dpr) {
              getSoundEngine().miss();
              setTrapHits(h => h + 1);
              trappedRef.current = true;
              trapCooldownRef.current = 60; // frames of immunity after respawn
              // Teleport back to start after brief delay
              setTimeout(() => {
                resetBall();
                trappedRef.current = false;
              }, 500);
              break;
            }
          }
        } else {
          trapCooldownRef.current--;
        }

        // Goal collision
        const dx = ball.x - goal.x;
        const dy = ball.y - goal.y;
        const goalDist = Math.sqrt(dx * dx + dy * dy);
        if (goalDist < (GOAL_RADIUS + BALL_RADIUS * 0.3) * dpr) {
          // WIN!
          getSoundEngine().swish();
          const prize = selectRandomPrize(prizes);
          setWonPrize(prize);
          setPhase('victory');
          if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
        }
      }

      /* ── Draw ball ── */
      const br = BALL_RADIUS * dpr;
      // Shadow
      ctx.beginPath();
      ctx.ellipse(ball.x + 2 * dpr, ball.y + 3 * dpr, br * 0.9, br * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      // Ball
      const ballGrad = ctx.createRadialGradient(ball.x - br * 0.3, ball.y - br * 0.3, br * 0.1, ball.x, ball.y, br);
      ballGrad.addColorStop(0, '#e0e7ff');
      ballGrad.addColorStop(0.4, '#a5b4fc');
      ballGrad.addColorStop(1, '#6366f1');
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, br, 0, Math.PI * 2);
      ctx.fillStyle = trappedRef.current ? 'rgba(239,68,68,0.5)' : ballGrad;
      ctx.fill();
      // Highlight
      ctx.beginPath();
      ctx.arc(ball.x - br * 0.25, ball.y - br * 0.3, br * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fill();

      /* ── Tilt indicator ── */
      const indicatorX = W / 2;
      const indicatorY = mazeY + mazeSize + 40 * dpr;
      const indR = 20 * dpr;
      // Outer ring
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(indicatorX, indicatorY, indR, 0, Math.PI * 2);
      ctx.stroke();
      // Dot showing tilt
      const dotX = indicatorX + tiltRef.current.x * indR * 0.8;
      const dotY = indicatorY + tiltRef.current.y * indR * 0.8;
      ctx.fillStyle = ACCENT_FROM;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animRef.current);
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [phase, prizes, toCanvas, lineCircleCollide, resetBall]);

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center"
      style={{
        background: 'radial-gradient(ellipse at 50% 20%, #0f2a1f 0%, #081510 50%, #030a07 100%)',
      }}
    >
      {/* Header */}
      <div className="w-full max-w-[400px] flex flex-col items-center pt-8 pb-2 z-10" style={{ animation: 'fadeInUp 0.5s ease-out both' }}>
        <h1
          className="text-[24px] font-black tracking-tight text-center"
          style={{
            background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Gyro Maze
        </h1>
        <p className="text-white/30 text-xs mt-1">Inclinez pour guider la bille vers le cadeau 🎁</p>
      </div>

      {/* HUD */}
      {phase === 'playing' && (
        <div className="w-full max-w-[400px] flex items-center justify-between px-6 py-2 z-10" style={{ animation: 'fadeIn 0.3s ease-out both' }}>
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-[11px] font-semibold uppercase tracking-wider">Temps</span>
            <span className="text-white/70 text-sm font-bold tabular-nums">{elapsed}s</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-[11px] font-semibold uppercase tracking-wider">Chutes</span>
            <span className="text-sm font-bold" style={{ color: trapHits > 0 ? '#ef4444' : 'rgba(255,255,255,0.7)' }}>{trapHits}</span>
          </div>
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      />

      {/* Loading */}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: '#081510' }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent" style={{ borderColor: `${ACCENT_FROM} transparent ${ACCENT_FROM} ${ACCENT_FROM}`, animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Ready screen */}
      {phase === 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 30%, #0f2a1f 0%, #081510 50%, #030a07 100%)' }} />
          <div className="relative z-10 flex flex-col items-center gap-5 px-8">
            <div className="text-6xl" style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}>🎁</div>
            <h2 className="text-[28px] font-extrabold text-white tracking-tight text-center" style={{ animation: 'fadeInUp 0.6s ease-out both' }}>
              Gyro Maze
            </h2>
            <p className="text-white/35 text-[13px] text-center max-w-[260px] leading-relaxed" style={{ animation: 'fadeInUp 0.6s ease-out 0.1s both' }}>
              Inclinez votre téléphone pour guider la bille à travers le labyrinthe.<br />
              <span className="text-white/20 text-[11px]">Évitez les trous rouges · Rejoignez le cadeau</span>
            </p>
            {hasGyro === false && (
              <p className="text-amber-400/60 text-[11px] text-center" style={{ animation: 'fadeIn 0.5s ease-out 0.3s both' }}>
                Gyroscope non détecté — glissez avec le doigt
              </p>
            )}
            <button
              onClick={startGame}
              className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.96]"
              style={{
                background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                boxShadow: `0 12px 40px -10px ${ACCENT_FROM}80`,
                animation: 'fadeInUp 0.6s ease-out 0.2s both',
              }}
            >
              Jouer 🏁
            </button>
          </div>
        </div>
      )}

      {/* Victory */}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen
          prize={wonPrize}
          onClose={() => setPhase('ready')}
          accentFrom={ACCENT_FROM}
          accentTo={ACCENT_TO}
        />
      )}
    </div>
  );
}
