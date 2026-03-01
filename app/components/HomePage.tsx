"use client";
import React from "react";
import Link from "next/link";
import { GameTheme, DEFAULT_THEME } from '../lib/themes';

/* ═══════════════════════════════════════════════
   Home Page — Clean, professional game selection grid
   Adapts to light & dark themes via theme.mode
   ═══════════════════════════════════════════════ */

/** SVG icons for each game — sharp, minimal, adult aesthetic */
const GAME_ICONS: Record<string, React.ReactElement> = {
  plinko: (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <circle cx="16" cy="6" r="3" fill="currentColor" opacity="0.9"/>
      <circle cx="8" cy="14" r="1.5" fill="currentColor" opacity="0.35"/>
      <circle cx="16" cy="14" r="1.5" fill="currentColor" opacity="0.35"/>
      <circle cx="24" cy="14" r="1.5" fill="currentColor" opacity="0.35"/>
      <circle cx="12" cy="20" r="1.5" fill="currentColor" opacity="0.35"/>
      <circle cx="20" cy="20" r="1.5" fill="currentColor" opacity="0.35"/>
      <rect x="6" y="26" width="4" height="3" rx="1" fill="currentColor" opacity="0.5"/>
      <rect x="14" y="26" width="4" height="3" rx="1" fill="currentColor" opacity="0.5"/>
      <rect x="22" y="26" width="4" height="3" rx="1" fill="currentColor" opacity="0.5"/>
    </svg>
  ),
  'gyro-maze': (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <rect x="4" y="4" width="24" height="24" rx="3" stroke="currentColor" strokeWidth="2" opacity="0.4"/>
      <path d="M4 12h12v8H8v-4h8" stroke="currentColor" strokeWidth="2" opacity="0.6"/>
      <circle cx="22" cy="22" r="2.5" fill="currentColor" opacity="0.9"/>
    </svg>
  ),
  'angry-ball': (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <circle cx="8" cy="20" r="5" fill="currentColor" opacity="0.9"/>
      <path d="M13 20 L26 10" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2" opacity="0.4"/>
      <rect x="23" y="6" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
    </svg>
  ),
  pendulum: (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <line x1="16" y1="2" x2="16" y2="4" stroke="currentColor" strokeWidth="2" opacity="0.3"/>
      <line x1="16" y1="4" x2="10" y2="22" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
      <circle cx="10" cy="24" r="3" fill="currentColor" opacity="0.9"/>
      <rect x="4" y="28" width="24" height="2" rx="1" fill="currentColor" opacity="0.2"/>
    </svg>
  ),
  cannon: (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <rect x="4" y="18" width="12" height="6" rx="3" fill="currentColor" opacity="0.7" transform="rotate(-25 10 21)"/>
      <circle cx="24" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
      <path d="M24 6v8M20 10h8" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
    </svg>
  ),
  spin: (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="1.5" opacity="0.35"/>
      <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.25"/>
      <circle cx="16" cy="16" r="2" fill="currentColor" opacity="0.9"/>
      <line x1="16" y1="4" x2="16" y2="9" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
      <line x1="28" y1="16" x2="23" y2="16" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
    </svg>
  ),
};

