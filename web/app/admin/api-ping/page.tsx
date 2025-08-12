'use client';

import { useEffect, useState } from 'react';

type Health = { ok: boolean };

export default function ApiPingPage() {
  const [result, setResult] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

  useEffect(() => {
    async function run() {
      try {
        if (!apiBase) throw new Error('NEXT_PUBLIC_API_BASE_URL is not set');
        const res = await fetch(`${apiBase}/healthz`, {
          method: 'GET',
          // No cookies or auth yet; we’ll add later when Clerk is on
          credentials: 'omit',
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Health;
        setResult(json);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    }
    run();
  }, [apiBase]);

  return (
    <div style={{ padding: 24 }}>
      <h1>API Connectivity Check</h1>
      <p><strong>API base:</strong> {apiBase ?? '(not set)'}</p>
      {result && <p>Health: <code>{JSON.stringify(result)}</code></p>}
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
      <p style={{ opacity: 0.7, marginTop: 16 }}>
        Tip: Open DevTools → Network → reload this page to inspect the request.
      </p>
    </div>
  );
}
