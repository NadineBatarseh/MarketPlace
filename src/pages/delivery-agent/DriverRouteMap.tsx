import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import DriverNotificationBell from './DriverNotificationBell';
import './DriverDashboard.css';

interface DeliveryStop {
  shipmentId: string;
  shipmentNumber: string;
  zone: string;
  shopName: string;
  // `lat`/`lng` is the location the driver must visit RIGHT NOW for this stop —
  // the store (pickup_lat/lng) if not yet picked up, otherwise the buyer
  // (dropoff_lat/lng). Kept alongside the raw pair so it can be recomputed
  // whenever `status` changes (see stopLatLng below).
  lat: number;
  lng: number;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  volume: number;
  deadline: string;
  urgencyScore: number;
  readyTime: string | null;
  // Enriched from /api/logistics/pickup-delivery (store/buyer details + status)
  status: string;
  buyerName: string;
  addressNote: string | null;
  batchId: string | null;
}

// A stop still needs a store pickup until it's been collected (or, in the rare
// case it was already delivered without going through this screen, skipped).
function needsPickup(status: string): boolean {
  return status !== 'picked_up' && status !== 'delivered';
}

function stopLatLng(status: string, s: { pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number }) {
  return needsPickup(status) ? { lat: s.pickupLat, lng: s.pickupLng } : { lat: s.dropoffLat, lng: s.dropoffLng };
}

// Per-shipment status labels (mirrors the pickup & delivery view)
const SHIPMENT_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:   { label: 'قيد التحضير',      color: '#9ca3af' },
  available: { label: 'متاحة',            color: '#f59e0b' },
  delayed:   { label: 'مؤجلة',            color: '#2563eb' },
  batched:   { label: 'بانتظار الاستلام', color: '#2563eb' },
  reserved:  { label: 'محجوزة',           color: '#2563eb' },
  picked_up: { label: 'قيد التوصيل',      color: '#7c3aed' },
  delivered: { label: 'تم التسليم',       color: '#16a34a' },
  stranded:  { label: 'مشكلة في النقل',   color: '#dc2626' },
};

// Which sequencer decided the visiting order:
//   'google'        → backend Google Route Optimization API
//   'greedy_2opt'   → backend hand-written Greedy + 2-opt (fallback)
//   'client_google' → in-browser Google Directions (used only if the backend is unreachable)
type Solver = 'google' | 'greedy_2opt' | 'client_google';

