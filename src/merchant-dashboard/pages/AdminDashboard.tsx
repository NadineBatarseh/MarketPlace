import { useState, useEffect } from 'react';
import emailjs from '@emailjs/browser';
import supabase from '../../lib/supabase';
import './AdminDashboard.css';

interface MerchantApp {
  id: string;
  name_of_owner: string;
  name_of_store: string;
  email: string;
  phone_number: string;
  city: string;
  Type_of_store: string;
  description: string | null;
  pictures: string[] | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  platform_email: string | null;
}

interface DeliveryApp {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  ID_number: string;
  type_of_vehicle: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  platform_email: string | null;
}

interface HubWorkerApp {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  ID_number: string;
  place_of_residence: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  platform_email: string | null;
}

type FilterTab = 'pending' | 'approved' | 'rejected';
type Section = 'merchant' | 'delivery' | 'hubworker';

const TAB_LABELS: Record<FilterTab, string> = {
  pending: 'قيد المراجعة',
  approved: 'موافق عليها',
  rejected: 'مرفوضة',
};

const STORE_TYPES: Record<string, string> = {
  retail: 'بيع بالتجزئة',
  wholesale: 'بيع بالجملة',
  food: 'أغذية ومشروبات',
  fashion: 'ملابس وأزياء',
  electronics: 'إلكترونيات',
  handmade: 'منتجات يدوية',
  other: 'أخرى',
};

const VEHICLE_TYPES: Record<string, string> = {
  motorcycle: 'دراجة نارية',
  car: 'سيارة',
  van: 'فان',
  bicycle: 'دراجة هوائية',
};

type ApproveModalState<T> = {
  app: T | null;
  platformEmail: string;
  message: string;
  sending: boolean;
  error: string;
};

type RejectModalState<T> = {
  app: T | null;
  message: string;
  sending: boolean;
  error: string;
};

