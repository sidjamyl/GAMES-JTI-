"use client";
import React from "react";
import Link from "next/link";
import { GameTheme, DEFAULT_THEME } from '../lib/themes';
import { getGamesForLetters } from '../lib/gameConfig';
import GameBackground from './GameBackground';

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
  'gift-slice': (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <rect x="8" y="12" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
      <rect x="6" y="10" width="20" height="4" rx="1.5" fill="currentColor" opacity="0.4"/>
      <line x1="16" y1="10" x2="16" y2="26" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
      <path d="M16 10 C16 10 12 4 9 6" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
      <path d="M16 10 C16 10 20 4 23 6" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
    </svg>
  ),
  'stack-tower': (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <rect x="10" y="24" width="12" height="4" rx="1" fill="currentColor" opacity="0.3"/>
      <rect x="9" y="19" width="14" height="4" rx="1" fill="currentColor" opacity="0.45"/>
      <rect x="11" y="14" width="10" height="4" rx="1" fill="currentColor" opacity="0.6"/>
      <rect x="10" y="9" width="12" height="4" rx="1" fill="currentColor" opacity="0.75"/>
      <rect x="12" y="4" width="8" height="4" rx="1" fill="currentColor" opacity="0.9"/>
    </svg>
  ),
  'whac-a-mole': (
    <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7">
      <ellipse cx="16" cy="24" rx="10" ry="3" fill="currentColor" opacity="0.2"/>
      <circle cx="16" cy="16" r="6" fill="currentColor" opacity="0.7"/>
      <circle cx="14" cy="15" r="1" fill="white" opacity="0.8"/>
      <circle cx="18" cy="15" r="1" fill="white" opacity="0.8"/>
      <rect x="4" y="4" width="4" height="12" rx="2" fill="currentColor" opacity="0.4" transform="rotate(-20 6 10)"/>
    </svg>
  ),
};

export default function HomePage({ theme = DEFAULT_THEME, letters = '' }: { theme?: GameTheme; letters?: string }) {
  const {
    GOLD, GOLD_BRIGHT, AMBER, CREAM, SIENNA,
    BG_DARK, BG_MID, BG_LIGHT, routePrefix, mode, name: themeName,
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

  /* Build game list from letters (empty letters = no games) */
  const gameMetas = getGamesForLetters(letters);
  const hrefBase = letters ? `${routePrefix}/${letters}` : routePrefix;
  const GAMES = gameMetas.map(g => ({
    href: `${hrefBase}/${g.slug}`,
    title: g.title,
    key: g.slug,
    desc: g.desc,
  }));

  return (
    <div
      className="relative flex flex-col items-center justify-center px-5 overflow-hidden"
      style={{
        width: "100%",
        height: "100dvh",
        background: isLight
          ? `linear-gradient(180deg, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)`
          : `radial-gradient(ellipse at 50% 20%, ${BG_LIGHT} 0%, ${BG_MID} 50%, ${BG_DARK} 100%)`,
      }}
    >
      <GameBackground themeName={themeName} />
      {/* Header */}
      <div
        className="relative z-[2] text-center mb-8"
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
        className="relative z-[2] grid gap-2.5 w-full"
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
                background: (isLight ? AMBER : GOLD) + (isLight ? '12' : '15'),
                color: isLight ? AMBER : GOLD,
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
        className="relative z-[2] mt-6"
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
