import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMaps';
import './LocationPicker.css';

/**
 * Google Maps delivery-pin picker.
 *
 * The customer drops a marker on their exact doorstep; we report the captured
 * coordinates (plus optional place metadata) up to the parent via `onChange`.
 * Four ways to set the pin:
 *   1. search for a place / landmark (Places Autocomplete),
 *   2. click anywhere on the map,
 *   3. drag the marker,
 *   4. "use my current location" (browser geolocation).
 *
 * Stateless about persistence — the parent owns lat/lng/placeId and decides when
 * to save. `meta` carries Google's place_id + formatted_address when the pin came
 * from a search; a raw click/drag/geolocation reports meta = { null, null } so the
 * parent can clear any stale place metadata.
 */

interface LatLng {
  lat: number | null;
  lng: number | null;
}

export interface PlaceMeta {
  placeId?: string | null;
  formattedAddress?: string | null;
}

interface Props {
  value: LatLng;
  onChange: (lat: number, lng: number, meta?: PlaceMeta) => void;
  /** Center shown until the user has dropped a pin. Defaults to Ramallah. */
  defaultCenter?: { lat: number; lng: number };
  /** When this changes, recenter the map (e.g. after the customer picks a zone). */
  recenterTo?: { lat: number; lng: number } | null;
}

// Sensible regional default (رام الله) so the first view isn't mid-ocean.
const FALLBACK_CENTER = { lat: 31.9038, lng: 35.2034 };

// ~0.1 m precision — plenty for a doorstep, avoids storing float noise.
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export default function LocationPicker({ value, onChange, defaultCenter = FALLBACK_CENTER, recenterTo = null }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const searchEl = useRef<HTMLInputElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [locating, setLocating] = useState(false);
  const [searchReady, setSearchReady] = useState(false);
  // Feedback after "use my current location" (browser geolocation).
  const [geoMsg, setGeoMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

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

        const place = (lat: number, lng: number, meta?: PlaceMeta) => {
          marker.setPosition({ lat, lng });
          marker.setVisible(true);
          onChangeRef.current(round(lat), round(lng), meta);
        };

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          // Raw pin — clear any place metadata from a previous search.
          if (e.latLng) place(e.latLng.lat(), e.latLng.lng(), { placeId: null, formattedAddress: null });
        });
        marker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) place(e.latLng.lat(), e.latLng.lng(), { placeId: null, formattedAddress: null });
        });

        // ── Places Autocomplete search (optional — degrades gracefully) ──
        if (searchEl.current && window.google.maps.places?.Autocomplete) {
          const ac = new window.google.maps.places.Autocomplete(searchEl.current, {
            fields: ['geometry', 'place_id', 'formatted_address'],
          });
          ac.bindTo('bounds', map);
          ac.addListener('place_changed', () => {
            const p = ac.getPlace();
            const loc = p.geometry?.location;
            if (!loc) return;
            const lat = loc.lat();
            const lng = loc.lng();
            map.setCenter({ lat, lng });
            map.setZoom(17);
            place(lat, lng, { placeId: p.place_id ?? null, formattedAddress: p.formatted_address ?? null });
          });
          setSearchReady(true);
        }

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

  // ── Recenter when the parent asks (e.g. zone selected) — no pin drop ──
  useEffect(() => {
    if (status !== 'ready' || !recenterTo) return;
    mapRef.current?.setCenter(recenterTo);
    mapRef.current?.setZoom(13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, recenterTo?.lat, recenterTo?.lng]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoMsg({ kind: 'error', text: 'فشل تحديد الموقع — المتصفح لا يدعم تحديد الموقع' });
      return;
    }
    setLocating(true);
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const pos = { lat: coords.latitude, lng: coords.longitude };
        mapRef.current?.setCenter(pos);
        mapRef.current?.setZoom(17);
        markerRef.current?.setPosition(pos);
        markerRef.current?.setVisible(true);
        onChangeRef.current(round(coords.latitude), round(coords.longitude), { placeId: null, formattedAddress: null });
        setLocating(false);
        setGeoMsg({ kind: 'success', text: 'تم تحديد الموقع بنجاح' });
      },
      () => {
        setLocating(false);
        setGeoMsg({ kind: 'error', text: 'فشل تحديد الموقع — يرجى السماح بالوصول إلى موقعك والمحاولة مرة أخرى' });
      },
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
      {/* Place / landmark search (hidden if the Places library is unavailable). */}
      <div className="lp-search" style={searchReady ? undefined : { display: 'none' }}>
        <span className="material-symbols-outlined" aria-hidden>search</span>
        <input
          ref={searchEl}
          type="text"
          className="lp-search-input"
          placeholder="حاول تحديد أقرب معلم لعنوان التسليم، هذا سيساعد المندوب في الوصول إليك بسهولة أكبر"
        />
      </div>

      <div className="lp-toolbar">
        <button type="button" className="lp-locate-btn" onClick={useMyLocation} disabled={locating || status !== 'ready'}>
          <span aria-hidden>📍</span>
          {locating ? 'جارٍ تحديد موقعك…' : 'استخدم موقعي الحالي'}
        </button>
        <p className="lp-hint">ابحث، أو اضغط على الخريطة، أو اسحب المؤشر لتحديد موقع التسليم بدقة.</p>
      </div>

      {geoMsg && (
        <p className={`lp-geo-msg lp-geo-msg--${geoMsg.kind}`} role="status">
          <span className="material-symbols-outlined" aria-hidden>
            {geoMsg.kind === 'success' ? 'check_circle' : 'error'}
          </span>
          {geoMsg.text}
        </p>
      )}

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
