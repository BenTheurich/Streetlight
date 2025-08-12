// web/app/api/whoami/route.ts
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const { userId, getToken } = await auth(); // <-- await + server import
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  const token = await getToken({ template: 'streetlight-api' }); // your JWT template name
  if (!token) {
    return NextResponse.json({ ok: false, error: 'No token' }, { status: 401 });
  }

  const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
  const r = await fetch(`${apiBase}/admin/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  return new NextResponse(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
