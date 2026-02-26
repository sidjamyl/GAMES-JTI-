'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';

/* ═══════════════════════════════════════════════
   WHAC-A-MOLE — Winston & Camel Edition
   Harder difficulty, faster moles, no rigging.
   If time runs out without enough hits → lose.
   ═══════════════════════════════════════════════ */

const GOLD = '#d4a843';
const GOLD_BRIGHT = '#e8c36a';
const AMBER = '#c9842b';
const CREAM = '#f5e6c8';
const SIENNA = '#a0522d';

const GRID_SIZE = 9;
const GAME_DURATION = 15;
const REQUIRED_HITS = 10;
const MOLE_SHOW_MIN = 280;
const MOLE_SHOW_MAX = 520;
const SPAWN_INTERVAL_START = 420;
const SPAWN_INTERVAL_END = 140;

const MOLE_EMOJI = '🐹';
const WHACK_EMOJI = '💥';

interface Hole {
  id: number;
  hasMole: boolean;
  whacked: boolean;
  showTime: number;
  duration: number;
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
  const [gameOver, setGameOver] = useState(false);

  const scoreRef = useRef(0);
  const phaseRef = useRef<GamePhase>('loading');
  const holesRef = useRef<Hole[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moleTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const effectKeyRef = useRef(0);
  const comboRef = useRef(0);
  const timeLeftRef = useRef(GAME_DURATION);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { holesRef.current = holes; }, [holes]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const initHoles = useCallback((): Hole[] => {
    return Array.from({ length: GRID_SIZE }, (_, i) => ({
      id: i, hasMole: false, whacked: false, showTime: 0, duration: 0,
    }));
  }, []);

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (spawnRef.current) { clearTimeout(spawnRef.current); spawnRef.current = null; }
    moleTimersRef.current.forEach((t) => clearTimeout(t));
    moleTimersRef.current.clear();
  }, []);

  const hideMole = useCallback((holeId: number) => {
    setHoles((prev) => {
      const next = prev.map((h) => h.id === holeId ? { ...h, hasMole: false, whacked: false } : h);
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
      spawnRef.current = setTimeout(spawnMole, 150);
      return;
    }

    const target = emptyHoles[Math.floor(Math.random() * emptyHoles.length)];
    const duration = MOLE_SHOW_MIN + Math.random() * (MOLE_SHOW_MAX - MOLE_SHOW_MIN);

    setHoles((prev) => {
      const next = prev.map((h) =>
        h.id === target.id ? { ...h, hasMole: true, whacked: false, showTime: Date.now(), duration } : h
      );
      holesRef.current = next;
      return next;
    });

    const hideTimer = setTimeout(() => {
      if (phaseRef.current === 'playing') hideMole(target.id);
    }, duration);
    moleTimersRef.current.set(target.id, hideTimer);

    const elapsed = GAME_DURATION - timeLeftRef.current;
    const progress = Math.min(elapsed / GAME_DURATION, 1);
    const interval = SPAWN_INTERVAL_START - (SPAWN_INTERVAL_START - SPAWN_INTERVAL_END) * progress;
    const extraSpawn = progress > 0.25 && Math.random() < 0.55;

    spawnRef.current = setTimeout(() => {
      spawnMole();
      if (extraSpawn) setTimeout(spawnMole, 80);
    }, interval + Math.random() * 150);
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

      getSoundEngine().impact();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const key = ++effectKeyRef.current;
      setHitEffects((prev) => [...prev, { id: holeId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, key }]);
      setTimeout(() => { setHitEffects((prev) => prev.filter((e) => e.key !== key)); }, 500);

      setHoles((prev) => {
        const next = prev.map((h) => h.id === holeId ? { ...h, whacked: true } : h);
        holesRef.current = next;
        return next;
      });

      const t = moleTimersRef.current.get(holeId);
      if (t) clearTimeout(t);
      setTimeout(() => hideMole(holeId), 300);

      const newScore = scoreRef.current + 1;
      scoreRef.current = newScore;
      setScore(newScore);

      comboRef.current += 1;
      setCombo(comboRef.current);
      setShowCombo(true);
      setTimeout(() => setShowCombo(false), 600);

      if (newScore >= REQUIRED_HITS) triggerWin();
    },
    [hideMole, triggerWin]
  );

  const missedTap = useCallback((holeId: number) => {
    if (phaseRef.current !== 'playing') return;
    const hole = holesRef.current.find((h) => h.id === holeId);
    if (hole && !hole.hasMole) {
      getSoundEngine().miss();
      setMisses((m) => m + 1);
      comboRef.current = 0;
      setCombo(0);
    }
  }, []);

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
    setGameOver(false);
    setPhase('playing');

    // Countdown — NO rigging, NO time extension
    timerRef.current = setInterval(() => {
      timeLeftRef.current -= 1;
      setTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 0) {
        clearAllTimers();
        if (scoreRef.current >= REQUIRED_HITS) {
          setPhase('victory');
          const prize = selectRandomPrize(prizes);
          setWonPrize(prize);
        } else {
          // Game over — lost
          setGameOver(true);
          setPhase('ready');
        }
      }
    }, 1000);

    setTimeout(() => spawnMole(), 400);
  }, [initHoles, clearAllTimers, prizes, spawnMole]);

  useEffect(() => { return () => clearAllTimers(); }, [clearAllTimers]);

  const progressPct = Math.min((score / REQUIRED_HITS) * 100, 100);
  const timePct = (timeLeft / GAME_DURATION) * 100;

  return (
    <div
      className="game-container noise-overlay flex flex-col items-center justify-between"
      style={{
        background: 'radial-gradient(ellipse at 50% 30%, #1e1209 0%, #120b05 50%, #0a0604 100%)',
        padding: '0 16px',
      }}
    >
      {/* Header */}
      <div className="w-full max-w-[380px] flex flex-col items-center pt-10 pb-2" style={{ animation: 'fadeInUp 0.5s ease-out both', zIndex: 10 }}>
        <h1 className="text-[28px] font-extrabold tracking-tight text-center"
          style={{ background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Whac-A-Mole
        </h1>
        <p style={{ color: CREAM + '40' }} className="text-xs mt-1">Tapez les taupes pour gagner !</p>
      </div>

      {/* Score & Timer */}
      {phase === 'playing' && (
        <div className="w-full max-w-[380px] flex flex-col gap-2 px-2" style={{ animation: 'fadeIn 0.3s ease-out both', zIndex: 10 }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span style={{ color: CREAM + '60' }} className="text-xs font-semibold uppercase tracking-wider">Score</span>
              <span className="text-lg font-extrabold"
                style={{ background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {score}/{REQUIRED_HITS}
              </span>
            </div>
            {showCombo && combo > 1 && (
              <span className="text-sm font-black" style={{ color: GOLD, animation: 'scaleIn 0.3s ease-out both' }}>
                x{combo} COMBO!
              </span>
            )}
            <div className="flex items-center gap-2">
              <span style={{ color: CREAM + '60' }} className="text-xs font-semibold uppercase tracking-wider">Temps</span>
              <span className="text-lg font-extrabold tabular-nums"
                style={{ color: timeLeft <= 5 ? '#ef4444' : CREAM + 'cc', animation: timeLeft <= 5 ? 'subtlePulse 0.5s ease-in-out infinite' : undefined }}>
                {timeLeft}s
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(212,168,67,0.08)' }}>
            <div className="h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${GOLD}, ${AMBER})`, boxShadow: `0 0 12px ${GOLD}60` }} />
          </div>

          {/* Time bar */}
          <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(245,230,200,0.04)' }}>
            <div className="h-full rounded-full transition-all duration-1000 linear"
              style={{ width: `${timePct}%`, background: timeLeft <= 5 ? 'linear-gradient(90deg, #ef4444, #f97316)' : `linear-gradient(90deg, ${CREAM}40, ${CREAM}20)` }} />
          </div>
        </div>
      )}

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
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-6xl"
              style={{
                background: `linear-gradient(135deg, ${GOLD}15, ${AMBER}15)`,
                border: `2px solid ${GOLD}25`,
                animation: 'victoryFloat 2.5s ease-in-out infinite',
              }}>
              {MOLE_EMOJI}
            </div>
            <p style={{ color: CREAM + '50' }} className="text-sm text-center max-w-[260px]">
              Tapez sur les taupes avant qu&apos;elles disparaissent !<br />
              <span style={{ color: CREAM + '25' }} className="text-xs">
                {REQUIRED_HITS} taupes pour gagner en {GAME_DURATION}s
              </span>
            </p>
            {gameOver && (
              <p className="text-sm font-bold" style={{ color: '#ef4444', animation: 'fadeIn 0.3s ease-out both' }}>
                Temps écoulé ! Réessayez 💪
              </p>
            )}
            <button onClick={startGame}
              className="px-10 py-4 rounded-2xl text-white font-bold text-[15px] tracking-wide transition-all duration-200 active:scale-[0.97]"
              style={{ background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, boxShadow: `0 8px 30px -8px ${GOLD}80` }}>
              {gameOver ? 'Réessayer 🔨' : "C'est parti ! 🔨"}
            </button>
          </div>
        )}

        {phase === 'playing' && (
          <div className="grid grid-cols-3 gap-4 w-full max-w-[340px]" style={{ animation: 'scaleIn 0.3s ease-out both' }}>
            {holes.map((hole) => (
              <button
                key={hole.id}
                onPointerDown={(e) => {
                  if (hole.hasMole && !hole.whacked) whackMole(hole.id, e);
                  else missedTap(hole.id);
                }}
                className="relative aspect-square rounded-3xl overflow-hidden transition-transform duration-100 active:scale-95"
                style={{
                  background: `radial-gradient(circle at 50% 60%, #2a1810, #140c06)`,
                  border: `2px solid ${hole.hasMole && !hole.whacked ? GOLD + '40' : GOLD + '08'}`,
                  boxShadow: hole.hasMole && !hole.whacked
                    ? `inset 0 -8px 20px rgba(0,0,0,0.5), 0 0 20px ${GOLD}25`
                    : 'inset 0 -8px 20px rgba(0,0,0,0.5)',
                }}
              >
                <div className="absolute inset-2 rounded-2xl"
                  style={{ background: 'radial-gradient(ellipse at 50% 80%, rgba(0,0,0,0.6), transparent 70%)' }} />

                {hole.hasMole && (
                  <div className="absolute inset-0 flex items-center justify-center"
                    style={{ animation: hole.whacked ? 'whackHit 0.3s ease-out forwards' : 'molePopUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
                    <span className="text-5xl select-none"
                      style={{
                        filter: hole.whacked ? 'grayscale(1) brightness(0.5)' : 'none',
                        transform: hole.whacked ? 'scale(0.7)' : 'scale(1)',
                        transition: 'filter 0.2s, transform 0.2s',
                      }}>
                      {hole.whacked ? WHACK_EMOJI : MOLE_EMOJI}
                    </span>
                  </div>
                )}

                {hole.hasMole && !hole.whacked && (
                  <div className="absolute inset-0 rounded-3xl pointer-events-none"
                    style={{ border: `2px solid ${GOLD}40`, animation: 'subtlePulse 0.8s ease-in-out infinite' }} />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-8 flex-shrink-0" />

      {/* Hit effects */}
      {hitEffects.map((eff) => (
        <div key={eff.key} className="fixed pointer-events-none"
          style={{ left: eff.x - 20, top: eff.y - 20, zIndex: 50, animation: 'hitBurst 0.5s ease-out forwards' }}>
          <span className="text-4xl">{WHACK_EMOJI}</span>
        </div>
      ))}

      {/* Victory */}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} accentFrom={GOLD} accentTo={AMBER} />
      )}

      <style jsx>{`
        @keyframes molePopUp {
          0% { transform: translateY(100%) scale(0.5); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes whackHit {
          0% { transform: scale(1) rotate(0deg); }
          30% { transform: scale(1.3) rotate(-10deg); }
          100% { transform: scale(0) rotate(20deg) translateY(40px); opacity: 0; }
        }
        @keyframes hitBurst {
          0% { transform: scale(0.5); opacity: 1; }
          50% { transform: scale(1.8); opacity: 0.8; }
          100% { transform: scale(2.5) translateY(-30px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
