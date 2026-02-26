'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   SWIPE & SHOOT — Basketball with 3 hoops
   Flick the ball into any of the 3 hoops.
   Swipe direction determines target.
   Always rigged: ball curves into a basket.
   ═══════════════════════════════════════════════ */

const GRAVITY = 0.22;
const BALL_RADIUS = 16;
const BALL_START_Y_PCT = 0.82;
const MAGNET_FORCE = 0.045;

const ACCENT_FROM = '#3b82f6';
const ACCENT_TO = '#8b5cf6';

interface HoopDef {
  xPct: number;
  yPct: number;
  rimWPct: number;
  color: string;
  label: string;
}

const HOOP_DEFS: HoopDef[] = [
  { xPct: 0.18, yPct: 0.32, rimWPct: 0.22, color: '#ef4444', label: '🔴' },
  { xPct: 0.50, yPct: 0.20, rimWPct: 0.20, color: '#fbbf24', label: '🟡' },
  { xPct: 0.82, yPct: 0.32, rimWPct: 0.22, color: '#3b82f6', label: '🔵' },
];

interface Hoop {
  x: number; y: number;
  rimW: number;
  color: string;
}

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
  const [swishPos, setSwishPos] = useState<{ x: number; y: number } | null>(null);

  const ballRef = useRef<Ball>({ x: 0, y: 0, vx: 0, vy: 0, active: false, trail: [], rotation: 0 });
  const hoopsRef = useRef<Hoop[]>([]);
  const targetPrizeRef = useRef<Prize | null>(null);
  const targetHoopRef = useRef(0);
  const animRef = useRef<number>(0);
  const swipeRef = useRef<SwipeStart | null>(null);
  const dprRef = useRef(1);
  const phaseRef = useRef<GamePhase>('loading');
  const sizeRef = useRef({ w: 0, h: 0 });
  const netSwayRef = useRef([0, 0, 0]);
  const scoredRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); });
  }, []);

  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = c.offsetWidth * dpr;
    const h = c.offsetHeight * dpr;
    c.width = w; c.height = h;
    sizeRef.current = { w, h };

    hoopsRef.current = HOOP_DEFS.map(def => ({
      x: w * def.xPct,
      y: h * def.yPct,
      rimW: Math.min(w * def.rimWPct, 100 * dpr),
      color: def.color,
    }));
  }, []);

  const resetBall = useCallback(() => {
    const { w, h } = sizeRef.current;
    ballRef.current = {
      x: w / 2, y: h * BALL_START_Y_PCT,
      vx: 0, vy: 0,
      active: false, trail: [], rotation: 0,
    };
    scoredRef.current = false;
  }, []);

  /* ── Render loop ── */
  const startLoop = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { w: W, h: H } = sizeRef.current;
    const dpr = dprRef.current;
    const hoops = hoopsRef.current;

    const loop = () => {
      ctx.clearRect(0, 0, W, H);

      /* ── Background ── */
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b1023');
      bg.addColorStop(0.35, '#111638');
      bg.addColorStop(1, '#1a1045');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      /* ── Court floor ── */
      const floorY = H * 0.9;
      ctx.fillStyle = 'rgba(255,255,255,0.015)';
      ctx.fillRect(0, floorY, W, H - floorY);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W, floorY); ctx.stroke();

      /* ── Court decorations ── */
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(W / 2, H * 0.58, W * 0.18, 0, Math.PI * 2); ctx.stroke();

      const ball = ballRef.current;

      /* ── Draw each hoop ── */
      for (let hi = 0; hi < hoops.length; hi++) {
        const hoop = hoops[hi];
        const rimLeft = hoop.x - hoop.rimW / 2;
        const rimRight = hoop.x + hoop.rimW / 2;
        const netDepth = hoop.rimW * 0.55;
        const sway = Math.sin(netSwayRef.current[hi]) * 2.5 * dpr;

        /* Backboard */
        const bbX = hoop.x + hoop.rimW / 2 + 4 * dpr;
        const bbH = hoop.rimW * 0.85;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(bbX, hoop.y - bbH * 0.4, 3.5 * dpr, bbH);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(bbX, hoop.y - bbH * 0.4, 3.5 * dpr, bbH);

        /* Backboard square */
        const sqS = hoop.rimW * 0.3;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(bbX - sqS - 2 * dpr, hoop.y - sqS * 0.4, sqS, sqS * 0.7);

        /* Pole */
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(bbX + 1 * dpr, hoop.y + bbH * 0.5, 2.5 * dpr, floorY - (hoop.y + bbH * 0.5));

        /* Rim */
        ctx.strokeStyle = hoop.color;
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath(); ctx.moveTo(rimLeft, hoop.y); ctx.lineTo(rimRight, hoop.y); ctx.stroke();
        [rimLeft, rimRight].forEach(rx => {
          ctx.beginPath(); ctx.arc(rx, hoop.y, 3.5 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = hoop.color; ctx.fill();
        });

        /* Net */
        netSwayRef.current[hi] += (ball.active && !scoredRef.current ? 0.06 : 0.015);
        const segs = 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.8 * dpr;
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const topX = rimLeft + (rimRight - rimLeft) * t;
          const bottomX = hoop.x + (topX - hoop.x) * 0.45 + sway;
          ctx.beginPath();
          ctx.moveTo(topX, hoop.y);
          ctx.quadraticCurveTo(
            (topX + bottomX) / 2 + Math.sin(t * Math.PI + netSwayRef.current[hi]) * 3.5 * dpr,
            hoop.y + netDepth * 0.6,
            bottomX,
            hoop.y + netDepth
          );
          ctx.stroke();
        }
        for (let j = 1; j <= 3; j++) {
          const ny = hoop.y + (netDepth * j) / 4;
          const shrink = j / 4;
          ctx.beginPath();
          ctx.moveTo(rimLeft + (hoop.x - rimLeft) * shrink * 0.5 + sway * shrink, ny);
          ctx.lineTo(rimRight - (rimRight - hoop.x) * shrink * 0.5 + sway * shrink, ny);
          ctx.stroke();
        }

        /* Rim glow */
        ctx.save();
        ctx.shadowBlur = 16 * dpr;
        ctx.shadowColor = hoop.color + '40';
        ctx.strokeStyle = hoop.color + '18';
        ctx.lineWidth = 7 * dpr;
        ctx.beginPath(); ctx.moveTo(rimLeft, hoop.y); ctx.lineTo(rimRight, hoop.y); ctx.stroke();
        ctx.restore();
      }

      /* ── Ball physics ── */
      if (ball.active && !scoredRef.current) {
        ball.vy += GRAVITY * dpr;
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.rotation += ball.vx * 0.02;

        // Determine target hoop for magnetic assist
        const tHoop = hoops[targetHoopRef.current];

        // Magnetic correction when in upper zone
        if (ball.y < H * 0.5 && ball.vy < 2 * dpr) {
          const dx = tHoop.x - ball.x;
          const dy = tHoop.y - ball.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1) {
            ball.vx += (dx / dist) * MAGNET_FORCE * dpr;
            ball.vy += (dy / dist) * MAGNET_FORCE * 0.3 * dpr;
          }
        }

        // Trail
        ball.trail.push({ x: ball.x, y: ball.y, alpha: 1 });
        if (ball.trail.length > 14) ball.trail.shift();
        ball.trail.forEach(t => { t.alpha *= 0.87; });

        // Wall bounce
        const r = BALL_RADIUS * dpr;
        if (ball.x - r < 0) { ball.x = r; ball.vx *= -0.5; }
        if (ball.x + r > W) { ball.x = W - r; ball.vx *= -0.5; }

        // Check scoring with each hoop
        for (let hi = 0; hi < hoops.length; hi++) {
          const hoop = hoops[hi];
          const rimLeft = hoop.x - hoop.rimW / 2;
          const rimRight = hoop.x + hoop.rimW / 2;
          const bbX = hoop.x + hoop.rimW / 2 + 4 * dpr;

          // Score detection
          if (
            ball.vy > 0 &&
            ball.y > hoop.y - 4 * dpr && ball.y < hoop.y + 18 * dpr &&
            ball.x > rimLeft + 6 * dpr && ball.x < rimRight - 6 * dpr
          ) {
            scoredRef.current = true;
            ball.active = false;
            getSoundEngine().swish();
            setShowSwish(true);
            setSwishPos({ x: hoop.x / dpr, y: hoop.y / dpr });
            netSwayRef.current[hi] += 3;
            setTimeout(() => setShowSwish(false), 1000);
            if (targetPrizeRef.current) {
              setWonPrize(targetPrizeRef.current);
              setTimeout(() => { if (phaseRef.current === 'playing') setPhase('victory'); }, 1100);
            }
            break;
          }

          // Backboard bounce
          if (
            ball.x + r > bbX && ball.x - r < bbX + 4 * dpr &&
            ball.y > hoop.y - hoop.rimW * 0.35 && ball.y < hoop.y + hoop.rimW * 0.45
          ) {
            ball.vx = -Math.abs(ball.vx) * 0.55;
            ball.x = bbX - r;
            getSoundEngine().impact();
          }

          // Rim bounce
          [rimLeft, rimRight].forEach(rx => {
            const dx = ball.x - rx;
            const dy = ball.y - hoop.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < r + 3.5 * dpr) {
              const nx = dx / dist, ny = dy / dist;
              const dot = ball.vx * nx + ball.vy * ny;
              ball.vx -= 1.6 * dot * nx;
              ball.vy -= 1.6 * dot * ny;
              ball.x = rx + nx * (r + 4 * dpr);
              ball.y = hoop.y + ny * (r + 4 * dpr);
              ball.vx *= 0.85;
              ball.vy *= 0.85;
              getSoundEngine().peg(hi);
            }
          });
        }

        // Off screen — reset and rig harder
        if (ball.y > H + 50 * dpr) {
          ball.active = false;
          setAttempts(a => a + 1);
          resetBall();
        }
        if (ball.y < -100 * dpr && ball.vy < 0) {
          ball.vy = Math.abs(ball.vy) * 0.3;
          const tH = hoops[targetHoopRef.current];
          ball.vx += (tH.x - ball.x) * 0.06;
        }
      }

      /* ── Draw trail ── */
      for (const t of ball.trail) {
        if (t.alpha < 0.05) continue;
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(2, BALL_RADIUS * dpr * t.alpha * 0.7), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(251,191,36,${t.alpha * 0.25})`;
        ctx.fill();
      }

      /* ── Draw ball ── */
      const r = BALL_RADIUS * dpr;
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.rotation);

      // Shadow
      ctx.save();
      ctx.translate(3 * dpr, 4 * dpr);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
      ctx.restore();

      // Body
      const ballGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      ballGrad.addColorStop(0, '#fcd34d');
      ballGrad.addColorStop(0.5, '#f59e0b');
      ballGrad.addColorStop(1, '#b45309');
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad; ctx.fill();

      // Lines
      ctx.strokeStyle = 'rgba(120,53,15,0.3)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 0.25, 0, r * 0.8, -0.8, 0.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 0.25, 0, r * 0.8, Math.PI - 0.8, Math.PI + 0.8); ctx.stroke();

      // Highlight
      ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.25, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
      ctx.restore();

      /* ── Swipe instruction ── */
      if (!ball.active && phaseRef.current === 'playing' && !scoredRef.current) {
        const time = Date.now() * 0.003;
        const bob = Math.sin(time) * 4 * dpr;
        ctx.save();
        ctx.globalAlpha = 0.35 + Math.sin(time * 2) * 0.12;
        ctx.font = `600 ${12 * dpr}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('↑ Swipez vers un panier', W / 2, ball.y + 50 * dpr + bob);
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
    if (phase !== 'playing' || ballRef.current.active || scoredRef.current) return;
    const pos = getPos(e);
    swipeRef.current = { x: pos.x, y: pos.y, t: Date.now() };
  };

  const onPointerUp = (e: React.TouchEvent | React.MouseEvent) => {
    if (!swipeRef.current || phase !== 'playing' || ballRef.current.active || scoredRef.current) return;
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

    if (dy < -12 * dpr) {
      const speed = Math.min(Math.abs(dy) / dt, 2.5) * 6; // smoother velocity
      const ball = ballRef.current;
      ball.vx = (dx / dt) * 3.5 * dpr;
      ball.vy = -speed * dpr;
      ball.active = true;
      ball.trail = [];
      ball.rotation = 0;
      getSoundEngine().swoosh();

      // Determine target hoop based on horizontal direction
      const { w } = sizeRef.current;
      const hoops = hoopsRef.current;
      if (ball.x + ball.vx * 10 < w * 0.35) targetHoopRef.current = 0;       // Left
      else if (ball.x + ball.vx * 10 > w * 0.65) targetHoopRef.current = 2;   // Right
      else targetHoopRef.current = 1;                                           // Center

      // Rig: adjust velocity to ensure reasonable trajectory toward target
      const tHoop = hoops[targetHoopRef.current];
      const tdx = tHoop.x - ball.x;
      ball.vx = ball.vx * 0.55 + tdx * 0.015 * dpr;
    }
    swipeRef.current = null;
  };

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

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
      {showSwish && swishPos && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{
            left: `${swishPos.x}px`,
            top: `${swishPos.y - 30}px`,
            transform: 'translateX(-50%)',
            animation: 'fadeInUp 0.3s ease-out both',
          }}
        >
          <span
            className="text-2xl font-black tracking-tight"
            style={{
              background: 'linear-gradient(135deg, #fbbf24, #ef4444)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}
          >
            SWISH! 🔥
          </span>
        </div>
      )}

      {/* Attempts counter */}
      {phase === 'playing' && attempts > 0 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10">
          <span className="text-xs font-semibold text-white/30">Tentative {attempts + 1}</span>
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
              Lancez le ballon dans l&apos;un des 3 paniers<br />pour gagner votre cadeau !
            </p>
            <div className="flex gap-3 text-sm" style={{ animation: 'fadeIn 0.5s ease-out 0.15s both' }}>
              <span className="text-red-400/60">🔴 Gauche</span>
              <span className="text-yellow-400/60">🟡 Centre</span>
              <span className="text-blue-400/60">🔵 Droite</span>
            </div>
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
          onClose={() => { cancelAnimationFrame(animRef.current); setPhase('ready'); }}
          accentFrom={ACCENT_FROM}
          accentTo={ACCENT_TO}
        />
      )}
    </div>
  );
}
