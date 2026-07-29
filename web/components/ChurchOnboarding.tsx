'use client';

import { useEffect, useState } from 'react';

export function ChurchOnboarding({
  churchName,
  initialTimeZone,
}: {
  churchName: string;
  initialTimeZone: string;
}) {
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) setTimeZone(detected);
  }, []);

  return (
    <main className="church-onboarding">
      <section>
        <p>WELCOME TO STREETLIGHT</p>
        <h1>Begin with your church.</h1>
        <p>
          We’ll place a one-mile starting circle around this address. No street data is imported
          until you review and save Territory Setup.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              const response = await fetch('/api/onboarding', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
              });
              const result = (await response.json()) as { error?: string };
              if (!response.ok) throw new Error(result.error || 'Could not begin setup');
              window.location.reload();
            } catch (submitError) {
              setError(
                submitError instanceof Error ? submitError.message : 'Could not begin setup',
              );
              setBusy(false);
            }
          }}
        >
          <label>
            Church name
            <input
              name="churchName"
              defaultValue={churchName}
              required
              autoComplete="organization"
            />
          </label>
          <label>
            Full church address
            <input name="address" required autoComplete="street-address" />
          </label>
          <label>
            Time zone
            <input
              name="timeZone"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              required
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Finding your church…' : 'Continue to territory setup'}
          </button>
        </form>
      </section>
      <a href="/logout">Sign out</a>
    </main>
  );
}
