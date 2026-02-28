import { NextRequest, NextResponse } from 'next/server';

/* Allow self-signed / unverifiable certificates (test only) */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/* ═══════════════════════════════════════════════════════════
   Proxy API route — avoids CORS by fetching server-side
   
   GET  /api/prizes?s=10  →  GET  BASE/10
   POST /api/prizes?s=10  →  POST BASE/10  (body contains gid)
   ═══════════════════════════════════════════════════════════ */

const BASE =
  process.env.PRIZES_BASE_URL ||
  'https://globalcluster-jti.net/JTI_DTC_WS/_Games_01_STK_COLL';

function buildUrl(req: NextRequest): string {
  const s = req.nextUrl.searchParams.get('s') || '';
  return `${BASE}/${s}`;
}

export async function GET(req: NextRequest) {
  const url = buildUrl(req);
  console.log('[PRIZES GET] fetching:', url);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    console.log('[PRIZES GET] upstream status:', res.status);
    if (!res.ok) {
      const body = await res.text();
      console.log('[PRIZES GET] upstream error body:', body);
      return NextResponse.json(
        { error: `Upstream returned ${res.status}`, body },
        { status: res.status },
      );
    }
    const data = await res.json();
    console.log('[PRIZES GET] raw response:', JSON.stringify(data, null, 2));

    /* Filter out product with id 267 (test) */
    const list = Array.isArray(data)
      ? data.filter((p: { id: number }) => p.id !== 267)
      : data;
    if (!Array.isArray(data) && Array.isArray(data?.prizes)) {
      data.prizes = data.prizes.filter((p: { id: number }) => p.id !== 267);
    }

    console.log('[PRIZES GET] after filtering id 267:', JSON.stringify(Array.isArray(data) ? list : data, null, 2));
    return NextResponse.json(Array.isArray(data) ? list : data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[PRIZES GET] catch error:', msg, e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const url = buildUrl(req);
  try {
    const body = await req.json();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: res.status },
      );
    }
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
