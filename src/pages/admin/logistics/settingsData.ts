export type SettingType =
  | 'count' | 'minutes' | 'ratio' | 'currency' | 'km' | 'volume' | 'coefficient';

export interface SettingDef {
  key: string;
  label: string;
  unit: string;
  type: SettingType;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  explanation: string;
  category: string;
  weightGroup?: string;
  /**
   * Optional time-unit toggle. When set, the value cell shows a button per unit and
   * the entered value is converted to the stored base unit via `factor` (base units
   * per this unit). The FIRST entry is the stored base unit (factor must be 1).
   * If omitted, a 'minutes'-type field falls back to a minute/hour toggle.
   */
  timeUnits?: { label: string; factor: number; step?: number }[];
}

export interface CategoryDef {
  key: string;
  label: string;
  icon: string;
  formula?: string;
  formulaVars?: string;
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'batch',      label: 'إعدادات الدفعة',   icon: '▦' },
  { key: 'flow',       label: 'إعدادات التدفق',    icon: '⟲' },
  {
    key: 'scoring',
    label: 'أوزان التقييم',
    icon: '⊞',
    formula: 'Score = W_n × N̂ + W_u × Û − W_d × D̂',
    formulaVars: 'N̂ = عدد الشحنات  ·  Û = الأولوية  ·  D̂ = مدة المسار',
  },
  { key: 'route',      label: 'إعدادات المسار',    icon: '◎' },
  { key: 'assignment', label: 'تعيين السائق',       icon: '🚗' },
];

export const WEIGHT_GROUPS: Record<string, { label: string; keys: string[] }> = {
  batch_score_weights: {
    label: 'أوزان تقييم الدفعات',
    keys: ['W_N', 'W_U', 'W_D'],
  },
};

