import { useState, useEffect, useRef } from 'react';
import LogisticsSettingsPage from '../../pages/admin/logistics/LogisticsSettingsPage';
import PaymentSettingsPage from '../../pages/admin/PaymentSettingsPage';
import SalesLedgerPage from '../../pages/admin/SalesLedgerPage';
import FinancialAnalyticsPage from '../../pages/admin/FinancialAnalyticsPage';
import BatchMonitorPage from '../../pages/admin/BatchMonitorPage';
import CouriersPage from '../../pages/admin/CouriersPage';
import DeliveryIssuesPage from '../../pages/admin/DeliveryIssuesPage';
import ShopsPage from '../../pages/admin/ShopsPage';
import CategoryImagesPage from '../../pages/admin/CategoryImagesPage';
import AdminSentMessages from '../../pages/admin/AdminSentMessages';
import emailjs from '@emailjs/browser';
import supabase from '../../lib/supabase';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import ApplicationCard, { AppIcons, type MediaSpec, type InfoSpec } from '../components/ApplicationCard';
import { archiveApplication, restoreApplication } from '../../lib/adminArchive';
import './AdminDashboard.css';

// ── Sidebar item component (mirrors MerchantDashboard pattern) ─────────────
function SidebarItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <div className={`ad-sidebar-item${active ? ' ad-active' : ''}`} onClick={onClick}>
      <span className="ad-sidebar-item-icon">{icon}</span>
      <span className="ad-sidebar-item-label">{label}</span>
      {badge != null && badge > 0 && <span className="ad-sidebar-badge">{badge}</span>}
    </div>
  );
}

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
  id_front_url: string | null;
  id_back_url: string | null;
  is_archived?: boolean;
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
  id_front_url: string | null;
  id_back_url: string | null;
  license_front_url: string | null;
  license_back_url: string | null;
  is_archived?: boolean;
}

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected';
type Section = 'merchant' | 'delivery' | 'batches' | 'logistics' | 'couriers' | 'shops' | 'categories' | 'messages' | 'payments' | 'ledger' | 'analytics';

interface BatchConfigForm {
  max_driver_capacity: number;
  max_stops_per_batch: number;
  max_allowed_wait: number;
  max_distance_km: number;
  max_wait_days: number;
}

interface BatchShop {
  shop_id: string;
  shop_name: string;
  lat: number;
  lng: number;
  ready_time: number;
  total_volume: number;
  order_ids: number[];
  items: { product_title: string; qty: number }[];
}

interface DriverInfo {
  driver_id: number;
  name: string;
}

interface Batch {
  shops: BatchShop[];
  order_ids: number[];
  total_volume: number;
  stops: number;
  /** Set after running assignment — driver assigned to this batch */
  assigned_driver?: DriverInfo | null;
}

const TAB_LABELS: Record<FilterTab, string> = {
  all: 'الكل',
  pending: 'قيد المراجعة',
  approved: 'موافق عليها',
  rejected: 'مرفوضة',
};

