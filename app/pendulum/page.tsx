'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   PENDULUM — Timing hook drop
   Pendulum swings. Gifts on conveyor belt below.
   Tap to drop the hook. Pure timing skill.
   ═══════════════════════════════════════════════ */

interface ConveyorItem {
  x: number;
  prize: Prize;
  speed: number;
  size: number;
}

export default function Pendulum({ theme }: { theme?: GameTheme }) {
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

  const pendulumRef = useRef({ angle: 0, speed: 0.025, dropping: false, hookY: 0, hookTargetY: 0 });
  const conveyorRef = useRef<ConveyorItem[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const timeRef = useRef(0);
  const caughtRef = useRef<Prize | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const initConveyor = useCallback((w: number, prizes: Prize[]) => {
    const items: ConveyorItem[] = [];
    const count = 6 + Math.floor(Math.random() * 3);
    const spacing = (w + 200) / count;
    const sorted = [...prizes].filter(p => p.quantity > 0).sort((a, b) => a.quantity - b.quantity);

    for (let i = 0; i < count; i++) {
      // Rarer prizes move faster
      const prize = selectRandomPrize(prizes);
      const rarity = sorted.findIndex(p => p.name === prize.name);
      const baseSpeed = 0.8;
      const speed = baseSpeed + (rarity >= 0 ? rarity * 0.15 : 0) + Math.random() * 0.3;

      items.push({
        x: -100 + i * spacing,
        prize,
        speed,
        size: 36,
      });
    }
    conveyorRef.current = items;
  }, []);

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

    const pivotX = w / 2;
    const pivotY = h * 0.08;
    const ropeLen = h * 0.35;
    const conveyorY = h * 0.75;

    pendulumRef.current = { angle: 0, speed: 0.025, dropping: false, hookY: 0, hookTargetY: 0 };
    caughtRef.current = null;
    initConveyor(w, prizes);
    timeRef.current = 0;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      timeRef.current++;

      // Background
      const bgGrad = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, h);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(0.5, BG_MID);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      const pend = pendulumRef.current;

      // Pendulum swing (simple harmonic)
      if (!pend.dropping) {
        pend.angle = Math.sin(timeRef.current * pend.speed) * 0.8; // ±0.8 rad (~45°)
      }

      const hookX = pivotX + Math.sin(pend.angle) * ropeLen;
      let hookY = pivotY + Math.cos(pend.angle) * ropeLen;

      // Hook drop animation
      if (pend.dropping) {
        pend.hookY += (pend.hookTargetY - pend.hookY) * 0.08;
        hookY = pend.hookY;

        // Check if hook reached target
        if (Math.abs(pend.hookY - pend.hookTargetY) < 2) {
          if (!caughtRef.current) {
            // Check collision with conveyor items
            for (const item of conveyorRef.current) {
              const dx = hookX - item.x;
              const dy = hookY - conveyorY;
              if (Math.abs(dx) < item.size * 0.7 && Math.abs(dy) < item.size * 0.7) {
                caughtRef.current = item.prize;
                try { getSoundEngine().impact(); } catch {}
                break;
              }
            }
            if (!caughtRef.current) {
              try { getSoundEngine().miss(); } catch {}
            }

            // Start retracting
            pend.hookTargetY = pivotY + Math.cos(pend.angle) * ropeLen;
          }

          // If retracted back up
          if (pend.hookTargetY < conveyorY && Math.abs(pend.hookY - pend.hookTargetY) < 5) {
            const prize = caughtRef.current || selectRandomPrize(prizes);
            setWonPrize(prize);
            try { getSoundEngine().swish(); } catch {}
            setTimeout(() => setPhase('victory'), 600);
            return;
          }
        }
      } else {
        pend.hookY = hookY;
      }

      // Draw support beam
      ctx.fillStyle = MAHOGANY;
      ctx.fillRect(w * 0.2, pivotY - 8, w * 0.6, 12);
      ctx.strokeStyle = GOLD + '40';
      ctx.lineWidth = 1;
      ctx.strokeRect(w * 0.2, pivotY - 8, w * 0.6, 12);

      // Draw rope
      ctx.strokeStyle = GOLD + '80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.lineTo(hookX, pend.dropping ? pend.hookY : hookY);
      ctx.stroke();

      // Draw hook
      const hY = pend.dropping ? pend.hookY : hookY;
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(hookX, hY + 8, 8, 0, Math.PI, false);
      ctx.stroke();

      // Draw caught prize on hook
      if (caughtRef.current && pend.dropping) {
        ctx.font = '24px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(caughtRef.current.emoji, hookX, hY + 28);
      }

      // Conveyor belt
      ctx.fillStyle = `rgba(${mahoganyRgb},0.6)`;
      ctx.fillRect(0, conveyorY + 20, w, 30);
      // Belt lines
      ctx.strokeStyle = GOLD + '15';
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 20) {
        const offset = (timeRef.current * 0.8) % 20;
        ctx.beginPath();
        ctx.moveTo(i + offset, conveyorY + 20);
        ctx.lineTo(i + offset - 10, conveyorY + 50);
        ctx.stroke();
      }

      // Conveyor items
      for (const item of conveyorRef.current) {
        item.x += item.speed;
        if (item.x > w + 60) item.x = -60;

        // Gift box
        const s = item.size;
        const grad = ctx.createLinearGradient(item.x - s / 2, conveyorY - s, item.x + s / 2, conveyorY);
        grad.addColorStop(0, GOLD + 'cc');
        grad.addColorStop(1, AMBER + 'cc');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(item.x - s / 2, conveyorY - s + 10, s, s, 6);
        ctx.fill();
        ctx.strokeStyle = CREAM + '30';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Emoji
        ctx.font = `${s * 0.45}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.prize.emoji, item.x, conveyorY - s / 2 + 12);

        // Name
        ctx.fillStyle = CREAM + '50';
        ctx.font = 'bold 8px system-ui';
        ctx.fillText(item.prize.name.substring(0, 8), item.x, conveyorY + 14);
      }

      // Drop zone indicator
      if (!pend.dropping) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = `rgba(${goldRgb},0.15)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hookX, hookY + 20);
        ctx.lineTo(hookX, conveyorY - 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Instruction
      if (!pend.dropping) {
        ctx.fillStyle = CREAM + '30';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('APPUYEZ pour lâcher le crochet', w / 2, h - 30);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, initConveyor, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO, goldRgb, creamRgb, mahoganyRgb]);

  const handleTap = () => {
    if (phaseRef.current !== 'playing') return;
    const pend = pendulumRef.current;
    if (pend.dropping) return;

    pend.dropping = true;
    pend.hookTargetY = sizeRef.current.h * 0.75 - 10;
    try { getSoundEngine().swoosh(); } catch {}
  };

  const start = () => {
    setWonPrize(null);
    caughtRef.current = null;
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
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🪝</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Pendulum</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Le pendule se balance. Tapez au bon moment<br/>pour attraper un cadeau sur le tapis !
          </p>
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
            boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>Commencer</button>
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
