'use client';

import Pendulum from '../../pendulum/page';
import { WINSTON_THEME } from '../../lib/themes';

export default function WinstonPendulum() {
  return <Pendulum theme={WINSTON_THEME} />;
}
