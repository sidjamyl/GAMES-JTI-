'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   CANNON TRAJECTORY — Single shot cannon
   Adjust angle + power, 1 shot. Platforms with
   prizes. Wind adds challenge.
   ═══════════════════════════════════════════════ */

interface Platform {
  x: number;
  y: number;
  width: number;
  prize: Prize;
}

const GRAVITY = 0.15;
const BALL_R = 8;

export default function CannonTrajectory({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY } = T;
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

  const angleRef = useRef(-Math.PI / 4); // -45° default
  const powerRef = useRef(0.5);
  const windRef = useRef(0);
  const firedRef = useRef(false);
  const ballRef = useRef<{ x: number; y: number; vx: number; vy: number; trail: { x: number; y: number; age: number }[] } | null>(null);
  const platformsRef = useRef<Platform[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const dragRef = useRef<{ type: 'angle' | 'power' | null; startY: number; startX: number; startAngle: number; startPower: number }>({
    type: null, startY: 0, startX: 0, startAngle: 0, startPower: 0,
  });

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

    // Init platforms
    const cannonX = 50;
    const cannonY = h - 60;
    const platforms: Platform[] = [];
    const sorted = [...prizes].filter(p => p.quantity > 0).sort((a, b) => a.quantity - b.quantity);
    const platCount = Math.min(5, sorted.length);

    for (let i = 0; i < platCount; i++) {
      const t = (i + 1) / (platCount + 1);
      platforms.push({
        x: w * 0.25 + t * w * 0.65,
        y: h * 0.3 + Math.sin(t * Math.PI) * h * 0.25,
        width: 50 + (platCount - i) * 8, // rarer = narrower
        prize: sorted[i],
      });
    }
    platformsRef.current = platforms;

    windRef.current = (Math.random() - 0.5) * 0.06;
    angleRef.current = -Math.PI / 4;
    powerRef.current = 0.5;
    firedRef.current = false;
    ballRef.current = null;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Sky background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(0.7, BG_MID);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Ground
      ctx.fillStyle = MAHOGANY;
      ctx.fillRect(0, h - 40, w, 40);
      ctx.strokeStyle = GOLD + '20';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h - 40); ctx.lineTo(w, h - 40); ctx.stroke();

      // Wind indicator
      ctx.fillStyle = CREAM + '30';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      const windStr = windRef.current > 0.01 ? '→ Vent →' : windRef.current < -0.01 ? '← Vent ←' : '~ Calme ~';
      ctx.fillText(windStr, w / 2, 20);
      // Wind arrow
      const windArrowX = w / 2;
      const windBarW = Math.abs(windRef.current) * 800;
      ctx.fillStyle = GOLD + '40';
      ctx.fillRect(windArrowX - windBarW / 2, 26, windBarW, 3);

      // Platforms
      for (const plat of platformsRef.current) {
        // Platform body
        const pg = ctx.createLinearGradient(plat.x - plat.width / 2, plat.y, plat.x + plat.width / 2, plat.y + 14);
        pg.addColorStop(0, `rgba(${mahoganyRgb},0.8)`);
        pg.addColorStop(1, `rgba(${mahoganyRgb},0.5)`);
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.roundRect(plat.x - plat.width / 2, plat.y, plat.width, 14, 4);
        ctx.fill();
        ctx.strokeStyle = GOLD + '30';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Prize on platform
        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(plat.prize.emoji, plat.x, plat.y - 2);

        ctx.fillStyle = CREAM + '50';
        ctx.font = 'bold 8px system-ui';
        ctx.textBaseline = 'top';
        ctx.fillText(plat.prize.name.substring(0, 10), plat.x, plat.y + 16);
      }

      // Cannon
      const cx = cannonX;
      const cy = cannonY;
      const barrelLen = 35;
      const angle = angleRef.current;
      const bx = cx + Math.cos(angle) * barrelLen;
      const by = cy + Math.sin(angle) * barrelLen;

      // Cannon base
      ctx.fillStyle = MAHOGANY;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = GOLD + '60';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Barrel
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.strokeStyle = GOLD_BRIGHT;
      ctx.lineWidth = 4;
      ctx.stroke();

      // Power indicator (bar on left)
      if (!firedRef.current) {
        const pw = powerRef.current;
        ctx.fillStyle = `rgba(${goldRgb},0.1)`;
        ctx.fillRect(10, h * 0.15, 16, h * 0.55);
        ctx.fillStyle = pw > 0.8 ? '#ef4444' : GOLD;
        ctx.fillRect(10, h * 0.15 + h * 0.55 * (1 - pw), 16, h * 0.55 * pw);
        ctx.strokeStyle = GOLD + '40';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, h * 0.15, 16, h * 0.55);

        ctx.fillStyle = CREAM + '40';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Force', 18, h * 0.15 - 6);

        // Trajectory guide (dotted)
        const maxPower = 14;
        const pw2 = pw * maxPower;
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = `rgba(${goldRgb},0.15)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let gx = bx, gy = by;
        let gvx = Math.cos(angle) * pw2;
        let gvy = Math.sin(angle) * pw2;
        ctx.moveTo(gx, gy);
        for (let t = 0; t < 60; t++) {
          gvx += windRef.current;
          gvy += GRAVITY;
          gx += gvx;
          gy += gvy;
          if (gy > h - 40 || gx > w + 20) break;
          ctx.lineTo(gx, gy);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Help text
        ctx.fillStyle = CREAM + '25';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Glissez ↕ angle · Glissez ↔ puissance · Tapez à droite pour tirer', w / 2, h - 12);
      }

      // Ball physics
      const ball = ballRef.current;
      if (ball) {
        ball.vx += windRef.current;
        ball.vy += GRAVITY;
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Trail
        ball.trail.push({ x: ball.x, y: ball.y, age: 0 });
        if (ball.trail.length > 30) ball.trail.shift();
        for (const t of ball.trail) t.age++;

        // Draw trail
        for (const t of ball.trail) {
          const alpha = Math.max(0, 1 - t.age / 30) * 0.3;
          ctx.beginPath();
          ctx.arc(t.x, t.y, BALL_R * (1 - t.age / 30) * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${goldRgb},${alpha})`;
          ctx.fill();
        }

        // Draw ball
        const bg = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 0, ball.x, ball.y, BALL_R);
        bg.addColorStop(0, CREAM);
        bg.addColorStop(0.4, GOLD_BRIGHT);
        bg.addColorStop(1, SIENNA);
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = bg;
        ctx.fill();

        // Platform collision
        for (const plat of platformsRef.current) {
          const onPlatX = ball.x >= plat.x - plat.width / 2 - BALL_R && ball.x <= plat.x + plat.width / 2 + BALL_R;
          const onPlatY = ball.y + BALL_R >= plat.y && ball.y + BALL_R <= plat.y + 20 && ball.vy > 0;
          if (onPlatX && onPlatY) {
            setWonPrize(plat.prize);
            try { getSoundEngine().swish(); } catch {}
            setTimeout(() => setPhase('victory'), 600);
            return;
          }
        }

        // Ground hit or off screen
        if (ball.y > h - 40 - BALL_R || ball.x > w + 50 || ball.x < -50) {
          try { getSoundEngine().miss(); } catch {}
          // Give random prize (consolation)
          setWonPrize(selectRandomPrize(prizes));
          setTimeout(() => setPhase('victory'), 800);
          return;
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, goldRgb, creamRgb, mahoganyRgb]);

  const handleDown = (e: React.TouchEvent | React.MouseEvent) => {
    if (phaseRef.current !== 'playing' || firedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;

    // Tap right side = fire
    if (x > sizeRef.current.w * 0.6) {
      fire();
      return;
    }

    dragRef.current = {
      type: x < sizeRef.current.w * 0.3 ? 'angle' : 'power',
      startY: y,
      startX: x,
      startAngle: angleRef.current,
      startPower: powerRef.current,
    };
  };

  const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
    const d = dragRef.current;
    if (!d.type) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;

    if (d.type === 'angle') {
      const dy = (y - d.startY) * 0.005;
      angleRef.current = Math.max(-Math.PI * 0.45, Math.min(-0.1, d.startAngle + dy));
    } else {
      const dx = (x - d.startX) * 0.003;
      powerRef.current = Math.max(0.1, Math.min(1, d.startPower + dx));
    }
  };

  const handleUp = () => { dragRef.current.type = null; };

  const fire = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    const { w, h } = sizeRef.current;
    const maxPower = 14;
    const pw = powerRef.current * maxPower;
    const angle = angleRef.current;
    const barrelLen = 35;

    ballRef.current = {
      x: 50 + Math.cos(angle) * barrelLen,
      y: (h - 60) + Math.sin(angle) * barrelLen,
      vx: Math.cos(angle) * pw,
      vy: Math.sin(angle) * pw,
      trail: [],
    };
    try { getSoundEngine().swoosh(); } catch {}
  };

  const start = () => {
    setWonPrize(null);
    firedRef.current = false;
    ballRef.current = null;
    setPhase('playing');
  };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
          onTouchStart={handleDown}
          onTouchMove={handleMove}
          onTouchEnd={handleUp}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
        />
      )}

      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>💣</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Cannon</h1>
          <p className="text-[14px] text-center max-w-[280px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Réglez l&apos;angle et la puissance du canon.<br/>Un seul tir pour atteindre un cadeau !
          </p>
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
            boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>Tirer</button>
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