/* Status classification box icons (right-aligned in RTL) */
const TAB_ICONS: Record<FilterTab, JSX.Element> = {
  all: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  pending: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  approved: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  rejected: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
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

const SECTION_HEADERS: Record<string, { title: string; subtitle: string }> = {
  merchant:  { title: 'طلبات التجار',     subtitle: 'إدارة ومراجعة طلبات انضمام التجار إلى المنصة' },
  delivery:  { title: 'طلبات المناديب',   subtitle: 'إدارة ومراجعة طلبات انضمام مناديب التوصيل إلى المنصة' },
};

/* Table column headers for the applications list (per kind) */
const APP_TABLE_COLUMNS: Record<'merchant' | 'delivery', string[]> = {
  merchant: ['المتجر', 'نوع المتجر', 'الموقع', 'التواصل', 'المستندات', 'الحالة', 'الإجراءات'],
  delivery: ['المندوب', 'نوع المركبة', 'الموقع', 'التواصل', 'المستندات', 'الحالة', 'الإجراءات'],
};

type ApproveModalState<T> = {
  app: T | null;
  platformEmail: string;
  message: string;
  sending: boolean;
  error: string;
  generatingEmail?: boolean;
};

type RejectModalState<T> = {
  app: T | null;
  reason: string;
  message: string;
  sending: boolean;
  error: string;
};

export default function AdminDashboard() {
  const [activeSection, setActiveSection] = useState<Section>('merchant');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const avatarRef  = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('pending');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);

  // Toolbar state (applications list)
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder]     = useState<'newest' | 'oldest'>('newest');
  const [typeFilter, setTypeFilter]   = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);

  const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

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
    { app: null, reason: '', message: '', sending: false, error: '' }
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
    { app: null, reason: '', message: '', sending: false, error: '' }
  );

  // Batches state
  const [batches, setBatches]             = useState<Batch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError]   = useState('');
  const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set());
  const [expandedShops, setExpandedShops]     = useState<Set<string>>(new Set());
  const [batchFilter, setBatchFilter]     = useState<'all' | 'assigned' | 'unassigned'>('all');

  // Assignment state
  const [assigning, setAssigning]         = useState(false);
  const [assignError, setAssignError]     = useState('');
  const [assignSummary, setAssignSummary] = useState<{ assigned: number; unassigned: number } | null>(null);

  // Batch config state
  // draftConfig holds raw string values for the inputs so the user can type freely.
  // batchConfig / savedConfig hold parsed numbers for comparison and saving.
  const defaultConfig: BatchConfigForm = { max_driver_capacity: 20, max_stops_per_batch: 6, max_allowed_wait: 60, max_distance_km: 5, max_wait_days: 3 };
  const [savedConfig, setSavedConfig]     = useState<BatchConfigForm>(defaultConfig);
  const [draftConfig, setDraftConfig]     = useState({ max_driver_capacity: '20', max_stops_per_batch: '6', max_allowed_wait: '60', max_distance_km: '5', max_wait_days: '3' });
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving]   = useState(false);
  const [configError, setConfigError]     = useState('');
  const [configSuccess, setConfigSuccess] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  const parsedConfig: BatchConfigForm = {
    max_driver_capacity: parseFloat(draftConfig.max_driver_capacity) || savedConfig.max_driver_capacity,
    max_stops_per_batch: parseFloat(draftConfig.max_stops_per_batch) || savedConfig.max_stops_per_batch,
    max_allowed_wait:    parseFloat(draftConfig.max_allowed_wait)    || savedConfig.max_allowed_wait,
    max_distance_km:     parseFloat(draftConfig.max_distance_km)     || savedConfig.max_distance_km,
    max_wait_days:       parseFloat(draftConfig.max_wait_days)       || savedConfig.max_wait_days,
  };

  const configChanged =
    parsedConfig.max_driver_capacity !== savedConfig.max_driver_capacity ||
    parsedConfig.max_stops_per_batch !== savedConfig.max_stops_per_batch ||
    parsedConfig.max_allowed_wait    !== savedConfig.max_allowed_wait    ||
    parsedConfig.max_distance_km     !== savedConfig.max_distance_km     ||
    parsedConfig.max_wait_days       !== savedConfig.max_wait_days;

  const toggleBatch = (idx: number) => setExpandedBatches(prev => {
    const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next;
  });
  const toggleShop = (key: string) => setExpandedShops(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next;
  });

  useEffect(() => { loadApps(); }, []);
  useEffect(() => { loadDeliveryApps(); }, []);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    setSearchQuery('');
    setTypeFilter('all');
  }, [activeSection]);

  useEffect(() => {
    const merchantSub = supabase
      .channel('admin-merchant-apps')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'merchant_applications' }, payload => {
        setApps(prev => [payload.new as MerchantApp, ...prev]);
      })
      .subscribe();

    const deliverySub = supabase
      .channel('admin-delivery-apps')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_applications' }, payload => {
        setDeliveryApps(prev => [payload.new as DeliveryApp, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(merchantSub);
      supabase.removeChannel(deliverySub);
    };
  }, []);

  useEffect(() => {
    if (!showAvatarMenu) return;
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setShowAvatarMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAvatarMenu]);

  // ── Batches loader ────────────────────────────────────────────────────────────

  const loadBatches = async () => {
    setBatchesLoading(true);
    setBatchesError('');
    try {
      const res = await fetch('/api/logistics/batches');
      const json = await res.json();
      if (json.ok) setBatches(json.batches);
      else setBatchesError(json.error ?? 'فشل تحميل التجميعات');
    } catch {
      setBatchesError('تعذّر الاتصال بالخادم');
    }
    setBatchesLoading(false);
  };

  // ── Assignment runner ─────────────────────────────────────────────────────────

  const runAssignment = async () => {
    setAssigning(true);
    setAssignError('');
    setAssignSummary(null);
    try {
      const res  = await fetch('/api/logistics/assign', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) { setAssignError(json.error ?? 'فشل التعيين'); setAssigning(false); return; }

      setAssignSummary({ assigned: json.assigned_count, unassigned: json.unassigned_count });

      // Reload all batches from the server so persisted assignments are shown correctly
      await loadBatches();
    } catch {
      setAssignError('تعذّر الاتصال بالخادم');
    }
    setAssigning(false);
  };

  // ── Batch config loader / saver ──────────────────────────────────────────────

  const loadConfig = async () => {
    setConfigLoading(true);
    setConfigError('');
    const { data, error } = await supabase
      .from('batch_config')
      .select('max_driver_capacity, max_stops_per_batch, max_allowed_wait, max_distance_km, max_wait_days')
      .single();
    if (error) setConfigError('تعذّر تحميل الإعدادات: ' + error.message);
    else if (data) {
      const d = data as BatchConfigForm;
      setSavedConfig(d);
      setDraftConfig({
        max_driver_capacity: String(d.max_driver_capacity),
        max_stops_per_batch: String(d.max_stops_per_batch),
        max_allowed_wait:    String(d.max_allowed_wait),
        max_distance_km:     String(d.max_distance_km),
        max_wait_days:       String(d.max_wait_days),
      });
    }
    setConfigLoading(false);
  };

  const saveConfig = async () => {
    setConfigSaving(true);
    setConfigError('');
    setConfigSuccess(false);
    const { error } = await supabase
      .from('batch_config')
      .update({
        max_driver_capacity: parsedConfig.max_driver_capacity,
        max_stops_per_batch: parsedConfig.max_stops_per_batch,
        max_allowed_wait:    parsedConfig.max_allowed_wait,
        max_distance_km:     parsedConfig.max_distance_km,
        max_wait_days:       parsedConfig.max_wait_days,
      })
      .eq('id', 1);
    if (error) setConfigError('فشل الحفظ: ' + error.message);
    else { setConfigSuccess(true); setSavedConfig({ ...parsedConfig }); loadBatches(); }
    setConfigSaving(false);
  };

  // ── Platform email generation ────────────────────────────────────────────────

  const arabicToLatin: Record<string, string> = {
    'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a', 'ء': 'a', 'ى': 'a',
    'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh',
    'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
    'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh',
    'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
    'ه': 'h', 'و': 'w', 'ي': 'y', 'ة': 'a', 'ئ': 'y', 'ؤ': 'w',
  };

  const normalizeName = (name: string) =>
    name
      .split('')
      .map(ch => arabicToLatin[ch] ?? ch)
      .join('')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');

  const randomShortCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = Math.random() < 0.5 ? 4 : 5;
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  const generateUniqueEmail = async (
    name: string,
    table: 'merchant_applications' | 'delivery_applications'
  ): Promise<string> => {
    const base = normalizeName(name);
    let email = `${base}${randomShortCode()}@souqlink.com`;
    for (let i = 0; i < 10; i++) {
      const candidate = `${base}${randomShortCode()}@souqlink.com`;
      const { data } = await supabase.from(table).select('id').eq('platform_email', candidate).maybeSingle();
      email = candidate;
      if (!data) break;
    }
    return email;
  };

  const generateMerchantEmail = async () => {
    if (!approveModal.app) return;
    setApproveModal(prev => ({ ...prev, generatingEmail: true }));
    const email = await generateUniqueEmail(approveModal.app.name_of_store, 'merchant_applications');
    setApproveModal(prev => ({ ...prev, platformEmail: email, generatingEmail: false }));
  };

  const generateDeliveryEmail = async () => {
    if (!deliveryApproveModal.app) return;
    setDeliveryApproveModal(prev => ({ ...prev, generatingEmail: true }));
    const email = await generateUniqueEmail(deliveryApproveModal.app.name, 'delivery_applications');
    setDeliveryApproveModal(prev => ({ ...prev, platformEmail: email, generatingEmail: false }));
  };


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

    const finalMessage = (approveModal.message + `\n\nبريدك الإلكتروني الرسمي: ${approveModal.platformEmail}`);
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
    setRejectModal({ app, reason: '', message: '', sending: false, error: '' });
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
    setRejectModal({ app: null, reason: '', message: '', sending: false, error: '' });
  };

  // Archive keeps the application row AND its uploaded documents (unlike the old
  // hard-delete) so the record stays auditable; it just leaves the active inbox.
  const archiveMerchantApp = async (app: MerchantApp) => {
    if (!confirm(`هل أنت متأكد من حذف طلب "${app.name_of_store}"؟ لن يظهر في القوائم الرئيسية، ويمكن استعادته لاحقًا من سلة المحذوفات.`)) return;
    setActionLoading(app.id);
    const res = await archiveApplication('merchant', app.id);
    if (res.ok) setApps(prev => prev.map(a => a.id === app.id ? { ...a, is_archived: true } : a));
    else setAppsError('فشل الحذف: ' + (res.error ?? ''));
    setActionLoading(null);
  };

  const restoreMerchantApp = async (app: MerchantApp) => {
    setActionLoading(app.id);
    const res = await restoreApplication('merchant', app.id);
    if (res.ok) setApps(prev => prev.map(a => a.id === app.id ? { ...a, is_archived: false } : a));
    else setAppsError('فشل الاستعادة: ' + (res.error ?? ''));
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

    const finalMessage = (deliveryApproveModal.message + `\n\nبريدك الإلكتروني الرسمي: ${deliveryApproveModal.platformEmail}`);
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
    setDeliveryRejectModal({ app, reason: '', message: '', sending: false, error: '' });
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
    setDeliveryRejectModal({ app: null, reason: '', message: '', sending: false, error: '' });
  };

  const archiveDeliveryApp = async (app: DeliveryApp) => {
    if (!confirm(`هل أنت متأكد من حذف طلب "${app.name}"؟ لن يظهر في القوائم الرئيسية، ويمكن استعادته لاحقًا من سلة المحذوفات.`)) return;
    setDeliveryActionLoading(app.id);
    const res = await archiveApplication('delivery', app.id);
    if (res.ok) setDeliveryApps(prev => prev.map(a => a.id === app.id ? { ...a, is_archived: true } : a));
    else setDeliveryError('فشل الحذف: ' + (res.error ?? ''));
    setDeliveryActionLoading(null);
  };

  const restoreDeliveryApp = async (app: DeliveryApp) => {
    setDeliveryActionLoading(app.id);
    const res = await restoreApplication('delivery', app.id);
    if (res.ok) setDeliveryApps(prev => prev.map(a => a.id === app.id ? { ...a, is_archived: false } : a));
    else setDeliveryError('فشل الاستعادة: ' + (res.error ?? ''));
    setDeliveryActionLoading(null);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const search = searchQuery.trim().toLowerCase();
  const matchesSearch = (fields: (string | null | undefined)[]) =>
    search === '' || fields.some(f => (f ?? '').toString().toLowerCase().includes(search));

  const byStatus = (status: string) => activeTab === 'all' || status === activeTab;
  const byDate = <T extends { created_at: string }>(arr: T[]): T[] =>
    [...arr].sort((a, b) =>
      sortOrder === 'newest'
        ? +new Date(b.created_at) - +new Date(a.created_at)
        : +new Date(a.created_at) - +new Date(b.created_at));

  const byArchived = (archived: boolean | undefined) => showArchived ? archived === true : archived !== true;

  const filteredMerchants = byDate(apps
    .filter(a => byArchived(a.is_archived))
    .filter(a => byStatus(a.status))
    .filter(a => typeFilter === 'all' || a.Type_of_store === typeFilter)
    .filter(a => matchesSearch([a.name_of_store, a.name_of_owner, a.phone_number, a.email, a.city])));

  const filteredDelivery = byDate(deliveryApps
    .filter(a => byArchived(a.is_archived))
    .filter(a => byStatus(a.status))
    .filter(a => typeFilter === 'all' || a.type_of_vehicle === typeFilter)
    .filter(a => matchesSearch([a.name, a.phone_number, a.email, a.ID_number])));

  const archivedCount =
    activeSection === 'merchant' ? apps.filter(a => a.is_archived).length :
    activeSection === 'delivery' ? deliveryApps.filter(a => a.is_archived).length : 0;

  const refreshCurrent = () => {
    if (activeSection === 'merchant') loadApps();
    else if (activeSection === 'delivery') loadDeliveryApps();
  };

  // Type-filter options for the toolbar dropdown (varies per section)
  const typeFilterOptions: { value: string; label: string }[] =
    activeSection === 'merchant'
      ? Object.entries(STORE_TYPES).map(([value, label]) => ({ value, label }))
      : activeSection === 'delivery'
        ? Object.entries(VEHICLE_TYPES).map(([value, label]) => ({ value, label }))
        : [];

  const loading = activeSection === 'merchant' ? appsLoading : activeSection === 'delivery' ? deliveryLoading : false;
  const loadError = activeSection === 'merchant' ? appsError : activeSection === 'delivery' ? deliveryError : '';
  const currentApps = activeSection === 'merchant' ? filteredMerchants : filteredDelivery;
  const allCurrentApps = activeSection === 'merchant' ? apps : deliveryApps;
  const isAppSection = activeSection === 'merchant' || activeSection === 'delivery';
  const sectionHeader = SECTION_HEADERS[activeSection];

  return (
    <div className="ad-root">

      {/* ── Topbar (mirrors MerchantDashboard) ── */}
      <header className="ad-topbar">
        <div className="ad-topbar-brand">
          <button
            type="button"
            className="ad-menu-toggle"
            aria-label="القائمة"
            onClick={() => setMobileNavOpen(true)}
          >
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <img src="/logo.png" alt="سوق لينك" className="ad-topbar-logo" />
          <div className="ad-topbar-brand-text">سوق <span>لينك</span></div>
        </div>

        <div className="ad-topbar-actions">
          {/* Bell */}
          <button type="button" className="ad-topbar-bell" aria-label="الإشعارات">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>

          {/* Avatar dropdown */}
          <div className="ad-avatar-wrapper" ref={avatarRef}>
            <div
              className={`ad-topbar-avatar${showAvatarMenu ? ' ad-avatar-active' : ''}`}
              title="المشرف"
              onClick={() => setShowAvatarMenu(v => !v)}
            >
              أ
            </div>
            {showAvatarMenu && (
              <div className="ad-avatar-menu">
                <div className="ad-avatar-menu-header">
                  <div className="ad-avatar-menu-name">المشرف</div>
                  <div className="ad-avatar-menu-email">SOUQ LINK Admin</div>
                </div>
                <button
                  type="button"
                  className="ad-avatar-menu-item"
                  onClick={() => { setShowChangePassword(true); setShowAvatarMenu(false); }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  تغيير كلمة المرور
                </button>
                <button
                  type="button"
                  className="ad-avatar-menu-item ad-avatar-menu-logout"
                  onClick={async () => { setShowAvatarMenu(false); await supabase.auth.signOut(); window.location.href = '/home'; }}
                >
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body: sidebar + content ── */}
      <div className="ad-body">

        {/* Mobile drawer backdrop */}
        {mobileNavOpen && <div className="ad-sidebar-overlay" onClick={() => setMobileNavOpen(false)} />}

        {/* Sidebar (mirrors MerchantDashboard) */}
        <aside className={`ad-sidebar${mobileNavOpen ? ' ad-sidebar--open' : ''}`}>

          {/* Greeting */}
          <div className="ad-sidebar-greeting">
            <div className="ad-sidebar-greeting-name">لوحة تحكم <strong>الإدارة</strong></div>
            <div className="ad-sidebar-greeting-date">{today}</div>
          </div>

          {/* Navigation — clicking any item also closes the mobile drawer (bubbles up) */}
          <nav className="ad-sidebar-nav" onClick={() => setMobileNavOpen(false)}>
            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              }
              label="طلبات التجار"
              active={activeSection === 'merchant'}
              badge={apps.filter(a => a.status === 'pending').length}
              onClick={() => setActiveSection('merchant')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="3" width="15" height="13" rx="2" />
                  <path d="M16 8l4 2v5h-4V8z" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
              }
              label="طلبات المناديب"
              active={activeSection === 'delivery'}
              badge={deliveryApps.filter(a => a.status === 'pending').length}
              onClick={() => setActiveSection('delivery')}
            />

            <div className="ad-sidebar-divider" />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="3" width="15" height="13" rx="2" />
                  <path d="M16 8l4 2v5h-4V8z" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
              }
              label="المناديب"
              active={activeSection === 'couriers'}
              onClick={() => setActiveSection('couriers')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              }
              label="مشاكل التوصيل"
              active={activeSection === 'deliveryIssues'}
              onClick={() => setActiveSection('deliveryIssues')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              }
              label="المتاجر"
              active={activeSection === 'shops'}
              onClick={() => setActiveSection('shops')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              }
              label="صور الفئات"
              active={activeSection === 'categories'}
              onClick={() => setActiveSection('categories')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
              }
              label="تجميعات الاستلام"
              active={activeSection === 'batches'}
              badge={batches.length || undefined}
              onClick={() => setActiveSection('batches')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              }
              label="إعدادات التوزيع"
              active={activeSection === 'logistics'}
              onClick={() => setActiveSection('logistics')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
              }
              label="إعدادات الدفع"
              active={activeSection === 'payments'}
              onClick={() => setActiveSection('payments')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M9 13h6M9 17h6M9 9h1" />
                </svg>
              }
              label="كشف المبيعات"
              active={activeSection === 'ledger'}
              onClick={() => setActiveSection('ledger')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M7 14l4-4 3 3 5-6" />
                </svg>
              }
              label="التحليلات"
              active={activeSection === 'analytics'}
              onClick={() => setActiveSection('analytics')}
            />

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              }
              label="الرسائل المرسلة"
              active={activeSection === 'messages'}
              onClick={() => setActiveSection('messages')}
            />
          </nav>

          {/* Sidebar footer */}
          <div className="ad-sidebar-footer">
            <div className="ad-sidebar-user">
              <div className="ad-sidebar-user-avatar">أ</div>
              <div className="ad-sidebar-user-info">
                <div className="ad-sidebar-user-name">المشرف</div>
                <div className="ad-sidebar-user-role">SOUQ LINK Admin</div>
              </div>
            </div>
            <button
              type="button"
              className="ad-sidebar-logout"
              onClick={async () => { await supabase.auth.signOut(); window.location.href = '/home'; }}
            >
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
        <main className="ad-content" ref={contentRef}>
          {isAppSection && loadError && <div className="ad-error">{loadError}</div>}

          {/* Page header — application sections */}
          {isAppSection && sectionHeader && (
            <div className="ad-page-head">
              <h1 className="ad-page-title">{sectionHeader.title}</h1>
              <p className="ad-page-subtitle">{sectionHeader.subtitle}</p>
            </div>
          )}

          {/* Filter tabs — only for application sections */}
          {isAppSection && (
            <div className="ad-tabs">
              {(['all', 'pending', 'approved', 'rejected'] as FilterTab[]).map(tab => {
                const count = tab === 'all'
                  ? allCurrentApps.length
                  : allCurrentApps.filter(a => a.status === tab).length;
                return (
                  <button
                    key={tab}
                    type="button"
                    className={`ad-tab ad-tab--${tab}${activeTab === tab ? ' ad-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                    aria-pressed={activeTab === tab}
                  >
                    <span className="ad-tab-label">{TAB_LABELS[tab]}</span>
                    <span className="ad-tab-count">{count}</span>
                    <span className="ad-tab-icon" aria-hidden="true">{TAB_ICONS[tab]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Toolbar — refresh / search / filter / sort */}
          {isAppSection && (
            <div className="ad-toolbar">
              <button
                type="button"
                className="ad-toolbar-refresh"
                onClick={refreshCurrent}
                disabled={loading}
                title="تحديث"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                تحديث
              </button>

              <div className="ad-toolbar-search">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="بحث بالاسم، المتجر، الهاتف..."
                />
                {searchQuery && (
                  <button type="button" className="ad-toolbar-search-clear" onClick={() => setSearchQuery('')} aria-label="مسح البحث">×</button>
                )}
              </div>

              <div className="ad-toolbar-spacer" />

              {typeFilterOptions.length > 0 && (
                <div className="ad-toolbar-select">
                  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                    <option value="all">كل الأنواع</option>
                    {typeFilterOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="ad-toolbar-select">
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="13" y2="6" /><line x1="3" y1="12" x2="11" y2="12" /><line x1="3" y1="18" x2="9" y2="18" />
                  <polyline points="17 8 17 18" /><polyline points="20 15 17 18 14 15" />
                </svg>
                <select value={sortOrder} onChange={e => setSortOrder(e.target.value as 'newest' | 'oldest')}>
                  <option value="newest">ترتيب: الأحدث</option>
                  <option value="oldest">ترتيب: الأقدم</option>
                </select>
              </div>

              <button
                type="button"
                className="ad-toolbar-refresh"
                onClick={() => setShowArchived(v => !v)}
                title="عرض العناصر المحذوفة"
                style={showArchived ? { background: '#475569', color: '#fff', borderColor: '#475569' } : undefined}
              >
                🗑️ سلة المحذوفات{archivedCount > 0 ? ` (${archivedCount})` : ''}
              </button>
            </div>
          )}

          {activeSection !== 'batches' && activeSection !== 'logistics' && activeSection !== 'couriers' && activeSection !== 'shops' && activeSection !== 'categories' && activeSection !== 'messages' && activeSection !== 'payments' && activeSection !== 'ledger' && activeSection !== 'analytics' && activeSection !== 'deliveryIssues' && activeSection !== 'settlements' && (loading ? (
            <div className="ad-state" role="status" aria-live="polite">
              <span className="ad-state-spin" aria-hidden="true" />
              <div className="ad-state-title">جاري تحميل الطلبات…</div>
              <div className="ad-state-sub">يرجى الانتظار قليلاً بينما نجلب أحدث الطلبات.</div>
            </div>
          ) : currentApps.length === 0 ? (
            <div className="ad-state">
              <div className="ad-state-icon">{AppIcons.inbox}</div>
              <div className="ad-state-title">
                {activeTab === 'all'      ? 'لا توجد طلبات' :
                 activeTab === 'pending'  ? 'لا توجد طلبات قيد المراجعة' :
                 activeTab === 'approved' ? 'لا توجد طلبات موافق عليها بعد' :
                                            'لا توجد طلبات مرفوضة'}
              </div>
              <div className="ad-state-sub">
                ستظهر الطلبات الجديدة هنا فور وصولها — يمكنك مراجعتها والرد عليها مباشرة.
              </div>
            </div>
          ) : (
        <div className="ad-table">
          {/* ── Table header (merchant / delivery) ── */}
          {(activeSection === 'merchant' || activeSection === 'delivery') && (
            <div className="ad-table-head" aria-hidden="true">
              {APP_TABLE_COLUMNS[activeSection].map((col, i) => (
                <div key={i} className="ad-row-cell ad-table-head-cell">{col}</div>
              ))}
            </div>
          )}

          {/* ── Merchant cards ── */}
          {activeSection === 'merchant' && (filteredMerchants as MerchantApp[]).map(app => {
            const documents: MediaSpec[] = [];
            if (app.pictures) {
              app.pictures.forEach((url, i) => {
                documents.push({ url, label: `صورة المتجر ${i + 1}`, variant: 'picture' });
              });
            }
            if (app.id_front_url) documents.push({ path: app.id_front_url, bucket: 'merchant-id-docs', label: 'الهوية — الواجهة' });
            if (app.id_back_url)  documents.push({ path: app.id_back_url,  bucket: 'merchant-id-docs', label: 'الهوية — الخلفية' });

            const contactItems: InfoSpec[] = [
              { icon: AppIcons.mail,  label: 'البريد الإلكتروني', value: app.email,        href: `mailto:${app.email}` },
              { icon: AppIcons.phone, label: 'رقم الهاتف',       value: app.phone_number, href: `tel:${app.phone_number}` },
              { icon: AppIcons.pin,   label: 'المدينة',          value: app.city },
            ];

            const detailItems: InfoSpec[] = [];
            if (app.Type_of_store) {
              detailItems.push({
                icon: AppIcons.store,
                label: 'نوع المتجر',
                value: STORE_TYPES[app.Type_of_store] ?? app.Type_of_store,
              });
            }
            detailItems.push({
              icon: AppIcons.user,
              label: 'صاحب المتجر',
              value: app.name_of_owner,
            });

            return (
              <ApplicationCard
                key={app.id}
                applicantName={app.name_of_store}
                ownerName={app.name_of_owner}
                typeChip={app.Type_of_store ? (STORE_TYPES[app.Type_of_store] ?? app.Type_of_store) : undefined}
                appKind="merchant"
                status={app.status}
                location={app.city}
                phone={app.phone_number}
                email={app.email}
                contactItems={contactItems}
                detailItems={detailItems}
                description={app.description}
                documents={documents}
                createdAt={app.created_at}
                loading={actionLoading === app.id}
                onApprove={() => openApproveModal(app)}
                onReject={() => openRejectModal(app)}
                onWithdraw={() => updateMerchantStatus(app.id, 'rejected')}
                onArchive={() => archiveMerchantApp(app)}
                onRestore={() => restoreMerchantApp(app)}
                isArchived={app.is_archived}
                onLightbox={(url) => setLightbox(url)}
              />
            );
          })}


          {/* ── Delivery cards ── */}
          {activeSection === 'delivery' && (filteredDelivery as DeliveryApp[]).map(app => {
            const documents: MediaSpec[] = [];
            if (app.id_front_url)      documents.push({ path: app.id_front_url,      bucket: 'delivery-applications', label: 'الهوية الوطنية — الواجهة' });
            if (app.id_back_url)       documents.push({ path: app.id_back_url,       bucket: 'delivery-applications', label: 'الهوية الوطنية — الخلفية' });
            if (app.license_front_url) documents.push({ path: app.license_front_url, bucket: 'delivery-applications', label: 'رخصة القيادة — الواجهة' });
            if (app.license_back_url)  documents.push({ path: app.license_back_url,  bucket: 'delivery-applications', label: 'رخصة القيادة — الخلفية' });

            const contactItems: InfoSpec[] = [
              { icon: AppIcons.mail,  label: 'البريد الإلكتروني', value: app.email,        href: `mailto:${app.email}` },
              { icon: AppIcons.phone, label: 'رقم الهاتف',       value: app.phone_number, href: `tel:${app.phone_number}` },
            ];

            const detailItems: InfoSpec[] = [];
            if (app.type_of_vehicle) {
              detailItems.push({
                icon: AppIcons.car,
                label: 'نوع المركبة',
                value: VEHICLE_TYPES[app.type_of_vehicle] ?? app.type_of_vehicle,
              });
            }
            if (app.ID_number) {
              detailItems.push({
                icon: AppIcons.idCard,
                label: 'رقم الهوية الوطنية',
                value: app.ID_number,
              });
            }

            return (
              <ApplicationCard
                key={app.id}
                applicantName={app.name}
                ownerName="مندوب توصيل"
                typeChip={app.type_of_vehicle ? (VEHICLE_TYPES[app.type_of_vehicle] ?? app.type_of_vehicle) : undefined}
                appKind="delivery"
                status={app.status}
                phone={app.phone_number}
                email={app.email}
                contactItems={contactItems}
                detailItems={detailItems}
                documents={documents}
                createdAt={app.created_at}
                loading={deliveryActionLoading === app.id}
                onApprove={() => openDeliveryApproveModal(app)}
                onReject={() => openDeliveryRejectModal(app)}
                onWithdraw={() => updateDeliveryStatus(app.id, 'rejected')}
                onArchive={() => archiveDeliveryApp(app)}
                onRestore={() => restoreDeliveryApp(app)}
                isArchived={app.is_archived}
                onLightbox={(url) => setLightbox(url)}
              />
            );
          })}
        </div>
          ))}

          {/* ── Couriers section ── */}
          {activeSection === 'couriers' && (
            <CouriersPage />
          )}

          {/* ── Delivery issues section ── */}
          {activeSection === 'deliveryIssues' && (
            <DeliveryIssuesPage />
          )}

          {/* ── Shops section ── */}
          {activeSection === 'shops' && (
            <ShopsPage />
          )}

          {/* ── Category images section ── */}
          {activeSection === 'categories' && (
            <CategoryImagesPage />
          )}

          {/* ── Logistics settings section ── */}
          {activeSection === 'logistics' && (
            <LogisticsSettingsPage embedded />
          )}

          {/* ── Payment settings section ── */}
          {activeSection === 'payments' && (
            <PaymentSettingsPage embedded />
          )}

          {/* ── Sales ledger section ── */}
          {activeSection === 'ledger' && (
            <SalesLedgerPage embedded />
          )}

          {/* ── Financial analytics section ── */}
          {activeSection === 'analytics' && (
            <FinancialAnalyticsPage embedded />
          )}

          {/* ── Sent messages section ── */}
          {activeSection === 'messages' && (
            <AdminSentMessages />
          )}

          {/* ── Batches section ── */}
          {activeSection === 'batches' && (
            <BatchMonitorPage />
          )}

          {/* ── Batches section (legacy inline — kept for reference) ── */}
          {false && (
            <div className="ad-batches-layout">

              {/* Left: batch list */}
              <div className="ad-batches-main">

                {/* Header row */}
                <div className="ad-batches-header">
                  <h2 className="ad-batches-title">تجميعات الاستلام — الميل الأول</h2>
                  <div className="ad-batches-header-actions">
                    <button className="ad-batches-refresh" onClick={loadBatches} disabled={batchesLoading}>↻ تحديث</button>
                    <button className="ad-assign-btn" onClick={runAssignment} disabled={assigning || batches.length === 0}>
                      {assigning ? '⏳ جاري التعيين...' : '🚗 تعيين السائقين'}
                    </button>
                  </div>
                </div>

                {/* Assignment result summary */}
                {assignError   && <div className="ad-error">{assignError}</div>}
                {assignSummary && (
                  <div className="ad-assign-summary">
                    <span className="ad-assign-summary-item ad-assign-summary-item--ok">✔ {assignSummary.assigned} دفعة تم تعيينها</span>
                    {assignSummary.unassigned > 0 && (
                      <span className="ad-assign-summary-item ad-assign-summary-item--warn">⚠ {assignSummary.unassigned} في قائمة الانتظار</span>
                    )}
                    {assignSummary.assigned === 0 && assignSummary.unassigned > 0 && (
                      <span className="ad-assign-summary-item ad-assign-summary-item--warn">
                        لم يتم العثور على سائقين متاحين بموقع جغرافي — تأكد من أن السائقين قد فتحوا تطبيقهم
                      </span>
                    )}
                  </div>
                )}

                {/* Filter tabs */}
                {batches.length > 0 && (
                  <div className="ad-batch-filters">
                    {(['all', 'assigned', 'unassigned'] as const).map(f => {
                      const count = f === 'all' ? batches.length
                        : f === 'assigned'   ? batches.filter(b => b.assigned_driver).length
                        : batches.filter(b => !b.assigned_driver).length;
                      return (
                        <button
                          key={f}
                          className={`ad-batch-filter-btn${batchFilter === f ? ' ad-batch-filter-btn--active' : ''}`}
                          onClick={() => setBatchFilter(f)}
                        >
                          {f === 'all' ? 'الكل' : f === 'assigned' ? '✔ مُعيَّنة' : '⏳ قائمة الانتظار'}
                          <span className="ad-batch-filter-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {batchesLoading && <div className="ad-loading">جاري حساب التجميعات...</div>}
                {batchesError  && <div className="ad-error">{batchesError}</div>}
                {!batchesLoading && !batchesError && batches.length === 0 && (
                  <div className="ad-empty">لا توجد طلبات معلقة للتجميع حالياً</div>
                )}

                {!batchesLoading && batches
                  .filter(b =>
                    batchFilter === 'all'        ? true :
                    batchFilter === 'assigned'   ? !!b.assigned_driver :
                    !b.assigned_driver
                  )
                  .map((batch, idx) => {
                    // use original index for expand key
                    const origIdx = batches.indexOf(batch);
                    const batchOpen = expandedBatches.has(origIdx);
                    const isAssigned = !!batch.assigned_driver;
                    const isQueued   = !batch.assigned_driver;
                    return (
                    <div key={origIdx} className={`ad-batch-card${isAssigned ? ' ad-batch-card--assigned' : isQueued ? ' ad-batch-card--queued' : ''}`}>

                      {/* Header */}
                      <div className="ad-batch-header ad-batch-header--clickable" onClick={() => toggleBatch(origIdx)}>
                        <div className="ad-batch-title">
                          <span className="ad-batch-num">دفعة {origIdx + 1}</span>
                          <span className="ad-batch-chip">{batch.stops} {batch.stops === 1 ? 'متجر' : 'متاجر'}</span>
                          <span className="ad-batch-chip ad-batch-chip--vol">حجم {batch.total_volume} وحدة</span>
                          {isAssigned && (
                            <span className="ad-batch-chip ad-batch-chip--driver">🚗 {batch.assigned_driver!.name}</span>
                          )}
                          {isQueued && (
                            <span className="ad-batch-chip ad-batch-chip--queued">⏳ انتظار</span>
                          )}
                          <span className="ad-batch-chevron">{batchOpen ? '▲' : '▼'}</span>
                        </div>
                        <div className="ad-batch-orders-summary">
                          {batch.stops} محطة استلام — انقر لعرض التفاصيل
                        </div>
                      </div>

                      {/* Shop list */}
                      {batchOpen && (
                        <div className="ad-batch-shops">
                          {batch.shops.map((shop, si) => {
                            const shopKey = `${origIdx}-${shop.shop_id}`;
                            const shopOpen = expandedShops.has(shopKey);
                            return (
                              <div key={shop.shop_id} className="ad-batch-shop-block">
                                <div className="ad-batch-shop-row ad-batch-shop-row--clickable" onClick={() => toggleShop(shopKey)}>
                                  <span className="ad-batch-stop-num">{si + 1}</span>
                                  <div className="ad-batch-shop-info">
                                    <span className="ad-batch-shop-id">{shop.shop_name}</span>
                                    <span className="ad-batch-shop-meta">
                                      {shop.order_ids.length} {shop.order_ids.length === 1 ? 'طلب' : 'طلبات'} · حجم {shop.total_volume} وحدة · جاهز{' '}
                                      {new Date(shop.ready_time).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <div className="ad-batch-shop-actions">
                                    <a href={`https://www.google.com/maps?q=${shop.lat},${shop.lng}`} target="_blank" rel="noreferrer" className="ad-batch-map-link" onClick={e => e.stopPropagation()}>
                                      📍 خريطة
                                    </a>
                                    <span className="ad-batch-chevron">{shopOpen ? '▲' : '▼'}</span>
                                  </div>
                                </div>
                                {shopOpen && (
                                  <div className="ad-batch-shop-detail">
                                    <span className="ad-batch-detail-label">المنتجات المطلوب استلامها:</span>
                                    <div className="ad-batch-item-list">
                                      {shop.items.map((item, i) => (
                                        <div key={i} className="ad-batch-item-row">
                                          <span className="ad-batch-item-qty">×{item.qty}</span>
                                          <span className="ad-batch-item-name">{item.product_title}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="ad-batch-detail-pills" style={{ marginTop: '0.5rem' }}>
                                      {shop.order_ids.map(id => (
                                        <span key={id} className="ad-batch-order-pill">ORD-{String(id).padStart(3, '0')}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    );
                  })}
              </div>

              {/* Right: config panel */}
              <div className="ad-config-panel">
                <h3 className="ad-config-panel-title">⚙️ إعدادات التجميع</h3>

                {configError   && <div className="ad-error" style={{ fontSize: '0.82rem' }}>{configError}</div>}
                {configSuccess && <div className="ad-config-success">✔ تم الحفظ</div>}

                {configLoading
                  ? <div style={{ color: '#888', fontSize: '0.85rem', padding: '1rem 0' }}>جاري التحميل...</div>
                  : (
                    <div className="ad-config-fields" onClick={() => setActiveTooltip(null)}>

                      {/* Capacity */}
                      <div className="ad-config-field">
                        <div className="ad-config-label-row">
                          <span className="ad-config-label-text">الطاقة الاستيعابية</span>
                          <button className="ad-config-info-btn" onClick={e => { e.stopPropagation(); setActiveTooltip(t => t === 'capacity' ? null : 'capacity'); }}>!</button>
                          {activeTooltip === 'capacity' && (
                            <div className="ad-config-tooltip">الحد الأقصى لمجموع وحدات الحجم التي يستطيع سائق واحد حملها في رحلة استلام واحدة</div>
                          )}
                        </div>
                        <div className="ad-config-input-row">
                          <input type="number" min={1} max={200} className="ad-config-input"
                            title="الطاقة الاستيعابية"
                            placeholder="أدخل الحد الأقصى للوحدات"
                            value={draftConfig.max_driver_capacity}
                            onChange={e => { setConfigSuccess(false); setDraftConfig(p => ({ ...p, max_driver_capacity: e.target.value })); }}
                          />
                          <span className="ad-config-unit">وحدة</span>
                        </div>
                      </div>

                      {/* Stops */}
                      <div className="ad-config-field">
                        <div className="ad-config-label-row">
                          <span className="ad-config-label-text">الحد الأقصى للمحطات</span>
                          <button className="ad-config-info-btn" onClick={e => { e.stopPropagation(); setActiveTooltip(t => t === 'stops' ? null : 'stops'); }}>!</button>
                          {activeTooltip === 'stops' && (
                            <div className="ad-config-tooltip">أقصى عدد من المتاجر يمكن للسائق زيارتها في دفعة استلام واحدة</div>
                          )}
                        </div>
                        <div className="ad-config-input-row">
                          <input type="number" min={1} max={20} className="ad-config-input"
                            title="الحد الأقصى للمحطات"
                            placeholder="أدخل الحد الأقصى للمحطات"
                            value={draftConfig.max_stops_per_batch}
                            onChange={e => { setConfigSuccess(false); setDraftConfig(p => ({ ...p, max_stops_per_batch: e.target.value })); }}
                          />
                          <span className="ad-config-unit">متجر</span>
                        </div>
                      </div>

                      {/* Wait */}
                      <div className="ad-config-field">
                        <div className="ad-config-label-row">
                          <span className="ad-config-label-text">وقت الانتظار</span>
                          <button className="ad-config-info-btn" onClick={e => { e.stopPropagation(); setActiveTooltip(t => t === 'wait' ? null : 'wait'); }}>!</button>
                          {activeTooltip === 'wait' && (
                            <div className="ad-config-tooltip">الوقت الأقصى (بالدقائق) الذي يُسمح فيه للطرد بالانتظار قبل الاستلام — يُستخدم للتنبيهات فقط ولا يوقف التجميع</div>
                          )}
                        </div>
                        <div className="ad-config-input-row">
                          <input type="number" min={10} max={480} className="ad-config-input"
                            title="الحد الأقصى لوقت الانتظار"
                            placeholder="أدخل الحد الأقصى لوقت الانتظار"
                            value={draftConfig.max_allowed_wait}
                            onChange={e => { setConfigSuccess(false); setDraftConfig(p => ({ ...p, max_allowed_wait: e.target.value })); }}
                          />
                          <span className="ad-config-unit">دقيقة</span>
                        </div>
                      </div>

                      {/* Distance */}
                      <div className="ad-config-field">
                        <div className="ad-config-label-row">
                          <span className="ad-config-label-text">الحد الأقصى للمسافة</span>
                          <button className="ad-config-info-btn" onClick={e => { e.stopPropagation(); setActiveTooltip(t => t === 'dist' ? null : 'dist'); }}>!</button>
                          {activeTooltip === 'dist' && (
                            <div className="ad-config-tooltip">أبعد مسافة (بالكيلومتر) مسموح بها بين أي متجرين داخل نفس الدفعة — تُحسب بخط مستقيم</div>
                          )}
                        </div>
                        <div className="ad-config-input-row">
                          <input type="number" min={0.5} max={50} step={0.5} className="ad-config-input"
                            title="الحد الأقصى للمسافة"
                            placeholder="أدخل الحد الأقصى للمسافة"
                            value={draftConfig.max_distance_km}
                            onChange={e => { setConfigSuccess(false); setDraftConfig(p => ({ ...p, max_distance_km: e.target.value })); }}
                          />
                          <span className="ad-config-unit">كم</span>
                        </div>
                      </div>

                      {/* Max wait days */}
                      <div className="ad-config-field">
                        <div className="ad-config-label-row">
                          <span className="ad-config-label-text">أقصى أيام انتظار الشحنة</span>
                          <button className="ad-config-info-btn" onClick={e => { e.stopPropagation(); setActiveTooltip(t => t === 'wait_days' ? null : 'wait_days'); }}>!</button>
                          {activeTooltip === 'wait_days' && (
                            <div className="ad-config-tooltip">الحد الأقصى لعدد الأيام التي يُسمح فيها للشحنة بالانتظار قبل الاستلام — يُحسب الموعد النهائي تلقائياً عند إنشاء الشحنة</div>
                          )}
                        </div>
                        <div className="ad-config-input-row">
                          <input type="number" min={1} max={30} className="ad-config-input"
                            title="أقصى أيام انتظار الشحنة"
                            placeholder="أدخل عدد الأيام"
                            value={draftConfig.max_wait_days}
                            onChange={e => { setConfigSuccess(false); setDraftConfig(p => ({ ...p, max_wait_days: e.target.value })); }}
                          />
                          <span className="ad-config-unit">يوم</span>
                        </div>
                      </div>

                      <button
                        className={`ad-config-save-btn${configChanged ? '' : ' ad-config-save-btn--inactive'}`}
                        onClick={configChanged ? saveConfig : undefined}
                        disabled={configSaving}
                        style={{ cursor: configChanged ? 'pointer' : 'default' }}
                      >
                        {configSaving ? 'جاري الحفظ...' : '💾 حفظ'}
                      </button>
                    </div>
                  )
                }
              </div>

            </div>
          )}

        </main>
      </div>{/* end ad-body */}

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
              <div className="ad-modal-input-row">
                <input
                  type="email"
                  className="ad-modal-input"
                  placeholder="merchant@souqlink.com"
                  value={approveModal.platformEmail}
                  onChange={e => setApproveModal(prev => ({ ...prev, platformEmail: e.target.value }))}
                  disabled={approveModal.sending || !!approveModal.generatingEmail}
                />
                <button
                  type="button"
                  className="ad-btn ad-btn--generate"
                  onClick={generateMerchantEmail}
                  disabled={approveModal.sending || !!approveModal.generatingEmail}
                >
                  {approveModal.generatingEmail ? '...' : 'توليد'}
                </button>
              </div>
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
        <div className="ad-modal-overlay" onClick={() => !rejectModal.sending && setRejectModal({ app: null, reason: '', message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">📧 إرسال إشعار رفض</h3>
            <p className="ad-modal-to">إلى: <strong>{rejectModal.app.email}</strong></p>
            <div className="ad-modal-field">
              <label className="ad-modal-label">سبب الرفض <span className="ad-required">*</span></label>
              <textarea
                className="ad-modal-textarea"
                rows={3}
                disabled={rejectModal.sending}
                placeholder="مثال: المستندات المرفقة غير مكتملة..."
                onChange={e => {
                  const reason = e.target.value;
                  const app = rejectModal.app!;
                  setRejectModal(prev => ({
                    ...prev,
                    reason,
                    message: `عزيزي/عزيزتي ${app.name_of_owner}،\n\nنشكركم على اهتمامكم بالانضمام إلى منصة سوق لينك.\n\nبعد مراجعة طلبكم بعناية، نأسف لإبلاغكم بأننا غير قادرين على قبول طلبكم للسبب التالي:\n${reason}\n\nنتمنى لكم التوفيق والنجاح في مساعيكم.\n\nمع تحياتنا،\nفريق سوق لينك`,
                  }));
                }}
              />
            </div>
            {rejectModal.message && (
              <div className="ad-modal-field">
                <label className="ad-modal-label">معاينة الرسالة</label>
                <pre className="ad-modal-preview">{rejectModal.message}</pre>
              </div>
            )}
            {rejectModal.error && <p className="ad-modal-error">{rejectModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--reject" onClick={handleSendRejection} disabled={rejectModal.sending || !rejectModal.reason.trim()}>
                {rejectModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل الرفض'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setRejectModal({ app: null, reason: '', message: '', sending: false, error: '' })} disabled={rejectModal.sending}>
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
              <div className="ad-modal-input-row">
                <input
                  type="email"
                  className="ad-modal-input"
                  placeholder="delivery@souqlink.com"
                  value={deliveryApproveModal.platformEmail}
                  onChange={e => setDeliveryApproveModal(prev => ({ ...prev, platformEmail: e.target.value }))}
                  disabled={deliveryApproveModal.sending || !!deliveryApproveModal.generatingEmail}
                />
                <button
                  type="button"
                  className="ad-btn ad-btn--generate"
                  onClick={generateDeliveryEmail}
                  disabled={deliveryApproveModal.sending || !!deliveryApproveModal.generatingEmail}
                >
                  {deliveryApproveModal.generatingEmail ? '...' : 'توليد'}
                </button>
              </div>
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
        <div className="ad-modal-overlay" onClick={() => !deliveryRejectModal.sending && setDeliveryRejectModal({ app: null, reason: '', message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">📧 إرسال إشعار رفض — مندوب توصيل</h3>
            <p className="ad-modal-to">إلى: <strong>{deliveryRejectModal.app.email}</strong></p>
            <div className="ad-modal-field">
              <label className="ad-modal-label">سبب الرفض <span className="ad-required">*</span></label>
              <textarea
                className="ad-modal-textarea"
                rows={3}
                disabled={deliveryRejectModal.sending}
                placeholder="مثال: المستندات المرفقة غير مكتملة..."
                onChange={e => {
                  const reason = e.target.value;
                  const app = deliveryRejectModal.app!;
                  setDeliveryRejectModal(prev => ({
                    ...prev,
                    reason,
                    message: `عزيزي/عزيزتي ${app.name}،\n\nنشكركم على اهتمامكم بالانضمام إلى منصة سوق لينك كمندوب توصيل.\n\nبعد مراجعة طلبكم بعناية، نأسف لإبلاغكم بأننا غير قادرين على قبول طلبكم للسبب التالي:\n${reason}\n\nنتمنى لكم التوفيق والنجاح في مساعيكم.\n\nمع تحياتنا،\nفريق سوق لينك`,
                  }));
                }}
              />
            </div>
            {deliveryRejectModal.message && (
              <div className="ad-modal-field">
                <label className="ad-modal-label">معاينة الرسالة</label>
                <pre className="ad-modal-preview">{deliveryRejectModal.message}</pre>
              </div>
            )}
            {deliveryRejectModal.error && <p className="ad-modal-error">{deliveryRejectModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--reject" onClick={handleSendDeliveryRejection} disabled={deliveryRejectModal.sending || !deliveryRejectModal.reason.trim()}>
                {deliveryRejectModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل الرفض'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setDeliveryRejectModal({ app: null, reason: '', message: '', sending: false, error: '' })} disabled={deliveryRejectModal.sending}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
