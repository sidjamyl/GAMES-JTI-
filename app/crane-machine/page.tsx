'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   CRANE MACHINE — Classic claw game (top-down)
   Claw moves auto horizontal → tap to go vertical
   → tap again to drop. Physics claw.
   ═══════════════════════════════════════════════ */

interface GiftBox {
  x: number;
  y: number;
  size: number;
  prize: Prize;
  rotation: number;
}

type ClawPhase = 'moving-x' | 'moving-y' | 'dropping' | 'grabbing' | 'retracting' | 'done';

export default function CraneMachine({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);
  const mahoganyRgb = hexToRgb(MAHOGANY);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  const clawRef = useRef({ x: 0, y: 50, openness: 1, targetY: 0, grabbed: null as Prize | null });
  const clawPhaseRef = useRef<ClawPhase>('moving-x');
  const clawDirRef = useRef(1);
  const clawSpeedRef = useRef(2.5);
  const giftsRef = useRef<GiftBox[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  useEffect(() => {
    if (phase !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const w = rect.width;
    const h = rect.height;
    sizeRef.current = { w, h };

    // Scatter gifts in the play area
    const gifts: GiftBox[] = [];
    const playAreaTop = h * 0.45;
    const playAreaBottom = h * 0.85;
    const count = 8 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      gifts.push({
        x: 30 + Math.random() * (w - 60),
        y: playAreaTop + Math.random() * (playAreaBottom - playAreaTop),
        size: 28 + Math.random() * 12,
        prize: selectRandomPrize(prizes),
        rotation: (Math.random() - 0.5) * 0.4,
      });
    }
    giftsRef.current = gifts;

    clawRef.current = { x: w / 2, y: 50, openness: 1, targetY: 0, grabbed: null };
    clawPhaseRef.current = 'moving-x';
    clawDirRef.current = 1;
    clawSpeedRef.current = 2.5;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Machine background
      ctx.fillStyle = BG_DARK;
      ctx.fillRect(0, 0, w, h);

      // Glass case
      ctx.fillStyle = `rgba(${mahoganyRgb},0.15)`;
      ctx.fillRect(10, 35, w - 20, h * 0.88);
      ctx.strokeStyle = GOLD + '30';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 35, w - 20, h * 0.88);

      // Top rail
      ctx.fillStyle = MAHOGANY;
      ctx.fillRect(10, 30, w - 20, 14);
      ctx.strokeStyle = GOLD + '50';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 30, w - 20, 14);

      const claw = clawRef.current;
      const cp = clawPhaseRef.current;

      // Claw movement
      if (cp === 'moving-x') {
        claw.x += clawSpeedRef.current * clawDirRef.current;
        if (claw.x > w - 30) clawDirRef.current = -1;
        if (claw.x < 30) clawDirRef.current = 1;
      } else if (cp === 'dropping') {
        claw.y += 2.5;
        claw.openness = Math.max(0.3, claw.openness - 0.01);
        const targetY = h * 0.75;
        if (claw.y >= targetY) {
          clawPhaseRef.current = 'grabbing';
          // Check for grab
          let bestDist = 40;
          let bestGift: GiftBox | null = null;
          for (const g of giftsRef.current) {
            const dx = claw.x - g.x;
            const dy = claw.y - g.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
              bestDist = dist;
              bestGift = g;
            }
          }
          if (bestGift) {
            // 70% grab success (claw sometimes slips)
            if (Math.random() < 0.75) {
              claw.grabbed = bestGift.prize;
              giftsRef.current = giftsRef.current.filter(g => g !== bestGift);
              try { getSoundEngine().impact(); } catch {}
            } else {
              try { getSoundEngine().miss(); } catch {}
            }
          } else {
            try { getSoundEngine().miss(); } catch {}
          }
          claw.openness = 0;
          setTimeout(() => { clawPhaseRef.current = 'retracting'; }, 400);
        }
      } else if (cp === 'retracting') {
        claw.y -= 2;
        if (claw.y <= 50) {
          claw.y = 50;
          clawPhaseRef.current = 'done';
          const prize = claw.grabbed || selectRandomPrize(prizes);
          setWonPrize(prize);
          try { getSoundEngine().swish(); } catch {}
          setTimeout(() => setPhase('victory'), 800);
          return;
        }
      }

      // Draw gifts
      for (const gift of giftsRef.current) {
        ctx.save();
        ctx.translate(gift.x, gift.y);
        ctx.rotate(gift.rotation);
        const s = gift.size;

        // Box
        const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
        grad.addColorStop(0, GOLD + 'cc');
        grad.addColorStop(1, AMBER + 'cc');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(-s / 2, -s / 2, s, s, 5);
        ctx.fill();
        ctx.strokeStyle = CREAM + '25';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Ribbon
        ctx.strokeStyle = CREAM + '40';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -s / 2); ctx.lineTo(0, s / 2);
        ctx.moveTo(-s / 2, 0); ctx.lineTo(s / 2, 0);
        ctx.stroke();

        // Emoji
        ctx.font = `${s * 0.4}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gift.prize.emoji, 0, 2);
        ctx.restore();
      }

      // Draw cable
      ctx.strokeStyle = GOLD + '80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(claw.x, 44);
      ctx.lineTo(claw.x, claw.y - 10);
      ctx.stroke();

      // Draw claw
      const clawY = claw.y;
      const open = claw.openness;
      const armLen = 18;

      // Claw body
      ctx.fillStyle = MAHOGANY;
      ctx.beginPath();
      ctx.arc(claw.x, clawY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Left arm
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(claw.x - 4, clawY + 4);
      ctx.lineTo(claw.x - 4 - open * 12, clawY + armLen);
      ctx.stroke();

      // Right arm
      ctx.beginPath();
      ctx.moveTo(claw.x + 4, clawY + 4);
      ctx.lineTo(claw.x + 4 + open * 12, clawY + armLen);
      ctx.stroke();

      // Grabbed prize
      if (claw.grabbed && (cp === 'grabbing' || cp === 'retracting' || cp === 'done')) {
        ctx.font = '22px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(claw.grabbed.emoji, claw.x, clawY + armLen + 8);
      }

      // Drop zone indicator
      if (cp === 'moving-x') {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = `rgba(${goldRgb},0.1)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(claw.x, claw.y + 20);
        ctx.lineTo(claw.x, h * 0.8);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Instructions
      ctx.fillStyle = CREAM + '30';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      if (cp === 'moving-x') {
        ctx.fillText('APPUYEZ pour stopper la pince', w / 2, h - 16);
      } else if (cp === 'dropping') {
        ctx.fillText('La pince descend...', w / 2, h - 16);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO, goldRgb, creamRgb, mahoganyRgb]);

  const handleTap = () => {
    if (phaseRef.current !== 'playing') return;
    const cp = clawPhaseRef.current;
    if (cp === 'moving-x') {
      clawPhaseRef.current = 'dropping';
      try { getSoundEngine().peg(0); } catch {}
    }
  };

  const start = () => {
    setWonPrize(null);
    setPhase('playing');
  };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
          onTouchStart={handleTap}
          onMouseDown={handleTap}
        />
      )}

      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🏗️</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Crane Machine</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            La pince bouge toute seule.<br/>Tapez au bon moment pour attraper un cadeau !
          </p>
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
            boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>Jouer</button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: BG_DARK }}>
          <div className="w-8 h-8 border-2 rounded-full" style={{ borderColor: `${GOLD}30`, borderTopColor: GOLD, animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} onClose={() => setPhase('ready')} accentFrom={GOLD} accentTo={AMBER} />
      )}
    </div>
  );
}
