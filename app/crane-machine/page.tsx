'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   CRANE MACHINE — Polished arcade claw game
   Glass case, LED lights, articulated 3-prong
   claw, chain cable, colorful varied gifts.
   ═══════════════════════════════════════════════ */

interface GiftBox {
  x: number; y: number; size: number; prize: Prize;
  hue: number; rotation: number; bobPhase: number;
}

type ClawPhase = 'moving-x' | 'dropping' | 'grabbing' | 'retracting' | 'done';

const GIFT_HUES = [0, 30, 50, 120, 200, 280, 340];

export default function CraneMachine({ theme }: { theme?: GameTheme }) {
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

  const clawRef = useRef({ x: 0, y: 60, openness: 1, grabbed: null as Prize | null });
  const clawPhaseRef = useRef<ClawPhase>('moving-x');
  const clawDirRef = useRef(1);
  const clawSpeedRef = useRef(2);
  const giftsRef = useRef<GiftBox[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const timeRef = useRef(0);
  const shakeRef = useRef({ amount: 0 });

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

    // Scatter varied gifts
    const gifts: GiftBox[] = [];
    const playTop = h * 0.48;
    const playBottom = h * 0.82;
    const count = 10 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      gifts.push({
        x: 35 + Math.random() * (w - 70),
        y: playTop + Math.random() * (playBottom - playTop),
        size: 26 + Math.random() * 10,
        prize: selectRandomPrize(prizes),
        hue: GIFT_HUES[i % GIFT_HUES.length],
        rotation: (Math.random() - 0.5) * 0.3,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
    giftsRef.current = gifts;

    clawRef.current = { x: w / 2, y: 56, openness: 1, grabbed: null };
    clawPhaseRef.current = 'moving-x';
    clawDirRef.current = 1;
    clawSpeedRef.current = 2;
    timeRef.current = 0;

    const MARGIN_L = 18;
    const MARGIN_R = w - 18;
    const RAIL_Y = 40;
    const TARGET_DROP_Y = h * 0.72;

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
        shakeRef.current.amount *= 0.9;
        if (shakeRef.current.amount < 0.2) shakeRef.current.amount = 0;
      }
      ctx.translate(sx, sy);
      ctx.clearRect(-5, -5, w + 10, h + 10);

      // Machine body background
      const machBg = ctx.createLinearGradient(0, 0, 0, h);
      machBg.addColorStop(0, '#1a1225');
      machBg.addColorStop(0.3, '#151020');
      machBg.addColorStop(1, '#0a0815');
      ctx.fillStyle = machBg;
      ctx.fillRect(-5, -5, w + 10, h + 10);

      // Outer machine frame
      ctx.strokeStyle = '#3a2840';
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.strokeStyle = '#5a4860';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, w - 20, h - 20);

      // Corner bolts
      const bolts = [[16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16]];
      for (const [bx, by] of bolts) {
        ctx.fillStyle = '#6a5a70';
        ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8a7a90';
        ctx.beginPath(); ctx.arc(bx - 1, by - 1, 2, 0, Math.PI * 2); ctx.fill();
      }

      // LED lights along top
      const ledCount = 12;
      for (let i = 0; i < ledCount; i++) {
        const lx = 25 + (i / (ledCount - 1)) * (w - 50);
        const ly = 22;
        const on = Math.sin(timeRef.current * 0.08 + i * 0.5) > 0;
        ctx.fillStyle = on ? '#ff4466' : '#331122';
        ctx.shadowColor = on ? '#ff4466' : 'transparent';
        ctx.shadowBlur = on ? 6 : 0;
        ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Glass case area
      const glassL = MARGIN_L;
      const glassT = 32;
      const glassW = w - MARGIN_L * 2;
      const glassH = h * 0.86 - 32;
      // Glass background
      ctx.fillStyle = 'rgba(10, 8, 20, 0.6)';
      ctx.fillRect(glassL, glassT, glassW, glassH);
      // Glass reflections
      ctx.fillStyle = 'rgba(255,255,255,0.015)';
      ctx.fillRect(glassL + 6, glassT + 4, 3, glassH - 8);
      ctx.fillRect(glassL + 12, glassT + 10, 1.5, glassH * 0.6);
      // Glass border
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(glassL, glassT, glassW, glassH);

      // Metal top rail
      const railGrad = ctx.createLinearGradient(0, RAIL_Y - 5, 0, RAIL_Y + 5);
      railGrad.addColorStop(0, '#6a5a70');
      railGrad.addColorStop(0.5, '#8a7a90');
      railGrad.addColorStop(1, '#4a3a50');
      ctx.fillStyle = railGrad;
      ctx.fillRect(glassL, RAIL_Y - 4, glassW, 8);
      // Rail highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(glassL + 2, RAIL_Y - 3); ctx.lineTo(glassL + glassW - 2, RAIL_Y - 3); ctx.stroke();

      const claw = clawRef.current;
      const cp = clawPhaseRef.current;

      // Claw physics
      if (cp === 'moving-x') {
        claw.x += clawSpeedRef.current * clawDirRef.current;
        if (claw.x > MARGIN_R - 20) { claw.x = MARGIN_R - 20; clawDirRef.current = -1; }
        if (claw.x < MARGIN_L + 20) { claw.x = MARGIN_L + 20; clawDirRef.current = 1; }
        claw.openness = 0.8 + Math.sin(timeRef.current * 0.03) * 0.2;
      } else if (cp === 'dropping') {
        claw.y += 2.2;
        claw.openness = Math.max(0.3, claw.openness - 0.008);
        if (claw.y >= TARGET_DROP_Y) {
          clawPhaseRef.current = 'grabbing';
          // Find closest gift
          let bestDist = 42;
          let bestGift: GiftBox | null = null;
          for (const g of giftsRef.current) {
            const dx = claw.x - g.x;
            const dy = claw.y - g.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) { bestDist = dist; bestGift = g; }
          }
          if (bestGift && Math.random() < 0.75) {
            claw.grabbed = bestGift.prize;
            giftsRef.current = giftsRef.current.filter(g => g !== bestGift);
            try { getSoundEngine().impact(); } catch {}
            shakeRef.current.amount = 3;
          } else {
            try { getSoundEngine().miss(); } catch {}
          }
          claw.openness = 0;
          setTimeout(() => { clawPhaseRef.current = 'retracting'; }, 500);
        }
      } else if (cp === 'retracting') {
        claw.y -= 1.8;
        if (claw.grabbed) claw.openness = Math.max(0, claw.openness - 0.02);
        if (claw.y <= 56) {
          claw.y = 56;
          clawPhaseRef.current = 'done';
          const prize = claw.grabbed || selectRandomPrize(prizes);
          setWonPrize(prize);
          try { claw.grabbed ? getSoundEngine().victory() : getSoundEngine().swish(); } catch {}
          setTimeout(() => setPhase('victory'), 800);
          return;
        }
      }

      // === Draw gifts ===
      // Sort by y for depth ordering
      const sortedGifts = [...giftsRef.current].sort((a, b) => a.y - b.y);
      for (const gift of sortedGifts) {
        ctx.save();
        const bob = Math.sin(timeRef.current * 0.015 + gift.bobPhase) * 1.5;
        ctx.translate(gift.x, gift.y + bob);
        ctx.rotate(gift.rotation);
        const s = gift.size;
        const hue = gift.hue;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(1, s / 2 + 2, s / 2, 3, 0, 0, Math.PI * 2); ctx.fill();

        // Box body gradient
        const boxGrad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
        boxGrad.addColorStop(0, `hsl(${hue}, 60%, 55%)`);
        boxGrad.addColorStop(1, `hsl(${hue}, 60%, 35%)`);
        ctx.fillStyle = boxGrad;
        ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, 4); ctx.fill();

        // Top highlight
        ctx.fillStyle = `hsla(${hue}, 50%, 75%, 0.15)`;
        ctx.fillRect(-s / 2 + 2, -s / 2 + 1, s - 4, s * 0.3);

        // Ribbon cross
        ctx.strokeStyle = `hsla(${hue}, 30%, 85%, 0.5)`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -s / 2); ctx.lineTo(0, s / 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s / 2, 0); ctx.lineTo(s / 2, 0); ctx.stroke();

        // Bow on top
        ctx.fillStyle = `hsl(${hue}, 45%, 70%)`;
        ctx.beginPath(); ctx.ellipse(-4, -s / 2 - 2, 5, 3, -0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(4, -s / 2 - 2, 5, 3, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsl(${hue}, 50%, 60%)`;
        ctx.beginPath(); ctx.arc(0, -s / 2 - 1, 2.5, 0, Math.PI * 2); ctx.fill();

        // Emoji
        ctx.font = `${s * 0.35}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gift.prize.emoji, 0, 2);
        ctx.restore();
      }

      // === Chain cable ===
      const chainTop = RAIL_Y + 4;
      const chainBot = claw.y - 8;
      const chainSegs = 8;
      ctx.strokeStyle = '#6a5a70';
      ctx.lineWidth = 2;
      for (let i = 0; i < chainSegs; i++) {
        const t = i / chainSegs;
        const nt = (i + 1) / chainSegs;
        const cy1 = chainTop + t * (chainBot - chainTop);
        const cy2 = chainTop + nt * (chainBot - chainTop);
        const sway = Math.sin(timeRef.current * 0.04 + i * 0.8) * (cp === 'dropping' || cp === 'retracting' ? 2 : 0.5);
        ctx.beginPath();
        ctx.moveTo(claw.x + sway * (1 - t), cy1);
        ctx.lineTo(claw.x + sway * (1 - nt), cy2);
        ctx.stroke();
        // Chain link markers
        if (i % 2 === 0) {
          ctx.fillStyle = '#8a7a90';
          ctx.beginPath(); ctx.arc(claw.x + sway * (1 - t), cy1, 2, 0, Math.PI * 2); ctx.fill();
        }
      }

      // === Articulated 3-prong claw ===
      const clawY = claw.y;
      const open = claw.openness;
      const armLen = 20;

      // Claw motor housing (cylinder)
      const housingGrad = ctx.createLinearGradient(claw.x - 10, clawY - 8, claw.x + 10, clawY + 8);
      housingGrad.addColorStop(0, '#7a6a80');
      housingGrad.addColorStop(0.5, '#9a8aa0');
      housingGrad.addColorStop(1, '#5a4a60');
      ctx.fillStyle = housingGrad;
      ctx.beginPath(); ctx.roundRect(claw.x - 10, clawY - 6, 20, 12, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(claw.x - 8, clawY - 5); ctx.lineTo(claw.x + 8, clawY - 5); ctx.stroke();
      // Housing bolts
      ctx.fillStyle = '#aaa';
      ctx.beginPath(); ctx.arc(claw.x - 6, clawY, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(claw.x + 6, clawY, 1.5, 0, Math.PI * 2); ctx.fill();

      // 3 prongs
      const drawProng = (baseAngle: number) => {
        const px = claw.x + Math.sin(baseAngle) * 6;
        const py = clawY + 6;
        const tipSpread = open * 14;
        const tipX = px + Math.sin(baseAngle) * tipSpread;
        const tipY = py + armLen;
        // Arm (tapered)
        ctx.strokeStyle = '#8a7a90';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tipX, tipY); ctx.stroke();
        // Inner highlight
        ctx.strokeStyle = '#aaa0b0';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tipX, tipY); ctx.stroke();
        // Tip curl
        const curlDir = baseAngle > 0 ? 1 : baseAngle < 0 ? -1 : 0;
        ctx.strokeStyle = '#8a7a90';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.quadraticCurveTo(tipX - curlDir * 3, tipY + 5, tipX - curlDir * 6, tipY + 3);
        ctx.stroke();
      };
      drawProng(-1);  // left
      drawProng(0);   // center
      drawProng(1);   // right

      // Grabbed prize follows claw
      if (claw.grabbed && (cp === 'grabbing' || cp === 'retracting' || cp === 'done')) {
        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Glow
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 10;
        ctx.fillText(claw.grabbed.emoji, claw.x, clawY + armLen + 12);
        ctx.shadowBlur = 0;
      }

      // Claw drop guide (when moving)
      if (cp === 'moving-x') {
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(claw.x, claw.y + 30);
        ctx.lineTo(claw.x, TARGET_DROP_Y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Small target zone
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.arc(claw.x, TARGET_DROP_Y, 15, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Bottom tray
      const trayY = h * 0.86;
      const trayGrad = ctx.createLinearGradient(0, trayY, 0, trayY + 20);
      trayGrad.addColorStop(0, '#3a2840');
      trayGrad.addColorStop(1, '#1a1020');
      ctx.fillStyle = trayGrad;
      ctx.fillRect(MARGIN_L, trayY, w - MARGIN_L * 2, 20);
      ctx.strokeStyle = '#5a4860';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(MARGIN_L, trayY); ctx.lineTo(MARGIN_R, trayY); ctx.stroke();

      // Instructions
      ctx.fillStyle = CREAM + '25';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      if (cp === 'moving-x') {
        ctx.fillText('APPUYEZ pour lâcher la pince', w / 2, h - 14);
      } else if (cp === 'dropping') {
        ctx.fillText('La pince descend...', w / 2, h - 14);
      } else if (cp === 'retracting') {
        ctx.fillText(claw.grabbed ? '🎁 Attrapé !' : 'Raté...', w / 2, h - 14);
      }

      // Bottom panel decoration
      const panelY = h * 0.9;
      ctx.fillStyle = '#2a1830';
      ctx.fillRect(8, panelY, w - 16, h - panelY - 8);
      // Coin slot decor
      ctx.fillStyle = '#4a3850';
      ctx.beginPath(); ctx.roundRect(w / 2 - 15, panelY + 6, 30, 10, 3); ctx.fill();
      ctx.fillStyle = '#5a4860';
      ctx.beginPath(); ctx.roundRect(w / 2 - 10, panelY + 8, 20, 6, 2); ctx.fill();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, goldRgb, creamRgb]);

  const handleTap = () => {
    if (phaseRef.current !== 'playing') return;
    if (clawPhaseRef.current === 'moving-x') {
      clawPhaseRef.current = 'dropping';
      try { getSoundEngine().peg(0); } catch {}
    }
  };

  const start = () => { setWonPrize(null); setPhase('playing'); };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={handleTap} onMouseDown={handleTap}
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
            La pince bouge toute seule.<br/>Appuyez au bon moment pour attraper un cadeau !
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
