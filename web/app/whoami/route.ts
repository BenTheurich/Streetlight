import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const { getToken } = auth();
  const token = await getToken({ template: 'streetlight-api' }); // matches your JWT Template name
  if (!token) return NextResponse.json({ ok: false, error: 'No token' }, { status: 401 });

  const api = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
  const r = await fetch(`${api}/admin/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  return new NextResponse(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
