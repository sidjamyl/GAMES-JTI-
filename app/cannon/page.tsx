'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Prize, GamePhase } from '../lib/types';
import { fetchPrizes, selectPremiumPrize, getConsolationPrize } from '../lib/prizes';
import { getSoundEngine } from '../lib/sounds';
import VictoryScreen from '../components/VictoryScreen';
import { GameTheme, DEFAULT_THEME, hexToRgb } from '../lib/themes';

/* ═══════════════════════════════════════════════
   CANNON — Polished single-shot trajectory game
   Drag cannon to aim, tap fire button.
   Platforms with 3D gift boxes, smoke + explosion.
   ═══════════════════════════════════════════════ */

interface Platform {
  x: number; y: number; width: number; prize: Prize; hue: number; hit?: boolean;
}
interface Debris {
  x: number; y: number; vx: number; vy: number;
  rot: number; rotV: number;
  w: number; h: number; color: string;
  life: number; maxLife: number;
}
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string; type: 'smoke' | 'spark' | 'trail';
}

const GRAVITY = 0.14;
const BALL_R = 7;
const GIFT_HUES = [0, 30, 50, 120, 200, 280, 340];
const MAX_ATTEMPTS = 3;

export default function CannonTrajectory({ theme }: { theme?: GameTheme }) {
  const T = { ...DEFAULT_THEME, ...theme };
  const { GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY } = T;
  const goldRgb = hexToRgb(GOLD);
  const creamRgb = hexToRgb(CREAM);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<GamePhase>('loading');
  const phaseRef = useRef<GamePhase>('loading');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const animRef = useRef<number>(0);
  const dprRef = useRef(1);

  const angleRef = useRef(-Math.PI / 4);
  const powerRef = useRef(0.6);
  const windRef = useRef(0);
  const firedRef = useRef(false);
  const ballRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const platformsRef = useRef<Platform[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const particlesRef = useRef<Particle[]>([]);
  const debrisRef = useRef<Debris[]>([]);
  const shakeRef = useRef({ amount: 0 });
  const timeRef = useRef(0);
  const lastTimeRef = useRef(0);
  const touchRef = useRef<{ active: boolean; startX: number; startY: number; startAngle: number; startPower: number }>({
    active: false, startX: 0, startY: 0, startAngle: 0, startPower: 0,
  });
  const hitRef = useRef(false);
  const attemptsRef = useRef(0);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { fetchPrizes().then((p) => { setPrizes(p); setPhase('ready'); }); }, []);

  const addParticles = (x: number, y: number, type: Particle['type'], count: number, color?: string) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = type === 'smoke' ? 0.5 + Math.random() * 1.5 : type === 'spark' ? 2 + Math.random() * 4 : 0.3;
      particlesRef.current.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - (type === 'smoke' ? 1 : 0),
        life: 0, maxLife: type === 'smoke' ? 40 + Math.random() * 20 : type === 'spark' ? 20 + Math.random() * 15 : 12,
        size: type === 'smoke' ? 6 + Math.random() * 8 : type === 'spark' ? 1.5 + Math.random() * 2 : 3,
        color: color || (type === 'smoke' ? '#888' : GOLD_BRIGHT), type,
      });
    }
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
    sizeRef.current = { w, h };

    const platforms: Platform[] = [];
    const premium = [...prizes].filter(p => p.quantity > 0 && p.name !== 'Briquet').sort((a, b) => a.quantity - b.quantity);
    const platCount = Math.min(5, Math.max(3, premium.length));
    for (let i = 0; i < platCount; i++) {
      const t = (i + 1) / (platCount + 1);
      platforms.push({
        x: w * 0.22 + t * w * 0.7,
        y: h * 0.25 + Math.sin(t * Math.PI) * h * 0.3,
        width: 38 + (platCount - i) * 6,
        prize: premium[i % premium.length] || selectPremiumPrize(prizes),
        hue: GIFT_HUES[i % GIFT_HUES.length],
      });
    }
    platformsRef.current = platforms;
    windRef.current = (Math.random() - 0.5) * 0.05;
    angleRef.current = -Math.PI / 4;
    powerRef.current = 0.6;
    firedRef.current = false;
    ballRef.current = null;
    particlesRef.current = [];
    debrisRef.current = [];
    hitRef.current = false;
    timeRef.current = 0;
    lastTimeRef.current = 0;

    const cannonBaseX = 48;
    const cannonBaseY = h - 55;

    const loop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      const rawDt = lastTimeRef.current ? (now - lastTimeRef.current) / 16.667 : 1;
      const dt = Math.min(rawDt, 3);
      lastTimeRef.current = now;
      timeRef.current += dt;

      // Shake
      let sx = 0, sy = 0;
      if (shakeRef.current.amount > 0) {
        sx = (Math.random() - 0.5) * shakeRef.current.amount;
        sy = (Math.random() - 0.5) * shakeRef.current.amount;
        shakeRef.current.amount *= Math.pow(0.88, dt);
        if (shakeRef.current.amount < 0.3) shakeRef.current.amount = 0;
      }
      ctx.translate(sx, sy);
      ctx.clearRect(-10, -10, w + 20, h + 20);

      // Sky
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0c1220');
      bgGrad.addColorStop(0.5, '#162035');
      bgGrad.addColorStop(0.85, '#1a1510');
      bgGrad.addColorStop(1, '#120e08');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-10, -10, w + 20, h + 20);

      // Stars
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 30; i++) {
        const px = (i * 131.7) % w;
        const py = (i * 67.3) % (h * 0.45);
        const blink = Math.sin(timeRef.current * 0.015 + i * 3.1) * 0.5 + 0.5;
        ctx.globalAlpha = blink * 0.25 + 0.05;
        ctx.beginPath(); ctx.arc(px, py, 1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Ground (grassy hill)
      const groundGrad = ctx.createLinearGradient(0, h - 50, 0, h);
      groundGrad.addColorStop(0, '#2a3a1a');
      groundGrad.addColorStop(0.3, '#1e2b12');
      groundGrad.addColorStop(1, '#0e1608');
      ctx.fillStyle = groundGrad;
      ctx.beginPath();
      ctx.moveTo(-5, h - 50);
      for (let x = 0; x <= w + 5; x += 5) {
        ctx.lineTo(x, h - 50 + Math.sin(x * 0.02) * 4 + Math.sin(x * 0.05) * 2);
      }
      ctx.lineTo(w + 5, h + 5); ctx.lineTo(-5, h + 5); ctx.closePath(); ctx.fill();

      // Wind indicator
      ctx.fillStyle = CREAM + '25';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      const windM = windRef.current;
      const windStr = Math.abs(windM) < 0.01 ? '~ Calme ~' : windM > 0 ? `Vent → ${(windM * 100).toFixed(0)}` : `${(windM * 100).toFixed(0)} ← Vent`;
      ctx.fillText(windStr, w / 2, 18);
      const windBarW = Math.abs(windM) * 1200;
      ctx.fillStyle = GOLD + '30';
      if (windM > 0) ctx.fillRect(w / 2, 22, windBarW, 2);
      else ctx.fillRect(w / 2 - windBarW, 22, windBarW, 2);

      // Floating wind dust
      for (let i = 0; i < 5; i++) {
        const dx = ((timeRef.current * (0.3 + i * 0.15) + i * 97) % (w + 60)) - 30;
        const dy = h * 0.15 + i * h * 0.12 + Math.sin(timeRef.current * 0.02 + i) * 10;
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = CREAM;
        ctx.beginPath(); ctx.arc(dx, dy, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // === Platforms with 3D gift boxes ===
      for (const plat of platformsRef.current) {
        const pw = plat.width;
        const ph = 10;
        const d = 4;
        // Top face
        ctx.fillStyle = '#5a4030';
        ctx.beginPath();
        ctx.moveTo(plat.x - pw / 2, plat.y);
        ctx.lineTo(plat.x - pw / 2 + d, plat.y - d);
        ctx.lineTo(plat.x + pw / 2 + d, plat.y - d);
        ctx.lineTo(plat.x + pw / 2, plat.y);
        ctx.closePath(); ctx.fill();
        // Front face
        const pfg = ctx.createLinearGradient(0, plat.y, 0, plat.y + ph);
        pfg.addColorStop(0, '#6a5040');
        pfg.addColorStop(1, '#3a2a1a');
        ctx.fillStyle = pfg;
        ctx.fillRect(plat.x - pw / 2, plat.y, pw, ph);
        // Right side
        ctx.fillStyle = '#3a2a1a';
        ctx.beginPath();
        ctx.moveTo(plat.x + pw / 2, plat.y);
        ctx.lineTo(plat.x + pw / 2 + d, plat.y - d);
        ctx.lineTo(plat.x + pw / 2 + d, plat.y + ph - d);
        ctx.lineTo(plat.x + pw / 2, plat.y + ph);
        ctx.closePath(); ctx.fill();
        // Highlight line
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(plat.x - pw / 2 + 2, plat.y + 1); ctx.lineTo(plat.x + pw / 2 - 2, plat.y + 1); ctx.stroke();

        // Gift box on platform (only if not hit)
        if (!plat.hit) {
          const bx = plat.x;
          const by = plat.y - 16;
          const bs = 22;
          const hue = plat.hue;
          // Shadow
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath(); ctx.ellipse(bx, plat.y, bs / 2 + 3, 3, 0, 0, Math.PI * 2); ctx.fill();
          // Box body
          const bg = ctx.createLinearGradient(bx - bs / 2, by - bs / 2, bx + bs / 2, by + bs / 2);
          bg.addColorStop(0, `hsl(${hue}, 60%, 55%)`);
          bg.addColorStop(1, `hsl(${hue}, 60%, 35%)`);
          ctx.fillStyle = bg;
          ctx.beginPath(); ctx.roundRect(bx - bs / 2, by - bs / 2, bs, bs, 3); ctx.fill();
          // Ribbon
          ctx.strokeStyle = `hsla(${hue}, 40%, 80%, 0.5)`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx, by - bs / 2); ctx.lineTo(bx, by + bs / 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(bx - bs / 2, by); ctx.lineTo(bx + bs / 2, by); ctx.stroke();
          // Bow
          ctx.fillStyle = `hsl(${hue}, 50%, 70%)`;
          ctx.beginPath(); ctx.ellipse(bx - 4, by - bs / 2 - 2, 5, 3, -0.4, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(bx + 4, by - bs / 2 - 2, 5, 3, 0.4, 0, Math.PI * 2); ctx.fill();
          // Emoji label
          ctx.font = '13px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(plat.prize.emoji, bx, by + 1);
        }
      }

      // === Cannon ===
      const angle = angleRef.current;
      const power = powerRef.current;
      const barrelLen = 32;
      const bx = cannonBaseX + Math.cos(angle) * barrelLen;
      const by = cannonBaseY + Math.sin(angle) * barrelLen;

      // Cannon wheel
      ctx.save();
      ctx.translate(cannonBaseX, cannonBaseY + 5);
      ctx.fillStyle = '#3a2820';
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a4230';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#4a3528';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const sa = (i / 6) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(sa) * 12, Math.sin(sa) * 12); ctx.stroke();
      }
      ctx.fillStyle = '#6a5a48';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Barrel
      ctx.save();
      ctx.translate(cannonBaseX, cannonBaseY);
      ctx.rotate(angle);
      const barrelW = 11;
      ctx.fillStyle = '#2a2028';
      ctx.beginPath(); ctx.roundRect(-3, -barrelW / 2 - 1, barrelLen + 5, barrelW + 2, 3); ctx.fill();
      const barrelGrad = ctx.createLinearGradient(0, -barrelW / 2, 0, barrelW / 2);
      barrelGrad.addColorStop(0, '#5a4a5a');
      barrelGrad.addColorStop(0.3, '#8a7a88');
      barrelGrad.addColorStop(0.5, '#6a5a68');
      barrelGrad.addColorStop(1, '#3a2a38');
      ctx.fillStyle = barrelGrad;
      ctx.beginPath(); ctx.roundRect(0, -barrelW / 2, barrelLen, barrelW, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(2, -barrelW / 2 + 1); ctx.lineTo(barrelLen - 2, -barrelW / 2 + 1); ctx.stroke();
      // Muzzle ring
      ctx.fillStyle = '#7a6a78';
      ctx.fillRect(barrelLen - 4, -barrelW / 2 - 2, 6, barrelW + 4);
      ctx.fillStyle = '#4a3a48';
      ctx.fillRect(barrelLen - 3, -barrelW / 2 - 1, 4, barrelW + 2);
      for (let i = 1; i <= 2; i++) {
        ctx.fillStyle = '#5a4a58';
        ctx.fillRect(barrelLen * i * 0.33, -barrelW / 2 - 1, 3, barrelW + 2);
      }
      ctx.restore();

      // Power gauge (arc around cannon)
      if (!firedRef.current) {
        const gaugeR = 28;
        ctx.strokeStyle = GOLD + '15';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cannonBaseX, cannonBaseY, gaugeR, -Math.PI * 0.8, -0.05); ctx.stroke();
        const fillEnd = -Math.PI * 0.8 + power * (Math.PI * 0.8 - 0.05);
        ctx.strokeStyle = power > 0.85 ? '#ef4444' : GOLD;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cannonBaseX, cannonBaseY, gaugeR, -Math.PI * 0.8, fillEnd); ctx.stroke();

        // Dotted trajectory preview
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = `rgba(${goldRgb},0.12)`;
        ctx.lineWidth = 1;
        const maxPower = 14;
        const pw = power * maxPower;
        let gx = bx, gy = by;
        let gvx = Math.cos(angle) * pw;
        let gvy = Math.sin(angle) * pw;
        ctx.beginPath(); ctx.moveTo(gx, gy);
        for (let t = 0; t < 80; t++) {
          gvx += windRef.current; gvy += GRAVITY; gx += gvx; gy += gvy;
          if (gy > h - 40 || gx > w + 20 || gx < -20) break;
          ctx.lineTo(gx, gy);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = CREAM + '20';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Glissez pour viser · Tapez le bouton pour tirer', w / 2, h - 8);
      }

      // Ball
      const ball = ballRef.current;
      if (ball) {
        ball.vx += windRef.current * dt;
        ball.vy += GRAVITY * dt;
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;

        if (Math.floor(timeRef.current) % 2 === 0 && Math.floor(timeRef.current) !== Math.floor(timeRef.current - dt)) {
          particlesRef.current.push({
            x: ball.x, y: ball.y, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
            life: 0, maxLife: 15, size: BALL_R * 0.6, color: GOLD + '40', type: 'trail',
          });
        }

        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 12;
        const ballGrad = ctx.createRadialGradient(ball.x - 1, ball.y - 1, 0, ball.x, ball.y, BALL_R);
        ballGrad.addColorStop(0, '#ffffff');
        ballGrad.addColorStop(0.3, GOLD_BRIGHT);
        ballGrad.addColorStop(1, SIENNA);
        ctx.fillStyle = ballGrad;
        ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        if (!hitRef.current) {
          for (const plat of platformsRef.current) {
            const onX = ball.x >= plat.x - plat.width / 2 - BALL_R && ball.x <= plat.x + plat.width / 2 + BALL_R;
            const onY = ball.y + BALL_R >= plat.y && ball.y + BALL_R <= plat.y + 18 && ball.vy > 0;
            if (onX && onY) {
              hitRef.current = true;
              plat.hit = true;
              // Spawn debris fragments from the gift box
              const bx = plat.x;
              const by = plat.y - 16;
              const bs = 22;
              const fragCount = 12;
              for (let f = 0; f < fragCount; f++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 2 + Math.random() * 4;
                debrisRef.current.push({
                  x: bx + (Math.random() - 0.5) * bs,
                  y: by + (Math.random() - 0.5) * bs,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed - 2,
                  rot: Math.random() * Math.PI * 2,
                  rotV: (Math.random() - 0.5) * 0.3,
                  w: 4 + Math.random() * 8,
                  h: 4 + Math.random() * 6,
                  color: f % 3 === 0 ? `hsl(${plat.hue}, 50%, 70%)` : f % 3 === 1 ? `hsl(${plat.hue}, 60%, 45%)` : `hsl(${plat.hue}, 40%, 80%)`,
                  life: 0, maxLife: 50 + Math.random() * 30,
                });
              }
              addParticles(ball.x, ball.y, 'spark', 20, GOLD_BRIGHT);
              addParticles(bx, by, 'spark', 10, `hsl(${plat.hue}, 60%, 60%)`);
              addParticles(bx, by, 'smoke', 6, `hsl(${plat.hue}, 30%, 40%)`);
              shakeRef.current.amount = 10;
              setWonPrize(plat.prize);
              try { getSoundEngine().victory(); } catch {}
              setTimeout(() => setPhase('victory'), 1200);
              break;
            }
          }
        }

        if (!hitRef.current && (ball.y > h - 40 || ball.x > w + 80 || ball.x < -80)) {
          hitRef.current = true;
          addParticles(Math.min(Math.max(ball.x, 10), w - 10), Math.min(ball.y, h - 45), 'smoke', 10);
          shakeRef.current.amount = 4;
          try { getSoundEngine().miss(); } catch {}
          attemptsRef.current++;
          setAttempts(attemptsRef.current);
          if (attemptsRef.current >= MAX_ATTEMPTS) {
            // All attempts used — consolation prize
            const consolation = getConsolationPrize(prizes);
            setWonPrize(consolation);
            setGameOver(true);
            setTimeout(() => setPhase('victory'), 1000);
          } else {
            // Reset cannon for next shot
            setTimeout(() => {
              firedRef.current = false;
              ballRef.current = null;
              hitRef.current = false;
              debrisRef.current = [];
              angleRef.current = -Math.PI / 4;
              powerRef.current = 0.6;
              windRef.current = (Math.random() - 0.5) * 0.05;
            }, 1000);
          }
        }
      }

      // Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life += dt;
        if (p.life > p.maxLife) { particlesRef.current.splice(i, 1); continue; }
        if (p.type === 'smoke') p.vy -= 0.02 * dt;
        else if (p.type === 'spark') p.vy += 0.08 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const alpha = 1 - p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        if (p.type === 'smoke') {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * (p.life / p.maxLife)), 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Debris fragments (broken gift pieces)
      for (let i = debrisRef.current.length - 1; i >= 0; i--) {
        const d = debrisRef.current[i];
        d.life += dt;
        if (d.life > d.maxLife) { debrisRef.current.splice(i, 1); continue; }
        d.vy += 0.12 * dt; // gravity
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.vx *= Math.pow(0.99, dt);
        d.rot += d.rotV * dt;
        const alpha = 1 - d.life / d.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rot);
        ctx.fillStyle = d.color;
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // Fire button (bottom center)
      if (!firedRef.current) {
        const btnX = w / 2;
        const btnY = h - 55;
        const btnR = 28;
        const btnGrad = ctx.createRadialGradient(btnX, btnY - 2, 0, btnX, btnY, btnR);
        btnGrad.addColorStop(0, '#ff6633');
        btnGrad.addColorStop(0.7, '#cc3311');
        btnGrad.addColorStop(1, '#881100');
        ctx.fillStyle = btnGrad;
        ctx.beginPath(); ctx.arc(btnX, btnY, btnR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TIRER', btnX, btnY + 1);
      }

      // HUD — attempts remaining
      const remaining = MAX_ATTEMPTS - attemptsRef.current;
      ctx.fillStyle = CREAM + '60';
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${'💣'.repeat(remaining)}${'✖️'.repeat(attemptsRef.current)}`, 14, h - 24);

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase, prizes, GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA, BG_DARK, BG_MID, BG_LIGHT, MAHOGANY, goldRgb, creamRgb]);

  const fire = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    hitRef.current = false;
    const { h } = sizeRef.current;
    const cannonBaseX = 48;
    const cannonBaseY = h - 55;
    const maxPower = 14;
    const pw = powerRef.current * maxPower;
    const angle = angleRef.current;
    const barrelLen = 32;
    const mx = cannonBaseX + Math.cos(angle) * barrelLen;
    const my = cannonBaseY + Math.sin(angle) * barrelLen;

    ballRef.current = { x: mx, y: my, vx: Math.cos(angle) * pw, vy: Math.sin(angle) * pw };
    addParticles(mx, my, 'smoke', 12);
    shakeRef.current.amount = 6;
    try { getSoundEngine().swoosh(); } catch {}
  };

  const handleDown = (e: React.TouchEvent | React.MouseEvent) => {
    if (phaseRef.current !== 'playing' || firedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    const { w, h } = sizeRef.current;

    // Check fire button tap
    const btnX = w / 2;
    const btnY = h - 55;
    const dx = x - btnX;
    const dy = y - btnY;
    if (Math.sqrt(dx * dx + dy * dy) < 30) {
      fire();
      return;
    }

    touchRef.current = { active: true, startX: x, startY: y, startAngle: angleRef.current, startPower: powerRef.current };
  };

  const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!touchRef.current.active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    const deltaY = (y - touchRef.current.startY) * 0.004;
    const deltaX = (x - touchRef.current.startX) * 0.002;
    angleRef.current = Math.max(-Math.PI * 0.48, Math.min(-0.08, touchRef.current.startAngle + deltaY));
    powerRef.current = Math.max(0.15, Math.min(1, touchRef.current.startPower + deltaX));
  };

  const handleUp = () => { touchRef.current.active = false; };

  const start = () => {
    setWonPrize(null);
    firedRef.current = false;
    ballRef.current = null;
    hitRef.current = false;
    debrisRef.current = [];
    attemptsRef.current = 0;
    setAttempts(0);
    setGameOver(false);
    setPhase('playing');
  };

  return (
    <div className="game-container noise-overlay flex flex-col items-center justify-center" style={{ background: BG_DARK }}>
      {phase === 'playing' && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }}
          onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp}
          onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp}
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
            Visez et tirez ! Atteignez un cadeau<br/>sur les plateformes pour le gagner.
            <br/><span style={{ color: CREAM + '35' }} className="text-[11px]">{MAX_ATTEMPTS} tirs pour décrocher un cadeau premium</span>
          </p>
          {gameOver && (
            <p className="text-sm font-bold" style={{ color: '#ef4444', animation: 'fadeIn 0.3s ease-out both' }}>
              Perdu ! Réessayez 💪
            </p>
          )}
          <button onClick={start} className="mt-2 px-10 py-4 rounded-2xl text-white font-bold text-lg tracking-wide transition-all active:scale-[0.96]" style={{
            background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
            boxShadow: `0 12px 40px -10px ${GOLD}80`,
          }}>{gameOver ? 'Réessayer 💣' : 'Tirer'}</button>
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
