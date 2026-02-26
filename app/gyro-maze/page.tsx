'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   GYRO MAZE — Ball starts at center,
   4 gift exits on each side.
   Tilt (gyro) or touch to guide the ball.
   Always rigged: player always reaches a goal.
   ═══════════════════════════════════════════════ */

const ACCENT_FROM = '#10b981';
const ACCENT_TO = '#06b6d4';

const BALL_RADIUS = 9;
const GOAL_RADIUS = 14;
const WALL_THICKNESS = 3;
const TRAP_RADIUS = 8;
const FRICTION = 0.94;
const ACCEL = 0.55;
const MAX_SPEED = 4.5;

const BALL_START: [number, number] = [0.5, 0.5];

const GOAL_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];
const GOAL_EMOJIS = ['🎁', '🎁', '🎁', '🎁'];

// 4 goals just inside each exit gap
const GOALS: [number, number][] = [
  [0.5, 0.025],   // Top (North)
  [0.975, 0.5],   // Right (East)
  [0.5, 0.975],   // Bottom (South)
  [0.025, 0.5],   // Left (West)
];

const MAZE_WALLS: [number, number, number, number][] = [
  // ── Outer walls with exit gaps (gap: 0.38 → 0.62) ──
  [0, 0, 0.37, 0], [0.63, 0, 1, 0],
  [1, 0, 1, 0.37], [1, 0.63, 1, 1],
  [1, 1, 0.63, 1], [0.37, 1, 0, 1],
  [0, 1, 0, 0.63], [0, 0.37, 0, 0],
  // ── Quadrant L-barriers ──
  [0.22, 0.08, 0.22, 0.35], [0.08, 0.22, 0.35, 0.22],
  [0.78, 0.08, 0.78, 0.35], [0.65, 0.22, 0.92, 0.22],
  [0.22, 0.65, 0.22, 0.92], [0.08, 0.78, 0.35, 0.78],
  [0.78, 0.65, 0.78, 0.92], [0.65, 0.78, 0.92, 0.78],
  // ── Inner cross barriers (gaps at cardinal directions) ──
  [0.42, 0.3, 0.42, 0.42], [0.58, 0.3, 0.58, 0.42],
  [0.42, 0.58, 0.42, 0.7], [0.58, 0.58, 0.58, 0.7],
  [0.3, 0.42, 0.42, 0.42], [0.58, 0.42, 0.7, 0.42],
  [0.3, 0.58, 0.42, 0.58], [0.58, 0.58, 0.7, 0.58],
];

// Traps in the 4 corners — dangerous dead-end zones
const TRAP_POSITIONS: [number, number][] = [
  [0.11, 0.11], [0.89, 0.11], [0.11, 0.89], [0.89, 0.89],
];

interface BallState {
  x: number; y: number;
  vx: number; vy: number;
}