export const SETTINGS_DEFINITIONS: SettingDef[] = [
  // ── 1. إعدادات الدفعة ──────────────────────────────────────────────────────
  {
    key: 'MAX_VOLUME',
    label: 'أقصى حجم في الدفعة',
    unit: 'وحدة حجم',
    type: 'volume',
    defaultValue: 100,
    min: 1,
    max: 10000,
    step: 1,
    explanation: 'أقصى سعة يمكن لمركبة السائق حملها في رحلة واحدة.',
    category: 'batch',
  },
  {
    key: 'MAX_STOPS',
    label: 'أقصى محطات في الدفعة',
    unit: 'محطة',
    type: 'count',
    defaultValue: 20,
    min: 1,
    max: 100,
    step: 1,
    explanation: 'الحد الأقصى لعدد محطات الاستلام أو التسليم في دفعة واحدة.',
    category: 'batch',
  },
  {
    key: 'MIN_BATCH_THRESHOLD',
    label: 'الحد الأدنى للدفعة',
    unit: 'شحنة',
    type: 'count',
    defaultValue: 5,
    min: 1,
    max: 50,
    step: 1,
    explanation: 'أدنى عدد شحنات مطلوب لإرسال الدفعة. إذا كان العدد أقل تُؤجَّل للدورة التالية.',
    category: 'batch',
  },
  {
    key: 'DELAY_THRESHOLD_MINUTES',
    label: 'حد التأخير التلقائي',
    unit: 'دقيقة',
    type: 'minutes',
    defaultValue: 180,
    min: 10,
    max: 1440,
    step: 10,
    explanation: 'إذا مرّ هذا الوقت على بدء الدفعة (in_transit) دون موعد إكمال متوقع، تُعتبر الدفعة متأخرة تلقائياً.',
    category: 'batch',
  },

  // ── 2. إعدادات التدفق ──────────────────────────────────────────────────────
  {
    key: 'CYCLE_INTERVAL_MINUTES',
    label: 'فترة دورة التجميع',
    unit: 'دقيقة',
    type: 'minutes',
    defaultValue: 30,
    min: 5,
    max: 240,
    step: 5,
    explanation: 'كم مرة تعمل دورة التجميع وتُجمّع الشحنات المتاحة.',
    category: 'flow',
  },
  {
    key: 'MAX_FLOW_WAITING_MINUTES',
    label: 'أقصى وقت انتظار التدفق',
    unit: 'دقيقة',
    type: 'minutes',
    defaultValue: 120,
    min: 10,
    max: 7200,
    step: 10,
    explanation: 'إذا انتظرت شحنات تدفق ما بمعدل يتجاوز هذا الوقت، تُرسَل الدفعة قسراً بغض النظر عن حجمها.',
    category: 'flow',
  },
  {
    key: 'MAX_DISTANCE_KM',
    label: 'أقصى مسافة بين المناطق',
    unit: 'كم',
    type: 'km',
    defaultValue: 50,
    min: 1,
    max: 500,
    step: 5,
    explanation: 'أقصى مسافة مسموح بها بين منطقتين في نفس المسار.',
    category: 'flow',
  },
  {
    key: 'SHIPMENT_DEADLINE_HOURS',
    label: 'مهلة تسليم الشحنة',
    unit: 'ساعة',
    type: 'count',
    defaultValue: 24,
    min: 1,
    max: 240,
    step: 1,
    explanation: 'عدد الساعات من إنشاء الشحنة حتى الموعد النهائي للتسليم. يُستخدم لعرض موعد الوصول المتوقع للعميل ولحساب إلحاح الشحنة في خوارزمية التجميع.',
    category: 'flow',
  },

  // ── 3. أوزان التقييم ───────────────────────────────────────────────────────
  {
    key: 'W_N',
    label: 'وزن عدد الشحنات (W_n)',
    unit: 'نسبة',
    type: 'ratio',
    defaultValue: 0.35,
    min: 0,
    max: 1,
    step: 0.01,
    explanation: 'تأثير عدد الشحنات على تقييم الدفعة. قيمة أعلى = عدد أكبر يرفع الأولوية.',
    category: 'scoring',
    weightGroup: 'batch_score_weights',
  },
  {
    key: 'W_U',
    label: 'وزن الأولوية (W_u)',
    unit: 'نسبة',
    type: 'ratio',
    defaultValue: 0.45,
    min: 0,
    max: 1,
    step: 0.01,
    explanation: 'تأثير الأولوية على ترتيب الدفعات. قيمة أعلى = الأكثر إلحاحاً يُرسَل أولاً.',
    category: 'scoring',
    weightGroup: 'batch_score_weights',
  },
  {
    key: 'W_D',
    label: 'وزن مدة المسار (W_d)',
    unit: 'نسبة',
    type: 'ratio',
    defaultValue: 0.20,
    min: 0,
    max: 1,
    step: 0.01,
    explanation: 'عقوبة المسارات الطويلة. قيمة أعلى = المسارات الأطول تُخفَّض أولويتها أكثر.',
    category: 'scoring',
    weightGroup: 'batch_score_weights',
  },
  {
    key: 'BASE_PENALTY',
    label: 'عقوبة النهاية المسدودة',
    unit: 'نقاط',
    type: 'ratio',
    defaultValue: 0.20,
    min: 0,
    max: 1,
    step: 0.01,
    explanation: 'العقوبة المطروحة من تقييم الدفعة عند غياب طلب في منطقة الوجهة. penalty = BASE_PENALTY × (1 − Û)',
    category: 'scoring',
  },

  // ── 4. إعدادات المسار ──────────────────────────────────────────────────────
  {
    key: 'COST_PER_KM',
    label: 'التكلفة لكل كيلومتر',
    unit: '₪/كم',
    type: 'currency',
    defaultValue: 2.5,
    min: 0,
    max: 100,
    step: 0.1,
    explanation: 'التكلفة المحسوبة لكل كيلومتر. تُستخدم لمقارنة تمديد المسار مقابل إرسال سائق جديد.',
    category: 'route',
  },
  {
    key: 'ROAD_FACTOR',
    label: 'معامل تعديل المسافة',
    unit: 'معامل',
    type: 'coefficient',
    defaultValue: 1.3,
    min: 1.0,
    max: 2.0,
    step: 0.01,
    explanation: 'نسبة المسافة الفعلية على الطريق إلى المسافة المستقيمة. يعوّض عن التعرجات والمنعطفات.',
    category: 'route',
  },
  {
    key: 'INTRA_CITY_MIN_TIME_BUFFER_MINUTES',
    label: 'أدنى وقت للإضافة أثناء الرحلة',
    unit: 'دقيقة',
    type: 'minutes',
    defaultValue: 15,
    min: 5,
    max: 120,
    step: 5,
    explanation: 'أدنى وقت متبقٍ للوصول للمنطقة ب حتى يُسمح بإضافة شحنات جديدة أثناء الرحلة.',
    category: 'route',
  },
  // ── 5. تعيين السائق ───────────────────────────────────────────────────────
  {
    key: 'DRIVERS_PER_ROUND',
    label: 'سائقون لكل جولة',
    unit: 'سائق',
    type: 'count',
    defaultValue: 3,
    min: 1,
    max: 10,
    step: 1,
    explanation: 'عدد السائقين الذين يُرسَل إليهم إشعار الدفعة في كل جولة تعيين.',
    category: 'assignment',
  },
  {
    key: 'MAX_ASSIGNMENT_ROUNDS',
    label: 'أقصى عدد جولات التعيين',
    unit: 'جولة',
    type: 'count',
    defaultValue: 3,
    min: 1,
    max: 10,
    step: 1,
    explanation: 'إذا رفض جميع السائقين أو انتهت المهلة في كل الجولات، تُحال الدفعة للمشرف.',
    category: 'assignment',
  },
  {
    key: 'ASSIGNMENT_TIMEOUT_SECONDS',
    label: 'مهلة انتظار قبول السائق',
    unit: 'ثانية',
    type: 'count',
    defaultValue: 300,
    min: 30,
    max: 1800,
    step: 30,
    explanation: 'المدة الزمنية التي ينتظرها النظام لقبول السائق في كل جولة قبل الانتقال للجولة التالية.',
    category: 'assignment',
  },
];

export type SettingsValues = Record<string, number>;

export function getDefaultValues(): SettingsValues {
  return Object.fromEntries(
    SETTINGS_DEFINITIONS.map(s => [s.key, s.defaultValue])
  );
}

export function getWeightGroupSum(group: string, values: SettingsValues): number {
  const keys = WEIGHT_GROUPS[group]?.keys ?? [];
  return keys.reduce((sum, k) => sum + (Number(values[k]) || 0), 0);
}

export function isWeightGroupValid(group: string, values: SettingsValues): boolean {
  return Math.abs(getWeightGroupSum(group, values) - 1) < 0.001;
}