function solverBadge(solver: Solver): { label: string; bg: string; border: string; color: string } {
  switch (solver) {
    case 'google':
      return { label: 'تم تحديد المسار بواسطة Google Route Optimization', bg: '#ecfdf5', border: '#a7f3d0', color: '#047857' };
    case 'greedy_2opt':
      return { label: 'تم تحديد المسار بواسطة خوارزمية سوق لينك (Greedy + 2-opt)', bg: '#eef2ff', border: '#c7d2fe', color: '#4338ca' };
    case 'client_google':
      return { label: 'تم الترتيب بواسطة Google Directions (في المتصفح — الخادم غير متاح)', bg: '#f8fafc', border: '#e2e8f0', color: '#475569' };
  }
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
  return new Date().toLocaleDateString('ar-EG-u-nu-latn', {
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
  const [solver, setSolver]                 = useState<Solver | null>(null);
  const [error, setError]                   = useState<string | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [actionLoading, setActionLoading]   = useState<string | null>(null);
  const [batchList, setBatchList]           = useState<{ id: string; number: string }[]>([]);

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
          setSolver(null);
          fetchStops();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rawUser?.id]);

  // ── Plan + draw the route once stops + location are both ready ───────────────
  // Ordering authority is the BACKEND sequencer (Google Route Optimization, with
  // the Greedy+2-opt fallback). Google Directions is then used only to DRAW that
  // fixed order. If the backend is unreachable, we fall back to letting Directions
  // optimize the waypoints in the browser.
  useEffect(() => {
    if (!stops.length || !driverLoc) return;
    let cancelled = false;

    const start = () => { if (!cancelled) void planRoute(); };
    // We can hit the backend immediately, but DRAWING needs the Maps JS API. Give it
    // a moment to load; planRoute still shows the table if Maps never becomes ready.
    if (apiKey && !(window as any).google?.maps) {
      const wait = () => {
        if (cancelled) return;
        if (!(window as any).google?.maps) { setTimeout(wait, 400); return; }
        start();
      };
      wait();
    } else {
      start();
    }

    return () => { cancelled = true; };
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
    // `volume` is NOT a column on shipments — like the backend (phase3), derive it
    // from order_details.qty × products.capacity_units. deadline/urgency_score ARE
    // real columns.
    // pickup_lat/pickup_lng: needed because a shipment isn't necessarily already
    // loaded on the truck — see needsPickup() / stopLatLng() above. ready_time
    // comes from order_details.ready_time (stamped when the merchant marks the
    // order ready), the earliest the courier can actually collect it.
    const { data: shipments, error: shipErr } = await supabase
      .from('shipments')
      .select('id, shipment_number, dropoff_zone, dropoff_lat, dropoff_lng, pickup_lat, pickup_lng, deadline, urgency_score, order_details(qty, ready_time, shops(name), products(capacity_units))')
      .in('id', allIds)
      .not('dropoff_lat', 'is', null)
      .not('dropoff_lng', 'is', null);

    if (shipErr) { setError('خطأ في تحميل الشحنات'); setLoading(false); return; }

    const base: DeliveryStop[] = (shipments ?? []).map((s: any) => ({
      shipmentId:   s.id             as string,
      shipmentNumber: (s.shipment_number as string) ?? '',
      zone:         s.dropoff_zone   as string,
      shopName:     (s.order_details?.shops?.name as string) ?? '—',
      // Status isn't known yet at this point (filled in by the enrichment fetch
      // below) — default to the dropoff point, then stopLatLng() corrects it.
      lat:          s.dropoff_lat    as number,
      lng:          s.dropoff_lng    as number,
      pickupLat:    s.pickup_lat     as number,
      pickupLng:    s.pickup_lng     as number,
      dropoffLat:   s.dropoff_lat    as number,
      dropoffLng:   s.dropoff_lng    as number,
      volume:       (s.order_details?.qty ?? 0) * (s.order_details?.products?.capacity_units ?? 0),
      deadline:     (s.deadline      as string) ?? new Date().toISOString(),
      urgencyScore: (s.urgency_score as number) ?? 0,
      readyTime:    (s.order_details?.ready_time as string) ?? null,
      status:       '',
      buyerName:    '—',
      addressNote:  null,
      batchId:      null,
    }));

    // Enrich with store/buyer details + live status via the backend endpoint
    // (it uses the service-role client, so it bypasses the RLS that blocks the
    // driver's browser from reading orders / customer_profiles).
    try {
      const res = await fetch(`/api/logistics/pickup-delivery?courier_id=${encodeURIComponent(rawUser!.id)}`);
      const json = await res.json();
      if (res.ok && json.success) {
        const info = new Map<string, { status: string; buyerName: string; addressNote: string | null; storeName: string; batchId: string }>();
        const blist: { id: string; number: string }[] = [];
        for (const b of json.batches as any[]) {
          blist.push({ id: b.id, number: b.batchNumber });
          for (const sh of b.shipments) {
            info.set(sh.id, {
              status:      sh.status,
              buyerName:   sh.buyer?.name ?? '—',
              addressNote: sh.buyer?.note ?? null,
              storeName:   sh.store?.name ?? '—',
              batchId:     b.id,
            });
          }
        }
        setBatchList(blist);
        for (const stop of base) {
          const e = info.get(stop.shipmentId);
          if (e) {
            stop.status      = e.status;
            stop.buyerName   = e.buyerName;
            stop.addressNote = e.addressNote;
            stop.batchId     = e.batchId;
            if (e.storeName && e.storeName !== '—') stop.shopName = e.storeName;
            // Now that we know the real status, point this stop at the store
            // (not yet picked up) or the buyer (already on board).
            Object.assign(stop, stopLatLng(stop.status, stop));
          }
        }
      }
    } catch (e) {
      console.warn('[DriverRouteMap] enrich (pickup-delivery) failed:', e);
    }

    setStops(base);
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

  // ── Backend sequencer ─────────────────────────────────────────────────────────
  // Ask the logistics service to order the stops. Not every stop is a delivery —
  // a shipment not yet collected from its store (needsPickup) must be visited as
  // a pickup at pickup_lat/lng first; only an already-collected shipment is a
  // delivery at dropoff_lat/lng. initial_volume only counts what's ALREADY on the
  // truck — volume still to be picked up is modeled via the pickup tasks' own
  // load demand, so it must NOT be double-counted here.
  // Returns the stops re-ordered to match the backend sequence + which solver ran.
  async function sequenceViaBackend(
    list: DeliveryStop[],
    loc: { lat: number; lng: number },
  ): Promise<{ ordered: DeliveryStop[]; solver: Solver }> {
    const tasks = list.map((s) => ({
      id:            s.shipmentId,
      type:          needsPickup(s.status) ? ('pickup' as const) : ('delivery' as const),
      shipment_id:   s.shipmentId,
      location:      { lat: s.lat, lng: s.lng },
      ready_time:    needsPickup(s.status) ? s.readyTime : null,
      deadline:      s.deadline,
      volume:        s.volume,
      urgency_score: s.urgencyScore,
    }));
    const initial_volume = list
      .filter((s) => !needsPickup(s.status))
      .reduce((sum, s) => sum + (s.volume || 0), 0);

    const res = await fetch('/api/logistics/sequence', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tasks, entry_point: loc, initial_volume }),
    });
    if (!res.ok) throw new Error(`/sequence HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.sequence)) throw new Error('/sequence returned no sequence');

    const byId = new Map(list.map((s) => [s.shipmentId, s]));
    const ordered = data.sequence
      .map((t: { shipment_id: string }) => byId.get(t.shipment_id))
      .filter((s: DeliveryStop | undefined): s is DeliveryStop => Boolean(s));
    if (ordered.length !== list.length) throw new Error('/sequence dropped stops');

    return { ordered, solver: (data.solver as Solver) ?? 'greedy_2opt' };
  }

  // ── Plan + draw ───────────────────────────────────────────────────────────────
  async function planRoute() {
    if (!driverLoc || !stops.length) return;
    setRouteBuilding(true);
    setError(null);

    // 1) Order the stops via the backend sequencer. On failure, leave `ordered`
    //    null so the in-browser Directions optimizer takes over.
    let ordered: DeliveryStop[] | null = null;
    let chosenSolver: Solver = 'client_google';
    try {
      const r = await sequenceViaBackend(stops, driverLoc);
      ordered = r.ordered;
      chosenSolver = r.solver;
    } catch (e) {
      console.warn('[DriverRouteMap] backend /sequence unavailable, using in-browser Google Directions:', e);
    }
    setSolver(chosenSolver);

    // 2) Draw. Without the Maps JS API we can't render a map, but the table still
    //    shows the best-known order.
    if (!apiKey || !(window as any).google?.maps || !mapRef.current) {
      setOrderedStops(ordered ?? stops);
      setRouteBuilding(false);
      return;
    }
    if (ordered) {
      setOrderedStops(ordered);
      drawRoute(ordered, /* optimize */ false);
    } else {
      drawRoute(stops, /* optimize */ true);
    }
  }

  // Draw a route on the map. When `optimize` is false the given order is kept as-is
  // (the backend already decided it); when true, Google Directions reorders the
  // waypoints in the browser and we read the result back from waypoint_order.
  function drawRoute(list: DeliveryStop[], optimize: boolean) {
    if (!mapRef.current || !driverLoc || !list.length) { setRouteBuilding(false); return; }

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
    if (list.length === 1) {
      directionsService.route(
        { origin, destination: new G.LatLng(list[0].lat, list[0].lng), travelMode: G.TravelMode.DRIVING },
        (result: any, status: string) => {
          if (status === 'OK') { directionsRenderer.setDirections(result); setOrderedStops(list); }
          else setError('تعذّر حساب المسار — تحقق من اتصالك بالإنترنت');
          setRouteBuilding(false);
        }
      );
      return;
    }

    // Multiple stops — last stop is the fixed destination; the rest are waypoints.
    const destination = new G.LatLng(list[list.length - 1].lat, list[list.length - 1].lng);
    const waypoints   = list.slice(0, -1).map((s) => ({
      location: new G.LatLng(s.lat, s.lng),
      stopover: true,
    }));

    directionsService.route(
      {
        origin,
        destination,
        waypoints,
        optimizeWaypoints: optimize, // false → keep the backend's order; true → let Google reorder
        travelMode: G.TravelMode.DRIVING,
      },
      (result: any, status: string) => {
        if (status === 'OK') {
          directionsRenderer.setDirections(result);
          if (optimize) {
            // waypoint_order holds the optimized indices for the waypoints array
            const order: number[] = result.routes[0].waypoint_order;
            setOrderedStops([
              ...order.map((i) => list[i]),
              list[list.length - 1], // destination is always last
            ]);
          }
          // when !optimize, orderedStops was already set to the backend order
        } else if (!optimize) {
          // مؤقتاً: عدم إظهار خطأ — الترتيب من الخادم معروض بالفعل
        } else {
          setOrderedStops(list); // fallback: original order
          setError('تعذّر تحسين المسار — يتم عرض الترتيب الافتراضي');
        }
        setRouteBuilding(false);
      }
    );
  }

  // ── Status reporting (same actions as the pickup & delivery view) ────────────
  function setStopStatus(shipmentId: string, status: string) {
    const apply = (s: DeliveryStop) =>
      s.shipmentId === shipmentId ? { ...s, status, ...stopLatLng(status, s) } : s;
    setStops((prev) => prev.map(apply));
    setOrderedStops((prev) => prev.map(apply));
  }

  async function handlePickup(shipmentId: string) {
    setActionLoading('pickup-' + shipmentId);
    try {
      const res = await fetch('/api/logistics/pickup-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId, courier_id: rawUser!.id }),
      });
      if (res.ok) setStopStatus(shipmentId, 'picked_up');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeliver(shipmentId: string) {
    setActionLoading('deliver-' + shipmentId);
    try {
      const res = await fetch('/api/logistics/deliver-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId, courier_id: rawUser!.id }),
      });
      if (res.ok) setStopStatus(shipmentId, 'delivered');
    } finally {
      setActionLoading(null);
    }
  }

  // Report a general breakdown — cancels all active batches on the route.
  async function handleBreakdown() {
    if (batchList.length === 0) return;
    if (!window.confirm('هل أنت متأكد من الإبلاغ عن عطل؟ سيتم إلغاء الدفعات الجارية، وإعادة الشحنات غير المُستلمة إلى المخزون، ووضع الشحنات المُستلمة قيد المعالجة اليدوية.')) return;
    const reason = window.prompt('وصف العطل (اختياري):', '') ?? undefined;
    setActionLoading('breakdown');
    try {
      for (const b of batchList) {
        await fetch('/api/logistics/breakdown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch_id: b.id, reason: reason?.trim() || undefined }),
        });
      }
      setStops([]); setOrderedStops([]); setSolver(null); setBatchList([]);
      await fetchStops();
    } finally {
      setActionLoading(null);
    }
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
            <div className="dd-sidebar-item" onClick={() => navigate('/driver-dashboard', { state: { page: 'home' } })}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">الرئيسية</span>
            </div>

            <div className="dd-sidebar-item" onClick={() => navigate('/driver-dashboard', { state: { page: 'inbox' } })}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">صندوق الرسائل</span>
            </div>

            <div className="dd-sidebar-item" onClick={() => navigate('/driver-dashboard', { state: { page: 'trips' } })}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                  <path d="M3 12a9 9 0 0 1 9-9" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">سجل الرحلات</span>
            </div>

            <div className="dd-sidebar-item" onClick={() => navigate('/driver-dashboard', { state: { page: 'pickup_delivery' } })}>
              <span className="dd-sidebar-item-icon">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M16 16h2a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
                  <polyline points="9 11 12 14 15 11" />
                  <line x1="12" y1="14" x2="12" y2="4" />
                </svg>
              </span>
              <span className="dd-sidebar-item-label">التسليم والاستلام</span>
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
                onClick={() => { setStops([]); setOrderedStops([]); setSolver(null); fetchStops(); locateDriver(); }}
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
              ⏳ جارٍ حساب المسار الأمثل…
            </div>
          )}

          {/* Which method ordered the route */}
          {/* مؤقتاً: إخفاء إشعار الرجوع لخوارزمية المنصة — يظهر فقط عند نجاح Google */}
          {!routeBuilding && solver === 'google' && orderedStops.length > 0 && (() => {
            const b = solverBadge(solver);
            return (
              <div style={{
                background: b.bg, border: `1px solid ${b.border}`, color: b.color,
                borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600,
                marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
                </svg>
                {b.label}
              </div>
            );
          })()}

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

              {/* Breakdown report (general — cancels all active batches) */}
              {batchList.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  <button
                    type="button"
                    className="dd-pd-breakdown-btn"
                    disabled={actionLoading === 'breakdown'}
                    onClick={handleBreakdown}
                  >
                    {actionLoading === 'breakdown' ? (
                      <span className="dd-mission-spinner dd-mission-spinner-sm" />
                    ) : (
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    )}
                    الإبلاغ عن عطل
                  </button>
                </div>
              )}

              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>الترتيب</th>
                      <th>رقم الشحنة</th>
                      <th>المتجر والمشتري</th>
                      <th>الحالة</th>
                      <th>الإجراء</th>
                      <th>الملاحة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedStops.map((stop, i) => {
                      const st = SHIPMENT_STATUS_LABEL[stop.status] ?? { label: stop.status || '—', color: '#6b7280' };
                      const anyLoading = actionLoading !== null;
                      return (
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
                          <td className="dd-td-id">{stop.shipmentNumber}</td>
                          <td>
                            <div style={{ fontWeight: 700, color: '#1e293b' }}>{stop.shopName}</div>
                            <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>المشتري: {stop.buyerName}</div>
                            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                              المنطقة: {stop.zone}{stop.addressNote ? ` · ${stop.addressNote}` : ''}
                            </div>
                          </td>
                          <td>
                            <span
                              className="dd-badge"
                              style={{ background: `${st.color}18`, color: st.color, borderColor: `${st.color}30` }}
                            >
                              {st.label}
                            </span>
                          </td>
                          <td>
                            {stop.status === 'delivered' ? (
                              <span className="dd-mission-done">
                                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                تم التسليم
                              </span>
                            ) : stop.status === 'stranded' ? (
                              <span className="dd-pd-stranded">مشكلة في النقل</span>
                            ) : stop.status === 'picked_up' ? (
                              <button
                                className="dd-mission-action-btn dd-mission-deliver-btn"
                                disabled={anyLoading}
                                onClick={() => handleDeliver(stop.shipmentId)}
                              >
                                {actionLoading === 'deliver-' + stop.shipmentId ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                                تم التسليم للعميل
                              </button>
                            ) : (
                              <button
                                className="dd-mission-action-btn dd-mission-pickup-btn"
                                disabled={anyLoading}
                                onClick={() => handlePickup(stop.shipmentId)}
                              >
                                {actionLoading === 'pickup-' + stop.shipmentId ? <span className="dd-mission-spinner dd-mission-spinner-sm" /> : null}
                                تم الاستلام من المتجر
                              </button>
                            )}
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
                      );
                    })}
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
