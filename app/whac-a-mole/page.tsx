'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   WHAC-A-MOLE — Tap the moles!
   Always rigged: player wins after scoring enough
   ═══════════════════════════════════════════════ */

const GRID_SIZE = 9; // 3x3 grid
const GAME_DURATION = 15; // seconds
const REQUIRED_HITS = 8; // hits to win (rigged: always reachable)
const MOLE_SHOW_MIN = 600; // ms minimum mole visible time
const MOLE_SHOW_MAX = 1200; // ms maximum mole visible time
const SPAWN_INTERVAL_START = 900; // ms between spawns at start
const SPAWN_INTERVAL_END = 500; // ms between spawns near end (speeds up)

const MOLE_EMOJI = '🐹';
const WHACK_EMOJI = '💥';
const HOLE_GRADIENT_FROM = '#2d1f0e';
const HOLE_GRADIENT_TO = '#1a1205';
const ACCENT_FROM = '#f59e0b';
const ACCENT_TO = '#ef4444';

interface Hole {
  id: number;
  hasMole: boolean;
  whacked: boolean;
  showTime: number; // timestamp when mole appeared
  duration: number; // how long mole stays up
}

export default function WhacAMole() {
  const [phase, setPhase] = useState<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [misses, setMisses] = useState(0);
  const [combo, setCombo] = useState(0);
  const [showCombo, setShowCombo] = useState(false);
  const [hitEffects, setHitEffects] = useState<{ id: number; x: number; y: number; key: number }[]>([]);

  const scoreRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const holesRef = useRef<Hole[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moleTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const effectKeyRef = useRef(0);
  const comboRef = useRef(0);
  const timeLeftRef = useRef(GAME_DURATION);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    holesRef.current = holes;
  }, [holes]);

  // Load prizes
  useEffect(() => {
    fetchPrizes().then((p) => {
      setPrizes(p);
      setPhase('ready');
    });
  }, []);

  const initHoles = useCallback((): Hole[] => {
    return Array.from({ length: GRID_SIZE }, (_, i) => ({
      id: i,
      hasMole: false,
      whacked: false,
      showTime: 0,
      duration: 0,
    }));
  }, []);

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (spawnRef.current) {
      clearTimeout(spawnRef.current);
      spawnRef.current = null;
    }
    moleTimersRef.current.forEach((t) => clearTimeout(t));
    moleTimersRef.current.clear();
  }, []);

  const hideMole = useCallback((holeId: number) => {
    setHoles((prev) => {
      const next = prev.map((h) =>
        h.id === holeId ? { ...h, hasMole: false, whacked: false } : h
      );
      holesRef.current = next;
      return next;
    });
    moleTimersRef.current.delete(holeId);
  }, []);

  const spawnMole = useCallback(() => {
    if (phaseRef.current !== 'playing') return;

    const current = holesRef.current;
    const emptyHoles = current.filter((h) => !h.hasMole);
    if (emptyHoles.length === 0) {
      // Try again soon
      spawnRef.current = setTimeout(spawnMole, 200);
      return;
    }

    const target = emptyHoles[Math.floor(Math.random() * emptyHoles.length)];
    const duration = MOLE_SHOW_MIN + Math.random() * (MOLE_SHOW_MAX - MOLE_SHOW_MIN);

    setHoles((prev) => {
      const next = prev.map((h) =>
        h.id === target.id
          ? { ...h, hasMole: true, whacked: false, showTime: Date.now(), duration }
          : h
      );
      holesRef.current = next;
      return next;
    });

    // Auto-hide mole after duration
    const hideTimer = setTimeout(() => {
      if (phaseRef.current === 'playing') {
        hideMole(target.id);
      }
    }, duration);
    moleTimersRef.current.set(target.id, hideTimer);

    // Schedule next spawn — gets faster over time
    const elapsed = GAME_DURATION - timeLeftRef.current;
    const progress = Math.min(elapsed / GAME_DURATION, 1);
    const interval = SPAWN_INTERVAL_START - (SPAWN_INTERVAL_START - SPAWN_INTERVAL_END) * progress;
    // Sometimes spawn 2 moles at once for excitement
    const extraSpawn = progress > 0.5 && Math.random() < 0.3;

    spawnRef.current = setTimeout(() => {
      spawnMole();
      if (extraSpawn) {
        setTimeout(spawnMole, 100);
      }
    }, interval + Math.random() * 200);
  }, [hideMole]);

  const triggerWin = useCallback(() => {
    clearAllTimers();
    setPhase('victory');
    const prize = selectRandomPrize(prizes);
    setWonPrize(prize);
  }, [clearAllTimers, prizes]);

  const whackMole = useCallback(
    (holeId: number, event: React.MouseEvent | React.TouchEvent) => {
      if (phaseRef.current !== 'playing') return;

      const hole = holesRef.current.find((h) => h.id === holeId);
      if (!hole || !hole.hasMole || hole.whacked) return;

      // Sound
      getSoundEngine().impact();

      // Hit effect position
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const key = ++effectKeyRef.current;
      setHitEffects((prev) => [
        ...prev,
        { id: holeId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, key },
      ]);
      setTimeout(() => {
        setHitEffects((prev) => prev.filter((e) => e.key !== key));
      }, 500);

      // Mark whacked
      setHoles((prev) => {
        const next = prev.map((h) =>
          h.id === holeId ? { ...h, whacked: true } : h
        );
        holesRef.current = next;
        return next;
      });

      // Clear auto-hide timer
      const t = moleTimersRef.current.get(holeId);
      if (t) clearTimeout(t);

      // Hide mole after brief whack animation
      setTimeout(() => hideMole(holeId), 300);

      // Update score
      const newScore = scoreRef.current + 1;
      scoreRef.current = newScore;
      setScore(newScore);

      // Combo
      comboRef.current += 1;
      setCombo(comboRef.current);
      setShowCombo(true);
      setTimeout(() => setShowCombo(false), 600);

      // Check win (rigged: always achievable)
      if (newScore >= REQUIRED_HITS) {
        triggerWin();
      }
    },
    [hideMole, triggerWin]
  );

  const missedTap = useCallback(
    (holeId: number) => {
      if (phaseRef.current !== 'playing') return;
      const hole = holesRef.current.find((h) => h.id === holeId);
      if (hole && !hole.hasMole) {
        getSoundEngine().miss();
        setMisses((m) => m + 1);
        comboRef.current = 0;
        setCombo(0);
      }
    },
    []
  );

  const startGame = useCallback(() => {
    const newHoles = initHoles();
    setHoles(newHoles);
    holesRef.current = newHoles;
    setScore(0);
    scoreRef.current = 0;
    setMisses(0);
    setCombo(0);
    comboRef.current = 0;
    setTimeLeft(GAME_DURATION);
    timeLeftRef.current = GAME_DURATION;
    setWonPrize(null);
    setHitEffects([]);
    setPhase('playing');

    // Countdown timer
    timerRef.current = setInterval(() => {
      timeLeftRef.current -= 1;
      setTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 0) {
        // Time's up — but we rig it: if player got close, give the win anyway
        if (scoreRef.current >= REQUIRED_HITS - 2) {
          // Close enough — grant the win
          clearAllTimers();
          setPhase('victory');
          const prize = selectRandomPrize(prizes);
          setWonPrize(prize);
        } else {
          // Extremely unlikely path: extend time secretly by 5 seconds
          timeLeftRef.current = 5;
          setTimeLeft(5);
        }
      }
    }, 1000);

    // Start spawning moles after a brief delay
    setTimeout(() => spawnMole(), 500);
  }, [initHoles, clearAllTimers, prizes, spawnMole]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearAllTimers();
  }, [clearAllTimers]);

  /* ═══════════════════ RENDER ═══════════════════ */

  const progressPct = Math.min((score / REQUIRED_HITS) * 100, 100);
  const timePct = (timeLeft / GAME_DURATION) * 100;

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-between"
      style={{
        background:
          'radial-gradient(ellipse at 50% 30%, #2a1a0a 0%, #12080a 50%, #050205 100%)',
        padding: '0 16px',
      }}
    >
      {/* ── Header ── */}
      <div
        className="w-full max-w-[380px] flex flex-col items-center pt-10 pb-2"
        style={{ animation: 'fadeInUp 0.5s ease-out both', zIndex: 10 }}
      >
        <h1
          className="text-[28px] font-extrabold tracking-tight text-center"
          style={{
            background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Whac-A-Mole
        </h1>
        <p className="text-white/30 text-xs mt-1">Tapez les taupes pour gagner !</p>
      </div>

      {/* ── Score & Timer Bar ── */}
      {phase === 'playing' && (
        <div
          className="w-full max-w-[380px] flex flex-col gap-2 px-2"
          style={{ animation: 'fadeIn 0.3s ease-out both', zIndex: 10 }}
        >
          {/* Score */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">Score</span>
              <span
                className="text-lg font-extrabold"
                style={{
                  background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {score}/{REQUIRED_HITS}
              </span>
            </div>

            {/* Combo indicator */}
            {showCombo && combo > 1 && (
              <span
                className="text-sm font-black"
                style={{
                  color: ACCENT_FROM,
                  animation: 'scaleIn 0.3s ease-out both',
                }}
              >
                x{combo} COMBO!
              </span>
            )}

            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">Temps</span>
              <span
                className="text-lg font-extrabold tabular-nums"
                style={{
                  color: timeLeft <= 5 ? '#ef4444' : 'rgba(255,255,255,0.8)',
                  animation: timeLeft <= 5 ? 'subtlePulse 0.5s ease-in-out infinite' : undefined,
                }}
              >
                {timeLeft}s
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div
            className="w-full h-2 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${progressPct}%`,
                background: `linear-gradient(90deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                boxShadow: `0 0 12px ${ACCENT_FROM}60`,
              }}
            />
          </div>

          {/* Time bar */}
          <div
            className="w-full h-1 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000 linear"
              style={{
                width: `${timePct}%`,
                background: timeLeft <= 5
                  ? 'linear-gradient(90deg, #ef4444, #f97316)'
                  : 'linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.15))',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Game Grid ── */}
      <div
        className="flex-1 flex items-center justify-center w-full max-w-[380px]"
        style={{ zIndex: 10 }}
      >
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3" style={{ animation: 'fadeIn 0.3s ease-out both' }}>
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent"
              style={{
                borderColor: `${ACCENT_FROM} transparent ${ACCENT_FROM} ${ACCENT_FROM}`,
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <p className="text-white/30 text-sm">Chargement…</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-6" style={{ animation: 'fadeInUp 0.5s ease-out both' }}>
            {/* Preview mole */}
            <div
              className="w-24 h-24 rounded-3xl flex items-center justify-center text-6xl"
              style={{
                background: `linear-gradient(135deg, ${ACCENT_FROM}20, ${ACCENT_TO}20)`,
                border: `2px solid ${ACCENT_FROM}30`,
                animation: 'victoryFloat 2.5s ease-in-out infinite',
              }}
            >
              {MOLE_EMOJI}
            </div>
            <p className="text-white/40 text-sm text-center max-w-[260px]">
              Tapez sur les taupes avant qu&apos;elles disparaissent !<br />
              <span className="text-white/20 text-xs">
                {REQUIRED_HITS} taupes pour gagner en {GAME_DURATION}s
              </span>
            </p>
            <button
              onClick={startGame}
              className="px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.97]"
              style={{
                background: `linear-gradient(135deg, ${ACCENT_FROM}, ${ACCENT_TO})`,
                boxShadow: `0 8px 30px -8px ${ACCENT_FROM}80`,
              }}
            >
              C&apos;est parti ! 🔨
            </button>
          </div>
        )}

        {phase === 'playing' && (
          <div
            className="grid grid-cols-3 gap-4 w-full max-w-[340px]"
            style={{ animation: 'scaleIn 0.3s ease-out both' }}
          >
            {holes.map((hole) => (
              <button
                key={hole.id}
                onPointerDown={(e) => {
                  if (hole.hasMole && !hole.whacked) {
                    whackMole(hole.id, e);
                  } else {
                    missedTap(hole.id);
                  }
                }}
                className="relative aspect-square rounded-3xl overflow-hidden transition-transform duration-100 active:scale-95"
                style={{
                  background: `radial-gradient(circle at 50% 60%, ${HOLE_GRADIENT_FROM}, ${HOLE_GRADIENT_TO})`,
                  border: '2px solid rgba(255,255,255,0.06)',
                  boxShadow: hole.hasMole && !hole.whacked
                    ? `inset 0 -8px 20px rgba(0,0,0,0.5), 0 0 20px ${ACCENT_FROM}30`
                    : 'inset 0 -8px 20px rgba(0,0,0,0.5)',
                }}
              >
                {/* Hole inner shadow */}
                <div
                  className="absolute inset-2 rounded-2xl"
                  style={{
                    background: 'radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.6), transparent 70%)',
                  }}
                />

                {/* Mole */}
                {hole.hasMole && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      animation: hole.whacked
                        ? 'whackHit 0.3s ease-out forwards'
                        : 'molePopUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both',
                    }}
                  >
                    <span
                      className="text-5xl select-none"
                      style={{
                        filter: hole.whacked ? 'grayscale(1) brightness(0.5)' : 'none',
                        transform: hole.whacked ? 'scale(0.7)' : 'scale(1)',
                        transition: 'filter 0.2s, transform 0.2s',
                      }}
                    >
                      {hole.whacked ? WHACK_EMOJI : MOLE_EMOJI}
                    </span>
                  </div>
                )}

                {/* Highlight ring when mole active */}
                {hole.hasMole && !hole.whacked && (
                  <div
                    className="absolute inset-0 rounded-3xl pointer-events-none"
                    style={{
                      border: `2px solid ${ACCENT_FROM}50`,
                      animation: 'subtlePulse 0.8s ease-in-out infinite',
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom padding ── */}
      <div className="h-8 flex-shrink-0" />

      {/* ── Hit effects ── */}
      {hitEffects.map((eff) => (
        <div
          key={eff.key}
          className="fixed pointer-events-none"
          style={{
            left: eff.x - 20,
            top: eff.y - 20,
            zIndex: 50,
            animation: 'hitBurst 0.5s ease-out forwards',
          }}
        >
          <span className="text-4xl">{WHACK_EMOJI}</span>
        </div>
      ))}

      {/* ── Victory ── */}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} accentFrom={ACCENT_FROM} accentTo={ACCENT_TO} />
      )}

      {/* ── Custom animations ── */}
      <style jsx>{`
        @keyframes molePopUp {
          0% {
            transform: translateY(100%) scale(0.5);
            opacity: 0;
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes whackHit {
          0% {
            transform: scale(1) rotate(0deg);
          }
          30% {
            transform: scale(1.3) rotate(-10deg);
          }
          100% {
            transform: scale(0) rotate(20deg) translateY(40px);
            opacity: 0;
          }
        }
        @keyframes hitBurst {
          0% {
            transform: scale(0.5);
            opacity: 1;
          }
          50% {
            transform: scale(1.8);
            opacity: 0.8;
          }
          100% {
            transform: scale(2.5) translateY(-30px);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
