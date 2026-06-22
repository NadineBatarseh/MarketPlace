/**
 * One-time, promise-based loader for the Google Maps JS SDK.
 *
 * The driver routing map (src/pages/delivery agent/DriverRouteMap.tsx)
 * injects a <script id="gmaps-script"> imperatively. This loader reuses the
 * SAME id and guards on `window.google.maps`, so whichever feature mounts first
 * loads the SDK and the other simply resolves against the already-loaded copy —
 * the SDK is never requested twice on one page.
 *
 * Usage:
 *   await loadGoogleMaps();          // resolves once window.google.maps exists
 *   const map = new window.google.maps.Map(el, { ... });
 */

const SCRIPT_ID = 'gmaps-script';
let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  // Already available (e.g. the delivery map loaded it earlier).
  if (typeof window !== 'undefined' && window.google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      reject(new Error('VITE_GOOGLE_MAPS_API_KEY غير مُعرّف'));
      return;
    }

    const finish = () => {
      if (window.google?.maps) resolve();
      else reject(new Error('فشل تحميل خرائط Google'));
    };

    // A script tag already exists (added here or by the delivery map). Poll for
    // readiness rather than appending a second, conflicting tag.
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.maps) return resolve();
      const iv = window.setInterval(() => {
        if (window.google?.maps) { window.clearInterval(iv); resolve(); }
      }, 100);
      existing.addEventListener('error', () => { window.clearInterval(iv); reject(new Error('فشل تحميل خرائط Google')); });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = () => reject(new Error('فشل تحميل خرائط Google'));
    document.head.appendChild(script);
  });

  // Let a failed load be retried on the next call.
  loadPromise.catch(() => { loadPromise = null; });
  return loadPromise;
}
