import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';
import RouteMap, { type MapStop } from './components/RouteMap';
import './DriverDashboard.css';

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f97316','#14b8a6','#0ea5e9','#84cc16','#f59e0b'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface DeliveryStop {
  orderId: number;
  customerName: string;
  address: string | null;
  lat: number;
  lng: number;
  status: string;
}

export default function DriverRouteMap() {
  const { name, rawUser } = useSharedAuth();
  const navigate = useNavigate();

  const [stops, setStops]         = useState<MapStop[]>([]);
  const [details, setDetails]     = useState<DeliveryStop[]>([]);
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const initials = getInitials(name ?? 'م');

  useEffect(() => {
    if (!rawUser) return;
    fetchStops();
    locateDriver();
  }, [rawUser?.id]);

  async function fetchStops() {
    setLoading(true);
    setError(null);

    // 1. Get driver_id
    const { data: driverRow } = await supabase
      .from('drivers')
      .select('driver_id')
      .eq('user_id', rawUser!.id)
      .maybeSingle();

    const driverId = driverRow?.driver_id ?? null;
    if (!driverId) { setLoading(false); setError('لم يتم العثور على بيانات السائق'); return; }

    // 2. Get batch IDs
    const { data: batchRows } = await supabase
      .from('batches')
      .select('id')
      .eq('assigned_driver_id', driverId);

    const batchIds = (batchRows ?? []).map((b) => b.id as number);
    if (!batchIds.length) { setLoading(false); return; }

    // 3. Get order IDs from order_details
    const { data: odRows } = await supabase
      .from('order_details')
      .select('order_id')
      .in('batch_id', batchIds);

    const orderIds = [...new Set((odRows ?? []).map((r) => r.order_id as number))];
    if (!orderIds.length) { setLoading(false); return; }

    // 4. Fetch orders with coordinates (no status filter — show all assigned)
    const { data: orders, error: ordErr } = await supabase
      .from('orders')
      .select('id, status, delivery_lat, delivery_lng, delivery_address, user_id')
      .in('id', orderIds);

    console.log('[RouteMap] orders:', orders, ordErr);

    if (!orders?.length) { setLoading(false); return; }

    // 5. Hydrate customer names
    const userIds = [...new Set(orders.map((o) => o.user_id).filter(Boolean))];
    const { data: users } = userIds.length
      ? await supabase.from('Users').select('user_id, name').in('user_id', userIds)
      : { data: [] as any[] };
    const nameMap = new Map((users ?? []).map((u: any) => [u.user_id, u.name as string]));

    // 6. Build stops — only orders that have coordinates
    const validOrders = orders.filter((o) => o.delivery_lat && o.delivery_lng);
    console.log('[RouteMap] validOrders (with coords):', validOrders);
    console.log('[RouteMap] orders missing coords:', orders.filter((o) => !o.delivery_lat || !o.delivery_lng).map(o => ({ id: o.id, status: o.status, lat: o.delivery_lat, lng: o.delivery_lng })));

    const deliveryStops: DeliveryStop[] = validOrders.map((o) => ({
      orderId:      o.id,
      customerName: nameMap.get(o.user_id) ?? 'عميل',
      address:      o.delivery_address ?? null,
      lat:          o.delivery_lat,
      lng:          o.delivery_lng,
      status:       o.status,
    }));

    setDetails(deliveryStops);
    setLoading(false);
  }

  function locateDriver() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setDriverLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {} // silently ignore if denied
    );
  }

  // Build MapStop array whenever details or driverLoc changes
  useEffect(() => {
    const mapStops: MapStop[] = [];

    if (driverLoc) {
      mapStops.push({ lat: driverLoc.lat, lng: driverLoc.lng, label: 'موقعك الحالي', type: 'driver' });
    }

    details.forEach((d) => {
      mapStops.push({
        lat:   d.lat,
        lng:   d.lng,
        label: `#SL-${d.orderId} — ${d.customerName}${d.address ? ' — ' + d.address : ''}`,
        type:  'customer',
      });
    });

    setStops(mapStops);
  }, [details, driverLoc]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  function statusLabel(s: string) {
    if (s === 'delivering')   return { text: 'قيد التوصيل', cls: 'in-transit' };
    if (s === 'consolidated') return { text: 'قيد الانتظار', cls: 'pending' };
    return { text: s, cls: 'pending' };
  }

  return (
    <div className="dd-root">

      {/* Sidebar */}
      <aside className="dd-sidebar">
        <div className="dd-sidebar-logo">
          <div className="dd-sidebar-logo-icon">س</div>
          <div className="dd-sidebar-logo-text">
            <span>سوق لينك</span>
            <span>توصيل</span>
          </div>
        </div>

        <div className="dd-sidebar-profile">
          <div className="dd-avatar" style={{ background: avatarColor(name ?? 'م') }}>{initials}</div>
          <div className="dd-avatar-info">
            <span className="dd-avatar-name">{name ?? 'السائق'}</span>
            <span className="dd-status-dot">في الخدمة</span>
          </div>
        </div>

        <nav className="dd-nav">
          <span className="dd-nav-section-label">الرئيسية</span>
          <span className="dd-nav-item" onClick={() => navigate('/driver-dashboard')} style={{ cursor: 'pointer' }}>
            <span className="dd-nav-icon">⊞</span>لوحة التحكم
          </span>
          <span className="dd-nav-item" onClick={() => navigate('/deliverer')} style={{ cursor: 'pointer' }}>
            <span className="dd-nav-icon">≡</span>طلباتي
          </span>
          <span className="dd-nav-item active">
            <span className="dd-nav-icon">◎</span>خريطة المسار
          </span>
          <span className="dd-nav-item">
            <span className="dd-nav-icon">▤</span>السجل
          </span>
          <span className="dd-nav-section-label">الأداء</span>
          <span className="dd-nav-item">
            <span className="dd-nav-icon">↑↓</span>الأرباح
          </span>
          <span className="dd-nav-item">
            <span className="dd-nav-icon">☆</span>التقييمات
          </span>
        </nav>

        <div className="dd-sidebar-footer">
          <span className="dd-nav-item"><span className="dd-nav-icon">👤</span>الملف الشخصي</span>
          <button className="dd-nav-item" onClick={handleLogout}>
            <span className="dd-nav-icon">⏻</span>تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="dd-main">
        <header className="dd-header">
          <div className="dd-header-left">
            <h1>خريطة المسار</h1>
            <p>{details.length} نقطة توصيل نشطة</p>
          </div>
          <div className="dd-header-right">
            <button className="dd-icon-btn" onClick={() => { fetchStops(); locateDriver(); }}>↻</button>
            <div className="dd-header-avatar" style={{ background: avatarColor(name ?? 'م') }}>{initials}</div>
          </div>
        </header>

        <div className="dd-content">
          {loading ? (
            <div className="dd-loading">جاري تحميل نقاط التوصيل…</div>
          ) : error ? (
            <div className="dd-empty" style={{ color: '#dc2626' }}>{error}</div>
          ) : stops.length === 0 ? (
            <div className="dd-empty">لا توجد طلبات نشطة لعرضها على الخريطة</div>
          ) : (
            <>
              {/* Map */}
              <div className="dd-orders-card" style={{ overflow: 'hidden' }}>
                <RouteMap stops={stops} height={420} />
              </div>

              {/* Stops list */}
              <div className="dd-orders-card">
                <div className="dd-orders-header">
                  <h2 className="dd-orders-title">نقاط التوصيل</h2>
                </div>
                <table className="dd-orders-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>رقم الطلب</th>
                      <th>العميل</th>
                      <th>العنوان</th>
                      <th>الحالة</th>
                      <th>الخريطة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((d, i) => {
                      const badge = statusLabel(d.status);
                      return (
                        <tr key={d.orderId}>
                          <td><span style={{ fontWeight: 700, color: '#f97316' }}>{i + 1}</span></td>
                          <td><span className="dd-order-id">#SL-{d.orderId}</span></td>
                          <td>{d.customerName}</td>
                          <td><span className="dd-address">{d.address ?? '—'}</span></td>
                          <td><span className={`dd-badge ${badge.cls}`}>{badge.text}</span></td>
                          <td>
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}
                            >
                              🗺 ابدأ
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