export default function HomePage({ theme = DEFAULT_THEME }: { theme?: GameTheme }) {
  const {
    GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA,
    BG_DARK, BG_MID, BG_LIGHT, routePrefix, mode,
  } = theme;

  const isLight = mode === 'light';

  /* Derived colors based on theme mode */
  const textPrimary = CREAM;
  const textSecondary = isLight ? CREAM + '80' : CREAM + '60';
  const textTertiary = isLight ? CREAM + '50' : CREAM + '35';
  const cardBg = isLight
    ? `rgba(255,255,255,0.7)`
    : `rgba(255,255,255,0.04)`;
  const cardBorder = isLight
    ? `rgba(0,0,0,0.06)`
    : `rgba(255,255,255,0.06)`;
  const cardHoverBg = isLight
    ? `rgba(255,255,255,0.95)`
    : `rgba(255,255,255,0.08)`;
  const backBtnBg = isLight
    ? 'rgba(0,0,0,0.04)'
    : 'rgba(255,255,255,0.06)';

  const GAMES = [
    { href: `${routePrefix}/plinko`, title: "Plinko", key: 'plinko', desc: "Lâchez la bille" },
    { href: `${routePrefix}/gyro-maze`, title: "Gyro Maze", key: 'gyro-maze', desc: "Trouvez la sortie" },
    { href: `${routePrefix}/angry-ball`, title: "Angry Ball", key: 'angry-ball', desc: "Visez le cadeau" },
    { href: `${routePrefix}/pendulum`, title: "Pendulum", key: 'pendulum', desc: "Timing parfait" },
    { href: `${routePrefix}/cannon`, title: "Cannon", key: 'cannon', desc: "Tirez & détruisez" },
    { href: `${routePrefix}/spin`, title: "Spin & Win", key: 'spin', desc: "Tournez la roue" },
  ];

  return (
    <div
      className="flex flex-col items-center justify-center px-5 overflow-hidden"
      style={{
        width: "100%",
        height: "100dvh",
        background: isLight
          ? `linear-gradient(180deg, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)`
          : `radial-gradient(ellipse at 50% 20%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)`,
      }}
    >
      {/* Header */}
      <div
        className="text-center mb-8"
        style={{ animation: "fadeInUp 0.4s ease-out both" }}
      >
        {/* Accent line */}
        <div
          className="mx-auto mb-4 rounded-full"
          style={{
            width: '32px',
            height: '3px',
            background: GOLD,
          }}
        />
        <h1
          className="text-[22px] font-bold tracking-[-0.02em] leading-none"
          style={{ color: textPrimary }}
        >
          Mini-Jeux
        </h1>
        <p
          className="text-[12px] mt-2 font-normal tracking-wide uppercase"
          style={{ color: textTertiary, letterSpacing: '0.12em' }}
        >
          Choisissez un jeu
        </p>
      </div>

      {/* Games Grid */}
      <div
        className="grid gap-2.5 w-full"
        style={{
          gridTemplateColumns: 'repeat(2, 1fr)',
          maxWidth: '380px',
        }}
      >
        {GAMES.map((game, i) => (
          <Link
            key={game.href}
            href={game.href}
            className="group relative flex flex-col items-start gap-2.5 p-4 rounded-2xl transition-all duration-200 active:scale-[0.97]"
            style={{
              background: cardBg,
              border: `1px solid ${cardBorder}`,
              animation: `fadeInUp 0.35s ease-out ${0.06 + i * 0.05}s both`,
              backdropFilter: isLight ? 'blur(12px)' : 'none',
              WebkitBackdropFilter: isLight ? 'blur(12px)' : 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = cardHoverBg;
              e.currentTarget.style.borderColor = GOLD + (isLight ? '30' : '25');
              e.currentTarget.style.boxShadow = isLight
                ? `0 8px 32px -8px ${GOLD}20`
                : `0 8px 32px -8px rgba(0,0,0,0.3)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = cardBg;
              e.currentTarget.style.borderColor = cardBorder;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {/* Icon */}
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{
                background: GOLD + (isLight ? '12' : '15'),
                color: GOLD,
              }}
            >
              {GAME_ICONS[game.key] || <div className="w-4 h-4 rounded-full" style={{ background: GOLD }} />}
            </div>

            {/* Text */}
            <div>
              <h2
                className="font-semibold text-[13px] tracking-[-0.01em] leading-tight"
                style={{ color: textPrimary }}
              >
                {game.title}
              </h2>
              <p
                className="text-[11px] mt-0.5 font-normal"
                style={{ color: textSecondary }}
              >
                {game.desc}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* Subtle footer accent */}
      <div
        className="mt-6"
        style={{
          width: '20px',
          height: '2px',
          background: GOLD + '30',
          borderRadius: '1px',
          animation: 'fadeIn 0.6s ease-out 0.8s both',
        }}
      />
    </div>
  );
}