export default function AdminDashboard() {
  const [activeSection, setActiveSection] = useState<Section>('merchant');
  const [activeTab, setActiveTab] = useState<FilterTab>('pending');

  // Merchant state
  const [apps, setApps] = useState<MerchantApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [approveModal, setApproveModal] = useState<ApproveModalState<MerchantApp>>(
    { app: null, platformEmail: '', message: '', sending: false, error: '' }
  );
  const [rejectModal, setRejectModal] = useState<RejectModalState<MerchantApp>>(
    { app: null, message: '', sending: false, error: '' }
  );

  // Delivery state
  const [deliveryApps, setDeliveryApps] = useState<DeliveryApp[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(true);
  const [deliveryError, setDeliveryError] = useState('');
  const [deliveryActionLoading, setDeliveryActionLoading] = useState<string | null>(null);

  const [deliveryApproveModal, setDeliveryApproveModal] = useState<ApproveModalState<DeliveryApp>>(
    { app: null, platformEmail: '', message: '', sending: false, error: '' }
  );
  const [deliveryRejectModal, setDeliveryRejectModal] = useState<RejectModalState<DeliveryApp>>(
    { app: null, message: '', sending: false, error: '' }
  );

  // Hub worker state
  const [hubApps, setHubApps] = useState<HubWorkerApp[]>([]);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState('');
  const [hubActionLoading, setHubActionLoading] = useState<string | null>(null);

  const [hubApproveModal, setHubApproveModal] = useState<ApproveModalState<HubWorkerApp>>(
    { app: null, platformEmail: '', message: '', sending: false, error: '' }
  );
  const [hubRejectModal, setHubRejectModal] = useState<RejectModalState<HubWorkerApp>>(
    { app: null, message: '', sending: false, error: '' }
  );

  useEffect(() => { loadApps(); }, []);
  useEffect(() => { loadDeliveryApps(); }, []);
  useEffect(() => { loadHubApps(); }, []);

  // ── Merchant loaders / actions ──────────────────────────────────────────────

  const loadApps = async () => {
    setAppsLoading(true);
    setAppsError('');
    const { data, error } = await supabase
      .from('merchant_applications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) setAppsError('تعذّر تحميل الطلبات: ' + error.message);
    else setApps((data ?? []) as MerchantApp[]);
    setAppsLoading(false);
  };

  const updateMerchantStatus = async (id: string, newStatus: 'approved' | 'rejected') => {
    setActionLoading(id);
    const { error } = await supabase
      .from('merchant_applications')
      .update({ status: newStatus })
      .eq('id', id);
    if (!error) setApps(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    setActionLoading(null);
  };

  const openApproveModal = (app: MerchantApp) => {
    setApproveModal({
      app,
      platformEmail: '',
      message: `عزيزي/عزيزتي ${app.name_of_owner}،\n\nيسعدنا إبلاغكم بقبول طلبكم للانضمام إلى منصة سوق لينك كتاجر معتمد!\n\nتم تخصيص بريد إلكتروني رسمي لحسابكم، يرجى مراجعته أدناه.\n\nلتفعيل حسابكم وإنشاء كلمة المرور، يرجى زيارة:\n${window.location.origin}/activate\n\nنتطلع إلى تعاون مثمر معكم،\nفريق سوق لينك`,
      sending: false,
      error: '',
    });
  };

  const handleSendApproval = async () => {
    if (!approveModal.app || !approveModal.platformEmail.trim()) return;
    setApproveModal(prev => ({ ...prev, sending: true, error: '' }));

    const finalMessage = approveModal.message + `\n\nبريدك الإلكتروني الرسمي: ${approveModal.platformEmail}`;
    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        { name: approveModal.app.name_of_owner, email: approveModal.app.email, message: finalMessage },
        { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
      );
    } catch {
      setApproveModal(prev => ({ ...prev, sending: false, error: 'تعذّر إرسال البريد الإلكتروني' }));
      return;
    }

    const { error: dbError } = await supabase
      .from('merchant_applications')
      .update({ status: 'approved', platform_email: approveModal.platformEmail.trim() })
      .eq('id', approveModal.app.id);

    if (dbError) {
      const msg = dbError.message.includes('unique') || dbError.message.includes('duplicate')
        ? 'هذا البريد الإلكتروني الرسمي مخصص لتاجر آخر — يرجى اختيار بريد مختلف'
        : 'تعذّر تحديث الطلب: ' + dbError.message;
      setApproveModal(prev => ({ ...prev, sending: false, error: msg }));
      return;
    }

    setApps(prev => prev.map(a => a.id === approveModal.app!.id ? { ...a, status: 'approved' } : a));
    setApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' });
  };

  const openRejectModal = (app: MerchantApp) => {
    setRejectModal({
      app,
      message: `عزيزي/عزيزتي ${app.name_of_owner}،\n\nنشكركم على اهتمامكم بالانضمام إلى منصة سوق لينك.\n\nبعد مراجعة طلبكم بعناية، نأسف لإبلاغكم بأننا غير قادرين على قبول طلبكم في الوقت الحالي.\n\nنتمنى لكم التوفيق والنجاح في مساعيكم.\n\nمع تحياتنا،\nفريق سوق لينك`,
      sending: false,
      error: '',
    });
  };

  const handleSendRejection = async () => {
    if (!rejectModal.app) return;
    setRejectModal(prev => ({ ...prev, sending: true, error: '' }));

    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        { name: rejectModal.app.name_of_owner, email: rejectModal.app.email, message: rejectModal.message },
        { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
      );
    } catch {
      setRejectModal(prev => ({ ...prev, sending: false, error: 'تعذّر إرسال البريد — سيتم تسجيل الرفض بدون إشعار' }));
      return;
    }

    await updateMerchantStatus(rejectModal.app.id, 'rejected');
    setRejectModal({ app: null, message: '', sending: false, error: '' });
  };

  const deleteMerchantApp = async (app: MerchantApp) => {
    if (!confirm(`هل تريد حذف طلب "${app.name_of_store}"؟`)) return;
    setActionLoading(app.id);
    if (app.pictures && app.pictures.length > 0) {
      const paths = app.pictures.map(url => {
        const parts = url.split('/merchant-applications/');
        return parts[1] ?? '';
      }).filter(Boolean);
      if (paths.length > 0) await supabase.storage.from('merchant-applications').remove(paths);
    }
    const { error } = await supabase.from('merchant_applications').delete().eq('id', app.id);
    if (!error) setApps(prev => prev.filter(a => a.id !== app.id));
    setActionLoading(null);
  };

  // ── Delivery loaders / actions ──────────────────────────────────────────────

  const loadDeliveryApps = async () => {
    setDeliveryLoading(true);
    setDeliveryError('');
    const { data, error } = await supabase
      .from('delivery_applications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) setDeliveryError('تعذّر تحميل الطلبات: ' + error.message);
    else setDeliveryApps((data ?? []) as DeliveryApp[]);
    setDeliveryLoading(false);
  };

  const updateDeliveryStatus = async (id: string, newStatus: 'approved' | 'rejected') => {
    setDeliveryActionLoading(id);
    const { error } = await supabase
      .from('delivery_applications')
      .update({ status: newStatus })
      .eq('id', id);
    if (!error) setDeliveryApps(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    setDeliveryActionLoading(null);
  };

  const openDeliveryApproveModal = (app: DeliveryApp) => {
    setDeliveryApproveModal({
      app,
      platformEmail: '',
      message: `عزيزي/عزيزتي ${app.name}،\n\nيسعدنا إبلاغكم بقبول طلبكم للانضمام إلى منصة سوق لينك كمندوب توصيل معتمد!\n\nتم تخصيص بريد إلكتروني رسمي لحسابكم، يرجى مراجعته أدناه.\n\nلتفعيل حسابكم وإنشاء كلمة المرور، يرجى زيارة:\n${window.location.origin}/activate\n\nنتطلع إلى تعاون مثمر معكم،\nفريق سوق لينك`,
      sending: false,
      error: '',
    });
  };

  const handleSendDeliveryApproval = async () => {
    if (!deliveryApproveModal.app || !deliveryApproveModal.platformEmail.trim()) return;
    setDeliveryApproveModal(prev => ({ ...prev, sending: true, error: '' }));

    const finalMessage = deliveryApproveModal.message + `\n\nبريدك الإلكتروني الرسمي: ${deliveryApproveModal.platformEmail}`;
    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        { name: deliveryApproveModal.app.name, email: deliveryApproveModal.app.email, message: finalMessage },
        { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
      );
    } catch {
      setDeliveryApproveModal(prev => ({ ...prev, sending: false, error: 'تعذّر إرسال البريد الإلكتروني' }));
      return;
    }

    const { error: dbError } = await supabase
      .from('delivery_applications')
      .update({ status: 'approved', platform_email: deliveryApproveModal.platformEmail.trim() })
      .eq('id', deliveryApproveModal.app.id);

    if (dbError) {
      const msg = dbError.message.includes('unique') || dbError.message.includes('duplicate')
        ? 'هذا البريد الإلكتروني الرسمي مخصص لمندوب آخر — يرجى اختيار بريد مختلف'
        : 'تعذّر تحديث الطلب: ' + dbError.message;
      setDeliveryApproveModal(prev => ({ ...prev, sending: false, error: msg }));
      return;
    }

    setDeliveryApps(prev => prev.map(a => a.id === deliveryApproveModal.app!.id ? { ...a, status: 'approved' } : a));
    setDeliveryApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' });
  };

  const openDeliveryRejectModal = (app: DeliveryApp) => {
    setDeliveryRejectModal({
      app,
      message: `عزيزي/عزيزتي ${app.name}،\n\nنشكركم على اهتمامكم بالانضمام إلى منصة سوق لينك كمندوب توصيل.\n\nبعد مراجعة طلبكم بعناية، نأسف لإبلاغكم بأننا غير قادرين على قبول طلبكم في الوقت الحالي.\n\nنتمنى لكم التوفيق والنجاح في مساعيكم.\n\nمع تحياتنا،\nفريق سوق لينك`,
      sending: false,
      error: '',
    });
  };

  const handleSendDeliveryRejection = async () => {
    if (!deliveryRejectModal.app) return;
    setDeliveryRejectModal(prev => ({ ...prev, sending: true, error: '' }));

    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        { name: deliveryRejectModal.app.name, email: deliveryRejectModal.app.email, message: deliveryRejectModal.message },
        { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
      );
    } catch {
      setDeliveryRejectModal(prev => ({ ...prev, sending: false, error: 'تعذّر إرسال البريد — سيتم تسجيل الرفض بدون إشعار' }));
      return;
    }

    await updateDeliveryStatus(deliveryRejectModal.app.id, 'rejected');
    setDeliveryRejectModal({ app: null, message: '', sending: false, error: '' });
  };

  const deleteDeliveryApp = async (app: DeliveryApp) => {
    if (!confirm(`هل تريد حذف طلب "${app.name}"؟`)) return;
    setDeliveryActionLoading(app.id);
    const { error } = await supabase.from('delivery_applications').delete().eq('id', app.id);
    if (!error) setDeliveryApps(prev => prev.filter(a => a.id !== app.id));
    setDeliveryActionLoading(null);
  };

  // ── Hub worker loaders / actions ────────────────────────────────────────────

  const loadHubApps = async () => {
    setHubLoading(true);
    setHubError('');
    const { data, error } = await supabase
      .from('hubworker_applications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) setHubError('تعذّر تحميل الطلبات: ' + error.message);
    else setHubApps((data ?? []) as HubWorkerApp[]);
    setHubLoading(false);
  };

  const updateHubStatus = async (id: string, newStatus: 'approved' | 'rejected') => {
    setHubActionLoading(id);
    const { error } = await supabase
      .from('hubworker_applications')
      .update({ status: newStatus })
      .eq('id', id);
    if (!error) setHubApps(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    setHubActionLoading(null);
  };

  const openHubApproveModal = (app: HubWorkerApp) => {
    setHubApproveModal({
      app,
      platformEmail: '',
      message: `عزيزي/عزيزتي ${app.name}،\n\nيسعدنا إبلاغكم بقبول طلبكم للانضمام إلى منصة سوق لينك كعامل مستودع معتمد!\n\nتم تخصيص بريد إلكتروني رسمي لحسابكم، يرجى مراجعته أدناه.\n\nلتفعيل حسابكم وإنشاء كلمة المرور، يرجى زيارة:\n${window.location.origin}/activate\n\nنتطلع إلى تعاون مثمر معكم،\nفريق سوق لينك`,
      sending: false,
      error: '',
    });
  };

  const handleSendHubApproval = async () => {
    if (!hubApproveModal.app || !hubApproveModal.platformEmail.trim()) return;
    setHubApproveModal(prev => ({ ...prev, sending: true, error: '' }));

    const finalMessage = hubApproveModal.message + `\n\nبريدك الإلكتروني الرسمي: ${hubApproveModal.platformEmail}`;
    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        { name: hubApproveModal.app.name, email: hubApproveModal.app.email, message: finalMessage },
        { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
      );
    } catch {
      setHubApproveModal(prev => ({ ...prev, sending: false, error: 'تعذّر إرسال البريد الإلكتروني' }));
      return;
    }

    const { error: dbError } = await supabase
      .from('hubworker_applications')
      .update({ status: 'approved', platform_email: hubApproveModal.platformEmail.trim() })
      .eq('id', hubApproveModal.app.id);

    if (dbError) {
      const msg = dbError.message.includes('unique') || dbError.message.includes('duplicate')
        ? 'هذا البريد الإلكتروني الرسمي مخصص لموظف آخر — يرجى اختيار بريد مختلف'
        : 'تعذّر تحديث الطلب: ' + dbError.message;
      setHubApproveModal(prev => ({ ...prev, sending: false, error: msg }));
      return;
    }

    setHubApps(prev => prev.map(a => a.id === hubApproveModal.app!.id ? { ...a, status: 'approved' } : a));
    setHubApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' });
  };

  const openHubRejectModal = (app: HubWorkerApp) => {
    setHubRejectModal({
      app,
      message: `عزيزي/عزيزتي ${app.name}،\n\nنشكركم على اهتمامكم بالانضمام إلى منصة سوق لينك كعامل مستودع.\n\nبعد مراجعة طلبكم بعناية، نأسف لإبلاغكم بأننا غير قادرين على قبول طلبكم في الوقت الحالي.\n\nنتمنى لكم التوفيق والنجاح في مساعيكم.\n\nمع تحياتنا،\nفريق سوق لينك`,
      sending: false,
      error: '',
    });
  };

  const handleSendHubRejection = async () => {
    if (!hubRejectModal.app) return;
    setHubRejectModal(prev => ({ ...prev, sending: true, error: '' }));

    try {
      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        { name: hubRejectModal.app.name, email: hubRejectModal.app.email, message: hubRejectModal.message },
        { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
      );
    } catch {
      setHubRejectModal(prev => ({ ...prev, sending: false, error: 'تعذّر إرسال البريد — سيتم تسجيل الرفض بدون إشعار' }));
      return;
    }

    await updateHubStatus(hubRejectModal.app.id, 'rejected');
    setHubRejectModal({ app: null, message: '', sending: false, error: '' });
  };

  const deleteHubApp = async (app: HubWorkerApp) => {
    if (!confirm(`هل تريد حذف طلب "${app.name}"؟`)) return;
    setHubActionLoading(app.id);
    const { error } = await supabase.from('hubworker_applications').delete().eq('id', app.id);
    if (!error) setHubApps(prev => prev.filter(a => a.id !== app.id));
    setHubActionLoading(null);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredMerchants = apps.filter(a => a.status === activeTab);
  const filteredDelivery = deliveryApps.filter(a => a.status === activeTab);
  const filteredHub = hubApps.filter(a => a.status === activeTab);

  const loading = activeSection === 'merchant' ? appsLoading : activeSection === 'delivery' ? deliveryLoading : hubLoading;
  const loadError = activeSection === 'merchant' ? appsError : activeSection === 'delivery' ? deliveryError : hubError;
  const currentApps = activeSection === 'merchant' ? filteredMerchants : activeSection === 'delivery' ? filteredDelivery : filteredHub;
  const allCurrentApps = activeSection === 'merchant' ? apps : activeSection === 'delivery' ? deliveryApps : hubApps;

  return (
    <div className="ad-root">
      <div className="ad-header">
        <div className="ad-header-logo">سوق <span>لينك</span></div>
        <div>
          <h1 className="ad-header-title">لوحة تحكم الإدارة</h1>
          <p className="ad-header-sub">مراجعة طلبات التسجيل</p>
        </div>
      </div>

      {/* Section toggle */}
      <div className="ad-section-toggle">
        <button
          type="button"
          className={`ad-section-btn${activeSection === 'merchant' ? ' ad-section-btn--active' : ''}`}
          onClick={() => setActiveSection('merchant')}
        >
          🏪 طلبات التجار
          <span className="ad-tab-count">{apps.filter(a => a.status === 'pending').length || ''}</span>
        </button>
        <button
          type="button"
          className={`ad-section-btn${activeSection === 'delivery' ? ' ad-section-btn--active' : ''}`}
          onClick={() => setActiveSection('delivery')}
        >
          🚚 طلبات المناديب
          <span className="ad-tab-count">{deliveryApps.filter(a => a.status === 'pending').length || ''}</span>
        </button>
        <button
          type="button"
          className={`ad-section-btn${activeSection === 'hubworker' ? ' ad-section-btn--active' : ''}`}
          onClick={() => setActiveSection('hubworker')}
        >
          📦 طلبات عمال المستودع
          <span className="ad-tab-count">{hubApps.filter(a => a.status === 'pending').length || ''}</span>
        </button>
      </div>

      {loadError && <div className="ad-error">{loadError}</div>}

      <div className="ad-tabs">
        {(['pending', 'approved', 'rejected'] as FilterTab[]).map(tab => {
          const count = allCurrentApps.filter(a => a.status === tab).length;
          return (
            <button
              key={tab}
              type="button"
              className={`ad-tab ad-tab--${tab}${activeTab === tab ? ' ad-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
              <span className="ad-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="ad-loading">جاري تحميل الطلبات...</div>
      ) : currentApps.length === 0 ? (
        <div className="ad-empty">لا توجد طلبات في هذا القسم</div>
      ) : (
        <div className="ad-cards">
          {/* ── Merchant cards ── */}
          {activeSection === 'merchant' && (filteredMerchants as MerchantApp[]).map(app => (
            <div key={app.id} className="ad-card">
              <div className="ad-card-body">
                <div className="ad-card-header-row">
                  <div className="ad-card-name">{app.name_of_store}</div>
                  {app.Type_of_store && (
                    <span className="ad-type-chip">{STORE_TYPES[app.Type_of_store] ?? app.Type_of_store}</span>
                  )}
                </div>
                <div className="ad-card-owner">
                  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  {app.name_of_owner}
                  <span className="ad-card-email"> — {app.email}</span>
                </div>
                <div className="ad-meta-row">
                  <div className="ad-card-detail">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.62 4.5 2 2 0 0 1 3.6 2.3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.73 2.02z"/>
                    </svg>
                    {app.phone_number}
                  </div>
                  <div className="ad-card-detail">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    {app.city}
                  </div>
                </div>
                {app.description && <div className="ad-card-desc">{app.description}</div>}
                {app.pictures && app.pictures.length > 0 && (
                  <div className="ad-pics-row">
                    {app.pictures.map((url, i) => (
                      <img key={i} src={url} alt={`صورة ${i + 1}`} className="ad-pic-thumb" onClick={() => setLightbox(url)} />
                    ))}
                  </div>
                )}
                <div className="ad-card-date">
                  تاريخ الطلب:{' '}
                  {new Date(app.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <div className="ad-card-actions">
                {activeTab !== 'approved' && (
                  <button type="button" className="ad-btn ad-btn--approve" disabled={actionLoading === app.id} onClick={() => openApproveModal(app)}>
                    ✅ موافقة
                  </button>
                )}
                {activeTab === 'approved' && (
                  <button type="button" className="ad-btn ad-btn--reject" disabled={actionLoading === app.id} onClick={() => updateMerchantStatus(app.id, 'rejected')}>
                    {actionLoading === app.id ? '...' : '↩ سحب الموافقة'}
                  </button>
                )}
                {activeTab !== 'rejected' && (
                  <button type="button" className="ad-btn ad-btn--reject" disabled={actionLoading === app.id} onClick={() => openRejectModal(app)}>
                    ❌ رفض
                  </button>
                )}
                <button type="button" className="ad-btn ad-btn--delete" disabled={actionLoading === app.id} onClick={() => deleteMerchantApp(app)}>
                  🗑 حذف
                </button>
              </div>
            </div>
          ))}

          {/* ── Hub worker cards ── */}
          {activeSection === 'hubworker' && (filteredHub as HubWorkerApp[]).map(app => (
            <div key={app.id} className="ad-card">
              <div className="ad-card-body">
                <div className="ad-card-header-row">
                  <div className="ad-card-name">{app.name}</div>
                  <span className="ad-type-chip">عامل مستودع</span>
                </div>
                <div className="ad-card-owner">
                  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  {app.email}
                </div>
                <div className="ad-meta-row">
                  <div className="ad-card-detail">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.62 4.5 2 2 0 0 1 3.6 2.3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.73 2.02z"/>
                    </svg>
                    {app.phone_number}
                  </div>
                  <div className="ad-card-detail">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    {app.place_of_residence}
                  </div>
                  <div className="ad-card-detail">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    هوية: {app.ID_number}
                  </div>
                </div>
                <div className="ad-card-date">
                  تاريخ الطلب:{' '}
                  {new Date(app.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <div className="ad-card-actions">
                {activeTab !== 'approved' && (
                  <button type="button" className="ad-btn ad-btn--approve" disabled={hubActionLoading === app.id} onClick={() => openHubApproveModal(app)}>
                    ✅ موافقة
                  </button>
                )}
                {activeTab === 'approved' && (
                  <button type="button" className="ad-btn ad-btn--reject" disabled={hubActionLoading === app.id} onClick={() => updateHubStatus(app.id, 'rejected')}>
                    {hubActionLoading === app.id ? '...' : '↩ سحب الموافقة'}
                  </button>
                )}
                {activeTab !== 'rejected' && (
                  <button type="button" className="ad-btn ad-btn--reject" disabled={hubActionLoading === app.id} onClick={() => openHubRejectModal(app)}>
                    ❌ رفض
                  </button>
                )}
                <button type="button" className="ad-btn ad-btn--delete" disabled={hubActionLoading === app.id} onClick={() => deleteHubApp(app)}>
                  🗑 حذف
                </button>
              </div>
            </div>
          ))}

          {/* ── Delivery cards ── */}
          {activeSection === 'delivery' && (filteredDelivery as DeliveryApp[]).map(app => (
            <div key={app.id} className="ad-card">
              <div className="ad-card-body">
                <div className="ad-card-header-row">
                  <div className="ad-card-name">{app.name}</div>
                  {app.type_of_vehicle && (
                    <span className="ad-type-chip">{VEHICLE_TYPES[app.type_of_vehicle] ?? app.type_of_vehicle}</span>
                  )}
                </div>
                <div className="ad-card-owner">
                  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  {app.email}
                </div>
                <div className="ad-meta-row">
                  <div className="ad-card-detail">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.62 4.5 2 2 0 0 1 3.6 2.3h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.73 2.02z"/>
                    </svg>
                    {app.phone_number}
                  </div>
                  <div className="ad-card-detail">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    هوية: {app.ID_number}
                  </div>
                </div>
                <div className="ad-card-date">
                  تاريخ الطلب:{' '}
                  {new Date(app.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <div className="ad-card-actions">
                {activeTab !== 'approved' && (
                  <button type="button" className="ad-btn ad-btn--approve" disabled={deliveryActionLoading === app.id} onClick={() => openDeliveryApproveModal(app)}>
                    ✅ موافقة
                  </button>
                )}
                {activeTab === 'approved' && (
                  <button type="button" className="ad-btn ad-btn--reject" disabled={deliveryActionLoading === app.id} onClick={() => updateDeliveryStatus(app.id, 'rejected')}>
                    {deliveryActionLoading === app.id ? '...' : '↩ سحب الموافقة'}
                  </button>
                )}
                {activeTab !== 'rejected' && (
                  <button type="button" className="ad-btn ad-btn--reject" disabled={deliveryActionLoading === app.id} onClick={() => openDeliveryRejectModal(app)}>
                    ❌ رفض
                  </button>
                )}
                <button type="button" className="ad-btn ad-btn--delete" disabled={deliveryActionLoading === app.id} onClick={() => deleteDeliveryApp(app)}>
                  🗑 حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="ad-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="صورة كاملة" />
        </div>
      )}

      {/* ── Merchant approve modal ── */}
      {approveModal.app && (
        <div className="ad-modal-overlay" onClick={() => !approveModal.sending && setApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">✅ إرسال إشعار القبول</h3>
            <p className="ad-modal-to">إلى: <strong>{approveModal.app.email}</strong></p>
            <div className="ad-modal-field">
              <label className="ad-modal-label">البريد الإلكتروني الرسمي للتاجر *</label>
              <input
                type="email"
                className="ad-modal-input"
                placeholder="merchant@souqlink.com"
                value={approveModal.platformEmail}
                onChange={e => setApproveModal(prev => ({ ...prev, platformEmail: e.target.value }))}
                disabled={approveModal.sending}
              />
            </div>
            <div className="ad-modal-field">
              <label className="ad-modal-label">نص الرسالة</label>
              <textarea
                className="ad-modal-textarea"
                value={approveModal.message}
                onChange={e => setApproveModal(prev => ({ ...prev, message: e.target.value }))}
                rows={8}
                disabled={approveModal.sending}
                title="نص رسالة القبول"
                placeholder="اكتب رسالة القبول هنا..."
              />
            </div>
            {approveModal.error && <p className="ad-modal-error">{approveModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--approve" onClick={handleSendApproval} disabled={approveModal.sending || !approveModal.platformEmail.trim()}>
                {approveModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل القبول'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' })} disabled={approveModal.sending}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Merchant reject modal ── */}
      {rejectModal.app && (
        <div className="ad-modal-overlay" onClick={() => !rejectModal.sending && setRejectModal({ app: null, message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">📧 إرسال إشعار رفض</h3>
            <p className="ad-modal-to">إلى: <strong>{rejectModal.app.email}</strong></p>
            <textarea
              className="ad-modal-textarea"
              value={rejectModal.message}
              onChange={e => setRejectModal(prev => ({ ...prev, message: e.target.value }))}
              rows={8}
              disabled={rejectModal.sending}
              title="نص الرسالة"
              placeholder="اكتب رسالة الرفض هنا..."
            />
            {rejectModal.error && <p className="ad-modal-error">{rejectModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--reject" onClick={handleSendRejection} disabled={rejectModal.sending}>
                {rejectModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل الرفض'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setRejectModal({ app: null, message: '', sending: false, error: '' })} disabled={rejectModal.sending}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delivery approve modal ── */}
      {deliveryApproveModal.app && (
        <div className="ad-modal-overlay" onClick={() => !deliveryApproveModal.sending && setDeliveryApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">✅ إرسال إشعار القبول — مندوب توصيل</h3>
            <p className="ad-modal-to">إلى: <strong>{deliveryApproveModal.app.email}</strong></p>
            <div className="ad-modal-field">
              <label className="ad-modal-label">البريد الإلكتروني الرسمي للمندوب *</label>
              <input
                type="email"
                className="ad-modal-input"
                placeholder="delivery@souqlink.com"
                value={deliveryApproveModal.platformEmail}
                onChange={e => setDeliveryApproveModal(prev => ({ ...prev, platformEmail: e.target.value }))}
                disabled={deliveryApproveModal.sending}
              />
            </div>
            <div className="ad-modal-field">
              <label className="ad-modal-label">نص الرسالة</label>
              <textarea
                className="ad-modal-textarea"
                value={deliveryApproveModal.message}
                onChange={e => setDeliveryApproveModal(prev => ({ ...prev, message: e.target.value }))}
                rows={8}
                disabled={deliveryApproveModal.sending}
                title="نص رسالة القبول"
                placeholder="اكتب رسالة القبول هنا..."
              />
            </div>
            {deliveryApproveModal.error && <p className="ad-modal-error">{deliveryApproveModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--approve" onClick={handleSendDeliveryApproval} disabled={deliveryApproveModal.sending || !deliveryApproveModal.platformEmail.trim()}>
                {deliveryApproveModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل القبول'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setDeliveryApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' })} disabled={deliveryApproveModal.sending}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delivery reject modal ── */}
      {deliveryRejectModal.app && (
        <div className="ad-modal-overlay" onClick={() => !deliveryRejectModal.sending && setDeliveryRejectModal({ app: null, message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">📧 إرسال إشعار رفض — مندوب توصيل</h3>
            <p className="ad-modal-to">إلى: <strong>{deliveryRejectModal.app.email}</strong></p>
            <textarea
              className="ad-modal-textarea"
              value={deliveryRejectModal.message}
              onChange={e => setDeliveryRejectModal(prev => ({ ...prev, message: e.target.value }))}
              rows={8}
              disabled={deliveryRejectModal.sending}
              title="نص الرسالة"
              placeholder="اكتب رسالة الرفض هنا..."
            />
            {deliveryRejectModal.error && <p className="ad-modal-error">{deliveryRejectModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--reject" onClick={handleSendDeliveryRejection} disabled={deliveryRejectModal.sending}>
                {deliveryRejectModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل الرفض'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setDeliveryRejectModal({ app: null, message: '', sending: false, error: '' })} disabled={deliveryRejectModal.sending}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Hub worker approve modal ── */}
      {hubApproveModal.app && (
        <div className="ad-modal-overlay" onClick={() => !hubApproveModal.sending && setHubApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">✅ إرسال إشعار القبول — عامل مستودع</h3>
            <p className="ad-modal-to">إلى: <strong>{hubApproveModal.app.email}</strong></p>
            <div className="ad-modal-field">
              <label className="ad-modal-label">البريد الإلكتروني الرسمي للعامل *</label>
              <input
                type="email"
                className="ad-modal-input"
                placeholder="hub@souqlink.com"
                value={hubApproveModal.platformEmail}
                onChange={e => setHubApproveModal(prev => ({ ...prev, platformEmail: e.target.value }))}
                disabled={hubApproveModal.sending}
              />
            </div>
            <div className="ad-modal-field">
              <label className="ad-modal-label">نص الرسالة</label>
              <textarea
                className="ad-modal-textarea"
                value={hubApproveModal.message}
                onChange={e => setHubApproveModal(prev => ({ ...prev, message: e.target.value }))}
                rows={8}
                disabled={hubApproveModal.sending}
                title="نص رسالة القبول"
                placeholder="اكتب رسالة القبول هنا..."
              />
            </div>
            {hubApproveModal.error && <p className="ad-modal-error">{hubApproveModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--approve" onClick={handleSendHubApproval} disabled={hubApproveModal.sending || !hubApproveModal.platformEmail.trim()}>
                {hubApproveModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل القبول'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setHubApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' })} disabled={hubApproveModal.sending}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hub worker reject modal ── */}
      {hubRejectModal.app && (
        <div className="ad-modal-overlay" onClick={() => !hubRejectModal.sending && setHubRejectModal({ app: null, message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">📧 إرسال إشعار رفض — عامل مستودع</h3>
            <p className="ad-modal-to">إلى: <strong>{hubRejectModal.app.email}</strong></p>
            <textarea
              className="ad-modal-textarea"
              value={hubRejectModal.message}
              onChange={e => setHubRejectModal(prev => ({ ...prev, message: e.target.value }))}
              rows={8}
              disabled={hubRejectModal.sending}
              title="نص الرسالة"
              placeholder="اكتب رسالة الرفض هنا..."
            />
            {hubRejectModal.error && <p className="ad-modal-error">{hubRejectModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--reject" onClick={handleSendHubRejection} disabled={hubRejectModal.sending}>
                {hubRejectModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل الرفض'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setHubRejectModal({ app: null, message: '', sending: false, error: '' })} disabled={hubRejectModal.sending}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
