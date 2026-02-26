'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   PRECISION SHOT — Moving target shooting
   Tap to shoot at the bullseye. Closer = better prize.
   Always rigged: always gives a prize, but maps
   precision to quality (with bias toward center).
   ═══════════════════════════════════════════════ */

const ACCENT_FROM = '#ef4444';
const ACCENT_TO = '#f59e0b';

const TARGET_RADIUS_BASE = 55; // px at 1x, scales with dpr
const RING_COUNT = 4;
const GAME_ROUNDS = 3; // 3 shots, best counts
const CROSSHAIR_SIZE = 14;

// Target movement patterns
type MovePattern = 'horizontal' | 'diagonal' | 'circle' | 'figure8';
const PATTERNS: MovePattern[] = ['horizontal', 'diagonal', 'circle', 'figure8'];

interface TargetState {
  x: number; y: number;
  pattern: MovePattern;
  speed: number;
  phase: number;       // animation phase
  baseX: number;       // center of movement
  baseY: number;
  amplitudeX: number;
  amplitudeY: number;
}

interface ShotResult {
  x: number; y: number;
  targetX: number; targetY: number;
  distance: number; // 0-1, 0 = perfect center
  rating: 'perfect' | 'great' | 'good' | 'ok';
}

function getRating(dist: number): ShotResult['rating'] {
  if (dist < 0.15) return 'perfect';
  if (dist < 0.35) return 'great';
  if (dist < 0.6) return 'good';
  return 'ok';
}

function getRatingColor(rating: ShotResult['rating']): string {
  switch (rating) {
    case 'perfect': return '#fbbf24';
    case 'great': return '#34d399';
    case 'good': return '#60a5fa';
    case 'ok': return '#a78bfa';
  }
}

function getRatingLabel(rating: ShotResult['rating']): string {
  switch (rating) {
    case 'perfect': return 'PARFAIT !';
    case 'great': return 'EXCELLENT !';
    case 'good': return 'BIEN !';
    case 'ok': return 'OK';
  }
}

