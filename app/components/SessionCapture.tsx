'use client';

import { useEffect } from 'react';
import { captureSession } from '../lib/session';

/**
 * Invisible component that captures the `?s=<userId>` query
 * param on first render and stores it in sessionStorage.
 * Mount once in the root layout.
 */
export default function SessionCapture() {
  useEffect(() => {
    captureSession();
  }, []);
  return null;
}
