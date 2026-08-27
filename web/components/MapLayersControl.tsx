'use client';

import { useEffect, useRef, useState } from 'react';
import type { StreetlightMapType } from '@/lib/google-maps-browser';

export function MapLayersControl({
  value,
  onChange,
}: {
  value: StreetlightMapType;
  onChange: (value: StreetlightMapType) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [open]);

  function choose(next: StreetlightMapType) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="layers-control" ref={rootRef}>
      {open && (
        <fieldset className="layers-chooser" id="map-layers-chooser">
          <legend className="sr-only">Map view</legend>
          {(['roadmap', 'satellite'] as const).map((option) => (
            <button
              aria-pressed={value === option}
              className={value === option ? 'active' : ''}
              key={option}
              onClick={() => choose(option)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`layers-choice-preview ${option === 'roadmap' ? 'map' : 'satellite'}`}
              />
              <span>{option === 'roadmap' ? 'Map' : 'Satellite'}</span>
            </button>
          ))}
        </fieldset>
      )}
      <button
        aria-controls="map-layers-chooser"
        aria-expanded={open}
        aria-label="Choose map view"
        className="layers-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="layers-thumbnail" />
        <span className="layers-trigger-label">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m12 3-9 5 9 5 9-5-9-5Zm-7.3 9L12 16l7.3-4L21 13l-9 5-9-5 1.7-1Zm0 5L12 21l7.3-4L21 18l-9 5-9-5 1.7-1Z" />
          </svg>
          Layers
        </span>
      </button>
    </div>
  );
}
