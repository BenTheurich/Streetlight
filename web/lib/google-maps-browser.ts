import type { Position } from './territory-geometry.ts';

let mapsPromise: Promise<typeof google.maps> | undefined;

export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }
  if (!mapsPromise) {
    mapsPromise = new Promise((resolve, reject) => {
      const callbackName = '__streetlightGoogleMapsReady';
      const callbackWindow = window as typeof window & {
        __streetlightGoogleMapsReady?: () => void;
      };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=marker&callback=${callbackName}`;
      script.async = true;
      callbackWindow.__streetlightGoogleMapsReady = () => {
        delete callbackWindow.__streetlightGoogleMapsReady;
        resolve(window.google.maps);
      };
      script.onerror = () => reject(new Error('Map unavailable'));
      document.head.append(script);
    });
  }
  return mapsPromise;
}

export function latLng(position: Position): google.maps.LatLngLiteral {
  return { lat: position[1], lng: position[0] };
}
