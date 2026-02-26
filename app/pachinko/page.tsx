'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   PACHINKO VERTICAL — Flipper with bumpers
   Ball falls from top, 2 flippers at bottom, 
   bumpers in the middle, slots for prizes.
   ═══════════════════════════════════════════════ */

interface Bumper {
  x: number;
  y: number;
  r: number;
  flash: number;
}

interface Peg {
  x: number;
  y: number;
  r: number;
}

interface Slot {
  x: number;
  w: number;
  prize: Prize;
}

export default function PachinkoVertical({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  const ballRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, active: false });
  const bumpersRef = useRef<Bumper[]>([]);
  const pegsRef = useRef<Peg[]>([]);
  const slotsRef = useRef<Slot[]>([]);
  const flipperLeft = useRef({ angle: 0.4, active: false });
  const flipperRight = useRef({ angle: -0.4, active: false });
  const touchRef = useRef({ left: false, right: false });
  const sizeRef = useRef({ w: 0, h: 0 });
  const launchedRef = useRef(false);

  const BALL_R = 8;
  const GRAVITY = 0.12;
  const FRICTION = 0.998;
  const FLIPPER_LEN = 50;
  const FLIPPER_W = 6;

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

    // Setup bumpers (3 large)
    const bumpers: Bumper[] = [
      { x: w * 0.5, y: h * 0.28, r: 22, flash: 0 },
      { x: w * 0.28, y: h * 0.42, r: 18, flash: 0 },
      { x: w * 0.72, y: h * 0.42, r: 18, flash: 0 },
    ];
    bumpersRef.current = bumpers;

    // Setup pegs (grid of small pins)
    const pegs: Peg[] = [];
    const rows = 6;
    const cols = 7;
    const startY = h * 0.2;
    const endY = h * 0.62;
    const rowSpacing = (endY - startY) / rows;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 0 ? 0 : (w / cols) / 2;
      for (let c = 0; c < cols; c++) {
        const px = (w / cols) * (c + 0.5) + offset;
        const py = startY + r * rowSpacing;
        // Check not overlapping with bumpers
        let skip = false;
        for (const b of bumpers) {
          const dx = px - b.x;
          const dy = py - b.y;
          if (Math.sqrt(dx * dx + dy * dy) < b.r + 12) { skip = true; break; }
        }
        if (px > 10 && px < w - 10 && !skip) {
          pegs.push({ x: px, y: py, r: 3 });
        }
      }
    }
    pegsRef.current = pegs;

    // Setup slots (prize zones at bottom)
    const slotCount = 5;
    const slotW = (w - 20) / slotCount;
    const slots: Slot[] = [];
    const sortedPrizes = [...prizes].sort((a, b) => a.quantity - b.quantity);
    for (let i = 0; i < slotCount; i++) {
      // Center slots = rarer prizes
      const rarity = i === Math.floor(slotCount / 2)
        ? 0  // center = rarest
        : Math.abs(i - Math.floor(slotCount / 2));
      const prizeIdx = Math.min(rarity, sortedPrizes.length - 1);
      slots.push({
        x: 10 + i * slotW,
        w: slotW,
        prize: sortedPrizes[prizeIdx] || selectRandomPrize(prizes),
      });
    }
    slotsRef.current = slots;

    // Init ball at top center
    ballRef.current = {
      x: w / 2 + (Math.random() - 0.5) * 40,
      y: 20,
      vx: (Math.random() - 0.5) * 1.5,
      vy: 0.5,
      active: true,
    };
    launchedRef.current = true;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = BG_DARK;
      ctx.fillRect(0, 0, w, h);

      // Machine frame
      ctx.strokeStyle = GOLD + '20';
      ctx.lineWidth = 3;
      ctx.strokeRect(5, 5, w - 10, h - 10);

      const ball = ballRef.current;
      if (ball.active) {
        // Apply gravity
        ball.vy += GRAVITY;
        ball.vx *= FRICTION;
        ball.vy *= FRICTION;
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Wall bounces
        if (ball.x < BALL_R + 10) { ball.x = BALL_R + 10; ball.vx = Math.abs(ball.vx) * 0.7; }
        if (ball.x > w - BALL_R - 10) { ball.x = w - BALL_R - 10; ball.vx = -Math.abs(ball.vx) * 0.7; }

        // Peg collisions
        for (const peg of pegsRef.current) {
          const dx = ball.x - peg.x;
          const dy = ball.y - peg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < BALL_R + peg.r) {
            const nx = dx / dist;
            const ny = dy / dist;
            ball.x = peg.x + nx * (BALL_R + peg.r + 0.5);
            ball.y = peg.y + ny * (BALL_R + peg.r + 0.5);
            const dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 1.6 * dot * nx;
            ball.vy -= 1.6 * dot * ny;
            ball.vx += (Math.random() - 0.5) * 0.3;
            try { getSoundEngine().peg(0.3 + Math.random() * 0.7); } catch {}
          }
        }

        // Bumper collisions
        for (const b of bumpersRef.current) {
          const dx = ball.x - b.x;
          const dy = ball.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < BALL_R + b.r) {
            const nx = dx / dist;
            const ny = dy / dist;
            ball.x = b.x + nx * (BALL_R + b.r + 1);
            ball.y = b.y + ny * (BALL_R + b.r + 1);
            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            const boost = Math.max(speed * 1.8, 4);
            ball.vx = nx * boost;
            ball.vy = ny * boost;
            b.flash = 1;
            try { getSoundEngine().impact(); } catch {}
          }
        }

        // Flipper collisions
        const flipperY = h * 0.82;
        const flipperBaseL = { x: w * 0.3, y: flipperY };
        const flipperBaseR = { x: w * 0.7, y: flipperY };
        
        // Left flipper
        const lAngle = flipperLeft.current.active ? -0.5 : 0.4;
        flipperLeft.current.angle += (lAngle - flipperLeft.current.angle) * 0.3;
        const lTipX = flipperBaseL.x + Math.cos(flipperLeft.current.angle) * FLIPPER_LEN;
        const lTipY = flipperBaseL.y + Math.sin(flipperLeft.current.angle) * FLIPPER_LEN;
        checkFlipperCollision(ball, flipperBaseL.x, flipperBaseL.y, lTipX, lTipY, flipperLeft.current.active);

        // Right flipper
        const rAngle = flipperRight.current.active ? Math.PI + 0.5 : Math.PI - 0.4;
        flipperRight.current.angle += (rAngle - flipperRight.current.angle) * 0.3;
        const rTipX = flipperBaseR.x + Math.cos(flipperRight.current.angle) * FLIPPER_LEN;
        const rTipY = flipperBaseR.y + Math.sin(flipperRight.current.angle) * FLIPPER_LEN;
        checkFlipperCollision(ball, flipperBaseR.x, flipperBaseR.y, rTipX, rTipY, flipperRight.current.active);

        // Check slots
        if (ball.y > h * 0.9) {
          ball.active = false;
          let slot: Slot | undefined;
          for (const s of slotsRef.current) {
            if (ball.x >= s.x && ball.x < s.x + s.w) { slot = s; break; }
          }
          const prize = slot ? slot.prize : selectRandomPrize(prizes);
          setWonPrize(prize);
          try { getSoundEngine().victory(); } catch {}
          setTimeout(() => setPhase('victory'), 600);
        }

        // Fell off bottom without slot — safety
        if (ball.y > h + 20) {
          ball.active = false;
          setWonPrize(selectRandomPrize(prizes));
          setTimeout(() => setPhase('victory'), 300);
        }
      }

      // === RENDER ===

      // Pegs
      for (const peg of pegsRef.current) {
        ctx.fillStyle = GOLD + '60';
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Bumpers
      for (const b of bumpersRef.current) {
        b.flash = Math.max(0, b.flash - 0.03);
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        grad.addColorStop(0, b.flash > 0 ? GOLD_BRIGHT : MAHOGANY);
        grad.addColorStop(1, b.flash > 0 ? AMBER : MAHOGANY + '80');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = GOLD + (b.flash > 0 ? 'ff' : '40');
        ctx.lineWidth = 2;
        ctx.stroke();
        if (b.flash > 0) {
          ctx.shadowColor = GOLD;
          ctx.shadowBlur = 15 * b.flash;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // Flippers
      const flipperY = h * 0.82;
      const drawFlipper = (bx: number, by: number, angle: number, mirror: boolean) => {
        const tipX = bx + Math.cos(angle) * FLIPPER_LEN;
        const tipY = by + Math.sin(angle) * FLIPPER_LEN;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = FLIPPER_W;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        // Pivot point
        ctx.fillStyle = AMBER;
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();
      };
      drawFlipper(w * 0.3, flipperY, flipperLeft.current.angle, false);
      drawFlipper(w * 0.7, flipperY, flipperRight.current.angle, true);

      // Slots
      const slotY = h * 0.88;
      for (let i = 0; i < slotsRef.current.length; i++) {
        const s = slotsRef.current[i];
        ctx.fillStyle = i % 2 === 0 ? `rgba(${goldRgb},0.07)` : `rgba(${goldRgb},0.03)`;
        ctx.fillRect(s.x, slotY, s.w, h - slotY - 5);
        ctx.strokeStyle = GOLD + '15';
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x, slotY, s.w, h - slotY - 5);
        // Label
        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.prize.emoji, s.x + s.w / 2, slotY + (h - slotY - 5) / 2);
      }

      // Separator walls between slots
      for (let i = 0; i <= slotsRef.current.length; i++) {
        const sx = i < slotsRef.current.length ? slotsRef.current[i].x : w - 10;
        ctx.fillStyle = MAHOGANY;
        ctx.fillRect(sx - 1, slotY - 6, 2, h - slotY + 1);
      }

      // Ball
      if (ball.active || ball.y < h + 20) {
        const bGrad = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 0, ball.x, ball.y, BALL_R);
        bGrad.addColorStop(0, '#ffffff');
        bGrad.addColorStop(0.3, GOLD_BRIGHT);
        bGrad.addColorStop(1, GOLD);
        ctx.fillStyle = bGrad;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Instructions
      ctx.fillStyle = CREAM + '25';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('← Gauche  |  Droite →', w / 2, h - 8);

      animRef.current = requestAnimationFrame(loop);
    };

    function checkFlipperCollision(b: { x: number; y: number; vx: number; vy: number; active: boolean }, ax: number, ay: number, bx: number, by: number, active: boolean) {
      const abx = bx - ax;
      const aby = by - ay;
      const apx = b.x - ax;
      const apy = b.y - ay;
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
      const closestX = ax + t * abx;
      const closestY = ay + t * aby;
      const dx = b.x - closestX;
      const dy = b.y - closestY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < BALL_R + FLIPPER_W / 2) {
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        b.x = closestX + nx * (BALL_R + FLIPPER_W / 2 + 1);
        b.y = closestY + ny * (BALL_R + FLIPPER_W / 2 + 1);
        if (active) {
          // Flipper launches ball upward with force
          b.vx += nx * 4;
          b.vy = -Math.abs(ny) * 6 - 2;
          try { getSoundEngine().swoosh(); } catch {}
        } else {
          const dot = b.vx * nx + b.vy * ny;
          b.vx -= 1.4 * dot * nx;
          b.vy -= 1.4 * dot * ny;
        }
      }
    }

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, TOBACCO, goldRgb, creamRgb]);

  // Touch input: left half = left flipper, right half = right flipper
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (phaseRef.current !== 'playing') return;
    const w = sizeRef.current.w;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    if (clientX < w / 2) {
      flipperLeft.current.active = true;
    } else {
      flipperRight.current.active = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    flipperLeft.current.active = false;
    flipperRight.current.active = false;
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
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseUp={handleTouchEnd}
        />
      )}

      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🎰</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Pachinko</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            La bille tombe ! Utilisez les flippers<br/>pour la guider vers le meilleur lot.
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
