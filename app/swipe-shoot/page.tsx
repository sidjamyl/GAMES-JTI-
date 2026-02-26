'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   SWIPE & SHOOT — Basketball Flick
   Flick the ball into the hoop. Arc trajectory.
   Always rigged: ball curves into the basket.
   ═══════════════════════════════════════════════ */

const GRAVITY = 0.35;
const BALL_RADIUS = 18;
const HOOP_Y_PCT = 0.22;     // hoop at 22% from top
const BALL_START_Y_PCT = 0.78; // ball starts at 78% from top
const MAGNET_ZONE = 0.45;     // y threshold to start magnetizing
const MAGNET_FORCE = 0.06;

const ACCENT_FROM = '#3b82f6';
const ACCENT_TO = '#8b5cf6';

interface Ball {
  x: number; y: number;
  vx: number; vy: number;
  active: boolean;
  trail: { x: number; y: number; alpha: number }[];
  rotation: number;
}

interface SwipeStart {
  x: number; y: number; t: number;
}

export default function SwipeShoot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [showSwish, setShowSwish] = useState(false);

  const ballRef = useRef<Ball>({ x: 0, y: 0, vx: 0, vy: 0, active: false, trail: [], rotation: 0 });
  const hoopRef = useRef({ x: 0, y: 0, rimW: 0 });
  const targetPrizeRef = useRef<Prize | null>(null);
  const animRef = useRef<number>(0);
  const swipeRef = useRef<SwipeStart | null>(null);
  const dprRef = useRef(1);
  const phaseRef = useRef<GamePhase>('loading');
  const sizeRef = useRef({ w: 0, h: 0 });
  const netSwayRef = useRef(0);
  const scoreAnimRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    fetchPrizes().then((p) => {
      setPrizes(p);
      setPhase('ready');
    });
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
    sizeRef.current = { w, h };

    // Position hoop
    hoopRef.current = {
      x: w / 2,
      y: h * HOOP_Y_PCT,
      rimW: Math.min(w * 0.28, 120 * dpr),
    };
  }, []);

  const resetBall = useCallback(() => {
    const { w, h } = sizeRef.current;
    const dpr = dprRef.current;
    ballRef.current = {
      x: w / 2,
      y: h * BALL_START_Y_PCT,
      vx: 0, vy: 0,
      active: false,
      trail: [],
      rotation: 0,
    };
  }, []);

  /* ── Render loop ── */
  const startLoop = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { w: W, h: H } = sizeRef.current;
    const dpr = dprRef.current;

    const loop = () => {
      ctx.clearRect(0, 0, W, H);

      /* ─ Background ─ */
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b1023');
      bg.addColorStop(0.4, '#111638');
      bg.addColorStop(1, '#1a1045');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      /* ─ Court floor ─ */
      const floorY = H * 0.88;
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(0, floorY, W, H - floorY);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(W, floorY);
      ctx.stroke();

      /* ─ Center court circle ─ */
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.55, W * 0.25, 0, Math.PI * 2);
      ctx.stroke();

      const hoop = hoopRef.current;
      const ball = ballRef.current;

      /* ─ Backboard ─ */
      const backboardX = hoop.x + hoop.rimW / 2 + 5 * dpr;
      const backboardH = hoop.rimW * 0.9;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(backboardX, hoop.y - backboardH * 0.4, 4 * dpr, backboardH);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(backboardX, hoop.y - backboardH * 0.4, 4 * dpr, backboardH);

      // Backboard square
      const sqSize = hoop.rimW * 0.35;
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(backboardX - sqSize - 2 * dpr, hoop.y - sqSize * 0.4, sqSize, sqSize * 0.8);

      /* ─ Pole ─ */
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(backboardX + 1 * dpr, hoop.y + backboardH * 0.5, 3 * dpr, floorY - (hoop.y + backboardH * 0.5));

      /* ─ Rim ─ */
      const rimLeft = hoop.x - hoop.rimW / 2;
      const rimRight = hoop.x + hoop.rimW / 2;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(rimLeft, hoop.y);
      ctx.lineTo(rimRight, hoop.y);
      ctx.stroke();

      // Rim caps
      [rimLeft, rimRight].forEach(rx => {
        ctx.beginPath();
        ctx.arc(rx, hoop.y, 4 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
      });

      /* ─ Net ─ */
      const netDepth = hoop.rimW * 0.55;
      const netSegments = 6;
      const sway = Math.sin(netSwayRef.current) * 3 * dpr;
      netSwayRef.current += (ball.active ? 0.08 : 0.02);

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1 * dpr;
      for (let i = 0; i <= netSegments; i++) {
        const t = i / netSegments;
        const topX = rimLeft + (rimRight - rimLeft) * t;
        const bottomX = hoop.x + (topX - hoop.x) * 0.5 + sway;
        ctx.beginPath();
        ctx.moveTo(topX, hoop.y);
        ctx.quadraticCurveTo(
          (topX + bottomX) / 2 + Math.sin(t * Math.PI + netSwayRef.current) * 4 * dpr,
          hoop.y + netDepth * 0.6,
          bottomX,
          hoop.y + netDepth
        );
        ctx.stroke();
      }
      // Horizontal net lines
      for (let j = 1; j <= 3; j++) {
        const ny = hoop.y + (netDepth * j) / 4;
        const shrink = j / 4;
        const nleft = rimLeft + (hoop.x - rimLeft) * shrink * 0.5 + sway * shrink;
        const nright = rimRight - (rimRight - hoop.x) * shrink * 0.5 + sway * shrink;
        ctx.beginPath();
        ctx.moveTo(nleft, ny);
        ctx.lineTo(nright, ny);
        ctx.stroke();
      }

      /* ─ Hoop glow ─ */
      ctx.save();
      ctx.shadowBlur = 20 * dpr;
      ctx.shadowColor = 'rgba(239,68,68,0.3)';
      ctx.strokeStyle = 'rgba(239,68,68,0.15)';
      ctx.lineWidth = 8 * dpr;
      ctx.beginPath();
      ctx.moveTo(rimLeft, hoop.y);
      ctx.lineTo(rimRight, hoop.y);
      ctx.stroke();
      ctx.restore();

      /* ─ Ball physics ─ */
      if (ball.active) {
        ball.vy += GRAVITY * dpr;
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.rotation += ball.vx * 0.02;

        // Magnetic correction toward hoop
        if (ball.y < H * MAGNET_ZONE && ball.vy < 0) {
          const dx = hoop.x - ball.x;
          ball.vx += dx * MAGNET_FORCE;
        }

        // Trail
        ball.trail.push({ x: ball.x, y: ball.y, alpha: 1 });
        if (ball.trail.length > 15) ball.trail.shift();
        ball.trail.forEach(t => { t.alpha *= 0.88; });

        // Wall bounce
        const r = BALL_RADIUS * dpr;
        if (ball.x - r < 0) { ball.x = r; ball.vx *= -0.5; }
        if (ball.x + r > W) { ball.x = W - r; ball.vx *= -0.5; }

        // Hoop scoring detection
        if (
          ball.vy > 0 &&
          ball.y > hoop.y - 5 * dpr && ball.y < hoop.y + 20 * dpr &&
          ball.x > rimLeft + 8 * dpr && ball.x < rimRight - 8 * dpr
        ) {
          // SCORE!
          ball.active = false;
          getSoundEngine().swish();
          setShowSwish(true);
          setTimeout(() => setShowSwish(false), 1000);
          netSwayRef.current += 2; // big net sway

          // Always win
          if (targetPrizeRef.current) {
            setWonPrize(targetPrizeRef.current);
            setTimeout(() => {
              if (phaseRef.current === 'playing') setPhase('victory');
            }, 1100);
          }
        }

        // Backboard bounce
        if (
          ball.x + r > backboardX && ball.x - r < backboardX + 4 * dpr &&
          ball.y > hoop.y - backboardH * 0.4 && ball.y < hoop.y + backboardH * 0.6
        ) {
          ball.vx = -Math.abs(ball.vx) * 0.6;
          ball.x = backboardX - r;
          getSoundEngine().impact();
        }

        // Rim bounce
        [rimLeft, rimRight].forEach(rx => {
          const dx = ball.x - rx;
          const dy = ball.y - hoop.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < r + 4 * dpr) {
            const nx = dx / dist;
            const ny = dy / dist;
            const dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 1.5 * dot * nx;
            ball.vy -= 1.5 * dot * ny;
            ball.x = rx + nx * (r + 5 * dpr);
            ball.y = hoop.y + ny * (r + 5 * dpr);
            getSoundEngine().peg(0);
          }
        });

        // Off screen bottom — rig: reset and redirect
        if (ball.y > H + 60 * dpr) {
          ball.active = false;
          // Give them another chance but rig harder
          setAttempts(a => a + 1);
          resetBall();
        }

        // Off screen top — rig: add downward velocity
        if (ball.y < -100 * dpr && ball.vy < 0) {
          ball.vy = Math.abs(ball.vy) * 0.3;
          ball.vx += (hoop.x - ball.x) * 0.05;
        }
      }

      /* ─ Draw trail ─ */
      for (const t of ball.trail) {
        if (t.alpha < 0.05) continue;
        const size = BALL_RADIUS * dpr * t.alpha * 0.8;
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(2, size), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(251,191,36,${t.alpha * 0.3})`;
        ctx.fill();
      }

      /* ─ Draw ball ─ */
      const r = BALL_RADIUS * dpr;
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.rotation);

      // Ball shadow
      ctx.save();
      ctx.translate(3 * dpr, 4 * dpr);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fill();
      ctx.restore();

      // Ball body (basketball texture)
      const ballGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      ballGrad.addColorStop(0, '#fcd34d');
      ballGrad.addColorStop(0.5, '#f59e0b');
      ballGrad.addColorStop(1, '#b45309');
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();

      // Ball lines
      ctx.strokeStyle = 'rgba(120,53,15,0.3)';
      ctx.lineWidth = 1.5 * dpr;
      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      ctx.stroke();
      // Vertical line
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();
      // Curved line
      ctx.beginPath();
      ctx.arc(-r * 0.25, 0, r * 0.8, -0.8, 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.25, 0, r * 0.8, Math.PI - 0.8, Math.PI + 0.8);
      ctx.stroke();

      // Highlight
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.25, r * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();

      ctx.restore();

      /* ─ Swipe instruction ─ */
      if (!ball.active && phaseRef.current === 'playing') {
        const time = Date.now() * 0.003;
        const bob = Math.sin(time) * 5 * dpr;
        ctx.save();
        ctx.globalAlpha = 0.4 + Math.sin(time * 2) * 0.15;
        ctx.font = `600 ${13 * dpr}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('↑ Swipez vers le panier', W / 2, ball.y + 55 * dpr + bob);
        ctx.restore();

        // Draw aim arc preview
        ctx.save();
        ctx.setLineDash([6 * dpr, 6 * dpr]);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.quadraticCurveTo(ball.x, (ball.y + hoop.y) / 2 - 40 * dpr, hoop.x, hoop.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [resetBall]);

  const start = useCallback(() => {
    setupCanvas();
    resetBall();
    setWonPrize(null);
    setAttempts(0);
    setShowSwish(false);

    // Pre-select winning prize
    const prize = selectRandomPrize(prizes);
    targetPrizeRef.current = prize;

    setPhase('playing');
    setTimeout(() => startLoop(), 50);

    return () => cancelAnimationFrame(animRef.current);
  }, [prizes, setupCanvas, resetBall, startLoop]);

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

    if (dy < -15 * dpr) {
      const speed = Math.min(Math.abs(dy) / dt, 3) * 7 * dpr;
      const ball = ballRef.current;
      ball.vx = (dx / dt) * 4 * dpr;
      ball.vy = -speed;
      ball.active = true;
      ball.trail = [];
      ball.rotation = 0;
      getSoundEngine().swoosh();
    }
    swipeRef.current = null;
  };

  // Cleanup
  useEffect(() => {
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div className="game-container" style={{ background: '#0b1023' }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onTouchStart={onPointerDown}
        onTouchEnd={onPointerUp}
        onMouseDown={onPointerDown}
        onMouseUp={onPointerUp}
      />

      {/* Swish effect */}
      {showSwish && (
        <div
          className="absolute top-[18%] left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          style={{ animation: 'fadeInUp 0.3s ease-out both' }}
        >
          <span
            className="text-3xl font-black tracking-tight"
            style={{
              background: 'linear-gradient(135deg, #fbbf24, #ef4444)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textShadow: 'none',
            }}
          >
            SWISH! 🔥
          </span>
        </div>
      )}

      {/* Score / attempts counter */}
      {phase === 'playing' && attempts > 0 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10">
          <span className="text-xs font-semibold text-white/30">
            Tentative {attempts + 1}
          </span>
        </div>
      )}

      {/* Ready overlay */}
      {phase === 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, #0b1023, #111638, #1a1045)' }} />
          <div className="relative z-10 flex flex-col items-center gap-6 px-8">
            <div className="text-7xl" style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}>🏀</div>
            <h1 className="text-[32px] font-extrabold text-white tracking-tight text-center" style={{ animation: 'fadeInUp 0.6s ease-out both' }}>
              Swipe & Shoot
            </h1>
            <p className="text-white/40 text-[14px] leading-relaxed text-center max-w-[280px]" style={{ animation: 'fadeInUp 0.6s ease-out 0.1s both' }}>
              Lancez le ballon dans le panier<br />pour gagner votre cadeau !
            </p>
            <button
              onClick={start}
              className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all duration-200 active:scale-[0.96]"
              style={{
                background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                boxShadow: `0 12px 40px -10px rgba(99,102,241,0.5)`,
                animation: 'fadeInUp 0.6s ease-out 0.2s both',
              }}
            >
              Lancer le jeu 🏀
            </button>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: '#0b1023' }}>
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full" style={{ animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {phase === 'victory' && wonPrize && (
        <VictoryScreen
          prize={wonPrize}
          onClose={() => {
            cancelAnimationFrame(animRef.current);
            setPhase('ready');
          }}
          accentFrom={ACCENT_FROM}
          accentTo={ACCENT_TO}
        />
      )}
    </div>
  );
}
