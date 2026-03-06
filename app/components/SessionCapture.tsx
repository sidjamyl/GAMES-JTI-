'use client';

import { useEffect } from 'react';
import { captureSession } from '../lib/session';
import { getSoundEngine } from '../lib/sounds';

/**
 * Invisible component that captures the `?s=<userId>` query
 * param on first render and stores it in sessionStorage.
 * Also preloads audio files for instant playback.
 * Mount once in the root layout.
 */
export default function SessionCapture() {
  useEffect(() => {
    captureSession();
    getSoundEngine().preload();
  }, []);
  return null;
}
