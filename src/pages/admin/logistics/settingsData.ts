import type { TFunction } from 'i18next';

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

// Labels/units/explanations come from the `admin` i18n namespace — these module-level
// functions take `t` as a parameter since there's no hook context at this scope.
export function getCategories(t: TFunction): CategoryDef[] {
  return [
    { key: 'batch', label: t('logisticsSettings.categories.batch'), icon: '▦' },
    { key: 'flow', label: t('logisticsSettings.categories.flow'), icon: '⟲' },
    {
      key: 'scoring',
      label: t('logisticsSettings.categories.scoring'),
      icon: '⊞',
      formula: 'Score = W_n × N̂ + W_u × Û − W_d × D̂',
      formulaVars: t('logisticsSettings.categories.scoringFormulaVars'),
    },
    { key: 'route', label: t('logisticsSettings.categories.route'), icon: '◎' },
    { key: 'assignment', label: t('logisticsSettings.categories.assignment'), icon: '🚗' },
  ];
}

export function getWeightGroups(t: TFunction): Record<string, { label: string; keys: string[] }> {
  return {
    batch_score_weights: {
      label: t('logisticsSettings.weightGroups.batchScoreWeights'),
      keys: ['W_N', 'W_U', 'W_D'],
    },
  };
}

export function getSettingsDefinitions(t: TFunction): SettingDef[] {
  return [
    // ── 1. Batch settings ──────────────────────────────────────────────────
    {
      key: 'MAX_VOLUME',
      label: t('logisticsSettings.settings.MAX_VOLUME.label'),
      unit: t('logisticsSettings.settings.MAX_VOLUME.unit'),
      type: 'volume',
      defaultValue: 100,
      min: 1,
      max: 10000,
      step: 1,
      explanation: t('logisticsSettings.settings.MAX_VOLUME.explanation'),
      category: 'batch',
    },
    {
      key: 'MAX_STOPS',
      label: t('logisticsSettings.settings.MAX_STOPS.label'),
      unit: t('logisticsSettings.settings.MAX_STOPS.unit'),
      type: 'count',
      defaultValue: 20,
      min: 1,
      max: 100,
      step: 1,
      explanation: t('logisticsSettings.settings.MAX_STOPS.explanation'),
      category: 'batch',
    },
    {
      key: 'MIN_BATCH_THRESHOLD',
      label: t('logisticsSettings.settings.MIN_BATCH_THRESHOLD.label'),
      unit: t('logisticsSettings.settings.MIN_BATCH_THRESHOLD.unit'),
      type: 'count',
      defaultValue: 5,
      min: 1,
      max: 50,
      step: 1,
      explanation: t('logisticsSettings.settings.MIN_BATCH_THRESHOLD.explanation'),
      category: 'batch',
    },

    // ── 2. Flow settings ───────────────────────────────────────────────────
    {
      key: 'CYCLE_INTERVAL_MINUTES',
      label: t('logisticsSettings.settings.CYCLE_INTERVAL_MINUTES.label'),
      unit: t('logisticsSettings.settings.CYCLE_INTERVAL_MINUTES.unit'),
      type: 'minutes',
      defaultValue: 30,
      min: 5,
      max: 240,
      step: 5,
      explanation: t('logisticsSettings.settings.CYCLE_INTERVAL_MINUTES.explanation'),
      category: 'flow',
    },
    {
      key: 'MAX_FLOW_WAITING_MINUTES',
      label: t('logisticsSettings.settings.MAX_FLOW_WAITING_MINUTES.label'),
      unit: t('logisticsSettings.settings.MAX_FLOW_WAITING_MINUTES.unit'),
      type: 'minutes',
      defaultValue: 120,
      min: 10,
      max: 7200,
      step: 10,
      explanation: t('logisticsSettings.settings.MAX_FLOW_WAITING_MINUTES.explanation'),
      category: 'flow',
    },
    {
      key: 'MAX_DISTANCE_KM',
      label: t('logisticsSettings.settings.MAX_DISTANCE_KM.label'),
      unit: t('logisticsSettings.settings.MAX_DISTANCE_KM.unit'),
      type: 'km',
      defaultValue: 50,
      min: 1,
      max: 500,
      step: 5,
      explanation: t('logisticsSettings.settings.MAX_DISTANCE_KM.explanation'),
      category: 'flow',
    },

    // ── 3. Scoring weights ─────────────────────────────────────────────────
    {
      key: 'W_N',
      label: t('logisticsSettings.settings.W_N.label'),
      unit: t('logisticsSettings.settings.W_N.unit'),
      type: 'ratio',
      defaultValue: 0.35,
      min: 0,
      max: 1,
      step: 0.01,
      explanation: t('logisticsSettings.settings.W_N.explanation'),
      category: 'scoring',
      weightGroup: 'batch_score_weights',
    },
    {
      key: 'W_U',
      label: t('logisticsSettings.settings.W_U.label'),
      unit: t('logisticsSettings.settings.W_U.unit'),
      type: 'ratio',
      defaultValue: 0.45,
      min: 0,
      max: 1,
      step: 0.01,
      explanation: t('logisticsSettings.settings.W_U.explanation'),
      category: 'scoring',
      weightGroup: 'batch_score_weights',
    },
    {
      key: 'W_D',
      label: t('logisticsSettings.settings.W_D.label'),
      unit: t('logisticsSettings.settings.W_D.unit'),
      type: 'ratio',
      defaultValue: 0.20,
      min: 0,
      max: 1,
      step: 0.01,
      explanation: t('logisticsSettings.settings.W_D.explanation'),
      category: 'scoring',
      weightGroup: 'batch_score_weights',
    },
    {
      key: 'BASE_PENALTY',
      label: t('logisticsSettings.settings.BASE_PENALTY.label'),
      unit: t('logisticsSettings.settings.BASE_PENALTY.unit'),
      type: 'ratio',
      defaultValue: 0.20,
      min: 0,
      max: 1,
      step: 0.01,
      explanation: t('logisticsSettings.settings.BASE_PENALTY.explanation'),
      category: 'scoring',
    },

    // ── 4. Route settings ──────────────────────────────────────────────────
    {
      key: 'COST_PER_KM',
      label: t('logisticsSettings.settings.COST_PER_KM.label'),
      unit: t('logisticsSettings.settings.COST_PER_KM.unit'),
      type: 'currency',
      defaultValue: 2.5,
      min: 0,
      max: 100,
      step: 0.1,
      explanation: t('logisticsSettings.settings.COST_PER_KM.explanation'),
      category: 'route',
    },
    {
      key: 'ROAD_FACTOR',
      label: t('logisticsSettings.settings.ROAD_FACTOR.label'),
      unit: t('logisticsSettings.settings.ROAD_FACTOR.unit'),
      type: 'coefficient',
      defaultValue: 1.3,
      min: 1.0,
      max: 2.0,
      step: 0.01,
      explanation: t('logisticsSettings.settings.ROAD_FACTOR.explanation'),
      category: 'route',
    },
    {
      key: 'INTRA_CITY_MIN_TIME_BUFFER_MINUTES',
      label: t('logisticsSettings.settings.INTRA_CITY_MIN_TIME_BUFFER_MINUTES.label'),
      unit: t('logisticsSettings.settings.INTRA_CITY_MIN_TIME_BUFFER_MINUTES.unit'),
      type: 'minutes',
      defaultValue: 15,
      min: 5,
      max: 120,
      step: 5,
      explanation: t('logisticsSettings.settings.INTRA_CITY_MIN_TIME_BUFFER_MINUTES.explanation'),
      category: 'route',
    },
    // ── 5. Driver assignment ────────────────────────────────────────────────
    {
      key: 'DRIVERS_PER_ROUND',
      label: t('logisticsSettings.settings.DRIVERS_PER_ROUND.label'),
      unit: t('logisticsSettings.settings.DRIVERS_PER_ROUND.unit'),
      type: 'count',
      defaultValue: 3,
      min: 1,
      max: 10,
      step: 1,
      explanation: t('logisticsSettings.settings.DRIVERS_PER_ROUND.explanation'),
      category: 'assignment',
    },
    {
      key: 'MAX_ASSIGNMENT_ROUNDS',
      label: t('logisticsSettings.settings.MAX_ASSIGNMENT_ROUNDS.label'),
      unit: t('logisticsSettings.settings.MAX_ASSIGNMENT_ROUNDS.unit'),
      type: 'count',
      defaultValue: 3,
      min: 1,
      max: 10,
      step: 1,
      explanation: t('logisticsSettings.settings.MAX_ASSIGNMENT_ROUNDS.explanation'),
      category: 'assignment',
    },
    {
      key: 'ASSIGNMENT_TIMEOUT_SECONDS',
      label: t('logisticsSettings.settings.ASSIGNMENT_TIMEOUT_SECONDS.label'),
      unit: t('logisticsSettings.settings.ASSIGNMENT_TIMEOUT_SECONDS.unit'),
      type: 'count',
      defaultValue: 300,
      min: 30,
      max: 1800,
      step: 30,
      explanation: t('logisticsSettings.settings.ASSIGNMENT_TIMEOUT_SECONDS.explanation'),
      category: 'assignment',
    },
  ];
}

export type SettingsValues = Record<string, number>;

export function getDefaultValues(definitions: SettingDef[]): SettingsValues {
  return Object.fromEntries(
    definitions.map(s => [s.key, s.defaultValue])
  );
}

export function getWeightGroupSum(group: string, values: SettingsValues, weightGroups: Record<string, { label: string; keys: string[] }>): number {
  const keys = weightGroups[group]?.keys ?? [];
  return keys.reduce((sum, k) => sum + (Number(values[k]) || 0), 0);
}

export function isWeightGroupValid(group: string, values: SettingsValues, weightGroups: Record<string, { label: string; keys: string[] }>): boolean {
  return Math.abs(getWeightGroupSum(group, values, weightGroups) - 1) < 0.001;
}
