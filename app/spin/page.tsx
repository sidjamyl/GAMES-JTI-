'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import PrizeLegend from '../components/PrizeLegend';
import Link from 'next/link';
import { GameTheme, DEFAULT_THEME } from '../lib/themes';
import GameBackground from '../components/GameBackground';

/* ═══════════════════════════════════════════════
   SPIN & WIN — Wheel of Fortune  (v2)
   Static canvas wheel + CSS-animated arrow pointer.
   Center "JOUER" button triggers the spin.
   ═══════════════════════════════════════════════ */

const SPIN_MS   = 4200;   // CSS transition duration
const MIN_SPINS = 5;
const MAX_EXTRA = 3;

const COLORS = [
  '#2cc5d2', '#38c88e', '#fab320', '#f97903',
  '#ca2231', '#79022c', '#0a4366', '#0a97d0',
  '#6366f1', '#22c55e', '#f59e0b', '#ec4899',
];

interface SliceInfo { prize: Prize; startDeg: number; endDeg: number; color: string; }

export default function Spin({ theme }: { theme?: GameTheme }) {
  const _t = theme ?? DEFAULT_THEME;
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, BG_DARK, BG_MID, BG_LIGHT, routePrefix, mode, name: themeName } = _t;
  const isLight = mode === 'light';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slicesRef = useRef<SliceInfo[]>([]);
  const tickRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef   = useRef(false);
  const arrowDegRef = useRef(0);   // tracks actual degree for landing calc

  const [prizes,   setPrizes]   = useState<Prize[]>([]);
  const [phase,    setPhase]    = useState<GamePhase>('loading');
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [arrowDeg, setArrowDeg] = useState(0);
  const [spinning, setSpinning] = useState(false);

  /* ── Load prizes ───────────────────────────── */
  useEffect(() => {
    fetchPrizes('STOCK_STW').then(d => {
      const ok = d.filter(p => p.quantity > 0);
      if (!ok.length) return;
      setPrizes(ok);
      setPhase('ready');
    });
  }, []);

  /* ── Build slices (proportional to quantity) ── */
  const buildSlices = useCallback((list: Prize[]): SliceInfo[] => {
    const tot = list.reduce((s, p) => s + p.quantity, 0);
    if (!tot) return [];
    const out: SliceInfo[] = [];
    let cur = 0;
    list.forEach((prize, i) => {
      const sweep = (prize.quantity / tot) * 360;
      out.push({ prize, startDeg: cur, endDeg: cur + sweep, color: COLORS[i % COLORS.length] });
      cur += sweep;
    });
    return out;
  }, []);

  /* ── Draw static wheel on canvas ───────────── */
  const paint = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width: cw, height: ch } = c.getBoundingClientRect();
    c.width = cw * dpr; c.height = ch * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = cw / 2, cy = ch / 2;
    const R = Math.min(cx, cy) * 0.93;
    const sl = slicesRef.current;
    if (!sl.length) return;
    ctx.clearRect(0, 0, cw, ch);

    /* outer shadow */
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.30)';
    ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.restore();

    /* slices */
    sl.forEach(s => {
      const a0 = (s.startDeg - 90) * Math.PI / 180;
      const a1 = (s.endDeg   - 90) * Math.PI / 180;
      const mid = (a0 + a1) / 2;
      const sweep = a1 - a0;

      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
      ctx.fillStyle = s.color; ctx.fill();

      /* depth overlay */
      const dg = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      dg.addColorStop(0, 'rgba(255,255,255,0.10)');
      dg.addColorStop(0.55, 'rgba(255,255,255,0)');
      dg.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
      ctx.fillStyle = dg; ctx.fill();

      /* divider */
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();

      /* emoji + name */
      const tR = R * 0.58;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(mid);
      const eS = Math.max(18, Math.min(30, sweep * R * 0.18));
      ctx.font = `${eS}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.prize.emoji, tR, 0);
      if (sweep > 0.35) {
        const nS = Math.max(8, Math.min(12, sweep * R * 0.07));
        ctx.font = `700 ${nS}px system-ui,sans-serif`;
        ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3;
        ctx.fillText(s.prize.name, tR, eS * 0.65);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    });

    /* LED dots */
    const dots = Math.max(sl.length * 4, 24);
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5), 2.2, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)';
      ctx.fill();
    }

    /* outer ring */
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3; ctx.stroke();
  }, []);

  /* init + redraw */
  useEffect(() => { if (!prizes.length) return; slicesRef.current = buildSlices(prizes); paint(); }, [prizes, buildSlices, paint]);
  useEffect(() => { const h = () => paint(); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [paint]);

  /* ── Tick sounds ───────────────────────────── */
  const clearTicks = useCallback(() => { if (tickRef.current) clearTimeout(tickRef.current); }, []);
  const startTicks = useCallback(() => {
    let d = 55;
    const go = () => {
      if (d > 400) return;
      try { getSoundEngine().peg(Math.floor(Math.random() * 5)); } catch {}
      d *= 1.06;
      tickRef.current = setTimeout(go, d);
    };
    go();
  }, []);
  useEffect(() => () => clearTicks(), [clearTicks]);

  /* ── End spin ──────────────────────────────── */
  const endSpin = useCallback(() => {
    if (!animRef.current) return;
    clearTicks();
    setSpinning(false);
    animRef.current = false;
    setTimeout(() => {
      /* Determine winner from actual arrow position */
      const finalDeg = ((arrowDegRef.current % 360) + 360) % 360;
      const landed = slicesRef.current.find(
        s => finalDeg >= s.startDeg && finalDeg < s.endDeg,
      ) || slicesRef.current[0];
      try { getSoundEngine().victory(); } catch {}
      setWonPrize(landed.prize);
      setPhase('victory');
    }, 300);
  }, [clearTicks]);

  /* ── Start spin ────────────────────────────── */
  const spin = useCallback(() => {
    if (phase !== 'ready' || animRef.current) return;
    setPhase('playing');
    setSpinning(true);
    animRef.current = true;

    /* weighted random winner — used to choose target angle */
    const tot = prizes.reduce((s, p) => s + p.quantity, 0);
    let r = Math.random() * tot, w = prizes[prizes.length - 1];
    for (const p of prizes) { r -= p.quantity; if (r <= 0) { w = p; break; } }

    /* target angle: arrow lands on winner's slice */
    const ws = slicesRef.current.find(s => s.prize.id === w.id)!;
    const mid = (ws.startDeg + ws.endDeg) / 2;
    const jitter = (Math.random() - 0.5) * (ws.endDeg - ws.startDeg) * 0.55;
    const target = mid + jitter;
    const full = (MIN_SPINS + Math.random() * MAX_EXTRA) * 360;
    const mod = ((arrowDeg % 360) + 360) % 360;
    const extra = ((target - mod) % 360 + 360) % 360;
    const newDeg = arrowDeg + full + extra;
    arrowDegRef.current = newDeg;
    setArrowDeg(newDeg);

    try { getSoundEngine().swoosh(); } catch {}
    startTicks();

    /* safety fallback */
    setTimeout(() => { if (animRef.current) endSpin(); }, SPIN_MS + 800);
  }, [phase, prizes, arrowDeg, startTicks, endSpin]);

  /* ── Render ────────────────────────────────── */
  if (phase === 'victory' && wonPrize)
    return <VictoryScreen prize={wonPrize} onClose={() => window.location.reload()} accentFrom={GOLD} accentTo={AMBER} />;

  return (
    <div className="relative w-full overflow-hidden flex flex-col items-center justify-center"
      style={{ height: '100dvh', background: `radial-gradient(ellipse at 50% 40%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)` }}>
      <GameBackground themeName={themeName} />

      {phase === 'ready' && (
        <Link href={routePrefix || '/'} className="absolute top-3 left-3 z-50 w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-200 active:scale-90" style={{ background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}` }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)' }}><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
      )}
      <PrizeLegend prizes={prizes} isLight={isLight} />

      {/* Header */}
      {phase === 'ready' && (
        <div className="absolute top-4 left-0 right-0 text-center z-10" style={{ animation: 'fadeInUp 0.4s ease-out both' }}>
          <h1 className="text-[18px] font-bold tracking-[-0.01em]" style={{ color: CREAM }}>Spin & Win</h1>
          <p style={{ color: `${CREAM}45` }} className="text-[11px] mt-0.5">Tournez la roue pour gagner</p>
        </div>
      )}

      {/* ── Wheel assembly ── */}
      <div className="relative" style={{ width: 'min(92vw, 78vh, 500px)', aspectRatio: '1' }}>

        {/* Static canvas wheel */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full rounded-full" />

        {/* Rotating arrow layer */}
        <div className="absolute inset-0 pointer-events-none"
          onTransitionEnd={endSpin}
          style={{
            transform: `rotate(${arrowDeg}deg)`,
            transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12,0.75,0.22,1)` : 'none',
          }}>
          <div className="absolute left-1/2 -translate-x-1/2" style={{ top: '-4%' }}>
            <svg width="30" height="38" viewBox="0 0 30 38" fill="none">
              <defs>
                <linearGradient id="aw" x1="15" y1="0" x2="15" y2="38" gradientUnits="userSpaceOnUse">
                  <stop stopColor={GOLD_BRIGHT} />
                  <stop offset="1" stopColor={GOLD} />
                </linearGradient>
                <filter id="as"><feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.25" /></filter>
              </defs>
              <polygon points="15,38 3,10 27,10" fill="url(#aw)" filter="url(#as)" />
              <circle cx="15" cy="10" r="6" fill={GOLD_BRIGHT} stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
            </svg>
          </div>
        </div>

        {/* Center button */}
        <button onClick={spin} disabled={phase !== 'ready'}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center z-20 transition-transform duration-150 active:scale-95"
          style={{
            width: '26%', aspectRatio: '1',
            background: `radial-gradient(circle at 38% 38%, ${GOLD_BRIGHT}, ${GOLD})`,
            boxShadow: `0 4px 20px -4px ${GOLD}90, inset 0 1px 1px rgba(255,255,255,0.25)`,
            border: '3px solid rgba(255,255,255,0.22)',
            cursor: phase === 'ready' ? 'pointer' : 'default',
          }}>
          <span className="text-white font-bold text-center leading-none select-none"
            style={{ fontSize: 'clamp(9px, 2.4vw, 13px)', textShadow: '0 1px 2px rgba(0,0,0,0.3)', letterSpacing: '0.06em' }}>
            {phase === 'ready' ? 'JOUER' : '···'}
          </span>
        </button>

        {/* Pulse ring */}
        {phase === 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="rounded-full" style={{
              width: '26%', aspectRatio: '1',
              border: `2px solid ${GOLD}`,
              animation: 'spinPulseRing 2s ease-in-out infinite',
            }} />
          </div>
        )}
      </div>

      {/* Loading */}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD }} />
        </div>
      )}

      <style>{`
        @keyframes spinPulseRing {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.25); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
