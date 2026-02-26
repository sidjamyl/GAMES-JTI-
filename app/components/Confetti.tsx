'use client';

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  rotV: number;
  opacity: number;
  shape: 'rect' | 'circle' | 'star';
}

const PALETTE = [
  '#FF3D71', '#FFAA00', '#00E096', '#0095FF',
  '#FF6B9D', '#C084FC', '#38BDF8', '#FCD34D',
  '#FB7185', '#34D399', '#A78BFA', '#F472B6',
];

export default function Confetti({ count = 180 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      c.width = window.innerWidth * dpr;
      c.height = window.innerHeight * dpr;
      c.style.width = `${window.innerWidth}px`;
      c.style.height = `${window.innerHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const shapes: Particle['shape'][] = ['rect', 'circle', 'star'];
      particles.push({
        x: Math.random() * c.width,
        y: -Math.random() * c.height * 0.6 - 30 * dpr,
        vx: (Math.random() - 0.5) * 14 * dpr,
        vy: (Math.random() * 3 + 2) * dpr,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        size: (Math.random() * 6 + 3) * dpr,
        rotation: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.35,
        opacity: 1,
        shape: shapes[Math.floor(Math.random() * 3)],
      });
    }

    let id: number;
    const animate = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      let alive = false;

      for (const p of particles) {
        p.vy += 0.15 * dpr;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.rotation += p.rotV;
        if (p.y > c.height + 40) p.opacity -= 0.06;
        if (p.opacity <= 0) continue;
        alive = true;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // star
          ctx.beginPath();
          for (let j = 0; j < 5; j++) {
            const a = (j * 4 * Math.PI) / 5 - Math.PI / 2;
            const r = j % 2 === 0 ? p.size / 2 : p.size / 5;
            if (j === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      if (alive) id = requestAnimationFrame(animate);
    };
    id = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', resize);
    };
  }, [count]);

  return <canvas ref={ref} className="fixed inset-0 pointer-events-none z-[100]" />;
}
