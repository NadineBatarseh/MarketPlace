import React from 'react';
import { CategoryDef, SettingDef, SettingsValues, WEIGHT_GROUPS, isWeightGroupValid } from '../settingsData';
import SettingRow from './SettingRow';
import WeightGroupWarning from './WeightGroupWarning';

interface SettingsSectionProps {
  category: CategoryDef;
  settings: SettingDef[];
  values: SettingsValues;
  errors: Record<string, string>;
  onChange: (key: string, val: number | boolean | string) => void;
  searchQuery: string;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  category, settings, values, errors, onChange, searchQuery,
}) => {
  const visible = settings.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q);
  });

  if (visible.length === 0) return null;

  const groupsInSection = Array.from(
    new Set(settings.map(s => s.weightGroup).filter(Boolean))
  ) as string[];

  const hasInvalidWeights = groupsInSection.some(g => !isWeightGroupValid(g, values));

  return (
    <div
      id={`section-${category.key}`}
      style={{
        background: '#FFFFFF',
        border: `1.5px solid ${hasInvalidWeights ? '#FCA5A5' : '#E2E8F0'}`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(15,43,78,0.06)',
        transition: 'border-color 0.2s',
      }}
    >
      {/* Section Header */}
      <div
        style={{
          padding: '12px 16px',
          background: hasInvalidWeights ? '#FFF5F5' : '#F8FAFC',
          borderBottom: `1px solid ${hasInvalidWeights ? '#FCA5A5' : '#E2E8F0'}`,
          direction: 'rtl',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 7,
              background: hasInvalidWeights ? '#FEE2E2' : '#FFF7ED',
              border: `1.5px solid ${hasInvalidWeights ? '#FCA5A5' : '#FED7AA'}`,
              fontSize: 13,
              color: hasInvalidWeights ? '#DC2626' : '#F97316',
              fontFamily: 'monospace',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {category.icon}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#0F2B4E',
                  letterSpacing: '0.01em',
                }}
              >
                {category.label}
              </h2>
              <span
                style={{
                  fontSize: 11,
                  color: '#64748B',
                  background: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  borderRadius: 4,
                  padding: '1px 7px',
                }}
              >
                {visible.length} إعداد{visible.length !== 1 ? 'ات' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Formula */}
        {category.formula && (
          <div
            style={{
              marginTop: 8,
              padding: '6px 12px',
              background: '#FFF7ED',
              border: '1px solid #FED7AA',
              borderRadius: 6,
            }}
          >
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#C2410C', letterSpacing: '0.02em' }}>
              {category.formula}
            </div>
            {category.formulaVars && (
              <div style={{ fontSize: 11, color: '#92400E', marginTop: 3, textAlign: 'right', direction: 'rtl' }}>
                {category.formulaVars}
              </div>
            )}
          </div>
        )}

        {/* Weight group warnings */}
        {groupsInSection.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {groupsInSection.map(g => (
              <WeightGroupWarning key={g} groupKey={g} values={values} />
            ))}
          </div>
        )}
      </div>

      {/* Column headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 140px 80px 24px',
          gap: 10,
          padding: '5px 16px',
          background: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          direction: 'rtl',
        }}
      >
        {['الإعداد', 'القيمة', 'الوحدة', ''].map(h => (
          <div
            key={h}
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#94A3B8',
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Setting rows */}
      <div style={{ padding: '4px 0' }}>
        {visible.map(s => (
          <SettingRow
            key={s.key}
            def={s}
            values={values}
            errors={errors}
            onChange={onChange}
            highlight={searchQuery.length > 0 &&
              (s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
               s.key.toLowerCase().includes(searchQuery.toLowerCase()))}
          />
        ))}
      </div>
    </div>
  );
};

export default SettingsSection;
