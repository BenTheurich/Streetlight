'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/google-maps-browser';

export function ChurchOnboarding({
  churchName,
  initialTimeZone,
  mapsApiKey,
  timeZones,
}: {
  churchName: string;
  initialTimeZone: string;
  mapsApiKey: string;
  timeZones: string[];
}) {
  const placeSearchRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState('');
  const [placeSearchFailed, setPlaceSearchFailed] = useState(!mapsApiKey);
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZones.includes(detected)) setTimeZone(detected);
  }, [timeZones]);

  useEffect(() => {
    const container = placeSearchRef.current;
    if (!mapsApiKey || !container) return;
    let disposed = false;

    void loadGoogleMaps(mapsApiKey)
      .then(async (maps) => {
        const { PlaceAutocompleteElement } = (await maps.importLibrary(
          'places',
        )) as google.maps.PlacesLibrary;
        if (disposed) return;
        const autocomplete = new PlaceAutocompleteElement();
        autocomplete.className = 'church-place-autocomplete';
        autocomplete.description = 'Search for your church or address';
        autocomplete.placeholder = 'Search for your church or address';
        autocomplete.addEventListener('gmp-select', async (event) => {
          const place = (
            event as google.maps.places.PlacePredictionSelectEvent
          ).placePrediction.toPlace();
          await place.fetchFields({ fields: ['formattedAddress'] });
          if (place.formattedAddress) setAddress(place.formattedAddress);
        });
        container.replaceChildren(autocomplete);
      })
      .catch(() => setPlaceSearchFailed(true));

    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [mapsApiKey]);

  return (
    <main className="church-onboarding">
      <section>
        <p>WELCOME TO STREETLIGHT</p>
        <h1>Begin with your church.</h1>
        <p>Tell us where your church meets so Streetlight can prepare your outreach area.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!address) {
              setError('Choose your church or address from the suggestions.');
              return;
            }
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
          <div className="church-onboarding-field">
            <label htmlFor={placeSearchFailed ? 'church-address' : undefined}>
              Church or address
            </label>
            {placeSearchFailed ? (
              <input
                id="church-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="street-address"
                placeholder="Search for your church or address"
              />
            ) : (
              <div ref={placeSearchRef} />
            )}
            <input name="address" value={address} type="hidden" readOnly />
          </div>
          <label>
            Time zone
            <select
              name="timeZone"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              required
            >
              {timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
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
