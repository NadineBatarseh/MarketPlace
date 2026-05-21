import { useState, useEffect, useCallback, useRef } from 'react';
import supabase from '../../lib/supabase';
import ConfirmDialog from '../../components/ConfirmDialog';
import AdminMessageModal from '../../components/AdminMessageModal';

interface Shop {
  shop_id: string;
  name: string;
  shopLogo: string | null;
  location: string | null;
  zone_id: string | null;
  description: string | null;
  whatsapp: string | null;
  facebook: string | null;
  instagram: string | null;
  Type_of_store: string | null;
  shop_lat: number | null;
  shop_lng: number | null;
  status: string;
  created_at: string;
  owner_id: string | null;
}

interface ShopEnriched extends Shop {
  avg_rating: number | null;
  review_count: number;
  product_count: number;
}

const STORE_TYPE_LABELS: Record<string, string> = {
  retail:      'بيع بالتجزئة',
  wholesale:   'بيع بالجملة',
  food:        'أغذية ومشروبات',
  fashion:     'ملابس وأزياء',
  electronics: 'إلكترونيات',
  handmade:    'منتجات يدوية',
  other:       'أخرى',
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  published: { label: 'منشور',        bg: '#F0FDF4', text: '#15803D', border: '#86EFAC' },
  pending:   { label: 'قيد المراجعة', bg: '#FFFBEB', text: '#B45309', border: '#FCD34D' },
  suspended: { label: 'موقوف',        bg: '#FEF2F2', text: '#DC2626', border: '#FCA5A5' },
};

