'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   PENDULUM — Polished timing game
   Real pendulum physics. Detailed conveyor with 
   rollers. Segmented rope. Articulated hook.
   ═══════════════════════════════════════════════ */

interface ConveyorItem {
  x: number;
  prize: Prize;
  speed: number;
  size: number;
  hue: number;
  bobPhase: number;
}

const GIFT_HUES = [0, 35, 55, 120, 210, 280, 340];

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

  // Real pendulum: angle + angular velocity
  const pendRef = useRef({ angle: 0.8, angVel: 0, dropping: false, hookY: 0, hookTargetY: 0, hookSpeed: 0 });
  const conveyorRef = useRef<ConveyorItem[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const timeRef = useRef(0);
  const caughtRef = useRef<Prize | null>(null);
  const retractingRef = useRef(false);
  const doneRef = useRef(false);

  const DAMPING = 0.9985;
  const G_ACCEL = 0.0012;

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const initConveyor = useCallback((w: number, prizes: Prize[]) => {
    const items: ConveyorItem[] = [];
    const count = 7 + Math.floor(Math.random() * 3);
    const spacing = (w + 300) / count;
    for (let i = 0; i < count; i++) {
      const prize = selectRandomPrize(prizes);
      items.push({
        x: -80 + i * spacing,
        prize,
        speed: 0.6 + Math.random() * 0.4,
        size: 38,
        hue: GIFT_HUES[Math.floor(Math.random() * GIFT_HUES.length)],
        bobPhase: Math.random() * Math.PI * 2,
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
    const pivotY = h * 0.07;
    const ropeLen = h * 0.38;
    const conveyorY = h * 0.72;

    pendRef.current = { angle: 0.8, angVel: 0, dropping: false, hookY: 0, hookTargetY: conveyorY - 8, hookSpeed: 0 };
    caughtRef.current = null;
    retractingRef.current = false;
    doneRef.current = false;
    initConveyor(w, prizes);
    timeRef.current = 0;

    const loop = () => {
      if (doneRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      timeRef.current++;

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(0.5, BG_MID);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle pattern
      ctx.strokeStyle = `rgba(${goldRgb},0.02)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < h; i += 30) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }

      const pend = pendRef.current;

      // Real pendulum physics (simple pendulum ODE)
      if (!pend.dropping) {
        const angAccel = -G_ACCEL * Math.sin(pend.angle);
        pend.angVel += angAccel;
        pend.angVel *= DAMPING;
        pend.angle += pend.angVel;
      }

      const hookX = pivotX + Math.sin(pend.angle) * ropeLen;
      let hookBaseY = pivotY + Math.cos(pend.angle) * ropeLen;

      // Hook drop/retract
      if (pend.dropping && !retractingRef.current) {
        pend.hookSpeed += 0.15;
        pend.hookY += pend.hookSpeed;
        if (pend.hookY >= pend.hookTargetY) {
          pend.hookY = pend.hookTargetY;
          // Check collision
          for (const item of conveyorRef.current) {
            const dx = hookX - item.x;
            const dy = pend.hookY - conveyorY;
            if (Math.abs(dx) < item.size * 0.6 && Math.abs(dy) < item.size * 0.8) {
              caughtRef.current = item.prize;
              conveyorRef.current = conveyorRef.current.filter(it => it !== item);
              try { getSoundEngine().impact(); } catch {}
              break;
            }
          }
          if (!caughtRef.current) { try { getSoundEngine().miss(); } catch {} }
          retractingRef.current = true;
          pend.hookSpeed = 0;
        }
      } else if (retractingRef.current) {
        pend.hookSpeed += 0.12;
        pend.hookY -= pend.hookSpeed;
        if (pend.hookY <= 0) {
          pend.hookY = 0;
          doneRef.current = true;
          const prize = caughtRef.current || selectRandomPrize(prizes);
          setWonPrize(prize);
          try { getSoundEngine().reveal(); } catch {}
          setTimeout(() => setPhase('victory'), 500);
          return;
        }
      }

      const actualHookY = pend.dropping ? hookBaseY + pend.hookY : hookBaseY;

      // === RENDER ===

      // Support beam — metal I-beam look
      const beamY = pivotY - 10;
      const beamGrad = ctx.createLinearGradient(0, beamY, 0, beamY + 18);
      beamGrad.addColorStop(0, '#6b5b4b');
      beamGrad.addColorStop(0.3, MAHOGANY);
      beamGrad.addColorStop(0.7, MAHOGANY);
      beamGrad.addColorStop(1, '#4a3a2a');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(w * 0.12, beamY, w * 0.76, 18);
      // Rivets
      ctx.fillStyle = GOLD + '60';
      for (let rx = w * 0.15; rx < w * 0.85; rx += 30) {
        ctx.beginPath(); ctx.arc(rx, beamY + 9, 3, 0, Math.PI * 2); ctx.fill();
      }
      // Beam highlight
      ctx.strokeStyle = GOLD + '15';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w * 0.12, beamY + 1); ctx.lineTo(w * 0.88, beamY + 1); ctx.stroke();

      // Rope — segmented chain
      const segments = 12;
      ctx.strokeStyle = GOLD + '90';
      ctx.lineWidth = 2;
      for (let s = 0; s < segments; s++) {
        const t1 = s / segments;
        const t2 = (s + 1) / segments;
        const x1 = pivotX + (hookX - pivotX) * t1;
        const y1 = pivotY + (actualHookY - pivotY) * t1;
        const x2 = pivotX + (hookX - pivotX) * t2;
        const y2 = pivotY + (actualHookY - pivotY) * t2;
        // Slight sag for each segment
        const midX = (x1 + x2) / 2;
        const sag = Math.sin(t1 * Math.PI) * 3 + Math.sin(timeRef.current * 0.05 + s) * 0.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(midX + sag * 0.3, (y1 + y2) / 2 + sag, x2, y2);
        ctx.stroke();
        // Chain links
        if (s % 2 === 0) {
          ctx.fillStyle = AMBER + '50';
          ctx.beginPath(); ctx.arc(x1, y1, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Pivot mount
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.arc(pivotX, pivotY, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = GOLD + '40';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Hook — articulated claw
      const hY = actualHookY;
      const openness = retractingRef.current ? 0.1 : (pend.dropping ? 0.2 : 0.8);

      // Hook body (metal cylinder)
      const hookGrad = ctx.createLinearGradient(hookX - 8, hY, hookX + 8, hY);
      hookGrad.addColorStop(0, '#888');
      hookGrad.addColorStop(0.5, '#bbb');
      hookGrad.addColorStop(1, '#888');
      ctx.fillStyle = hookGrad;
      ctx.beginPath(); ctx.roundRect(hookX - 7, hY - 4, 14, 14, 3); ctx.fill();
      ctx.strokeStyle = GOLD + '50';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Hook arms (3 prongs)
      const armLen = 16;
      const angles = [-openness * 0.6, 0, openness * 0.6];
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (const aOff of angles) {
        const ax = hookX + Math.sin(aOff) * armLen;
        const ay = hY + 10 + Math.cos(aOff) * armLen;
        ctx.beginPath();
        ctx.moveTo(hookX + Math.sin(aOff) * 3, hY + 10);
        ctx.lineTo(ax, ay);
        // Curved tip
        ctx.quadraticCurveTo(ax + Math.sin(aOff) * 3, ay + 3, ax - Math.sin(aOff) * 2, ay + 1);
        ctx.stroke();
      }

      // Caught prize
      if (caughtRef.current && (retractingRef.current || pend.dropping)) {
        ctx.font = '26px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(caughtRef.current.emoji, hookX, hY + armLen + 20);
      }

      // Conveyor belt — with rollers and depth
      const beltY = conveyorY + 22;
      const beltH = 28;
      // Belt depth
      ctx.fillStyle = `rgba(${mahoganyRgb},0.4)`;
      ctx.fillRect(0, beltY + beltH, w, 8);
      // Belt surface
      const beltGrad = ctx.createLinearGradient(0, beltY, 0, beltY + beltH);
      beltGrad.addColorStop(0, `rgba(${mahoganyRgb},0.75)`);
      beltGrad.addColorStop(0.5, `rgba(${mahoganyRgb},0.6)`);
      beltGrad.addColorStop(1, `rgba(${mahoganyRgb},0.75)`);
      ctx.fillStyle = beltGrad;
      ctx.fillRect(0, beltY, w, beltH);
      // Belt treads
      ctx.strokeStyle = GOLD + '10';
      ctx.lineWidth = 1;
      const treadOffset = (timeRef.current * 0.8) % 18;
      for (let tx = -18 + treadOffset; tx < w + 18; tx += 18) {
        ctx.beginPath();
        ctx.moveTo(tx, beltY);
        ctx.lineTo(tx - 6, beltY + beltH);
        ctx.stroke();
      }
      // Rollers at ends
      for (const rx of [20, w - 20]) {
        ctx.fillStyle = '#555';
        ctx.beginPath(); ctx.arc(rx, beltY + beltH / 2, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = GOLD + '30';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Roller spoke
        const sAngle = timeRef.current * 0.03;
        ctx.strokeStyle = '#777';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx + Math.cos(sAngle) * 7, beltY + beltH / 2 + Math.sin(sAngle) * 7);
        ctx.lineTo(rx - Math.cos(sAngle) * 7, beltY + beltH / 2 - Math.sin(sAngle) * 7);
        ctx.stroke();
      }

      // Conveyor items — colorful gift boxes
      for (const item of conveyorRef.current) {
        item.x += item.speed;
        if (item.x > w + 80) item.x = -80;

        const s = item.size;
        const bobY = Math.sin(timeRef.current * 0.04 + item.bobPhase) * 2;
        const gx = item.x;
        const gy = conveyorY - s + 14 + bobY;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.beginPath(); ctx.ellipse(gx, conveyorY + 16, s * 0.4, 4, 0, 0, Math.PI * 2); ctx.fill();

        // Box
        const grad = ctx.createLinearGradient(gx - s / 2, gy, gx + s / 2, gy + s);
        grad.addColorStop(0, `hsl(${item.hue}, 55%, 58%)`);
        grad.addColorStop(1, `hsl(${item.hue}, 60%, 38%)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(gx - s / 2, gy, s, s, 6); ctx.fill();
        ctx.strokeStyle = `hsla(${item.hue}, 55%, 72%, 0.4)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Lid
        ctx.fillStyle = `hsla(${item.hue}, 55%, 68%, 0.2)`;
        ctx.fillRect(gx - s / 2 + 2, gy + 2, s - 4, s * 0.25);

        // Ribbon
        const rh = (item.hue + 40) % 360;
        ctx.strokeStyle = `hsla(${rh}, 70%, 78%, 0.6)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + s);
        ctx.moveTo(gx - s / 2, gy + s / 2); ctx.lineTo(gx + s / 2, gy + s / 2);
        ctx.stroke();

        // Emoji
        ctx.font = `${s * 0.35}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.prize.emoji, gx, gy + s / 2 + 2);

        // Name tag below
        ctx.fillStyle = CREAM + '40';
        ctx.font = 'bold 8px system-ui';
        ctx.fillText(item.prize.name.substring(0, 10), gx, conveyorY + 14);
      }

      // Drop guide
      if (!pend.dropping) {
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = `rgba(${goldRgb},0.1)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hookX, actualHookY + 30);
        ctx.lineTo(hookX, conveyorY - 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Instructions
      if (!pend.dropping) {
        ctx.fillStyle = CREAM + '30';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('APPUYEZ pour lâcher le crochet', w / 2, h - 28);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, initConveyor, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO, goldRgb, creamRgb, mahoganyRgb]);

  const handleTap = () => {
    if (phaseRef.current !== 'playing') return;
    const pend = pendRef.current;
    if (pend.dropping) return;
    pend.dropping = true;
    pend.hookY = 0;
    pend.hookSpeed = 0;
    try { getSoundEngine().swoosh(); } catch {}
  };

  const start = () => { setWonPrize(null); caughtRef.current = null; setPhase('playing'); };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={handleTap} onMouseDown={handleTap} />
      )}
      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🪝</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Pendulum</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Le pendule oscille. Tapez au bon moment<br/>pour attraper un cadeau !
          </p>
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`, boxShadow: `0 12px 40px -10px ${GOLD}80`,
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
