import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import DriverNotificationBell from './DriverNotificationBell';
import './DriverDashboard.css';

interface DeliveryStop {
  shipmentId: string;
  zone: string;
  shopName: string;
  lat: number;
  lng: number;
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'مساء الخير';
  return 'مساء النور';
}

function formatDate(): string {
  return new Date().toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function buildGoogleMapsUrl(
  ordered: DeliveryStop[],
  driverLoc: { lat: number; lng: number }
): string {
  const origin      = `${driverLoc.lat},${driverLoc.lng}`;
  const destination = `${ordered[ordered.length - 1].lat},${ordered[ordered.length - 1].lng}`;
  const waypoints   = ordered.slice(0, -1).map((s) => `${s.lat},${s.lng}`).join('|');

  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  if (waypoints) url.searchParams.set('waypoints', waypoints);
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}

export default function DriverRouteMap() {
  const { name, rawUser } = useSharedAuth();
  const navigate          = useNavigate();
  const mapRef            = useRef<HTMLDivElement>(null);
  const watchRef          = useRef<number | null>(null);

  const [stops, setStops]                   = useState<DeliveryStop[]>([]);
  const [orderedStops, setOrderedStops]     = useState<DeliveryStop[]>([]);
  const [driverLoc, setDriverLoc]           = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading]               = useState(true);
  const [routeBuilding, setRouteBuilding]   = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);

  const apiKey         = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const initials       = getInitials(name ?? 'م');
  const displayInitial = initials.charAt(0);
  const greeting       = getGreeting();
  const today          = formatDate();

  // ── Load Google Maps JS API once ─────────────────────────────────────────────
  useEffect(() => {
    if (!apiKey || (window as any).google?.maps) return;
    const id = 'gmap-script';
    if (document.getElementById(id)) return;
    const s  = document.createElement('script');
    s.id     = id;
    s.src    = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    document.head.appendChild(s);
  }, [apiKey]);

  // ── Fetch stops + locate driver on mount ─────────────────────────────────────
  useEffect(() => {
    if (!rawUser) return;
    fetchStops();
    locateDriver();
  }, [rawUser?.id]);

  // ── Re-fetch stops when admin adds shipments to this batch (Phase 8) ─────────
  useEffect(() => {
    if (!rawUser?.id) return;
    const channel = supabase
      .channel('route-map-batch-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'batches', filter: `assigned_to=eq.${rawUser.id}` },
        () => {
          setStops([]);
          setOrderedStops([]);
          fetchStops();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rawUser?.id]);

  // ── Build route once stops + location are both ready ─────────────────────────
  useEffect(() => {
    if (!stops.length || !driverLoc || !apiKey) return;
    const wait = () => {
      if (!(window as any).google?.maps) { setTimeout(wait, 400); return; }
      buildOptimizedRoute();
    };
    wait();
  }, [stops, driverLoc]);

  // ── Data fetching ─────────────────────────────────────────────────────────────

  async function fetchStops() {
    setLoading(true);
    setError(null);

    // Correct schema: batches.assigned_to = courier's user id
    const { data: batchRows, error: batchErr } = await supabase
      .from('batches')
      .select('ab_shipment_ids, bc_shipment_ids')
      .eq('assigned_to', rawUser!.id)
      .eq('status', 'in_transit');

    if (batchErr) { setError('خطأ في تحميل الدفعات'); setLoading(false); return; }
    if (!batchRows?.length) { setLoading(false); return; }

    const allIds: string[] = [];
    for (const b of batchRows) {
      allIds.push(...((b.ab_shipment_ids as string[]) ?? []));
      allIds.push(...((b.bc_shipment_ids as string[]) ?? []));
    }
    if (!allIds.length) { setLoading(false); return; }

    // Fetch delivery coordinates + shop name via order_details → shops join
    const { data: shipments, error: shipErr } = await supabase
      .from('shipments')
      .select('id, dropoff_zone, dropoff_lat, dropoff_lng, order_details(shops(name))')
      .in('id', allIds)
      .not('dropoff_lat', 'is', null)
      .not('dropoff_lng', 'is', null);

    if (shipErr) { setError('خطأ في تحميل الشحنات'); setLoading(false); return; }

    console.log('[DriverRouteMap] raw shipments:', JSON.stringify(shipments?.[0], null, 2));

    setStops(
      (shipments ?? []).map((s: any) => ({
        shipmentId: s.id             as string,
        zone:       s.dropoff_zone   as string,
        shopName:   (s.order_details?.shops?.name as string) ?? '—',
        lat:        s.dropoff_lat    as number,
        lng:        s.dropoff_lng    as number,
      }))
    );
    setLoading(false);
  }

  function locateDriver() {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => setDriverLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()    => setError('تعذّر تحديد موقعك — يرجى السماح بالوصول إلى الموقع الجغرافي'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );
  }

  useEffect(() => {
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // ── Google Maps: optimized route ──────────────────────────────────────────────

  function buildOptimizedRoute() {
    if (!mapRef.current || !driverLoc || !stops.length) return;
    setRouteBuilding(true);

    const G   = (window as any).google.maps;
    const map = new G.Map(mapRef.current, {
      zoom:              13,
      center:            { lat: driverLoc.lat, lng: driverLoc.lng },
      mapTypeControl:    false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl:       true,
    });

    const directionsService  = new G.DirectionsService();
    const directionsRenderer = new G.DirectionsRenderer({
      map,
      suppressMarkers: false,
      polylineOptions: { strokeColor: '#2563eb', strokeWeight: 5 },
    });

    const origin = new G.LatLng(driverLoc.lat, driverLoc.lng);

    // Single stop — simple origin → destination
    if (stops.length === 1) {
      directionsService.route(
        { origin, destination: new G.LatLng(stops[0].lat, stops[0].lng), travelMode: G.TravelMode.DRIVING },
        (result: any, status: string) => {
          if (status === 'OK') { directionsRenderer.setDirections(result); setOrderedStops(stops); }
          else setError('تعذّر حساب المسار — تحقق من اتصالك بالإنترنت');
          setRouteBuilding(false);
        }
      );
      return;
    }

    // Multiple stops — last stop is fixed destination; all others are optimizable waypoints
    const destination = new G.LatLng(stops[stops.length - 1].lat, stops[stops.length - 1].lng);
    const waypoints   = stops.slice(0, -1).map((s) => ({
      location: new G.LatLng(s.lat, s.lng),
      stopover: true,
    }));

    directionsService.route(
      {
        origin,
        destination,
        waypoints,
        optimizeWaypoints: true, // Google TSP solver picks the shortest real-road order
        travelMode: G.TravelMode.DRIVING,
      },
      (result: any, status: string) => {
        if (status === 'OK') {
          directionsRenderer.setDirections(result);
          // waypoint_order holds the optimized indices for the waypoints array
          const order: number[] = result.routes[0].waypoint_order;
          setOrderedStops([
            ...order.map((i) => stops[i]),
            stops[stops.length - 1], // destination is always last
          ]);
        } else {
          setOrderedStops(stops); // fallback: original order
          setError('تعذّر تحسين المسار — يتم عرض الترتيب الافتراضي');
        }
        setRouteBuilding(false);
      }
    );
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="dd-root">

      {/* Topbar */}
      <header className="dd-topbar">
        <div className="dd-topbar-brand" onClick={() => navigate('/')}>
          <img src="/logo.png" alt="سوق لينك" className="dd-topbar-logo" />
          <div className="dd-topbar-brand-text">سوق <span>لينك</span></div>
        </div>

        <div className="dd-topbar-actions">
          {/* Notification bell */}
          <DriverNotificationBell />

          <div className="dd-avatar-wrapper">
            <div
              className={`dd-topbar-avatar${showAvatarMenu ? ' dd-avatar-active' : ''}`}
              title={name ?? 'السائق'}
              onClick={() => setShowAvatarMenu((v) => !v)}
            >
              {displayInitial}
            </div>
            {showAvatarMenu && (
              <div className="dd-avatar-menu">
                <div className="dd-avatar-menu-header">
                  <div className="dd-avatar-menu-name">{name ?? 'السائق'}</div>
                  <div className="dd-avatar-menu-role">SOUQ LINK Driver</div>
                </div>
                <button
                  type="button"
                  className="dd-avatar-menu-item"
                  onClick={() => { setShowChangePassword(true); setShowAvatarMenu(false); }}
                >
                  تغيير كلمة المرور
                </button>
                <button
                  type="button"
                  className="dd-avatar-menu-item dd-avatar-menu-logout"
                  onClick={() => { setShowAvatarMenu(false); handleLogout(); }}
                >
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="dd-body">

        {/* Sidebar */}
        <aside className="dd-sidebar">
          <div className="dd-sidebar-greeting">
            <div className="dd-sidebar-greeting-name">{greeting}، <strong>{name ?? 'السائق'}</strong></div>
            <div className="dd-sidebar-greeting-date">{today}</div>
          </div>

          <nav className="dd-sidebar-nav">
            <div className="dd-sidebar-item" onClick={() => navigate('/driver-dashboard')}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">الرئيسية</span>
            </div>

            <div className="dd-sidebar-item" onClick={() => navigate('/deliverer')}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="3" width="15" height="13" rx="2" />
                  <path d="M16 8l4 2v5h-4V8z" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">طلباتي</span>
            </div>

            <div className="dd-sidebar-item" onClick={() => {}}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <polyline points="12 12 16 14" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">وردياتي</span>
            </div>

            <div className="dd-sidebar-item" onClick={() => {}}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">الأرباح</span>
            </div>

            <div className="dd-sidebar-divider" />

            <div className="dd-sidebar-item dd-active">
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">خريطة المسار</span>
            </div>

            <div className="dd-sidebar-item" onClick={() => {}}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">التقييمات</span>
            </div>
          </nav>

          <div className="dd-sidebar-footer">
            <div className="dd-sidebar-user">
              <div className="dd-sidebar-user-avatar">{displayInitial}</div>
              <div className="dd-sidebar-user-info">
                <div className="dd-sidebar-user-name">{name ?? 'السائق'}</div>
                <div className="dd-sidebar-user-role">
                  <span className="dd-duty-dot" />
                  في الخدمة
                </div>
              </div>
            </div>
            <button type="button" className="dd-sidebar-logout" onClick={handleLogout}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              تسجيل الخروج
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="dd-content">

          {/* Header row */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>خريطة المسار المحسّن</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                {loading ? 'جارٍ تحميل نقاط التوصيل…' : `${stops.length} نقطة توصيل`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {orderedStops.length > 0 && driverLoc && (
                <a
                  href={buildGoogleMapsUrl(orderedStops, driverLoc)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: '#16a34a', color: '#fff', borderRadius: 8,
                    padding: '8px 16px', fontSize: 13, fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  فتح كل المحطات في Google Maps
                </a>
              )}
              <button
                type="button"
                onClick={() => { setStops([]); setOrderedStops([]); fetchStops(); locateDriver(); }}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
              >
                تحديث
              </button>
            </div>
          </div>

          {/* No API key warning */}
          {!apiKey && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', color: '#92400e', fontSize: 13, marginBottom: 12 }}>
              أضف <strong>VITE_GOOGLE_MAPS_API_KEY</strong> في ملف .env لعرض الخريطة
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {/* Route building indicator */}
          {routeBuilding && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', color: '#2563eb', fontSize: 13, marginBottom: 12 }}>
              ⏳ جارٍ حساب المسار الأمثل عبر Google Maps…
            </div>
          )}

          {/* Map */}
          {!loading && stops.length > 0 && (
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div ref={mapRef} style={{ height: 450, width: '100%' }} />
            </div>
          )}

          {/* Empty state */}
          {!loading && stops.length === 0 && !error && (
            <div className="dd-orders-empty">لا توجد مهام جارية — ابدأ دفعة أولاً من لوحة التحكم</div>
          )}

          {/* Optimized stop list */}
          {orderedStops.length > 0 && (
            <div className="dd-orders-section">
              <div className="dd-orders-header">
                <h2 className="dd-orders-title">ترتيب التوصيل المحسّن</h2>
              </div>
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>الترتيب</th>
                      <th>رقم الشحنة</th>
                      <th>المتجر</th>
                      <th>المنطقة</th>
                      <th>الإحداثيات</th>
                      <th>الملاحة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedStops.map((stop, i) => (
                      <tr key={stop.shipmentId}>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 28, height: 28, borderRadius: '50%',
                            background: i === 0 ? '#2563eb' : '#f1f5f9',
                            color: i === 0 ? '#fff' : '#475569',
                            fontWeight: 700, fontSize: 13,
                          }}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="dd-td-id">#{stop.shipmentId.slice(-8).toUpperCase()}</td>
                        <td style={{ fontWeight: 600, color: '#1e293b' }}>{stop.shopName}</td>
                        <td>{stop.zone}</td>
                        <td style={{ fontSize: 12, color: '#94a3b8', direction: 'ltr' }}>
                          {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
                        </td>
                        <td>
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}
                          >
                            ابدأ الملاحة ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
