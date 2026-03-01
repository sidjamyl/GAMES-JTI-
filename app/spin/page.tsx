'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import Link from 'next/link';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   SPIN & WIN — Wheel of Fortune
   Proportional slices based on prize quantities.
   Each slice shows emoji + product name.
   ═══════════════════════════════════════════════ */

const FRICTION = 0.985;          // per-frame multiplier (lower = stops faster)
const MIN_VELOCITY = 0.001;      // rad/frame — below this → stopped
const MIN_SPINS = 4;             // minimum full rotations
const MAX_EXTRA_SPINS = 3;       // random extra rotations on top
const POINTER_ANGLE = -Math.PI / 2; // pointer at top (12 o'clock)

interface Slice {
  prize: Prize;
  startAngle: number;
  endAngle: number;
  color: string;
}

export default function Spin({ theme }: { theme?: GameTheme }) {
  const {
    GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA,
    BG_DARK, BG_MID, BG_LIGHT, TOBACCO, MAHOGANY, routePrefix, mode,
  } = theme ?? DEFAULT_THEME;
  const isLight = mode === 'light';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);

  // Animation state
  const stateRef = useRef({
    slices: [] as Slice[],
    angle: 0,          // current rotation in radians
    velocity: 0,       // angular velocity rad/frame
    spinning: false,
    targetPrize: null as Prize | null,
    spinStartTime: 0,
  });

  /* ─── Load prizes ─── */
  useEffect(() => {
    fetchPrizes().then(data => {
      const available = data.filter(p => p.quantity > 0);
      if (available.length === 0) return;
      setPrizes(available);
      setPhase('ready');
    });
  }, []);

  /* ─── Build slices from prizes (proportional to quantity) ─── */
  const buildSlices = useCallback((prizeList: Prize[]): Slice[] => {
    const totalQty = prizeList.reduce((s, p) => s + p.quantity, 0);
    if (totalQty === 0) return [];

    // Color palette for slices
    const palette = [
      GOLD, AMBER, SIENNA, '#6366f1', '#ef4444', '#22c55e',
      '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
    ];

    const slices: Slice[] = [];
    let currentAngle = 0;

    prizeList.forEach((prize, i) => {
      const fraction = prize.quantity / totalQty;
      const sweepAngle = fraction * Math.PI * 2;
      slices.push({
        prize,
        startAngle: currentAngle,
        endAngle: currentAngle + sweepAngle,
        color: palette[i % palette.length],
      });
      currentAngle += sweepAngle;
    });

    return slices;
  }, [GOLD, AMBER, SIENNA]);

  /* ─── Draw the wheel ─── */
  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const state = stateRef.current;
    const { slices, angle } = state;
    if (slices.length === 0) return;

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) * 0.82;

    ctx.clearRect(0, 0, w, h);

    // ── Draw outer ring glow
    const glowGrad = ctx.createRadialGradient(cx, cy, radius * 0.95, cx, cy, radius * 1.08);
    glowGrad.addColorStop(0, `rgba(${hexToRgb(GOLD)}, 0.3)`);
    glowGrad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.08, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();

    // ── Draw slices
    slices.forEach((slice) => {
      const start = slice.startAngle + angle;
      const end = slice.endAngle + angle;
      const mid = (start + end) / 2;

      // Slice sector
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, end);
      ctx.closePath();

      // Fill with gradient
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${hexToRgb(slice.color)}, 0.25)`);
      grad.addColorStop(0.4, `rgba(${hexToRgb(slice.color)}, 0.5)`);
      grad.addColorStop(1, `rgba(${hexToRgb(slice.color)}, 0.8)`);
      ctx.fillStyle = grad;
      ctx.fill();

      // Border
      ctx.strokeStyle = `rgba(0,0,0,0.3)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // ── Text (emoji + name) along the slice
      const sweepAngle = slice.endAngle - slice.startAngle;
      const textRadius = radius * 0.62;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);

      // Emoji
      const emojiSize = Math.max(16, Math.min(28, sweepAngle * radius * 0.2));
      ctx.font = `${emojiSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(slice.prize.emoji, textRadius, 0);

      // Name — only show if slice is wide enough
      if (sweepAngle > 0.3) {
        const nameSize = Math.max(9, Math.min(14, sweepAngle * radius * 0.08));
        ctx.font = `bold ${nameSize}px system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 3;
        ctx.fillText(slice.prize.name, textRadius, emojiSize * 0.7);
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    });

    // ── Center hub
    const hubRadius = radius * 0.12;
    const hubGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, hubRadius);
    hubGrad.addColorStop(0, GOLD_BRIGHT);
    hubGrad.addColorStop(0.6, GOLD);
    hubGrad.addColorStop(1, AMBER);
    ctx.beginPath();
    ctx.arc(cx, cy, hubRadius, 0, Math.PI * 2);
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,0.3)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Hub text
    ctx.fillStyle = BG_DARK;
    ctx.font = `bold ${hubRadius * 0.6}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPIN', cx, cy);

    // ── Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();

    // ── Tick marks around the wheel
    const tickCount = slices.length * 3;
    for (let i = 0; i < tickCount; i++) {
      const tickAngle = (i / tickCount) * Math.PI * 2;
      const innerR = radius - 6;
      const outerR = radius;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(tickAngle) * innerR, cy + Math.sin(tickAngle) * innerR);
      ctx.lineTo(cx + Math.cos(tickAngle) * outerR, cy + Math.sin(tickAngle) * outerR);
      ctx.strokeStyle = `rgba(${hexToRgb(GOLD)}, 0.5)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── Pointer (top, 12 o'clock)
    const ptrLen = radius * 0.16;
    const ptrWidth = radius * 0.07;
    const ptrY = cy - radius - 2;

    ctx.beginPath();
    ctx.moveTo(cx, ptrY + ptrLen);
    ctx.lineTo(cx - ptrWidth, ptrY - 4);
    ctx.lineTo(cx + ptrWidth, ptrY - 4);
    ctx.closePath();

    const ptrGrad = ctx.createLinearGradient(cx, ptrY - 4, cx, ptrY + ptrLen);
    ptrGrad.addColorStop(0, GOLD_BRIGHT);
    ptrGrad.addColorStop(1, AMBER);
    ctx.fillStyle = ptrGrad;
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,0.3)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pointer circle
    ctx.beginPath();
    ctx.arc(cx, ptrY - 2, ptrWidth * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = GOLD_BRIGHT;
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,0.2)`;
    ctx.lineWidth = 1;
    ctx.stroke();

  }, [GOLD, GOLD_BRIGHT, AMBER, BG_DARK, CREAM]);

  /* ─── Animation loop ─── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prizes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = stateRef.current;
    state.slices = buildSlices(prizes);

    let rafId: number;
    let lastTickSliceIdx = -1;

    const setupCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: rect.width, h: rect.height };
    };

    const loop = () => {
      const { w, h } = setupCanvas();

      if (state.spinning) {
        state.angle += state.velocity;
        state.velocity *= FRICTION;

        // Tick sound when crossing a slice boundary
        const normalizedAngle = ((POINTER_ANGLE - state.angle) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
        const currentSliceIdx = state.slices.findIndex(s => normalizedAngle >= s.startAngle && normalizedAngle < s.endAngle);
        if (currentSliceIdx !== -1 && currentSliceIdx !== lastTickSliceIdx) {
          lastTickSliceIdx = currentSliceIdx;
          try { getSoundEngine().peg(currentSliceIdx % 5); } catch {}
        }

        if (Math.abs(state.velocity) < MIN_VELOCITY) {
          state.velocity = 0;
          state.spinning = false;

          // Determine which slice the pointer landed on
          const finalAngle = ((POINTER_ANGLE - state.angle) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
          const landedSlice = state.slices.find(
            s => finalAngle >= s.startAngle && finalAngle < s.endAngle,
          ) || state.slices[0];

          // Short delay then victory
          setTimeout(() => {
            try { getSoundEngine().victory(); } catch {}
            setWonPrize(landedSlice.prize);
            setPhase('victory');
          }, 400);
        }
      }

      draw(ctx, w, h);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    const onResize = () => setupCanvas();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
  }, [prizes, buildSlices, draw]);

  /* ─── Start spin ─── */
  const startSpin = useCallback(() => {
    if (phase !== 'ready') return;
    const state = stateRef.current;
    if (state.spinning) return;

    setPhase('playing');

    // Pick the winning prize (weighted by quantity)
    const totalQty = prizes.reduce((s, p) => s + p.quantity, 0);
    let rand = Math.random() * totalQty;
    let winner = prizes[prizes.length - 1];
    for (const p of prizes) {
      rand -= p.quantity;
      if (rand <= 0) { winner = p; break; }
    }
    state.targetPrize = winner;

    // Calculate target angle so pointer lands on winning slice
    const winSlice = state.slices.find(s => s.prize.id === winner.id);
    if (!winSlice) return;

    // Random position within the slice (avoid edges)
    const sliceMid = (winSlice.startAngle + winSlice.endAngle) / 2;
    const sliceRange = (winSlice.endAngle - winSlice.startAngle) * 0.6;
    const targetInSlice = sliceMid + (Math.random() - 0.5) * sliceRange;

    // Pointer is at POINTER_ANGLE. We need: POINTER_ANGLE - (angle + totalRotation) ≡ targetInSlice (mod 2π)
    // → totalRotation = POINTER_ANGLE - targetInSlice - state.angle + N*2π
    const fullSpins = (MIN_SPINS + Math.random() * MAX_EXTRA_SPINS) * Math.PI * 2;
    const targetTotalAngle = POINTER_ANGLE - targetInSlice - state.angle + fullSpins;

    // Calculate initial velocity needed: v₀ = totalAngle * (1 - FRICTION) / (1 - FRICTION^N)
    // Approximate: since FRICTION is close to 1, use geometric sum
    // total = v₀ / (1 - FRICTION)
    state.velocity = targetTotalAngle * (1 - FRICTION);
    state.spinning = true;
    state.spinStartTime = Date.now();

    try { getSoundEngine().swoosh(); } catch {}
  }, [phase, prizes]);

  /* ─── Victory screen ─── */
  if (phase === 'victory' && wonPrize) {
    return (
      <VictoryScreen
        prize={wonPrize}
        onClose={() => window.location.reload()}
        accentFrom={GOLD}
        accentTo={AMBER}
      />
    );
  }

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        height: '100dvh',
        background: `radial-gradient(ellipse at 50% 40%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)`,
      }}
    >
      {/* Back to menu */}
      <Link href={routePrefix || '/'} className="absolute top-3 left-3 z-50 w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-200 active:scale-90" style={{ background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}` }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)' }}><path d="M15 18l-6-6 6-6" /></svg>
      </Link>
      {/* Header — only during ready */}
      {phase === 'ready' && (
        <div
          className="absolute top-3 left-0 right-0 text-center z-10"
          style={{ animation: 'fadeInUp 0.4s ease-out both' }}
        >
          <h1
            className="text-[16px] font-bold tracking-[-0.01em]"
            style={{ color: CREAM }}
          >
            Spin & Win
          </h1>
          <p style={{ color: `${CREAM}45` }} className="text-[11px] mt-0.5">
            Tournez la roue pour gagner
          </p>
        </div>
      )}

      {/* Canvas — fills available space */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ touchAction: 'none' }}
      />

      {/* Spin button overlay */}
      {phase === 'ready' && (
        <button
          onClick={startSpin}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-8 py-3 rounded-xl font-semibold text-[14px] tracking-wide transition-all duration-200 active:scale-[0.97]"
          style={{
            background: GOLD,
            color: '#ffffff',
            boxShadow: `0 4px 20px -4px ${GOLD}50`,
            animation: 'fadeInUp 0.5s ease-out 0.3s both',
          }}
        >
          Tourner la roue
        </button>
      )}

      {/* Loading state */}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{
              borderColor: `${GOLD}30`,
              borderTopColor: GOLD,
            }}
          />
        </div>
      )}
    </div>
  );
}
