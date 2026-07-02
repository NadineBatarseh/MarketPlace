import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLanguage } from '../../context/LanguageContext';
import './LocationPickerMap.css';

// Fix Leaflet's broken marker icons when bundled by Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadow,
});

export interface LatLng { lat: number; lng: number; }

interface LocationPickerMapProps {
  value: LatLng | null;
  onChange: (coords: LatLng) => void;
  loading?: boolean;
  error?: string;
  onRequestLocation: () => void;
}

const DEFAULT_CENTER: L.LatLngTuple = [31.9, 35.2]; // West Bank

export default function LocationPickerMap({
  value,
  onChange,
  loading = false,
  error = '',
  onRequestLocation,
}: LocationPickerMapProps) {
  const { t } = useTranslation('merchant');
  const { direction } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Mount the Leaflet map exactly once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 9,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  // onChange is intentionally excluded — we bind it via closure below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the click handler in sync with the latest onChange
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.off('click');
    map.on('click', (e: L.LeafletMouseEvent) => {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
  }, [onChange]);

  // Move/create marker when value changes, fly map there
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (value) {
      const ll: L.LatLngTuple = [value.lat, value.lng];
      if (markerRef.current) {
        markerRef.current.setLatLng(ll);
      } else {
        markerRef.current = L.marker(ll).addTo(map);
      }
      map.flyTo(ll, 14, { duration: 1 });
    } else {
      markerRef.current?.remove();
      markerRef.current = null;
    }
  }, [value]);

  return (
    <div className="lpm-root" dir={direction}>
      <div className="lpm-toolbar">
        <button
          type="button"
          className="lpm-geo-btn"
          onClick={onRequestLocation}
          disabled={loading}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {loading ? t('locationPicker.gettingLocation') : t('locationPicker.useCurrentLocation')}
        </button>

        {value && (
          <span className="lpm-coords" dir="ltr">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        )}
      </div>

      {error && <div className="lpm-error">{error}</div>}

      <div ref={containerRef} className="lpm-map" />

      <p className="lpm-hint">{t('locationPicker.hint')}</p>
    </div>
  );
}
