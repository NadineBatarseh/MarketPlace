import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  SETTINGS_DEFINITIONS,
  CATEGORIES,
  WEIGHT_GROUPS,
  getDefaultValues,
  isWeightGroupValid,
  SettingsValues,
} from './settingsData';
import SettingsSection from './components/SettingsSection';
import { supabase } from '../../../lib/supabase';

const FONTS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: #F1F5F9; }
  ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
  input[type=number]::-webkit-inner-spin-button { opacity: 0.5; }
  input[type=number]::-webkit-outer-spin-button { opacity: 0.5; }
`;

function validate(values: SettingsValues): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const def of SETTINGS_DEFINITIONS) {
    if (def.type === 'boolean' || def.type === 'select') continue;
    const v = Number(values[def.key]);
    if (isNaN(v)) { errs[def.key] = 'يجب أن يكون رقماً'; continue; }
    if (def.min !== undefined && v < def.min) errs[def.key] = `الحد الأدنى ${def.min}`;
    else if (def.max !== undefined && v > def.max) errs[def.key] = `الحد الأقصى ${def.max}`;
  }
  for (const [gKey] of Object.entries(WEIGHT_GROUPS)) {
    if (!isWeightGroupValid(gKey, values)) {
      const keys = WEIGHT_GROUPS[gKey].keys;
      keys.forEach(k => { if (!errs[k]) errs[k] = 'يجب أن تساوي الأوزان 1'; });
    }
  }
  return errs;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface LogisticsSettingsPageProps {
  embedded?: boolean;
}

// Maps settings keys to their DB column names where they differ
const COL_OVERRIDE: Record<string, string> = {
  MAX_VOLUME:                         'max_driver_capacity',
  MAX_STOPS:                          'max_stops_per_batch',
  CYCLE_INTERVAL_MINUTES:             'flow_grouping_window_minutes',
  MAX_FLOW_WAITING_MINUTES:           'max_allowed_wait',
  W_N:                                'weight_shipment_count',
  W_U:                                'weight_urgency',
  W_D:                                'weight_duration',
  BASE_PENALTY:                       'base_dead_end_penalty',
  INTRA_CITY_MIN_TIME_BUFFER_MINUTES: 'min_time_to_zone_b_for_addition',
  ASSIGNMENT_TIMEOUT_SECONDS:         'assignment_timeout_seconds',
  DRIVERS_PER_ROUND:                  'drivers_per_round',
  MAX_ASSIGNMENT_ROUNDS:              'max_assignment_rounds',
};

function settingToDbCol(key: string): string {
  return COL_OVERRIDE[key] ?? key.toLowerCase();
}

const LogisticsSettingsPage: React.FC<LogisticsSettingsPageProps> = ({ embedded = false }) => {
  const [values, setValues] = useState<SettingsValues>(getDefaultValues);
  const [savedValues, setSavedValues] = useState<SettingsValues>(getDefaultValues);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    supabase
      .from('batch_config')
      .select('*')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const patch: SettingsValues = {};
        for (const def of SETTINGS_DEFINITIONS) {
          const col = settingToDbCol(def.key);
          const val = (data as Record<string, unknown>)[col];
          if (val !== null && val !== undefined) patch[def.key] = val as number | boolean | string;
        }
        setValues(prev => ({ ...prev, ...patch } as SettingsValues));
        setSavedValues(prev => ({ ...prev, ...patch } as SettingsValues));
      });
  }, []);
  const contentRef = useRef<HTMLDivElement>(null);

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(savedValues),
    [values, savedValues]
  );

  const invalidWeightGroups = useMemo(
    () => Object.keys(WEIGHT_GROUPS).filter(g => !isWeightGroupValid(g, values)),
    [values]
  );

  const handleChange = useCallback((key: string, val: number | boolean | string) => {
    setValues(prev => ({ ...prev, [key]: val }));
    setErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
    if (saveState === 'saved') setSaveState('idle');
  }, [saveState]);

  const handleSave = async () => {
    const errs = validate(values);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaveState('saving');
    setSaveMessage(null);
    try {
      const dbPatch: Record<string, number | boolean | string> = {};
      for (const def of SETTINGS_DEFINITIONS) {
        dbPatch[settingToDbCol(def.key)] = values[def.key];
      }
      const { error } = await supabase
        .from('batch_config')
        .update(dbPatch)
        .eq('id', 1);
      if (error) throw error;
      setSavedValues(values);
      setSaveState('saved');
      setSaveMessage({ type: 'success', text: 'تم حفظ الإعدادات بنجاح في قاعدة البيانات.' });
      setTimeout(() => { setSaveState('idle'); setSaveMessage(null); }, 4000);
    } catch (err: unknown) {
      setSaveState('error');
      const msg = err instanceof Error ? err.message
        : (err as { message?: string })?.message ?? String(err);
      setSaveMessage({ type: 'error', text: `فشل الحفظ: ${msg}` });
      setTimeout(() => { setSaveState('idle'); setSaveMessage(null); }, 8000);
    }
  };

  const handleReset = () => { setValues(savedValues); setErrors({}); };

  const visibleCategories = useMemo(() => {
    return CATEGORIES.filter(cat => {
      if (activeCategory !== 'all' && cat.key !== activeCategory) return false;
      const catSettings = SETTINGS_DEFINITIONS.filter(s => s.category === cat.key);
      if (!search) return catSettings.length > 0;
      const q = search.toLowerCase();
      return catSettings.some(s => s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q));
    });
  }, [activeCategory, search]);

  const scrollToSection = (key: string) => {
    const el = document.getElementById(`section-${key}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const totalErrors = Object.keys(errors).length;

  // ── Save toast ───────────────────────────────────────────────────────────
  const saveToast = saveMessage && (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
      borderRadius: 8, fontSize: 13, fontFamily: "'Tajawal', sans-serif",
      direction: 'rtl', lineHeight: 1.5,
      background: saveMessage.type === 'success' ? '#F0FDF4' : '#FEF2F2',
      border: `1.5px solid ${saveMessage.type === 'success' ? '#86EFAC' : '#FCA5A5'}`,
      color: saveMessage.type === 'success' ? '#15803D' : '#B91C1C',
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{saveMessage.type === 'success' ? '✓' : '✗'}</span>
      <span>{saveMessage.text}</span>
      <button
        onClick={() => setSaveMessage(null)}
        style={{ marginRight: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16, lineHeight: 1, padding: 0, opacity: 0.6 }}
      >×</button>
    </div>
  );

  // ── Save button ───────────────────────────────────────────────────────────
  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={saveState === 'saving' || (!isDirty && saveState === 'idle')}
      style={{
        background: saveState === 'saved'
          ? 'linear-gradient(135deg,#16A34A,#15803D)'
          : saveState === 'error'
          ? 'linear-gradient(135deg,#DC2626,#B91C1C)'
          : 'linear-gradient(135deg,#F97316,#EA580C)',
        border: 'none',
        borderRadius: 7,
        color: '#fff',
        fontSize: 13,
        fontWeight: 700,
        padding: '8px 20px',
        cursor: saveState === 'saving' || (!isDirty && saveState === 'idle') ? 'not-allowed' : 'pointer',
        opacity: !isDirty && saveState === 'idle' ? 0.45 : 1,
        fontFamily: "'Tajawal', sans-serif",
        boxShadow: isDirty ? '0 4px 14px rgba(249,115,22,0.35)' : 'none',
        transition: 'all 0.2s',
        minWidth: 130,
        whiteSpace: 'nowrap',
      }}
    >
      {saveState === 'saving' ? '...جاري الحفظ' : saveState === 'saved' ? '✓ تم الحفظ' : saveState === 'error' ? '✗ فشل الحفظ' : 'حفظ التغييرات'}
    </button>
  );

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', direction: 'rtl' }}>
      {/* Search */}
      <div style={{ position: 'relative', flex: '1 1 160px', maxWidth: 280 }}>
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: 14, pointerEvents: 'none' }}>⌕</span>
        <input
          type="text"
          placeholder="...البحث في الإعدادات"
          value={search}
          onChange={e => setSearch(e.target.value)}
          dir="rtl"
          style={{ width: '100%', background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 7, color: '#0F2B4E', fontSize: 13, padding: '7px 34px 7px 10px', outline: 'none', fontFamily: "'Tajawal', sans-serif", transition: 'border-color 0.15s' }}
          onFocus={e => (e.currentTarget.style.borderColor = '#F97316')}
          onBlur={e => (e.currentTarget.style.borderColor = '#E2E8F0')}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
        )}
      </div>

      {/* Category filter */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <select
          value={activeCategory}
          onChange={e => setActiveCategory(e.target.value)}
          dir="rtl"
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            background: '#FFFFFF',
            border: '1.5px solid #E2E8F0',
            borderRadius: 7,
            color: '#0F2B4E',
            fontSize: 13,
            fontFamily: "'Tajawal', sans-serif",
            padding: '7px 14px 7px 36px',
            outline: 'none',
            cursor: 'pointer',
            minWidth: 150,
            transition: 'border-color 0.15s',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#F97316')}
          onBlur={e => (e.currentTarget.style.borderColor = '#E2E8F0')}
        >
          <option value="all">جميع الفئات</option>
          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {/* Custom arrow */}
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748B', fontSize: 10, lineHeight: 1 }}>▼</span>
      </div>

      {/* Status + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
        {isDirty && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#F97316', fontFamily: "'Tajawal', sans-serif" }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F97316', display: 'inline-block', boxShadow: '0 0 6px rgba(249,115,22,0.5)' }} />
            غير محفوظ
          </div>
        )}
        {totalErrors > 0 && (
          <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 5, padding: '3px 10px', fontFamily: "'Tajawal', sans-serif" }}>
            {totalErrors} خطأ
          </div>
        )}
        {invalidWeightGroups.length > 0 && (
          <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 5, padding: '3px 10px', fontFamily: "'Tajawal', sans-serif" }}>
            {invalidWeightGroups.length} خطأ في الأوزان
          </div>
        )}
        {isDirty && (
          <button onClick={handleReset}
            style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 7, color: '#64748B', fontSize: 13, padding: '7px 14px', cursor: 'pointer', fontFamily: "'Tajawal', sans-serif", transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#CBD5E1'; e.currentTarget.style.color = '#0F2B4E'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.color = '#64748B'; }}>
            استعادة
          </button>
        )}
        {saveBtn}
      </div>
    </div>
  );

  // ── Sidenav ───────────────────────────────────────────────────────────────
  const sidenav = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} className="ls-sidenav">
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#94A3B8', marginBottom: 6, paddingRight: 8, direction: 'rtl', textTransform: 'uppercase' }}>
        الفئات
      </div>
      {CATEGORIES.map(cat => {
        const catSettings = SETTINGS_DEFINITIONS.filter(s => s.category === cat.key);
        const hasError = catSettings.some(s => errors[s.key]);
        const isActive = activeCategory === 'all' || activeCategory === cat.key;
        return (
          <button key={cat.key}
            onClick={() => { setActiveCategory('all'); setSearch(''); setTimeout(() => scrollToSection(cat.key), 50); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, border: 'none', background: isActive ? '#FFF7ED' : 'transparent', cursor: 'pointer', textAlign: 'right', width: '100%', direction: 'rtl', transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = isActive ? '#FFF7ED' : '#F8FAFC')}
            onMouseLeave={e => (e.currentTarget.style.background = isActive ? '#FFF7ED' : 'transparent')}
          >
            <span style={{ fontSize: 12, width: 18, textAlign: 'center', color: hasError ? '#DC2626' : '#F97316', flexShrink: 0 }}>{cat.icon}</span>
            <span style={{ fontSize: 12, color: hasError ? '#DC2626' : '#1E3A5F', fontFamily: "'Tajawal', sans-serif", fontWeight: isActive ? 600 : 400, flex: 1, lineHeight: 1.3, textAlign: 'right' }}>{cat.label}</span>
            <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace', flexShrink: 0 }}>{catSettings.length}</span>
          </button>
        );
      })}

      {/* Stats */}
      <div style={{ marginTop: 16, padding: 12, background: '#F8FAFC', border: '1.5px solid #E2E8F0', borderRadius: 8 }}>
        <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right', direction: 'rtl' }}>ملخص</div>
        {[
          ['إجمالي الإعدادات', SETTINGS_DEFINITIONS.length],
          ['الفئات', CATEGORIES.length],
          ['الأخطاء', totalErrors],
        ].map(([label, value]) => (
          <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, direction: 'rtl' }}>
            <span style={{ fontSize: 12, color: '#64748B', fontFamily: "'Tajawal', sans-serif" }}>{label}</span>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: label === 'الأخطاء' && Number(value) > 0 ? '#DC2626' : '#0F2B4E', fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Sections grid ─────────────────────────────────────────────────────────
  const sectionsGrid = (
    <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {visibleCategories.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94A3B8' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◎</div>
          <div style={{ fontSize: 14, fontFamily: "'Tajawal', sans-serif", color: '#64748B' }}>
            لا توجد إعدادات تطابق "{search}"
          </div>
          <button onClick={() => setSearch('')}
            style={{ marginTop: 12, background: '#FFFFFF', border: '1.5px solid #E2E8F0', borderRadius: 6, color: '#64748B', fontSize: 13, padding: '7px 16px', cursor: 'pointer', fontFamily: "'Tajawal', sans-serif" }}>
            مسح البحث
          </button>
        </div>
      )}
      {visibleCategories.map(cat => (
        <SettingsSection
          key={cat.key}
          category={cat}
          settings={SETTINGS_DEFINITIONS.filter(s => s.category === cat.key)}
          values={values}
          errors={errors}
          onChange={handleChange}
          searchQuery={search}
        />
      ))}
      <div style={{ height: 40 }} />
    </div>
  );

  // ── Responsive style ──────────────────────────────────────────────────────
  const responsiveCss = `@media(max-width:768px){.ls-sidenav{display:none!important}.ls-grid{grid-template-columns:1fr!important}}`;

  // ── Embedded mode ─────────────────────────────────────────────────────────
  if (embedded) {
    return (
      <div style={{ fontFamily: "'Tajawal', sans-serif", color: '#0F2B4E', background: '#F8FAFC', borderRadius: 8, padding: 16 }}>
        <style>{FONTS_CSS}</style>
        <style>{responsiveCss}</style>
        {/* Toolbar */}
        <div style={{ marginBottom: saveToast ? 8 : 16 }}>{toolbar}</div>
        {saveToast && <div style={{ marginBottom: 16 }}>{saveToast}</div>}
        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 20, alignItems: 'start' }} className="ls-grid">
          <div style={{ position: 'sticky', top: 8 }}>{sidenav}</div>
          {sectionsGrid}
        </div>
      </div>
    );
  }

  // ── Standalone mode ───────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'Tajawal', sans-serif", color: '#0F2B4E' }}>
      <style>{FONTS_CSS}</style>
      <style>{responsiveCss}</style>

      {/* Sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(248,250,252,0.95)', backdropFilter: 'blur(10px)', borderBottom: '1.5px solid #E2E8F0', padding: '0 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: 64, display: 'flex', alignItems: 'center', gap: 16, direction: 'rtl' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg,#F97316,#EA580C)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(249,115,22,0.35)' }}>
              <span style={{ fontSize: 16 }}>⚙</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0F2B4E', lineHeight: 1.1 }}>إعدادات الخوارزمية</div>
              <div style={{ fontSize: 11, color: '#94A3B8', lineHeight: 1.1 }}>ضبط خوارزمية التجميع اللوجستي</div>
            </div>
          </div>
          <div style={{ flex: 1 }}>{toolbar}</div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
        {saveToast && <div style={{ marginBottom: 16 }}>{saveToast}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 20, alignItems: 'start' }} className="ls-grid">
          <div style={{ position: 'sticky', top: 80 }}>{sidenav}</div>
          {sectionsGrid}
        </div>
      </div>
    </div>
  );
};

export default LogisticsSettingsPage;
