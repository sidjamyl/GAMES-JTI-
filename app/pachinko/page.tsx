'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   PACHINKO — Polished vertical flipper machine
   Metallic pegs, neon bumpers, tapered flippers,
   ball trail, detailed slots, machine aesthetic.
   ═══════════════════════════════════════════════ */

interface Bumper {
  x: number; y: number; r: number; flash: number; hue: number;
}
interface Peg {
  x: number; y: number; r: number;
}
interface Slot {
  x: number; w: number; prize: Prize; hue: number;
}
interface TrailDot {
  x: number; y: number; age: number;
}

const BALL_R = 7;
const GRAVITY = 0.11;
const FRICTION = 0.999;
const FLIPPER_LEN = 48;

export default function PachinkoVertical({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY } = T;
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
  const sizeRef = useRef({ w: 0, h: 0 });
  const trailRef = useRef<TrailDot[]>([]);
  const timeRef = useRef(0);
  const shakeRef = useRef({ amount: 0 });
  const doneRef = useRef(false);

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

    // Bumpers (neon-lit rings)
    const bumpers: Bumper[] = [
      { x: w * 0.5, y: h * 0.26, r: 20, flash: 0, hue: 0 },
      { x: w * 0.26, y: h * 0.40, r: 16, flash: 0, hue: 120 },
      { x: w * 0.74, y: h * 0.40, r: 16, flash: 0, hue: 240 },
      { x: w * 0.5, y: h * 0.52, r: 14, flash: 0, hue: 60 },
    ];
    bumpersRef.current = bumpers;

    // Pegs (metallic pins grid)
    const pegs: Peg[] = [];
    const rows = 7;
    const cols = 8;
    const startY = h * 0.18;
    const endY = h * 0.64;
    const rowSpacing = (endY - startY) / rows;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 0 ? 0 : (w / cols) / 2;
      for (let c = 0; c < cols; c++) {
        const px = (w / cols) * (c + 0.5) + offset;
        const py = startY + r * rowSpacing;
        let skip = false;
        for (const b of bumpers) {
          const dx = px - b.x; const dy = py - b.y;
          if (Math.sqrt(dx * dx + dy * dy) < b.r + 14) { skip = true; break; }
        }
        if (px > 14 && px < w - 14 && !skip) pegs.push({ x: px, y: py, r: 3.5 });
      }
    }
    pegsRef.current = pegs;

    // Slots (prize zones)
    const slotCount = 5;
    const slotW = (w - 24) / slotCount;
    const sortedPrizes = [...prizes].sort((a, b) => a.quantity - b.quantity);
    const slots: Slot[] = [];
    const hues = [0, 200, 50, 280, 120];
    for (let i = 0; i < slotCount; i++) {
      const rarity = i === Math.floor(slotCount / 2) ? 0 : Math.abs(i - Math.floor(slotCount / 2));
      slots.push({
        x: 12 + i * slotW,
        w: slotW,
        prize: sortedPrizes[Math.min(rarity, sortedPrizes.length - 1)] || selectRandomPrize(prizes),
        hue: hues[i],
      });
    }
    slotsRef.current = slots;

    ballRef.current = {
      x: w / 2 + (Math.random() - 0.5) * 30,
      y: 18,
      vx: (Math.random() - 0.5) * 1.2,
      vy: 0.5,
      active: true,
    };
    trailRef.current = [];
    timeRef.current = 0;
    doneRef.current = false;

    const FLIPPER_W = 7;
    const flipperY = h * 0.80;
    const flipperBaseL = { x: w * 0.28, y: flipperY };
    const flipperBaseR = { x: w * 0.72, y: flipperY };

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      timeRef.current++;

      // Shake
      let sx = 0, sy = 0;
      if (shakeRef.current.amount > 0) {
        sx = (Math.random() - 0.5) * shakeRef.current.amount;
        sy = (Math.random() - 0.5) * shakeRef.current.amount;
        shakeRef.current.amount *= 0.88;
        if (shakeRef.current.amount < 0.2) shakeRef.current.amount = 0;
      }
      ctx.translate(sx, sy);
      ctx.clearRect(-5, -5, w + 10, h + 10);

      // Machine background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0e0818');
      bgGrad.addColorStop(0.5, '#120c1e');
      bgGrad.addColorStop(1, '#0a0612');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-5, -5, w + 10, h + 10);

      // Background subtle pattern (diamond grid)
      ctx.strokeStyle = 'rgba(255,255,255,0.012)';
      ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let x = 0; x < w; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }

      // Machine frame border (detailed)
      // Outer
      ctx.strokeStyle = '#3a2848';
      ctx.lineWidth = 5;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      // Inner
      ctx.strokeStyle = '#5a4868';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(9, 9, w - 18, h - 18);
      // Corner rivets
      const corners = [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]];
      for (const [cx, cy] of corners) {
        const rivGrad = ctx.createRadialGradient(cx - 0.5, cy - 0.5, 0, cx, cy, 3.5);
        rivGrad.addColorStop(0, '#aaa0b0');
        rivGrad.addColorStop(1, '#4a3a58');
        ctx.fillStyle = rivGrad;
        ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      }

      // Ball physics
      const ball = ballRef.current;
      if (ball.active && !doneRef.current) {
        ball.vy += GRAVITY;
        ball.vx *= FRICTION; ball.vy *= FRICTION;
        ball.x += ball.vx; ball.y += ball.vy;

        // Wall bounces
        if (ball.x < BALL_R + 12) { ball.x = BALL_R + 12; ball.vx = Math.abs(ball.vx) * 0.65; }
        if (ball.x > w - BALL_R - 12) { ball.x = w - BALL_R - 12; ball.vx = -Math.abs(ball.vx) * 0.65; }

        // Trail
        if (timeRef.current % 2 === 0) {
          trailRef.current.push({ x: ball.x, y: ball.y, age: 0 });
          if (trailRef.current.length > 25) trailRef.current.shift();
        }

        // Peg collisions
        for (const peg of pegsRef.current) {
          const dx = ball.x - peg.x; const dy = ball.y - peg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < BALL_R + peg.r) {
            const nx = dx / dist; const ny = dy / dist;
            ball.x = peg.x + nx * (BALL_R + peg.r + 0.5);
            ball.y = peg.y + ny * (BALL_R + peg.r + 0.5);
            const dot = ball.vx * nx + ball.vy * ny;
            ball.vx -= 1.5 * dot * nx;
            ball.vy -= 1.5 * dot * ny;
            ball.vx += (Math.random() - 0.5) * 0.3;
            try { getSoundEngine().peg(0.3 + Math.random() * 0.7); } catch {}
          }
        }

        // Bumper collisions
        for (const b of bumpersRef.current) {
          const dx = ball.x - b.x; const dy = ball.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < BALL_R + b.r) {
            const nx = dx / dist; const ny = dy / dist;
            ball.x = b.x + nx * (BALL_R + b.r + 1);
            ball.y = b.y + ny * (BALL_R + b.r + 1);
            const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            const boost = Math.max(speed * 1.6, 3.5);
            ball.vx = nx * boost;
            ball.vy = ny * boost;
            b.flash = 1;
            shakeRef.current.amount = 3;
            try { getSoundEngine().impact(); } catch {}
          }
        }

        // Flipper collisions
        const lAngle = flipperLeft.current.active ? -0.5 : 0.4;
        flipperLeft.current.angle += (lAngle - flipperLeft.current.angle) * 0.3;
        const lTipX = flipperBaseL.x + Math.cos(flipperLeft.current.angle) * FLIPPER_LEN;
        const lTipY = flipperBaseL.y + Math.sin(flipperLeft.current.angle) * FLIPPER_LEN;
        checkFlipperCollision(ball, flipperBaseL.x, flipperBaseL.y, lTipX, lTipY, flipperLeft.current.active, FLIPPER_W);

        const rAngle = flipperRight.current.active ? Math.PI + 0.5 : Math.PI - 0.4;
        flipperRight.current.angle += (rAngle - flipperRight.current.angle) * 0.3;
        const rTipX = flipperBaseR.x + Math.cos(flipperRight.current.angle) * FLIPPER_LEN;
        const rTipY = flipperBaseR.y + Math.sin(flipperRight.current.angle) * FLIPPER_LEN;
        checkFlipperCollision(ball, flipperBaseR.x, flipperBaseR.y, rTipX, rTipY, flipperRight.current.active, FLIPPER_W);

        // Slot check
        if (ball.y > h * 0.89 && !doneRef.current) {
          doneRef.current = true;
          ball.active = false;
          let slot: Slot | undefined;
          for (const s of slotsRef.current) {
            if (ball.x >= s.x && ball.x < s.x + s.w) { slot = s; break; }
          }
          const prize = slot ? slot.prize : selectRandomPrize(prizes);
          setWonPrize(prize);
          shakeRef.current.amount = 5;
          try { getSoundEngine().victory(); } catch {}
          setTimeout(() => setPhase('victory'), 600);
        }

        if (ball.y > h + 30 && !doneRef.current) {
          doneRef.current = true;
          setWonPrize(selectRandomPrize(prizes));
          setTimeout(() => setPhase('victory'), 300);
        }
      }

      // === RENDER ===

      // Trail
      for (const t of trailRef.current) {
        t.age++;
        const alpha = Math.max(0, 1 - t.age / 25) * 0.3;
        ctx.fillStyle = `rgba(${goldRgb},${alpha})`;
        ctx.beginPath(); ctx.arc(t.x, t.y, BALL_R * (1 - t.age / 25) * 0.5, 0, Math.PI * 2); ctx.fill();
      }

      // Pegs (metallic look)
      for (const peg of pegsRef.current) {
        const pegGrad = ctx.createRadialGradient(peg.x - 0.8, peg.y - 0.8, 0, peg.x, peg.y, peg.r);
        pegGrad.addColorStop(0, '#c0b8cc');
        pegGrad.addColorStop(0.6, '#8a7a98');
        pegGrad.addColorStop(1, '#4a3a58');
        ctx.fillStyle = pegGrad;
        ctx.beginPath(); ctx.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2); ctx.fill();
      }

      // Bumpers (neon rings)
      for (const b of bumpersRef.current) {
        b.flash = Math.max(0, b.flash - 0.025);
        const intensity = b.flash;
        // Outer glow
        if (intensity > 0) {
          ctx.shadowColor = `hsl(${b.hue}, 80%, 60%)`;
          ctx.shadowBlur = 18 * intensity;
        }
        // Ring
        const ringGrad = ctx.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r);
        ringGrad.addColorStop(0, intensity > 0 ? `hsl(${b.hue}, 70%, 50%)` : '#2a1838');
        ringGrad.addColorStop(0.7, intensity > 0 ? `hsl(${b.hue}, 80%, 40%)` : '#1a1028');
        ringGrad.addColorStop(1, intensity > 0 ? `hsl(${b.hue}, 80%, 60%)` : '#3a2848');
        ctx.fillStyle = ringGrad;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        // Border ring
        ctx.strokeStyle = intensity > 0 ? `hsla(${b.hue}, 90%, 70%, ${0.5 + intensity * 0.5})` : `hsla(${b.hue}, 40%, 30%, 0.3)`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Inner highlight
        ctx.fillStyle = `rgba(255,255,255,${0.05 + intensity * 0.15})`;
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.15, b.y - b.r * 0.15, b.r * 0.4, 0, Math.PI * 2); ctx.fill();
      }

      // Flippers (tapered, 3D)
      const drawFlipper = (bx: number, by: number, angle: number) => {
        const tipX = bx + Math.cos(angle) * FLIPPER_LEN;
        const tipY = by + Math.sin(angle) * FLIPPER_LEN;
        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);
        const baseW = FLIPPER_W;
        const tipW = 3;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(bx + perpX * baseW + 1, by + perpY * baseW + 2);
        ctx.lineTo(tipX + perpX * tipW + 1, tipY + perpY * tipW + 2);
        ctx.lineTo(tipX - perpX * tipW + 1, tipY - perpY * tipW + 2);
        ctx.lineTo(bx - perpX * baseW + 1, by - perpY * baseW + 2);
        ctx.closePath(); ctx.fill();

        // Body gradient
        const flipGrad = ctx.createLinearGradient(bx - perpX * baseW, by - perpY * baseW, bx + perpX * baseW, by + perpY * baseW);
        flipGrad.addColorStop(0, '#6a5a78');
        flipGrad.addColorStop(0.3, '#b0a0c0');
        flipGrad.addColorStop(0.5, '#8a7a98');
        flipGrad.addColorStop(1, '#4a3a58');
        ctx.fillStyle = flipGrad;
        ctx.beginPath();
        ctx.moveTo(bx + perpX * baseW, by + perpY * baseW);
        ctx.lineTo(tipX + perpX * tipW, tipY + perpY * tipW);
        ctx.lineTo(tipX - perpX * tipW, tipY - perpY * tipW);
        ctx.lineTo(bx - perpX * baseW, by - perpY * baseW);
        ctx.closePath(); ctx.fill();

        // Highlight edge
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx - perpX * baseW, by - perpY * baseW);
        ctx.lineTo(tipX - perpX * tipW, tipY - perpY * tipW);
        ctx.stroke();

        // Pivot
        const pivotGrad = ctx.createRadialGradient(bx - 1, by - 1, 0, bx, by, 5);
        pivotGrad.addColorStop(0, '#c0b8d0');
        pivotGrad.addColorStop(1, '#5a4a68');
        ctx.fillStyle = pivotGrad;
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
      };
      drawFlipper(flipperBaseL.x, flipperBaseL.y, flipperLeft.current.angle);
      drawFlipper(flipperBaseR.x, flipperBaseR.y, flipperRight.current.angle);

      // Guide walls between flippers
      ctx.fillStyle = '#3a2848';
      ctx.fillRect(0, flipperY - 4, flipperBaseL.x - 20, 4);
      ctx.fillRect(flipperBaseR.x + 20, flipperY - 4, w - flipperBaseR.x - 20, 4);

      // Slots
      const slotY = h * 0.87;
      for (let i = 0; i < slotsRef.current.length; i++) {
        const s = slotsRef.current[i];
        const slotH = h - slotY - 10;
        // Slot background glow
        const slotGrad = ctx.createLinearGradient(s.x, slotY, s.x, slotY + slotH);
        slotGrad.addColorStop(0, `hsla(${s.hue}, 50%, 20%, 0.3)`);
        slotGrad.addColorStop(1, `hsla(${s.hue}, 50%, 10%, 0.1)`);
        ctx.fillStyle = slotGrad;
        ctx.fillRect(s.x, slotY, s.w, slotH);
        // Slot border
        ctx.strokeStyle = `hsla(${s.hue}, 40%, 40%, 0.2)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x, slotY, s.w, slotH);
        // Emoji
        ctx.font = '18px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.prize.emoji, s.x + s.w / 2, slotY + slotH / 2);
      }

      // Slot walls (pegs on top of slots)
      for (let i = 0; i <= slotsRef.current.length; i++) {
        const sx = i < slotsRef.current.length ? slotsRef.current[i].x : w - 12;
        const wallGrad = ctx.createLinearGradient(sx - 1.5, slotY - 8, sx + 1.5, slotY - 8);
        wallGrad.addColorStop(0, '#6a5a78');
        wallGrad.addColorStop(0.5, '#9a8aa8');
        wallGrad.addColorStop(1, '#4a3a58');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(sx - 1.5, slotY - 8, 3, h - slotY + 3);
      }

      // Ball
      if (ball.active || ball.y < h + 30) {
        const bGrad = ctx.createRadialGradient(ball.x - 1.5, ball.y - 1.5, 0, ball.x, ball.y, BALL_R);
        bGrad.addColorStop(0, '#ffffff');
        bGrad.addColorStop(0.2, GOLD_BRIGHT);
        bGrad.addColorStop(0.8, GOLD);
        bGrad.addColorStop(1, SIENNA);
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 10;
        ctx.fillStyle = bGrad;
        ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Instructions
      ctx.fillStyle = CREAM + '20';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('← Gauche  |  Droite →', w / 2, h - 8);

      animRef.current = requestAnimationFrame(loop);
    };

    function checkFlipperCollision(
      b: { x: number; y: number; vx: number; vy: number; active: boolean },
      ax: number, ay: number, bx: number, by: number, active: boolean, fw: number,
    ) {
      const abx = bx - ax; const aby = by - ay;
      const apx = b.x - ax; const apy = b.y - ay;
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
      const cx = ax + t * abx; const cy = ay + t * aby;
      const dx = b.x - cx; const dy = b.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < BALL_R + fw / 2) {
        const nx = dx / (dist || 1); const ny = dy / (dist || 1);
        b.x = cx + nx * (BALL_R + fw / 2 + 1);
        b.y = cy + ny * (BALL_R + fw / 2 + 1);
        if (active) {
          b.vx += nx * 3.5;
          b.vy = -Math.abs(ny) * 5.5 - 2;
          shakeRef.current.amount = 3;
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
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, goldRgb, creamRgb]);

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (phaseRef.current !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    if (clientX < sizeRef.current.w / 2) flipperLeft.current.active = true;
    else flipperRight.current.active = true;
  };

  const handleTouchEnd = () => {
    flipperLeft.current.active = false;
    flipperRight.current.active = false;
  };

  const start = () => {
    setWonPrize(null);
    doneRef.current = false;
    setPhase('playing');
  };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart} onMouseUp={handleTouchEnd}
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
