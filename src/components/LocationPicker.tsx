import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps';
import './LocationPicker.css';

/**
 * Google Maps delivery-pin picker.
 *
 * The customer drops a marker on their exact doorstep; we report the captured
 * coordinates up to the parent via `onChange`. Three ways to set the pin:
 *   1. click anywhere on the map,
 *   2. drag the marker,
 *   3. "use my current location" (browser geolocation).
 *
 * Stateless about persistence — the parent owns lat/lng and decides when to save
 * (here: as part of the Profile Settings form → PUT /api/profile).
 */

interface LatLng {
  lat: number | null;
  lng: number | null;
}

interface Props {
  value: LatLng;
  onChange: (lat: number, lng: number) => void;
  /** Center shown until the user has dropped a pin. Defaults to Ramallah. */
  defaultCenter?: { lat: number; lng: number };
}

// Sensible regional default (رام الله) so the first view isn't mid-ocean.
const FALLBACK_CENTER = { lat: 31.9038, lng: 35.2034 };

// ~0.1 m precision — plenty for a doorstep, avoids storing float noise.
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export default function LocationPicker({ value, onChange, defaultCenter = FALLBACK_CENTER }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [locating, setLocating] = useState(false);

  // Keep the latest onChange without making it an init-effect dependency
  // (we only ever want to build the map once).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ── Build the map once ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapEl.current) return;

        const hasPin = value.lat != null && value.lng != null;
        const start = hasPin ? { lat: value.lat!, lng: value.lng! } : defaultCenter;

        const map = new window.google.maps.Map(mapEl.current, {
          center: start,
          zoom: hasPin ? 16 : 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });

        const marker = new window.google.maps.Marker({
          position: start,
          map,
          draggable: true,
          visible: hasPin, // hidden until the user actually picks a point
          animation: window.google.maps.Animation.DROP,
        });

        const place = (lat: number, lng: number) => {
          marker.setPosition({ lat, lng });
          marker.setVisible(true);
          onChangeRef.current(round(lat), round(lng));
        };

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) place(e.latLng.lat(), e.latLng.lng());
        });
        marker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) place(e.latLng.lat(), e.latLng.lng());
        });

        mapRef.current = map;
        markerRef.current = marker;
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync a pin that arrives AFTER init (async profile load) ─────────
  useEffect(() => {
    if (status !== 'ready' || value.lat == null || value.lng == null) return;
    const pos = { lat: value.lat, lng: value.lng };
    markerRef.current?.setPosition(pos);
    markerRef.current?.setVisible(true);
    mapRef.current?.setCenter(pos);
  }, [status, value.lat, value.lng]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pos = { lat: coords.latitude, lng: coords.longitude };
        mapRef.current?.setCenter(pos);
        mapRef.current?.setZoom(17);
        markerRef.current?.setPosition(pos);
        markerRef.current?.setVisible(true);
        onChangeRef.current(round(coords.latitude), round(coords.longitude));
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  if (status === 'error') {
    return (
      <div className="lp-fallback">
        تعذّر تحميل الخريطة. تأكد من ضبط مفتاح <code>VITE_GOOGLE_MAPS_API_KEY</code> في ملف البيئة.
      </div>
    );
  }

  const hasPin = value.lat != null && value.lng != null;

  return (
    <div className="lp-wrap">
      <div className="lp-toolbar">
        <button type="button" className="lp-locate-btn" onClick={useMyLocation} disabled={locating || status !== 'ready'}>
          <span aria-hidden>📍</span>
          {locating ? 'جارٍ تحديد موقعك…' : 'استخدم موقعي الحالي'}
        </button>
        <p className="lp-hint">اضغط على الخريطة أو اسحب المؤشر لتحديد موقع التسليم بدقة.</p>
      </div>

      <div className="lp-map-shell">
        {status === 'loading' && <div className="lp-map-loading">جارٍ تحميل الخريطة…</div>}
        <div ref={mapEl} className="lp-map" />
      </div>

      <div className="lp-coords">
        {hasPin ? (
          <>
            <span className="lp-coords-label">الإحداثيات المحددة:</span>
            <code className="lp-coords-val">{value.lat!.toFixed(6)}, {value.lng!.toFixed(6)}</code>
          </>
        ) : (
          <span className="lp-coords-empty">لم يتم تحديد موقع بعد.</span>
        )}
      </div>
    </div>
  );
}