export default function GyroMaze() {
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [trapHits, setTrapHits] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [hasGyro, setHasGyro] = useState<boolean | null>(null);
  const [gyroPermission, setGyroPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballRef = useRef<BallState>({ x: 0, y: 0, vx: 0, vy: 0 });
  const tiltRef = useRef({ x: 0, y: 0 });
  const animRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0, mazeX: 0, mazeY: 0, mazeSize: 0 });
  const startTimeRef = useRef(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trappedRef = useRef(false);
  const trapCooldownRef = useRef(0);
  const touchActiveRef = useRef(false);
  const touchPosRef = useRef({ x: 0, y: 0 });
  const calibrationRef = useRef({ beta: 0, gamma: 0, calibrated: false });

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); });
  }, []);

  useEffect(() => {
    setHasGyro('DeviceOrientationEvent' in window);
  }, []);

  const requestGyroPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const perm = await DOE.requestPermission();
        setGyroPermission(perm === 'granted' ? 'granted' : 'denied');
        return perm === 'granted';
      } catch { setGyroPermission('denied'); return false; }
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
    c.width = w; c.height = h;
    const padding = 24 * dpr;
    const mazeSize = Math.min(w - padding * 2, h * 0.62);
    const mazeX = (w - mazeSize) / 2;
    const mazeY = h * 0.2;
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

  const toCanvas = useCallback((nx: number, ny: number) => {
    const { mazeX, mazeY, mazeSize } = sizeRef.current;
    return { x: mazeX + nx * mazeSize, y: mazeY + ny * mazeSize };
  }, []);

  const lineCircleCollide = useCallback((
    x1: number, y1: number, x2: number, y2: number,
    cx: number, cy: number, r: number
  ) => {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { hit: false, nx: 0, ny: 0, pen: 0 };
    const ux = dx / len, uy = dy / len;
    const fx = cx - x1, fy = cy - y1;
    let t = fx * ux + fy * uy;
    t = Math.max(0, Math.min(len, t));
    const closestX = x1 + ux * t, closestY = y1 + uy * t;
    const distX = cx - closestX, distY = cy - closestY;
    const dist = Math.sqrt(distX * distX + distY * distY);
    const wallR = WALL_THICKNESS * dprRef.current * 0.5;
    if (dist < r + wallR) {
      const pen = r + wallR - dist;
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
    calibrationRef.current = { beta: 0, gamma: 0, calibrated: false };
    setupCanvas();
    resetBall();
    setTrapHits(0);
    setElapsed(0);
    setWonPrize(null);
    trappedRef.current = false;
    trapCooldownRef.current = 0;
    tiltRef.current = { x: 0, y: 0 };
    startTimeRef.current = Date.now();
    setPhase('playing');
    elapsedIntervalRef.current = setInterval(() => {
      if (phaseRef.current === 'playing') {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
  }, [hasGyro, gyroPermission, requestGyroPermission, setupCanvas, resetBall]);

  // ── Gyroscope with calibration ──
  useEffect(() => {
    if (phase !== 'playing') return;
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const beta = e.beta || 0;
      const gamma = e.gamma || 0;
      if (!calibrationRef.current.calibrated) {
        calibrationRef.current = { beta, gamma, calibrated: true };
      }
      const cal = calibrationRef.current;
      const dx = (gamma - cal.gamma) / 30;
      const dy = (beta - cal.beta) / 30;
      tiltRef.current = {
        x: Math.max(-1, Math.min(1, dx)),
        y: Math.max(-1, Math.min(1, dy)),
      };
    };
    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [phase]);

  // ── Touch/Mouse: ball accelerates toward touch point ──
  const onPointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (phase !== 'playing') return;
    touchActiveRef.current = true;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = ('touches' in e ? e.touches[0].clientX : e.clientX);
    const cy = ('touches' in e ? e.touches[0].clientY : e.clientY);
    touchPosRef.current = { x: (cx - rect.left) * dpr, y: (cy - rect.top) * dpr };
    updateTiltFromTouch();
  }, [phase]);

  const onPointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!touchActiveRef.current || phase !== 'playing') return;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = ('touches' in e ? e.touches[0].clientX : e.clientX);
    const cy = ('touches' in e ? e.touches[0].clientY : e.clientY);
    touchPosRef.current = { x: (cx - rect.left) * dpr, y: (cy - rect.top) * dpr };
    updateTiltFromTouch();
  }, [phase]);

  const onPointerUp = useCallback(() => {
    touchActiveRef.current = false;
    tiltRef.current = { x: 0, y: 0 };
  }, []);

  const updateTiltFromTouch = useCallback(() => {
    const ball = ballRef.current;
    const touch = touchPosRef.current;
    const dx = touch.x - ball.x;
    const dy = touch.y - ball.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) { tiltRef.current = { x: 0, y: 0 }; return; }
    const maxDist = 150 * dprRef.current;
    const strength = Math.min(1, dist / maxDist);
    tiltRef.current = { x: (dx / dist) * strength, y: (dy / dist) * strength };
  }, []);

  // ── Game loop ──
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
      const time = Date.now() * 0.003;

      ctx.clearRect(0, 0, W, H);

      /* ── Background ── */
      const bg = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, H);
      bg.addColorStop(0, '#0f2a1f');
      bg.addColorStop(0.5, '#081510');
      bg.addColorStop(1, '#030a07');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      /* ── Maze board ── */
      const bp = 8 * dpr;
      ctx.fillStyle = 'rgba(16,185,129,0.03)';
      ctx.beginPath();
      ctx.roundRect(mazeX - bp, mazeY - bp, mazeSize + bp * 2, mazeSize + bp * 2, 14 * dpr);
      ctx.fill();
      ctx.strokeStyle = 'rgba(16,185,129,0.12)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(mazeX, mazeY, mazeSize, mazeSize);

      /* ── Trap holes ── */
      for (const [tx, ty] of TRAP_POSITIONS) {
        const tp = toCanvas(tx, ty);
        const tr = TRAP_RADIUS * dpr;
        const hg = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, tr * 1.5);
        hg.addColorStop(0, 'rgba(0,0,0,0.8)');
        hg.addColorStop(0.6, 'rgba(0,0,0,0.3)');
        hg.addColorStop(1, 'transparent');
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(tp.x, tp.y, tr * 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a0505';
        ctx.beginPath(); ctx.arc(tp.x, tp.y, tr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(239,68,68,0.35)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }

      /* ── 4 Goal zones ── */
      for (let i = 0; i < GOALS.length; i++) {
        const [gx, gy] = GOALS[i];
        const gp = toCanvas(gx, gy);
        const gr = GOAL_RADIUS * dpr;
        const pulse = 0.5 + Math.sin(time + i * 1.5) * 0.3;
        ctx.save();
        ctx.shadowBlur = 22 * dpr * pulse;
        ctx.shadowColor = GOAL_COLORS[i];
        ctx.fillStyle = GOAL_COLORS[i] + '18';
        ctx.beginPath(); ctx.arc(gp.x, gp.y, gr * 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        const gg = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, gr);
        gg.addColorStop(0, GOAL_COLORS[i] + '40');
        gg.addColorStop(1, GOAL_COLORS[i] + '10');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(gp.x, gp.y, gr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = GOAL_COLORS[i];
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.font = `${gr * 1.1}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(GOAL_EMOJIS[i], gp.x, gp.y);
      }

      /* ── Maze walls ── */
      ctx.strokeStyle = 'rgba(16,185,129,0.55)';
      ctx.lineWidth = WALL_THICKNESS * dpr;
      ctx.lineCap = 'round';
      for (const [x1, y1, x2, y2] of MAZE_WALLS) {
        const p1 = toCanvas(x1, y1);
        const p2 = toCanvas(x2, y2);
        ctx.save();
        ctx.shadowBlur = 5 * dpr;
        ctx.shadowColor = 'rgba(16,185,129,0.15)';
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.restore();
      }

      /* ── Physics ── */
      if (!trappedRef.current) {
        // Update tilt from touch (tracks ball position changes)
        if (touchActiveRef.current) updateTiltFromTouch();

        const tilt = tiltRef.current;
        ball.vx += tilt.x * ACCEL * dpr;
        ball.vy += tilt.y * ACCEL * dpr;
        ball.vx *= FRICTION;
        ball.vy *= FRICTION;

        const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
        if (speed > MAX_SPEED * dpr) {
          const s = (MAX_SPEED * dpr) / speed;
          ball.vx *= s; ball.vy *= s;
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
            const dot = ball.vx * col.nx + ball.vy * col.ny;
            ball.vx -= 1.8 * dot * col.nx;
            ball.vy -= 1.8 * dot * col.ny;
            ball.vx *= 0.5; ball.vy *= 0.5;
            getSoundEngine().peg(Math.floor(Math.random() * 5));
          }
        }

        // Trap collision
        if (trapCooldownRef.current <= 0) {
          for (const [tx, ty] of TRAP_POSITIONS) {
            const tp = toCanvas(tx, ty);
            const dx = ball.x - tp.x, dy = ball.y - tp.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < (TRAP_RADIUS + BALL_RADIUS * 0.5) * dpr) {
              getSoundEngine().miss();
              setTrapHits(h => h + 1);
              trappedRef.current = true;
              trapCooldownRef.current = 60;
              setTimeout(() => { resetBall(); trappedRef.current = false; }, 500);
              break;
            }
          }
        } else { trapCooldownRef.current--; }

        // Goal collision — any of the 4 goals
        for (let i = 0; i < GOALS.length; i++) {
          const gp = toCanvas(GOALS[i][0], GOALS[i][1]);
          const dx = ball.x - gp.x, dy = ball.y - gp.y;
          if (Math.sqrt(dx * dx + dy * dy) < (GOAL_RADIUS + BALL_RADIUS * 0.3) * dpr) {
            getSoundEngine().swish();
            setWonPrize(selectRandomPrize(prizes));
            setPhase('victory');
            if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
            return;
          }
        }

        // Auto-assist after 20s — subtle push toward nearest goal
        const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
        if (elapsedSec > 20) {
          let nearestGoal = GOALS[0];
          let nearestDist = Infinity;
          for (const g of GOALS) {
            const gp = toCanvas(g[0], g[1]);
            const dx = ball.x - gp.x, dy = ball.y - gp.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < nearestDist) { nearestDist = d; nearestGoal = g; }
          }
          const gp = toCanvas(nearestGoal[0], nearestGoal[1]);
          const dx = gp.x - ball.x, dy = gp.y - ball.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 1) {
            const assistForce = Math.min(0.08, (elapsedSec - 20) * 0.004) * dpr;
            ball.vx += (dx / d) * assistForce;
            ball.vy += (dy / d) * assistForce;
          }
        }
      }

      /* ── Draw ball ── */
      const br = BALL_RADIUS * dpr;
      ctx.beginPath();
      ctx.ellipse(ball.x + 2 * dpr, ball.y + 3 * dpr, br * 0.9, br * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();
      const ballGrad = ctx.createRadialGradient(ball.x - br * 0.3, ball.y - br * 0.3, br * 0.1, ball.x, ball.y, br);
      ballGrad.addColorStop(0, '#e0e7ff');
      ballGrad.addColorStop(0.4, '#a5b4fc');
      ballGrad.addColorStop(1, '#6366f1');
      ctx.beginPath(); ctx.arc(ball.x, ball.y, br, 0, Math.PI * 2);
      ctx.fillStyle = trappedRef.current ? 'rgba(239,68,68,0.5)' : ballGrad;
      ctx.fill();
      ctx.beginPath(); ctx.arc(ball.x - br * 0.25, ball.y - br * 0.3, br * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fill();

      /* ── Touch indicator (when touching) ── */
      if (touchActiveRef.current) {
        const tp = touchPosRef.current;
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = ACCENT_FROM;
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 12 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = ACCENT_FROM;
        ctx.stroke();
        ctx.restore();
      }

      /* ── Tilt indicator ── */
      const indX = W / 2;
      const indY = mazeY + mazeSize + 35 * dpr;
      const indR = 18 * dpr;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(indX, indY, indR, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ACCENT_FROM;
      ctx.beginPath();
      ctx.arc(
        indX + tiltRef.current.x * indR * 0.8,
        indY + tiltRef.current.y * indR * 0.8,
        3.5 * dpr, 0, Math.PI * 2
      );
      ctx.fill();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animRef.current);
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [phase, prizes, toCanvas, lineCircleCollide, resetBall, updateTiltFromTouch]);

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center"
      style={{ background: 'radial-gradient(ellipse at 50% 20%, #0f2a1f 0%, #081510 50%, #030a07 100%)' }}
    >
      {/* Header */}
      <div className="w-full max-w-[400px] flex flex-col items-center pt-8 pb-2 z-10" style={{ animation: 'fadeInUp 0.5s ease-out both' }}>
        <h1
          className="text-[24px] font-black tracking-tight text-center"
          style={{ background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          Gyro Maze
        </h1>
        <p className="text-white/30 text-xs mt-1">Guidez la bille vers un des 4 cadeaux 🎁</p>
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
            <div className="flex gap-3 text-4xl" style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}>
              <span>🎁</span><span>🎁</span><span>🎁</span><span>🎁</span>
            </div>
            <h2 className="text-[28px] font-extrabold text-white tracking-tight text-center" style={{ animation: 'fadeInUp 0.6s ease-out both' }}>
              Gyro Maze
            </h2>
            <p className="text-white/35 text-[13px] text-center max-w-[260px] leading-relaxed" style={{ animation: 'fadeInUp 0.6s ease-out 0.1s both' }}>
              Guidez la bille depuis le centre vers l&apos;un des 4 cadeaux sur les bords.<br />
              <span className="text-white/20 text-[11px]">Évitez les trous rouges dans les coins</span>
            </p>
            {hasGyro === false && (
              <p className="text-amber-400/60 text-[11px] text-center" style={{ animation: 'fadeIn 0.5s ease-out 0.3s both' }}>
                Gyroscope non détecté — touchez/glissez pour jouer
              </p>
            )}
            <button
              onClick={startGame}
              className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.96]"
              style={{ background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`, boxShadow: `0 12px 40px -10px ${ACCENT_FROM}80`, animation: 'fadeInUp 0.6s ease-out 0.2s both' }}
            >
              Jouer 🏁
            </button>
          </div>
        </div>
      )}

      {/* Victory */}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} onClose={() => setPhase('ready')} accentFrom={ACCENT_FROM} accentTo={ACCENT_TO} />
      )}
    </div>
  );
}
