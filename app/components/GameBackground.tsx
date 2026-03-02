'use client';

import { BG_IMAGE_OPACITY } from '../lib/gameConfig';

/**
 * Themed background image for game pages.
 * Place as first child inside the game's container div.
 * Images: /public/camel.jpeg, /public/ld.jpeg, /public/winston.png
 */
export default function GameBackground({ themeName }: { themeName: string }) {
  const name = themeName === 'default' ? 'camel' : themeName;
  const opacity = BG_IMAGE_OPACITY[themeName] ?? BG_IMAGE_OPACITY.default ?? 0.08;

  return (
    <div
      className="absolute inset-0 z-[1] pointer-events-none"
      style={{ opacity }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/${name}.jpeg`}
        alt=""
        className="w-full h-full object-cover"
        draggable={false}
      />
    </div>
  );
}
