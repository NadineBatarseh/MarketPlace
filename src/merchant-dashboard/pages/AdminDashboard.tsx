import { useState, useEffect, useRef } from 'react';
import LogisticsSettingsPage from '../../pages/admin/logistics/LogisticsSettingsPage';
import BatchMonitorPage from '../../pages/admin/BatchMonitorPage';
import CouriersPage from '../../pages/admin/CouriersPage';
import ShopsPage from '../../pages/admin/ShopsPage';
import AdminSentMessages from '../../pages/admin/AdminSentMessages';
import emailjs from '@emailjs/browser';
import supabase from '../../lib/supabase';
import ChangePasswordModal from '../../components/ChangePasswordModal';
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
type Section = 'merchant' | 'delivery' | 'hubworker' | 'batches' | 'logistics' | 'couriers' | 'shops' | 'messages';

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
  const contentRef = useRef<HTMLElement>(null);
  const avatarRef  = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('pending');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);

  const today = new Date().toLocaleDateString('ar-EG', {
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

  // Hub worker state
  const [hubApps, setHubApps] = useState<HubWorkerApp[]>([]);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState('');
  const [hubActionLoading, setHubActionLoading] = useState<string | null>(null);

  const [hubApproveModal, setHubApproveModal] = useState<ApproveModalState<HubWorkerApp>>(
    { app: null, platformEmail: '', message: '', sending: false, error: '' }
  );
  const [hubRejectModal, setHubRejectModal] = useState<RejectModalState<HubWorkerApp>>(
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
  useEffect(() => { loadHubApps(); }, []);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [activeSection]);

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

    const hubSub = supabase
      .channel('admin-hub-apps')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hubworker_applications' }, payload => {
        setHubApps(prev => [payload.new as HubWorkerApp, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(merchantSub);
      supabase.removeChannel(deliverySub);
      supabase.removeChannel(hubSub);
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
    table: 'merchant_applications' | 'delivery_applications' | 'hubworker_applications'
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

  const generateHubEmail = async () => {
    if (!hubApproveModal.app) return;
    setHubApproveModal(prev => ({ ...prev, generatingEmail: true }));
    const email = await generateUniqueEmail(hubApproveModal.app.name, 'hubworker_applications');
    setHubApproveModal(prev => ({ ...prev, platformEmail: email, generatingEmail: false }));
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

    const finalMessage = (hubApproveModal.message + `\n\nبريدك الإلكتروني الرسمي: ${hubApproveModal.platformEmail}`);
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
    setHubRejectModal({ app, reason: '', message: '', sending: false, error: '' });
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
    setHubRejectModal({ app: null, reason: '', message: '', sending: false, error: '' });
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

  const loading = activeSection === 'merchant' ? appsLoading : activeSection === 'delivery' ? deliveryLoading : activeSection === 'hubworker' ? hubLoading : false;
  const loadError = activeSection === 'merchant' ? appsError : activeSection === 'delivery' ? deliveryError : activeSection === 'hubworker' ? hubError : '';
  const currentApps = activeSection === 'merchant' ? filteredMerchants : activeSection === 'delivery' ? filteredDelivery : filteredHub;
  const allCurrentApps = activeSection === 'merchant' ? apps : activeSection === 'delivery' ? deliveryApps : hubApps;

  return (
    <div className="ad-root">

      {/* ── Topbar (mirrors MerchantDashboard) ── */}
      <header className="ad-topbar">
        <div className="ad-topbar-brand">
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
                  onClick={async () => { setShowAvatarMenu(false); await supabase.auth.signOut(); window.location.href = '/login'; }}
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

        {/* Sidebar (mirrors MerchantDashboard) */}
        <aside className="ad-sidebar">

          {/* Greeting */}
          <div className="ad-sidebar-greeting">
            <div className="ad-sidebar-greeting-name">لوحة تحكم <strong>الإدارة</strong></div>
            <div className="ad-sidebar-greeting-date">{today}</div>
          </div>

          {/* Navigation */}
          <nav className="ad-sidebar-nav">
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

            <SidebarItem
              icon={
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              }
              label="عمال المستودع"
              active={activeSection === 'hubworker'}
              badge={hubApps.filter(a => a.status === 'pending').length}
              onClick={() => setActiveSection('hubworker')}
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
              onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }}
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
          {loadError && <div className="ad-error">{loadError}</div>}

          {/* Filter tabs — only for application sections */}
          {activeSection !== 'batches' && activeSection !== 'logistics' && activeSection !== 'couriers' && activeSection !== 'shops' && activeSection !== 'messages' && (
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
          )}

          {activeSection !== 'batches' && activeSection !== 'logistics' && activeSection !== 'couriers' && activeSection !== 'shops' && activeSection !== 'messages' && (loading ? (
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
                {(app.id_front_url || app.id_back_url) && (
                  <div className="ad-doc-row">
                    {([
                      { path: app.id_front_url, label: '💳 هوية (أمامي)' },
                      { path: app.id_back_url,  label: '💳 هوية (خلفي)' },
                    ] as const).filter(d => d.path).map(({ path, label }) => (
                      <button
                        key={label}
                        type="button"
                        className="ad-doc-link"
                        onClick={async () => {
                          const { data, error } = await supabase.storage
                            .from('merchant-id-docs')
                            .createSignedUrl(path!, 3600);
                          if (error || !data?.signedUrl) { alert('تعذّر فتح المستند'); return; }
                          window.open(data.signedUrl, '_blank');
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
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
                {(app.id_front_url || app.id_back_url || app.license_front_url || app.license_back_url) && (
                  <div className="ad-doc-row">
                    {([
                      { path: app.id_front_url,      label: '💳 هوية (أمامي)' },
                      { path: app.id_back_url,       label: '💳 هوية (خلفي)' },
                      { path: app.license_front_url, label: '🚗 رخصة (أمامي)' },
                      { path: app.license_back_url,  label: '🚗 رخصة (خلفي)' },
                    ] as const).filter(d => d.path).map(({ path, label }) => (
                      <button
                        key={label}
                        type="button"
                        className="ad-doc-link"
                        onClick={async () => {
                          const { data, error } = await supabase.storage
                            .from('delivery-applications')
                            .createSignedUrl(path!, 3600);
                          if (error || !data?.signedUrl) { alert('تعذّر فتح المستند'); return; }
                          window.open(data.signedUrl, '_blank');
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
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
          ))}

          {/* ── Couriers section ── */}
          {activeSection === 'couriers' && (
            <CouriersPage />
          )}

          {/* ── Shops section ── */}
          {activeSection === 'shops' && (
            <ShopsPage />
          )}

          {/* ── Logistics settings section ── */}
          {activeSection === 'logistics' && (
            <LogisticsSettingsPage embedded />
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
                                      {new Date(shop.ready_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
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
      {/* ── Hub worker approve modal ── */}
      {hubApproveModal.app && (
        <div className="ad-modal-overlay" onClick={() => !hubApproveModal.sending && setHubApproveModal({ app: null, platformEmail: '', message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">✅ إرسال إشعار القبول — عامل مستودع</h3>
            <p className="ad-modal-to">إلى: <strong>{hubApproveModal.app.email}</strong></p>
            <div className="ad-modal-field">
              <label className="ad-modal-label">البريد الإلكتروني الرسمي للعامل *</label>
              <div className="ad-modal-input-row">
                <input
                  type="email"
                  className="ad-modal-input"
                  placeholder="hub@souqlink.com"
                  value={hubApproveModal.platformEmail}
                  onChange={e => setHubApproveModal(prev => ({ ...prev, platformEmail: e.target.value }))}
                  disabled={hubApproveModal.sending || !!hubApproveModal.generatingEmail}
                />
                <button
                  type="button"
                  className="ad-btn ad-btn--generate"
                  onClick={generateHubEmail}
                  disabled={hubApproveModal.sending || !!hubApproveModal.generatingEmail}
                >
                  {hubApproveModal.generatingEmail ? '...' : 'توليد'}
                </button>
              </div>
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
        <div className="ad-modal-overlay" onClick={() => !hubRejectModal.sending && setHubRejectModal({ app: null, reason: '', message: '', sending: false, error: '' })}>
          <div className="ad-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="ad-modal-title">📧 إرسال إشعار رفض — عامل مستودع</h3>
            <p className="ad-modal-to">إلى: <strong>{hubRejectModal.app.email}</strong></p>
            <div className="ad-modal-field">
              <label className="ad-modal-label">سبب الرفض <span className="ad-required">*</span></label>
              <textarea
                className="ad-modal-textarea"
                rows={3}
                disabled={hubRejectModal.sending}
                placeholder="مثال: المستندات المرفقة غير مكتملة..."
                onChange={e => {
                  const reason = e.target.value;
                  const app = hubRejectModal.app!;
                  setHubRejectModal(prev => ({
                    ...prev,
                    reason,
                    message: `عزيزي/عزيزتي ${app.name}،\n\nنشكركم على اهتمامكم بالانضمام إلى منصة سوق لينك كعامل مستودع.\n\nبعد مراجعة طلبكم بعناية، نأسف لإبلاغكم بأننا غير قادرين على قبول طلبكم للسبب التالي:\n${reason}\n\nنتمنى لكم التوفيق والنجاح في مساعيكم.\n\nمع تحياتنا،\nفريق سوق لينك`,
                  }));
                }}
              />
            </div>
            {hubRejectModal.message && (
              <div className="ad-modal-field">
                <label className="ad-modal-label">معاينة الرسالة</label>
                <pre className="ad-modal-preview">{hubRejectModal.message}</pre>
              </div>
            )}
            {hubRejectModal.error && <p className="ad-modal-error">{hubRejectModal.error}</p>}
            <div className="ad-modal-actions">
              <button type="button" className="ad-btn ad-btn--reject" onClick={handleSendHubRejection} disabled={hubRejectModal.sending || !hubRejectModal.reason.trim()}>
                {hubRejectModal.sending ? 'جارٍ الإرسال...' : 'إرسال وتسجيل الرفض'}
              </button>
              <button type="button" className="ad-btn ad-btn--delete" onClick={() => setHubRejectModal({ app: null, reason: '', message: '', sending: false, error: '' })} disabled={hubRejectModal.sending}>
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
