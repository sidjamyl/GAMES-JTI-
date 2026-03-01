'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import Link from 'next/link';
import { GameTheme, DEFAULT_THEME } from '../lib/themes';

/* ═══════════════════════════════════════════════
   GIFT CATCHER — Themeable
   Gifts pop up briefly. Tap ONE to win it.
   Very fast — one tap = instant win of that prize.
   ═══════════════════════════════════════════════ */

const GRID_SIZE = 9; // 3×3

// Gifts appear VERY briefly — constant fast speed, no time limit
const GIFT_SHOW_MIN = 150;  // ms minimum visible time
const GIFT_SHOW_MAX = 320;  // ms maximum visible time
const SPAWN_INTERVAL = 250; // ms between spawns (constant)

const CATCH_EMOJI = '✓';

interface Hole {
  id: number;
  hasGift: boolean;
  caught: boolean;
  prize: Prize | null;
  showTime: number;
  duration: number;
}

export default function GiftCatcher({ theme }: { theme?: GameTheme }) {
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, routePrefix, mode } = { ...DEFAULT_THEME, ...theme };
  const isLight = mode === 'light';
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [catchEffect, setCatchEffect] = useState<{ x: number; y: number; key: number } | null>(null);

  const phaseRef = useRef<GamePhase>('loading');
  const holesRef = useRef<Hole[]>([]);
  const spawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giftTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const effectKeyRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { holesRef.current = holes; }, [holes]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const initHoles = useCallback((): Hole[] => {
    return Array.from({ length: GRID_SIZE }, (_, i) => ({
      id: i, hasGift: false, caught: false, prize: null, showTime: 0, duration: 0,
    }));
  }, []);

  const clearAllTimers = useCallback(() => {
    if (spawnRef.current) { clearTimeout(spawnRef.current); spawnRef.current = null; }
    giftTimersRef.current.forEach((t) => clearTimeout(t));
    giftTimersRef.current.clear();
  }, []);

  const hideGift = useCallback((holeId: number) => {
    setHoles((prev) => {
      const next = prev.map((h) => h.id === holeId ? { ...h, hasGift: false, caught: false, prize: null } : h);
      holesRef.current = next;
      return next;
    });
    giftTimersRef.current.delete(holeId);
  }, []);

  const spawnGift = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    const current = holesRef.current;
    const emptyHoles = current.filter((h) => !h.hasGift);
    if (emptyHoles.length === 0) {
      spawnRef.current = setTimeout(spawnGift, 120);
      return;
    }

    const target = emptyHoles[Math.floor(Math.random() * emptyHoles.length)];

    // Choose a random prize for this specific gift
    const prize = selectRandomPrize(prizes);

    // Constant fast show duration
    const duration = GIFT_SHOW_MIN + Math.random() * (GIFT_SHOW_MAX - GIFT_SHOW_MIN);

    setHoles((prev) => {
      const next = prev.map((h) =>
        h.id === target.id ? { ...h, hasGift: true, caught: false, prize, showTime: Date.now(), duration } : h
      );
      holesRef.current = next;
      return next;
    });

    // Auto-hide after duration
    const hideTimer = setTimeout(() => {
      if (phaseRef.current === 'playing') hideGift(target.id);
    }, duration);
    giftTimersRef.current.set(target.id, hideTimer);

    // Schedule next spawn — constant fast pace
    spawnRef.current = setTimeout(() => {
      spawnGift();
    }, SPAWN_INTERVAL + Math.random() * 100);
  }, [hideGift, prizes]);

  const catchGift = useCallback(
    (holeId: number, event: React.MouseEvent | React.TouchEvent) => {
      if (phaseRef.current !== 'playing') return;
      const hole = holesRef.current.find((h) => h.id === holeId);
      if (!hole || !hole.hasGift || hole.caught || !hole.prize) return;

      // CAUGHT! Stop everything immediately.
      getSoundEngine().swish();

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const key = ++effectKeyRef.current;
      setCatchEffect({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, key });
      setTimeout(() => setCatchEffect(null), 600);

      // Mark as caught visually
      setHoles((prev) => {
        const next = prev.map((h) => h.id === holeId ? { ...h, caught: true } : h);
        holesRef.current = next;
        return next;
      });

      // Stop all timers immediately
      clearAllTimers();

      // Set the won prize to the specific gift they tapped
      const caughtPrize = hole.prize;
      setWonPrize(caughtPrize);

      // Brief dramatic pause then show victory
      setTimeout(() => {
        if (phaseRef.current === 'playing') setPhase('victory');
      }, 800);
    },
    [clearAllTimers]
  );

  const missedTap = useCallback((holeId: number) => {
    if (phaseRef.current !== 'playing') return;
    const hole = holesRef.current.find((h) => h.id === holeId);
    if (hole && !hole.hasGift) {
      getSoundEngine().miss();
    }
  }, []);

  const startGame = useCallback(() => {
    const newHoles = initHoles();
    setHoles(newHoles);
    holesRef.current = newHoles;
    setWonPrize(null);
    setCatchEffect(null);
    setGameOver(false);
    setPhase('playing');

    // Start spawning gifts immediately
    setTimeout(() => spawnGift(), 300);
  }, [initHoles, spawnGift]);

  useEffect(() => { return () => clearAllTimers(); }, [clearAllTimers]);

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-between"
      style={{
        background: `radial-gradient(ellipse at 50% 30%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)`,
        padding: '0 16px',
      }}
    >
      {/* Back to menu */}
      <Link href={routePrefix || '/'} className="absolute top-3 left-3 z-50 w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-200 active:scale-90" style={{ background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)', border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}` }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)' }}><path d="M15 18l-6-6 6-6" /></svg>
      </Link>
      {/* Header */}
      <div className="w-full max-w-[380px] flex flex-col items-center pt-10 pb-2" style={{ animation: 'fadeInUp 0.5s ease-out both', zIndex: 10 }}>
        <h1 className="text-[28px] font-extrabold tracking-tight text-center"
          style={{ background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Gift Catcher
        </h1>
        <p style={{ color: CREAM + '40' }} className="text-xs mt-1">Attrapez un cadeau avant qu&apos;il disparaisse !</p>
      </div>

      {/* Game Grid */}
      <div className="flex-1 flex items-center justify-center w-full max-w-[380px]" style={{ zIndex: 10 }}>
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3" style={{ animation: 'fadeIn 0.3s ease-out both' }}>
            <div className="w-8 h-8 rounded-full border-2" style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD, animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: CREAM + '40' }} className="text-sm">Chargement…</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-6" style={{ animation: 'fadeInUp 0.5s ease-out both' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
              background: isLight ? `${GOLD}12` : `${GOLD}18`, border: `1.5px solid ${isLight ? GOLD + '20' : GOLD + '25'}`,
              animation: 'victoryFloat 2.5s ease-in-out infinite',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8V3m-4 5l4-3 4 3"/><line x1="12" y1="8" x2="12" y2="21"/><line x1="3" y1="14" x2="21" y2="14"/></svg>
            </div>
            <p style={{ color: isLight ? CREAM + '60' : CREAM + '50' }} className="text-[13px] text-center max-w-[240px] leading-relaxed">
              Des cadeaux apparaissent brièvement.<br />
              Tapez sur un cadeau pour le gagner !
            </p>
            {gameOver && (
              <p className="text-sm font-semibold" style={{ color: '#ef4444', animation: 'fadeIn 0.3s ease-out both' }}>
                Trop lent ! Réessayez
              </p>
            )}
            <button onClick={startGame}
              className="px-10 py-4 rounded-xl font-semibold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.97]"
              style={{ background: GOLD, color: isLight ? '#fff' : BG_DARK }}>
              {gameOver ? 'Réessayer' : 'Jouer'}
            </button>
          </div>
        )}

        {phase === 'playing' && (
          <div className="grid grid-cols-3 gap-4 w-full max-w-[340px]" style={{ animation: 'scaleIn 0.3s ease-out both' }}>
            {holes.map((hole) => (
              <button
                key={hole.id}
                onPointerDown={(e) => {
                  if (hole.hasGift && !hole.caught) catchGift(hole.id, e);
                  else missedTap(hole.id);
                }}
                className="relative aspect-square rounded-3xl overflow-hidden transition-transform duration-100 active:scale-95"
                style={{
                  background: `radial-gradient(circle at 50% 60%, ${MAHOGANY}, ${BG_MID})`,
                  border: `2px solid ${hole.hasGift && !hole.caught ? GOLD + '50' : GOLD + '08'}`,
                  boxShadow: hole.hasGift && !hole.caught
                    ? `inset 0 -8px 20px rgba(0,0,0,0.5), 0 0 24px ${GOLD}30`
                    : 'inset 0 -8px 20px rgba(0,0,0,0.5)',
                }}
              >
                {/* Hole depth */}
                <div className="absolute inset-2 rounded-2xl"
                  style={{ background: 'radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.6), transparent 70%)' }} />

                {/* Gift */}
                {hole.hasGift && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5"
                    style={{ animation: hole.caught ? 'whackHit 0.3s ease-out forwards' : 'giftPopUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
                    <span className="text-4xl select-none"
                      style={{
                        filter: hole.caught ? 'brightness(1.5)' : 'none',
                        transform: hole.caught ? 'scale(1.2)' : 'scale(1)',
                        transition: 'filter 0.15s, transform 0.15s',
                      }}>
                      {hole.caught ? CATCH_EMOJI : (hole.prize?.emoji || '●')}
                    </span>

                  </div>
                )}

                {/* Glow ring when gift visible */}
                {hole.hasGift && !hole.caught && (
                  <div className="absolute inset-0 rounded-3xl pointer-events-none"
                    style={{ border: `2px solid ${GOLD}45`, animation: 'subtlePulse 0.6s ease-in-out infinite' }} />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-8 flex-shrink-0" />

      {/* Catch effect */}
      {catchEffect && (
        <div className="fixed pointer-events-none"
          style={{ left: catchEffect.x - 24, top: catchEffect.y - 24, zIndex: 50, animation: 'hitBurst 0.6s ease-out forwards' }}>
          <span className="text-5xl">{CATCH_EMOJI}</span>
        </div>
      )}

      {/* Victory */}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} onClose={() => setPhase('ready')} accentFrom={GOLD} accentTo={AMBER} />
      )}

      <style jsx>{`
        @keyframes giftPopUp {
          0% { transform: translateY(100%) scale(0.5); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes whackHit {
          0% { transform: scale(1); }
          40% { transform: scale(1.4); }
          100% { transform: scale(0) translateY(-30px); opacity: 0; }
        }
        @keyframes hitBurst {
          0% { transform: scale(0.5); opacity: 1; }
          50% { transform: scale(2); opacity: 0.8; }
          100% { transform: scale(3) translateY(-40px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
