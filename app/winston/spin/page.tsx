'use client';

import Spin from '../../spin/page';
import { WINSTON_THEME } from '../../lib/themes';

export default function WinstonSpin() {
  return <Spin theme={WINSTON_THEME} />;
}