function StatusBadge({ status }: { status: string }) {
  const raw = status.replace(/^'|'$/g, '');
  const cfg = STATUS_CONFIG[raw] ?? { label: raw, bg: '#F8FAFC', text: '#64748B', border: '#CBD5E1' };
  return (
    <span style={{
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
      borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span style={{ color: '#CBD5E1', fontSize: 12 }}>—</span>;
  const full  = Math.floor(rating);
  const half  = rating - full >= 0.5;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2, direction: 'ltr' }}>
      {[1,2,3,4,5].map(i => (
        <svg key={i} width="12" height="12" viewBox="0 0 24 24" fill={i <= full ? '#F59E0B' : (i === full + 1 && half ? 'url(#half)' : '#E2E8F0')} stroke="none">
          <defs>
            <linearGradient id="half">
              <stop offset="50%" stopColor="#F59E0B" />
              <stop offset="50%" stopColor="#E2E8F0" />
            </linearGradient>
          </defs>
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
      <span style={{ fontSize: 11, color: '#64748B', marginRight: 4 }}>{rating.toFixed(1)}</span>
    </span>
  );
}

function ShopAvatar({ logo, name }: { logo: string | null; name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
  if (logo) {
    return (
      <img src={logo} alt={name}
        style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'cover', border: '1px solid #E2E8F0', flexShrink: 0 }}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 7, background: '#EFF6FF',
      color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: 13, flexShrink: 0, border: '1px solid #BFDBFE',
    }}>
      {initials || '?'}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'right', color: '#64748B',
  fontWeight: 700, fontSize: 11, borderBottom: '1.5px solid #E2E8F0',
  whiteSpace: 'nowrap', background: '#F8FAFC', letterSpacing: '0.04em',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px', color: '#0F2B4E', fontSize: 12,
  verticalAlign: 'middle', textAlign: 'right', borderBottom: '1px solid #F1F5F9',
};

type StatusFilter = 'all' | 'published' | 'pending' | 'suspended';

export default function ShopsPage() {
  const [shops, setShops]               = useState<ShopEnriched[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter]     = useState<string>('all');
  const [search, setSearch]             = useState('');
  const [deleteTarget, setDeleteTarget]   = useState<ShopEnriched | null>(null);
  const [deleting, setDeleting]           = useState(false);
  const [deleteError, setDeleteError]     = useState('');
  const [suspendTarget, setSuspendTarget] = useState<ShopEnriched | null>(null);
  const [suspending, setSuspending]       = useState(false);
  const [suspendError, setSuspendError]   = useState('');
  const [openMenuId, setOpenMenuId]       = useState<string | null>(null);
  const menuRef                           = useRef<HTMLDivElement | null>(null);
  const [messageTarget, setMessageTarget] = useState<ShopEnriched | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    const [
      { data: shopRows, error: sErr },
      { data: ratingRows },
      { data: productRows },
    ] = await Promise.all([
      supabase.from('shops').select('shop_id, name, shopLogo, location, zone_id, description, whatsapp, facebook, instagram, Type_of_store, shop_lat, shop_lng, status, created_at, owner_id').order('created_at', { ascending: false }),
      supabase.from('shop_ratings').select('shop_id, avg_rating, review_count'),
      supabase.from('products').select('shop_id').eq('isPublish', true),
    ]);

    if (sErr) { setError('تعذّر تحميل البيانات: ' + sErr.message); setLoading(false); return; }

    const ratingsMap: Record<string, { avg_rating: number; review_count: number }> = {};
    for (const r of ratingRows ?? []) ratingsMap[r.shop_id] = r;

    const productCounts: Record<string, number> = {};
    for (const p of productRows ?? []) productCounts[p.shop_id] = (productCounts[p.shop_id] ?? 0) + 1;

    setShops((shopRows ?? []).map((s: any) => ({
      ...s,
      status:        (s.status ?? 'pending').replace(/^'|'$/g, ''),
      avg_rating:    ratingsMap[s.shop_id]?.avg_rating  ?? null,
      review_count:  ratingsMap[s.shop_id]?.review_count ?? 0,
      product_count: productCounts[s.shop_id] ?? 0,
    })));

    setLoading(false);
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    const { error: err } = await supabase.from('shops').delete().eq('shop_id', deleteTarget.shop_id);
    if (err) {
      setDeleteError('فشل الحذف: ' + err.message);
      setDeleting(false);
      return;
    }
    setShops(prev => prev.filter(s => s.shop_id !== deleteTarget.shop_id));
    setDeleteTarget(null);
    setDeleting(false);
  }

  async function handleSuspend() {
    if (!suspendTarget) return;
    setSuspending(true);
    setSuspendError('');
    const newStatus = suspendTarget.status === 'suspended' ? 'published' : 'suspended';
    const { error: err } = await supabase.from('shops').update({ status: newStatus }).eq('shop_id', suspendTarget.shop_id);
    if (err) {
      setSuspendError('فشل تحديث الحالة: ' + err.message);
      setSuspending(false);
      return;
    }
    setShops(prev => prev.map(s => s.shop_id === suspendTarget.shop_id ? { ...s, status: newStatus } : s));
    setSuspendTarget(null);
    setSuspending(false);
  }

  function openMessageModal(shop: ShopEnriched) {
    setMessageTarget(shop);
  }

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const statusCounts = {
    all:       shops.length,
    published: shops.filter(s => s.status === 'published').length,
    pending:   shops.filter(s => s.status === 'pending').length,
    suspended: shops.filter(s => s.status === 'suspended').length,
  };

  const storeTypes = ['all', ...Array.from(new Set(shops.map(s => s.Type_of_store).filter(Boolean)))] as string[];

  const visible = shops
    .filter(s => statusFilter === 'all' || s.status === statusFilter)
    .filter(s => typeFilter === 'all' || s.Type_of_store === typeFilter)
    .filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.location ?? '').toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ fontFamily: "'Tajawal', sans-serif", direction: 'rtl', color: '#0F2B4E' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
        .admin-stat-card {
          background: #fff;
          border-radius: 14px;
          padding: 12px 14px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          border: 1px solid #f0ede8;
          box-shadow: 0 1px 4px rgba(26,26,46,0.05);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .admin-stat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.1); }
      `}</style>

      {deleteTarget && (
        <ConfirmDialog
          title="تأكيد حذف المتجر"
          message={<>هل أنت متأكد من حذف المتجر <strong>{deleteTarget.name}</strong>؟</>}
          warning={deleteTarget.product_count > 0
            ? `تحذير: يحتوي هذا المتجر على ${deleteTarget.product_count} منتج منشور.`
            : undefined}
          confirmLabel="حذف"
          loading={deleting}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
        />
      )}

      {messageTarget && (
        <AdminMessageModal
          recipientName={messageTarget.name}
          recipientId={messageTarget.owner_id}
          onClose={() => setMessageTarget(null)}
        />
      )}

      {suspendTarget && (
        <ConfirmDialog
          title={suspendTarget.status === 'suspended' ? 'تأكيد إعادة النشر' : 'تأكيد إيقاف النشر'}
          message={
            suspendTarget.status === 'suspended'
              ? <>هل تريد إعادة نشر المتجر <strong>{suspendTarget.name}</strong>؟</>
              : <>هل تريد إيقاف نشر المتجر <strong>{suspendTarget.name}</strong>؟</>
          }
          icon={suspendTarget.status === 'suspended' ? '✅' : '🚫'}
          confirmColor={suspendTarget.status === 'suspended' ? '#16a34a' : '#B45309'}
          confirmLabel={suspendTarget.status === 'suspended' ? 'إعادة النشر' : 'إيقاف النشر'}
          reversible
          loading={suspending}
          error={suspendError}
          onConfirm={handleSuspend}
          onCancel={() => { setSuspendTarget(null); setSuspendError(''); }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>المتاجر</h2>
        <button onClick={load} disabled={loading}
          style={{ padding: '7px 14px', borderRadius: 7, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F2B4E', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
          ↻ تحديث
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
        {[
          {
            label: 'الإجمالي', sub: 'إجمالي المتاجر', value: statusCounts.all,
            iconBg: '#eff6ff', iconColor: '#2563eb',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
          },
          {
            label: 'منشورة', sub: 'متاحة للعملاء', value: statusCounts.published,
            iconBg: '#f0fdf4', iconColor: '#16a34a',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
          },
          {
            label: 'قيد المراجعة', sub: 'بانتظار الموافقة', value: statusCounts.pending,
            iconBg: '#fffbeb', iconColor: '#d97706',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
          },
          {
            label: 'موقوفة', sub: 'إيقاف مؤقت', value: statusCounts.suspended,
            iconBg: '#fef2f2', iconColor: '#dc2626',
            icon: <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
          },
        ].map(s => (
          <div key={s.label} className="admin-stat-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{s.label}</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: s.iconBg, color: s.iconColor, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {s.icon}
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'published', 'pending', 'suspended'] as StatusFilter[]).map(s => {
          const active = statusFilter === s;
          const cfg = s !== 'all' ? STATUS_CONFIG[s] : null;
          return (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{
                padding: '5px 13px', borderRadius: 20, border: '1.5px solid',
                borderColor: active ? (cfg ? cfg.border : '#0F2B4E') : '#E2E8F0',
                background:  active ? (cfg ? cfg.bg    : '#0F2B4E') : '#fff',
                color:       active ? (cfg ? cfg.text   : '#fff')   : '#64748B',
                cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: active ? 700 : 400,
              }}>
              {s === 'all' ? 'الكل' : STATUS_CONFIG[s].label}
              <span style={{ marginRight: 5, fontFamily: 'monospace', opacity: 0.8 }}>{statusCounts[s]}</span>
            </button>
          );
        })}

        {storeTypes.length > 1 && (
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{
              padding: '5px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0',
              fontSize: 12, fontFamily: 'inherit', color: '#0F2B4E',
              background: '#fff', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="all">كل الأنواع</option>
            {storeTypes.filter(t => t !== 'all').map(t => (
              <option key={t} value={t}>{STORE_TYPE_LABELS[t] ?? t}</option>
            ))}
          </select>
        )}

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث باسم المتجر أو الموقع..."
          style={{
            marginRight: 'auto', padding: '6px 12px', borderRadius: 8,
            border: '1.5px solid #E2E8F0', fontSize: 12, fontFamily: 'inherit',
            color: '#0F2B4E', outline: 'none', minWidth: 220,
          }}
        />
      </div>

      {/* Results count */}
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
        {visible.length} متجر
      </div>

      {error && (
        <div style={{ padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>جاري التحميل...</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8', fontSize: 14 }}>لا توجد متاجر</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '20%' }}>المتجر</th>
                <th style={{ ...thStyle, width: '11%' }}>النوع</th>
                <th style={{ ...thStyle, width: '11%' }}>الموقع</th>
                <th style={{ ...thStyle, width: '9%' }}>الحالة</th>
                <th style={{ ...thStyle, width: '7%', textAlign: 'center' }}>المنتجات</th>
                <th style={{ ...thStyle, width: '10%' }}>التقييم</th>
                <th style={{ ...thStyle, width: '8%', textAlign: 'center' }}>التواصل</th>
                <th style={{ ...thStyle, width: '10%' }}>تاريخ الإنشاء</th>
                <th style={{ ...thStyle, width: '6%', textAlign: 'center' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(shop => (
                <tr key={shop.shop_id}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                  style={{ transition: 'background 0.1s' }}>

                  {/* Shop name + logo */}
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <ShopAvatar logo={shop.shopLogo} name={shop.name} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shop.name}</div>
                        <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace', marginTop: 1 }}>
                          #{shop.shop_id.toString().slice(0, 8)}
                        </div>
                        {shop.description && (
                          <div style={{ fontSize: 10, color: '#64748B', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {shop.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Store type */}
                  <td style={tdStyle}>
                    {shop.Type_of_store
                      ? <span style={{ background: '#F1F5F9', color: '#334155', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                          {STORE_TYPE_LABELS[shop.Type_of_store] ?? shop.Type_of_store}
                        </span>
                      : <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>

                  {/* Location */}
                  <td style={tdStyle}>
                    {shop.shop_lat && shop.shop_lng ? (
                      <a
                        href={`https://www.google.com/maps?q=${shop.shop_lat},${shop.shop_lng}`}
                        target="_blank" rel="noreferrer"
                        style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden' }}
                      >
                        <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        <span style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shop.location ?? 'عرض الخريطة'}</span>
                      </a>
                    ) : shop.location ? (
                      <span style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden' }}>
                        <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: '#94A3B8' }}>
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shop.location}</span>
                      </span>
                    ) : (
                      <span style={{ color: '#CBD5E1', fontSize: 11 }}>—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td style={tdStyle}>
                    <StatusBadge status={shop.status} />
                  </td>

                  {/* Product count */}
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <span style={{
                      background: shop.product_count > 0 ? '#EFF6FF' : '#F8FAFC',
                      color:      shop.product_count > 0 ? '#1D4ED8' : '#94A3B8',
                      border:     `1px solid ${shop.product_count > 0 ? '#93C5FD' : '#E2E8F0'}`,
                      borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                    }}>
                      {shop.product_count}
                    </span>
                  </td>

                  {/* Rating */}
                  <td style={tdStyle}>
                    <div>
                      <Stars rating={shop.avg_rating} />
                      {shop.review_count > 0 && (
                        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
                          {shop.review_count} تقييم
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Social links */}
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                      {shop.whatsapp && (
                        <a href={`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" title="واتساب"
                          style={{ color: '#16a34a', display: 'flex' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.535 5.856L.057 23.428a.5.5 0 0 0 .609.61l5.638-1.474A11.942 11.942 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.882a9.875 9.875 0 0 1-5.031-1.375l-.36-.214-3.733.976.999-3.648-.235-.374A9.857 9.857 0 0 1 2.118 12C2.118 6.533 6.533 2.118 12 2.118c5.468 0 9.882 4.415 9.882 9.882 0 5.467-4.414 9.882-9.882 9.882z"/>
                          </svg>
                        </a>
                      )}
                      {shop.facebook && (
                        <a href={shop.facebook.startsWith('http') ? shop.facebook : `https://facebook.com/${shop.facebook}`} target="_blank" rel="noreferrer" title="فيسبوك"
                          style={{ color: '#1877F2', display: 'flex' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                          </svg>
                        </a>
                      )}
                      {shop.instagram && (
                        <a href={shop.instagram.startsWith('http') ? shop.instagram : `https://instagram.com/${shop.instagram}`} target="_blank" rel="noreferrer" title="إنستغرام"
                          style={{ color: '#E1306C', display: 'flex' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
                          </svg>
                        </a>
                      )}
                      {!shop.whatsapp && !shop.facebook && !shop.instagram && (
                        <span style={{ color: '#CBD5E1', fontSize: 12 }}>—</span>
                      )}
                    </div>
                  </td>

                  {/* Created at */}
                  <td style={{ ...tdStyle, fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>
                    {new Date(shop.created_at).toLocaleDateString('ar-EG', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </td>

                  {/* Actions — 3-dot dropdown */}
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ position: 'relative', display: 'inline-block' }}
                      ref={openMenuId === shop.shop_id ? menuRef : null}>

                      {/* Trigger */}
                      <button
                        onClick={() => setOpenMenuId(prev => prev === shop.shop_id ? null : shop.shop_id)}
                        title="المزيد من الإجراءات"
                        style={{
                          width: 32, height: 32, borderRadius: 8,
                          border: '1.5px solid #E2E8F0',
                          background: openMenuId === shop.shop_id ? '#F1F5F9' : '#fff',
                          color: '#475569', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 18, lineHeight: 1, fontWeight: 700,
                          transition: 'background 0.1s',
                        }}>
                        ···
                      </button>

                      {/* Dropdown */}
                      {openMenuId === shop.shop_id && (
                        <div style={{
                          position: 'absolute',
                          top: 36, left: 0,
                          background: '#fff',
                          border: '1.5px solid #E2E8F0',
                          borderRadius: 10,
                          boxShadow: '0 6px 24px rgba(0,0,0,0.10)',
                          zIndex: 100,
                          minWidth: 148,
                          overflow: 'hidden',
                        }}>
                          {shop.status === 'published' && (
                            <button
                              onClick={() => { setOpenMenuId(null); setSuspendTarget(shop); setSuspendError(''); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                width: '100%', padding: '10px 14px',
                                border: 'none', background: 'none',
                                color: '#B45309', cursor: 'pointer',
                                fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                                textAlign: 'right',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#FFFBEB')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                              <span>🚫</span> إيقاف النشر
                            </button>
                          )}
                          {shop.status === 'suspended' && (
                            <button
                              onClick={() => { setOpenMenuId(null); setSuspendTarget(shop); setSuspendError(''); }}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                width: '100%', padding: '10px 14px',
                                border: 'none', background: 'none',
                                color: '#15803D', cursor: 'pointer',
                                fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                                textAlign: 'right',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#F0FDF4')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                              <span>✅</span> إعادة النشر
                            </button>
                          )}

                          <button
                            onClick={() => { setOpenMenuId(null); openMessageModal(shop); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              width: '100%', padding: '10px 14px',
                              border: 'none', background: 'none',
                              color: '#2563eb', cursor: 'pointer',
                              fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                              textAlign: 'right',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#EFF6FF')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            إرسال رسالة
                          </button>

                          {/* Divider */}
                          <div style={{ height: 1, background: '#F1F5F9', margin: '2px 0' }} />

                          <button
                            onClick={() => { setOpenMenuId(null); setDeleteTarget(shop); setDeleteError(''); }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              width: '100%', padding: '10px 14px',
                              border: 'none', background: 'none',
                              color: '#DC2626', cursor: 'pointer',
                              fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                              textAlign: 'right',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#FEF2F2')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                            <span>🗑️</span> حذف
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
