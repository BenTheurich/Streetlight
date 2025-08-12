'use client';

import { useEffect, useState } from 'react';

type Health = { ok: boolean };

export default function ApiPingPage() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const [result, setResult] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${apiBase}/healthz`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as Health;
        setResult(json);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    })();
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
