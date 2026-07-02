import React from 'react';
import { useTranslation } from 'react-i18next';
import { getWeightGroupSum, SettingsValues } from '../settingsData';

interface WeightGroupWarningProps {
  groupKey: string;
  values: SettingsValues;
  weightGroups: Record<string, { label: string; keys: string[] }>;
}

const WeightGroupWarning: React.FC<WeightGroupWarningProps> = ({ groupKey, values, weightGroups }) => {
  const { t } = useTranslation('admin');
  const group = weightGroups[groupKey];
  if (!group) return null;

  const sum = getWeightGroupSum(groupKey, values, weightGroups);
  const isValid = Math.abs(sum - 1) < 0.001;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        borderRadius: 6,
        background: isValid ? 'rgba(22,163,74,0.06)' : 'rgba(239,68,68,0.06)',
        border: `1px solid ${isValid ? 'rgba(22,163,74,0.25)' : 'rgba(239,68,68,0.3)'}`,
        marginBottom: 2,
      }}
    >
      <span style={{ fontSize: 13, flexShrink: 0 }}>{isValid ? '✓' : '⚠'}</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
        {group.keys.map((k, i) => (
          <React.Fragment key={k}>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#0F2B4E', fontWeight: 600 }}>
              {Number(values[k] ?? 0).toFixed(2)}
            </span>
            {i < group.keys.length - 1 && (
              <span style={{ color: '#94A3B8', fontSize: 11 }}>+</span>
            )}
          </React.Fragment>
        ))}
        <span style={{ color: '#94A3B8', fontSize: 11 }}>=</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: isValid ? '#16A34A' : '#DC2626' }}>
          {sum.toFixed(3)}
        </span>
      </div>

      <span style={{ fontSize: 11, color: isValid ? '#16A34A' : '#DC2626', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {isValid ? t('logisticsSettings.weightsValid') : t('logisticsSettings.weightsMustEqualOne')}
      </span>
    </div>
  );
};

export default WeightGroupWarning;