export default function PrecisionShot() {
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [shots, setShots] = useState<ShotResult[]>([]);
  const [lastRating, setLastRating] = useState<{ text: string; color: string; key: number } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [showResult, setShowResult] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef<TargetState>({ x: 0, y: 0, pattern: 'horizontal', speed: 1, phase: 0, baseX: 0, baseY: 0, amplitudeX: 0, amplitudeY: 0 });
  const animRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  const canShootRef = useRef(false);
  const roundRef = useRef(0);
  const shotsRef = useRef<ShotResult[]>([]);
  const ratingKeyRef = useRef(0);
  const rippleRef = useRef<{ x: number; y: number; age: number; rating: string } | null>(null);
  const crosshairPulseRef = useRef(0);

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
  }, []);

  const initTarget = useCallback((roundNum: number) => {
    const { w, h } = sizeRef.current;
    const dpr = dprRef.current;
    const pattern = PATTERNS[roundNum % PATTERNS.length];
    const speed = 1 + roundNum * 0.4; // gets faster each round
    const baseX = w * 0.5;
    const baseY = h * 0.4;
    const amplitudeX = w * 0.3;
    const amplitudeY = h * 0.15;

    targetRef.current = {
      x: baseX,
      y: baseY,
      pattern,
      speed,
      phase: Math.random() * Math.PI * 2,
      baseX,
      baseY,
      amplitudeX,
      amplitudeY,
    };
  }, []);

  const startRound = useCallback((roundNum: number) => {
    initTarget(roundNum);
    canShootRef.current = false;

    // Countdown
    setCountdown(3);
    let count = 3;
    const countInterval = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(countInterval);
        canShootRef.current = true;
      }
    }, 600);
  }, [initTarget]);

  const startGame = useCallback(() => {
    setupCanvas();
    setCurrentRound(0);
    roundRef.current = 0;
    setShots([]);
    shotsRef.current = [];
    setWonPrize(null);
    setLastRating(null);
    setShowResult(false);
    rippleRef.current = null;
    setPhase('playing');

    startRound(0);
  }, [setupCanvas, startRound]);

  const determinePrize = useCallback((allShots: ShotResult[]) => {
    // Best shot determines the prize tier
    const bestDist = Math.min(...allShots.map(s => s.distance));
    // Rig it: bias the distance toward better results
    const riggedDist = bestDist * 0.6; // make it always feel good

    // Sort prizes by quantity (rarest first)
    const sorted = [...prizes].sort((a, b) => a.quantity - b.quantity);
    if (sorted.length === 0) return prizes[0];

    // Map distance to prize index
    const idx = Math.min(
      Math.floor(riggedDist * sorted.length),
      sorted.length - 1,
    );
    return sorted[idx];
  }, [prizes]);

  const handleShot = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (phaseRef.current !== 'playing' || !canShootRef.current) return;
    canShootRef.current = false;

    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = dprRef.current;
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const tapX = (cx - rect.left) * dpr;
    const tapY = (cy - rect.top) * dpr;

    const target = targetRef.current;
    const targetR = TARGET_RADIUS_BASE * dpr;

    // Calculate precision
    const dx = tapX - target.x;
    const dy = tapY - target.y;
    const rawDist = Math.sqrt(dx * dx + dy * dy);
    const normalizedDist = Math.min(rawDist / targetR, 1);

    // Rig: if player is reasonably close, make it even closer
    const riggedDist = normalizedDist < 0.8 ? normalizedDist * 0.5 : normalizedDist * 0.7;
    const rating = getRating(riggedDist);

    getSoundEngine().impact();

    const shot: ShotResult = {
      x: tapX, y: tapY,
      targetX: target.x, targetY: target.y,
      distance: riggedDist,
      rating,
    };

    // Ripple effect
    rippleRef.current = { x: tapX, y: tapY, age: 0, rating };

    const newShots = [...shotsRef.current, shot];
    shotsRef.current = newShots;
    setShots(newShots);

    // Show rating
    ratingKeyRef.current++;
    setLastRating({
      text: getRatingLabel(rating),
      color: getRatingColor(rating),
      key: ratingKeyRef.current,
    });

    // Sound based on rating
    if (rating === 'perfect') getSoundEngine().victory();
    else if (rating === 'great') getSoundEngine().reveal();

    const nextRound = roundRef.current + 1;

    if (nextRound >= GAME_ROUNDS) {
      // All rounds done, show results
      setTimeout(() => {
        setShowResult(true);
        setTimeout(() => {
          const prize = determinePrize(newShots);
          setWonPrize(prize);
          setPhase('victory');
        }, 1500);
      }, 800);
    } else {
      // Next round
      setTimeout(() => {
        roundRef.current = nextRound;
        setCurrentRound(nextRound);
        setLastRating(null);
        rippleRef.current = null;
        startRound(nextRound);
      }, 1200);
    }
  }, [determinePrize, startRound]);

  // Game loop — target movement + rendering
  useEffect(() => {
    if (phase !== 'playing') return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const loop = () => {
      if (phaseRef.current !== 'playing') return;
      const { w: W, h: H } = sizeRef.current;
      const dpr = dprRef.current;
      const target = targetRef.current;

      ctx.clearRect(0, 0, W, H);

      /* ── Background ── */
      const bg = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, H);
      bg.addColorStop(0, '#1f0a0a');
      bg.addColorStop(0.5, '#120808');
      bg.addColorStop(1, '#080305');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Subtle crosshair grid
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
      ctx.moveTo(0, H * 0.4); ctx.lineTo(W, H * 0.4);
      ctx.stroke();

      /* ── Update target position ── */
      target.phase += 0.02 * target.speed;
      const t = target.phase;
      switch (target.pattern) {
        case 'horizontal':
          target.x = target.baseX + Math.sin(t) * target.amplitudeX;
          target.y = target.baseY + Math.sin(t * 0.3) * target.amplitudeY * 0.3;
          break;
        case 'diagonal':
          target.x = target.baseX + Math.sin(t) * target.amplitudeX * 0.8;
          target.y = target.baseY + Math.cos(t * 0.7) * target.amplitudeY;
          break;
        case 'circle':
          target.x = target.baseX + Math.cos(t) * target.amplitudeX * 0.7;
          target.y = target.baseY + Math.sin(t) * target.amplitudeY;
          break;
        case 'figure8':
          target.x = target.baseX + Math.sin(t) * target.amplitudeX;
          target.y = target.baseY + Math.sin(t * 2) * target.amplitudeY * 0.6;
          break;
      }

      /* ── Draw target ── */
      const R = TARGET_RADIUS_BASE * dpr;
      const ringColors = ['#ef4444', '#f97316', '#fbbf24', '#fef3c7'];

      // Outer glow
      ctx.save();
      ctx.shadowBlur = 30 * dpr;
      ctx.shadowColor = 'rgba(239,68,68,0.3)';

      for (let i = 0; i < RING_COUNT; i++) {
        const ringR = R * (1 - i / RING_COUNT);
        ctx.beginPath();
        ctx.arc(target.x, target.y, ringR, 0, Math.PI * 2);
        ctx.fillStyle = ringColors[i] + (i === RING_COUNT - 1 ? '' : '40');
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      }

      // Bullseye center
      ctx.beginPath();
      ctx.arc(target.x, target.y, R * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = '#fef3c7';
      ctx.fill();

      ctx.restore();

      // Crosshair lines on target
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(target.x - R * 1.2, target.y);
      ctx.lineTo(target.x - R * 0.3, target.y);
      ctx.moveTo(target.x + R * 0.3, target.y);
      ctx.lineTo(target.x + R * 1.2, target.y);
      ctx.moveTo(target.x, target.y - R * 1.2);
      ctx.lineTo(target.x, target.y - R * 0.3);
      ctx.moveTo(target.x, target.y + R * 0.3);
      ctx.lineTo(target.x, target.y + R * 1.2);
      ctx.stroke();

      /* ── Ripple effect (shot impact) ── */
      if (rippleRef.current) {
        const rip = rippleRef.current;
        rip.age += 0.03;
        if (rip.age < 1) {
          const ripR = R * 1.5 * rip.age;
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, ripR, 0, Math.PI * 2);
          ctx.strokeStyle = `${getRatingColor(rip.rating as ShotResult['rating'])}${Math.round((1 - rip.age) * 255).toString(16).padStart(2, '0')}`;
          ctx.lineWidth = 3 * dpr * (1 - rip.age);
          ctx.stroke();

          // Impact dot
          const dotR = 5 * dpr * (1 - rip.age * 0.5);
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = getRatingColor(rip.rating as ShotResult['rating']);
          ctx.fill();
        }
      }

      /* ── Crosshair cursor (pulsing) ── */
      crosshairPulseRef.current += 0.05;
      const pulse = 1 + Math.sin(crosshairPulseRef.current) * 0.15;
      const chSize = CROSSHAIR_SIZE * dpr * pulse;

      // Draw at screen center as aiming guide
      const chX = W / 2;
      const chY = H * 0.4;
      ctx.strokeStyle = canShootRef.current ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(chX - chSize, chY);
      ctx.lineTo(chX - chSize * 0.3, chY);
      ctx.moveTo(chX + chSize * 0.3, chY);
      ctx.lineTo(chX + chSize, chY);
      ctx.moveTo(chX, chY - chSize);
      ctx.lineTo(chX, chY - chSize * 0.3);
      ctx.moveTo(chX, chY + chSize * 0.3);
      ctx.lineTo(chX, chY + chSize);
      ctx.stroke();

      /* ── HUD: Round dots at bottom ── */
      const dotY = H * 0.88;
      for (let i = 0; i < GAME_ROUNDS; i++) {
        const dotX = W / 2 + (i - (GAME_ROUNDS - 1) / 2) * 28 * dpr;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 5 * dpr, 0, Math.PI * 2);
        if (i < shotsRef.current.length) {
          ctx.fillStyle = getRatingColor(shotsRef.current[i].rating);
        } else if (i === roundRef.current) {
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
        }
        ctx.fill();
      }

      /* ── "TAP!" instruction ── */
      if (canShootRef.current) {
        const time = Date.now() * 0.004;
        ctx.save();
        ctx.globalAlpha = 0.4 + Math.sin(time) * 0.2;
        ctx.font = `bold ${12 * dpr}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('TAPEZ pour tirer !', W / 2, H * 0.7);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase]);

  // Cleanup
  useEffect(() => {
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const bestRating = shots.length > 0
    ? shots.reduce((best, s) => s.distance < best.distance ? s : best, shots[0])
    : null;

  return (
    <div className="game-container" style={{ background: '#0a0305' }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onClick={handleShot}
        onTouchStart={handleShot}
      />

      {/* Title overlay when playing */}
      {phase === 'playing' && (
        <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-8 z-10 pointer-events-none">
          <h1
            className="text-[20px] font-black tracking-wider uppercase"
            style={{
              background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Tir de Précision
          </h1>
          <span className="text-white/30 text-[11px] mt-1 font-semibold tracking-wider uppercase">
            Round {currentRound + 1}/{GAME_ROUNDS}
          </span>
        </div>
      )}

      {/* Countdown */}
      {phase === 'playing' && countdown > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <span
            className="text-[80px] font-black text-white/20"
            style={{ animation: 'scaleIn 0.4s ease-out both' }}
            key={countdown}
          >
            {countdown}
          </span>
        </div>
      )}

      {/* Rating popup */}
      {lastRating && (
        <div
          key={lastRating.key}
          className="absolute top-[30%] left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          style={{ animation: 'fadeInUp 0.3s ease-out both' }}
        >
          <span className="text-2xl font-black" style={{ color: lastRating.color }}>
            {lastRating.text}
          </span>
        </div>
      )}

      {/* Result summary */}
      {showResult && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none"
          style={{ animation: 'fadeIn 0.5s ease-out both' }}
        >
          <div className="glass rounded-2xl p-6 flex flex-col items-center gap-3">
            <span className="text-white/40 text-[11px] font-semibold tracking-wider uppercase">Meilleur tir</span>
            {bestRating && (
              <span className="text-3xl font-black" style={{ color: getRatingColor(bestRating.rating) }}>
                {getRatingLabel(bestRating.rating)}
              </span>
            )}
            <div className="flex gap-3 mt-1">
              {shots.map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-4 h-4 rounded-full" style={{ background: getRatingColor(s.rating) }} />
                  <span className="text-[9px] text-white/30">R{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: '#0a0305' }}>
          <div className="w-8 h-8 border-2 border-white/20 border-t-red-400 rounded-full" style={{ animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {/* Ready screen */}
      {phase === 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 30%, #1f0a0a 0%, #120808 50%, #080305 100%)' }} />
          <div className="relative z-10 flex flex-col items-center gap-5 px-8">
            <div className="relative" style={{ animation: 'victoryFloat 3s ease-in-out infinite' }}>
              <div className="text-6xl">🎯</div>
            </div>
            <h2 className="text-[28px] font-extrabold text-white tracking-tight text-center" style={{ animation: 'fadeInUp 0.6s ease-out both' }}>
              Tir de Précision
            </h2>
            <p className="text-white/35 text-[13px] text-center max-w-[260px] leading-relaxed" style={{ animation: 'fadeInUp 0.6s ease-out 0.1s both' }}>
              La cible bouge — tapez au bon moment !<br />
              <span className="text-white/20 text-[11px]">3 tirs · Plus vous êtes précis, meilleur est le cadeau</span>
            </p>
            <button
              onClick={startGame}
              className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.96]"
              style={{
                background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                boxShadow: `0 12px 40px -10px ${ACCENT_FROM}80`,
                animation: 'fadeInUp 0.6s ease-out 0.2s both',
              }}
            >
              Viser 🎯
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
