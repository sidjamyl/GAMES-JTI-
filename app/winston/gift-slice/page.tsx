'use client';

import GiftSlice from '../../gift-slice/page';
import { WINSTON_THEME } from '../../lib/themes';

export default function WinstonGiftSlice() {
  return <GiftSlice theme={WINSTON_THEME} />;
}
