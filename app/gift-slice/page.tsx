'use client';

import { useRef, useState, useEffect } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectRandomPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   GIFT SLICE — One-at-a-time slice game
   Objects rise one at a time. Some are gifts,
   some are decoys (fruits). Slice = game over.
   Slice a gift → win prize. Slice a fruit → lose.
   ═══════════════════════════════════════════════ */

interface RisingItem {
  x: number; y: number;
  vy: number;
  rotation: number; rotSpeed: number;
  size: number;
  isGift: boolean;
  prize: Prize | null;
  hue: number;
  sliced: boolean;
  sliceTime: number;
  halves: { x: number; y: number; vx: number; vy: number; rot: number; rotV: number }[];
  passed: boolean;
  emoji: string;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number; color: string;
}

const GRAVITY = 0.08;
const GIFT_HUES = [0, 30, 50, 120, 200, 280, 340];
const DECOY_EMOJIS = ['🍎', '🍊', '🍋', '🍇', '🍒', '🥝', '🍑', '🫐', '🥭', '🍍'];

export default function GiftSlice({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [missed, setMissed] = useState(false);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);
  const itemsRef = useRef<RisingItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const sliceTrailRef = useRef<{ x: number; y: number; age: number }[]>([]);
  const pointerRef = useRef({ x: 0, y: 0, down: false, prevX: 0, prevY: 0 });
  const shakeRef = useRef({ x: 0, y: 0, decay: 0 });
  const timeRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const doneRef = useRef(false);
  const itemCountRef = useRef(0);
  const nextIdRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const addParticles = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4;
      particlesRef.current.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
        life: 0, maxLife: 25 + Math.random() * 20,
        size: 2.5 + Math.random() * 3, color,
      });
    }
  };

  const spawnItem = (w: number, h: number, prizesArr: Prize[]) => {
    itemCountRef.current++;
    // ~30% chance gift, increases if many decoys in a row
    const isGift = Math.random() < 0.3 || (itemCountRef.current >= 5 && Math.random() < 0.5);
    if (isGift) itemCountRef.current = 0; // reset counter on gift
    // Spawn from center area with slight offset
    const x = w * 0.35 + Math.random() * w * 0.3;
    const hue = GIFT_HUES[Math.floor(Math.random() * GIFT_HUES.length)];
    const item: RisingItem = {
      x, y: h + 80,
      vy: -(h * 0.018 + Math.random() * h * 0.005),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.06,
      size: 70 + Math.random() * 20,
      isGift,
      prize: isGift ? selectRandomPrize(prizesArr) : null,
      hue,
      sliced: false, sliceTime: 0, halves: [],
      passed: false,
      emoji: DECOY_EMOJIS[Math.floor(Math.random() * DECOY_EMOJIS.length)],
    };
    itemsRef.current.push(item);
    nextIdRef.current++;
  };

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

    itemsRef.current = [];
    particlesRef.current = [];
    sliceTrailRef.current = [];
    doneRef.current = false;
    spawnTimerRef.current = 30;
    itemCountRef.current = 0;
    nextIdRef.current = 0;
    timeRef.current = 0;

    const loop = () => {
      if (doneRef.current) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      timeRef.current++;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Screen shake
      const shake = shakeRef.current;
      if (shake.decay > 0) {
        shake.x = (Math.random() - 0.5) * shake.decay * 10;
        shake.y = (Math.random() - 0.5) * shake.decay * 10;
        shake.decay *= 0.88;
        if (shake.decay < 0.01) shake.decay = 0;
      } else { shake.x = 0; shake.y = 0; }
      ctx.translate(shake.x, shake.y);
      ctx.clearRect(-10, -10, w + 20, h + 20);

      // Background
      const bgGrad = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, h * 0.9);
      bgGrad.addColorStop(0, BG_LIGHT);
      bgGrad.addColorStop(0.6, BG_MID);
      bgGrad.addColorStop(1, BG_DARK);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-10, -10, w + 20, h + 20);

      // Subtle grid
      ctx.strokeStyle = `rgba(${goldRgb},0.02)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 44) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
      for (let i = 0; i < h; i += 44) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }

      // Instruction text
      ctx.fillStyle = CREAM + '30';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Tranchez un cadeau 🎁 pour gagner !', w / 2, 30);
      ctx.fillStyle = CREAM + '18';
      ctx.font = '10px system-ui';
      ctx.fillText('Attention aux fruits — si vous tranchez, c\'est perdu !', w / 2, 48);

      // Spawn logic — chain items rapidly
      spawnTimerRef.current--;
      if (spawnTimerRef.current <= 0) {
        spawnItem(w, h, prizes);
        spawnTimerRef.current = 45 + Math.floor(Math.random() * 20); // new item every ~45-65 frames
      }

      // Update & render all items
      const items = itemsRef.current;
      for (let idx = items.length - 1; idx >= 0; idx--) {
        const item = items[idx];

        if (!item.sliced) {
          item.vy += GRAVITY;
          item.y += item.vy;
          item.rotation += item.rotSpeed;

          // Remove if fell off screen
          if (item.y > h + 120 && item.vy > 0) {
            items.splice(idx, 1);
            continue;
          }

          // Draw the item
          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.rotate(item.rotation);
          const s = item.size;
          const hue = item.hue;

          // Shadow
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          if (item.isGift) {
            ctx.beginPath(); ctx.roundRect(-s / 2 + 4, -s / 2 + 4, s, s, 10); ctx.fill();
          } else {
            ctx.beginPath(); ctx.arc(4, 4, s / 2, 0, Math.PI * 2); ctx.fill();
          }

          if (item.isGift) {
            // Gift box
            const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
            grad.addColorStop(0, `hsl(${hue}, 60%, 55%)`);
            grad.addColorStop(1, `hsl(${hue}, 65%, 35%)`);
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, 10); ctx.fill();
            ctx.strokeStyle = `hsla(${hue}, 60%, 72%, 0.6)`;
            ctx.lineWidth = 2; ctx.stroke();
            // Lid
            ctx.fillStyle = `hsla(${hue}, 55%, 68%, 0.2)`;
            ctx.fillRect(-s / 2 + 3, -s / 2 + 3, s - 6, s * 0.25);
            // Ribbon
            const ribHue = (hue + 40) % 360;
            ctx.strokeStyle = `hsla(${ribHue}, 70%, 80%, 0.7)`;
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(0, -s / 2); ctx.lineTo(0, s / 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-s / 2, 0); ctx.lineTo(s / 2, 0); ctx.stroke();
            // Bow
            ctx.fillStyle = `hsla(${ribHue}, 70%, 75%, 0.9)`;
            ctx.beginPath(); ctx.ellipse(-7, -s / 2, 10, 5, -0.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(7, -s / 2, 10, 5, 0.3, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `hsl(${ribHue}, 60%, 65%)`;
            ctx.beginPath(); ctx.arc(0, -s / 2, 4, 0, Math.PI * 2); ctx.fill();
            // Prize emoji
            if (item.prize) {
              ctx.font = `${s * 0.3}px serif`;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText(item.prize.emoji, 0, 4);
            }
            // Glow
            ctx.shadowColor = `hsl(${hue}, 60%, 60%)`;
            ctx.shadowBlur = 15 + Math.sin(timeRef.current * 0.08) * 5;
            ctx.strokeStyle = `hsla(${hue}, 60%, 60%, 0.15)`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(-s / 2 - 3, -s / 2 - 3, s + 6, s + 6, 12); ctx.stroke();
            ctx.shadowBlur = 0;
          } else {
            // Fruit / decoy — round
            const fruitGrad = ctx.createRadialGradient(-s * 0.1, -s * 0.1, 0, 0, 0, s / 2);
            fruitGrad.addColorStop(0, `hsl(${hue}, 55%, 60%)`);
            fruitGrad.addColorStop(0.8, `hsl(${hue}, 60%, 40%)`);
            fruitGrad.addColorStop(1, `hsl(${hue}, 65%, 28%)`);
            ctx.fillStyle = fruitGrad;
            ctx.beginPath(); ctx.arc(0, 0, s / 2, 0, Math.PI * 2); ctx.fill();
            // Highlight
            ctx.fillStyle = `hsla(${hue}, 40%, 85%, 0.3)`;
            ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.15, s * 0.18, 0, Math.PI * 2); ctx.fill();
            // Big emoji
            ctx.font = `${s * 0.5}px serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(item.emoji, 0, 4);
          }
          ctx.restore();

          // Slice detection
          const p = pointerRef.current;
          if (p.down) {
            const dx = p.x - item.x;
            const dy = p.y - item.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const speed = Math.sqrt((p.x - p.prevX) ** 2 + (p.y - p.prevY) ** 2);
            if (dist < item.size * 0.55 && speed > 2) {
              item.sliced = true;
              item.sliceTime = Date.now();
              const a = Math.atan2(p.y - p.prevY, p.x - p.prevX);
              item.halves = [
                { x: item.x, y: item.y, vx: Math.cos(a + 1.2) * 4, vy: -5 - Math.random() * 3, rot: item.rotation, rotV: 0.1 },
                { x: item.x, y: item.y, vx: Math.cos(a - 1.2) * 4, vy: -5 - Math.random() * 3, rot: item.rotation, rotV: -0.1 },
              ];

              if (item.isGift) {
                addParticles(item.x, item.y, `hsl(${hue}, 70%, 60%)`, 20);
                addParticles(item.x, item.y, GOLD_BRIGHT, 12);
                shakeRef.current.decay = 0.6;
                try { getSoundEngine().victory(); } catch { /* */ }
                setTimeout(() => {
                  doneRef.current = true;
                  setWonPrize(item.prize);
                  setPhase('victory');
                }, 800);
              } else {
                addParticles(item.x, item.y, '#ff3333', 15);
                addParticles(item.x, item.y, `hsl(${hue}, 50%, 50%)`, 10);
                shakeRef.current.decay = 1;
                try { getSoundEngine().miss(); } catch { /* */ }
                setTimeout(() => {
                  doneRef.current = true;
                  setMissed(true);
                  setTimeout(() => { setMissed(false); setPhase('ready'); }, 2000);
                }, 600);
              }
            }
          }
        } else {
          // Sliced halves animation
          const age = Date.now() - item.sliceTime;
          if (age > 1500) { items.splice(idx, 1); continue; }
          for (const half of item.halves) {
            half.vy += 0.15;
            half.x += half.vx;
            half.y += half.vy;
            half.rot += half.rotV;
            ctx.save();
            ctx.translate(half.x, half.y);
            ctx.rotate(half.rot);
            ctx.globalAlpha = Math.max(0, 1 - age / 1500);
            const hs = item.size * 0.45;
            if (item.isGift) {
              ctx.fillStyle = `hsl(${item.hue}, 55%, 50%)`;
              ctx.beginPath(); ctx.roundRect(-hs / 2, -hs / 2, hs, hs, 5); ctx.fill();
            } else {
              ctx.fillStyle = `hsl(${item.hue}, 50%, 40%)`;
              ctx.beginPath(); ctx.arc(0, 0, hs / 2, 0, Math.PI); ctx.fill();
            }
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        }
      } // end items loop

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const pt = particlesRef.current[i];
        pt.life++;
        if (pt.life > pt.maxLife) { particlesRef.current.splice(i, 1); continue; }
        pt.vy += 0.06; pt.x += pt.vx; pt.y += pt.vy; pt.vx *= 0.98;
        const alpha = 1 - pt.life / pt.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * alpha, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Slice trail
      const trail = sliceTrailRef.current;
      for (let i = trail.length - 1; i >= 0; i--) { trail[i].age++; if (trail[i].age > 12) trail.splice(i, 1); }
      if (trail.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let t = 1; t < trail.length; t++) {
          const alpha = Math.max(0, 1 - trail[t].age / 12);
          const w2 = (1 - trail[t].age / 12);
          ctx.strokeStyle = `rgba(${goldRgb},${alpha * 0.3})`;
          ctx.lineWidth = w2 * 14;
          ctx.beginPath(); ctx.moveTo(trail[t - 1].x, trail[t - 1].y); ctx.lineTo(trail[t].x, trail[t].y); ctx.stroke();
          ctx.strokeStyle = `rgba(${creamRgb},${alpha * 0.9})`;
          ctx.lineWidth = w2 * 4;
          ctx.beginPath(); ctx.moveTo(trail[t - 1].x, trail[t - 1].y); ctx.lineTo(trail[t].x, trail[t].y); ctx.stroke();
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, goldRgb, creamRgb]);

  const handlePointerDown = (e: React.TouchEvent | React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    pointerRef.current = { x, y, down: true, prevX: x, prevY: y };
  };
  const handlePointerMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!pointerRef.current.down) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    pointerRef.current.prevX = pointerRef.current.x;
    pointerRef.current.prevY = pointerRef.current.y;
    pointerRef.current.x = x;
    pointerRef.current.y = y;
    sliceTrailRef.current.push({ x, y, age: 0 });
  };
  const handlePointerUp = () => { pointerRef.current.down = false; };

  const start = () => { setWonPrize(null); setMissed(false); setPhase('playing'); };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={handlePointerDown} onTouchMove={handlePointerMove} onTouchEnd={handlePointerUp}
          onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp} onMouseLeave={handlePointerUp} />
      )}
      {phase === 'ready' && (
        <div className="flex flex-col items-center gap-6 z-20 px-8">
          <div className="text-6xl" style={{ animation: 'victoryFloat 2s ease-in-out infinite' }}>🗡️</div>
          <h1 className="text-[32px] font-extrabold tracking-tight text-center" style={{
            background: `linear-gradient(135deg, ${GOLD_BRIGHT}, ${GOLD}, ${AMBER})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Gift Slice</h1>
          <p className="text-[14px] text-center max-w-[260px] leading-relaxed" style={{ color: CREAM + '60' }}>
            Des objets montent un par un.<br/>Tranchez uniquement les cadeaux 🎁 !<br/>Attention aux fruits 🍎
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
      {missed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-30" style={{ background: 'rgba(10,8,18,0.85)' }}>
          <div className="text-6xl mb-4" style={{ animation: 'victoryFloat 1.5s ease-in-out infinite' }}>😔</div>
          <h2 className="text-2xl font-bold tracking-tight" style={{ color: CREAM + 'cc' }}>Raté !</h2>
          <p className="text-sm mt-2" style={{ color: CREAM + '60' }}>C&apos;était un fruit, pas un cadeau !</p>
        </div>
      )}
      {phase === 'victory' && wonPrize && (
        <VictoryScreen prize={wonPrize} onClose={() => setPhase('ready')} accentFrom={GOLD} accentTo={AMBER} />
      )}
    </div>
  );
}
