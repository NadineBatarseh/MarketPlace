import React, { useCallback, useState, useEffect } from 'react';
import { SettingDef, SettingsValues } from '../settingsData';
import InfoTooltip from './InfoTooltip';
import ToggleSwitch from './ToggleSwitch';

interface SettingRowProps {
  def: SettingDef;
  values: SettingsValues;
  errors: Record<string, string>;
  onChange: (key: string, val: number | boolean | string) => void;
  highlight?: boolean;
}

const INPUT_STYLE: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1.5px solid #E2E8F0',
  borderRadius: 6,
  color: '#0F2B4E',
  fontFamily: 'monospace',
  fontSize: 13,
  padding: '5px 10px',
  width: '100%',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: 'pointer',
  appearance: 'none' as const,
  WebkitAppearance: 'none',
  MozAppearance: 'none',
};

// Numeric input that allows free typing and commits on blur
const NumericInput: React.FC<{
  value: number;
  min?: number;
  max?: number;
  step?: number;
  hasError: boolean;
  onChange: (val: number) => void;
}> = ({ value, min, max, step = 1, hasError, onChange }) => {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Keep raw in sync when external value changes (e.g. reset)
  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) { setRaw(String(value)); return; }
    const clamped = min !== undefined && parsed < min ? min
      : max !== undefined && parsed > max ? max
      : parsed;
    setRaw(String(clamped));
    onChange(clamped);
  };

  const borderColor = hasError ? '#DC2626' : focused ? '#F97316' : '#E2E8F0';
  const boxShadow = focused ? '0 0 0 3px rgba(249,115,22,0.12)' : 'none';

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const next = parseFloat(raw || String(value)) + step;
          const clamped = max !== undefined ? Math.min(next, max) : next;
          setRaw(String(parseFloat(clamped.toFixed(10))));
          onChange(clamped);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = parseFloat(raw || String(value)) - step;
          const clamped = min !== undefined ? Math.max(next, min) : next;
          setRaw(String(parseFloat(clamped.toFixed(10))));
          onChange(clamped);
        }
      }}
      style={{ ...INPUT_STYLE, borderColor, boxShadow }}
    />
  );
};

const SettingRow: React.FC<SettingRowProps> = ({
  def, values, errors, onChange, highlight,
}) => {
  const val = values[def.key];
  const error = errors[def.key];

  // Minutes ↔ Hours toggle (only for 'minutes' type)
  const [useHours, setUseHours] = useState(false);
  const isMinutes = def.type === 'minutes';

  const minutesVal = Number(val);
  const displayVal = isMinutes && useHours
    ? parseFloat((minutesVal / 60).toFixed(4))
    : minutesVal;

  const handleFocus = useCallback((e: React.FocusEvent<HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = '#F97316';
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.12)';
  }, []);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = error ? '#DC2626' : '#E2E8F0';
    e.currentTarget.style.boxShadow = 'none';
  }, [error]);

  const handleNumericChange = (parsed: number) => {
    const stored = isMinutes && useHours ? Math.round(parsed * 60) : parsed;
    onChange(def.key, stored);
  };

  const renderInput = () => {
    if (def.type === 'boolean') {
      return <ToggleSwitch value={Boolean(val)} onChange={v => onChange(def.key, v)} />;
    }

    if (def.type === 'select') {
      return (
        <div style={{ position: 'relative' }}>
          <select
            value={String(val)}
            onChange={e => onChange(def.key, e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            style={{ ...SELECT_STYLE, borderColor: error ? '#DC2626' : '#E2E8F0', paddingLeft: 28 }}
          >
            {def.options?.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94A3B8', fontSize: 9, lineHeight: 1 }}>▼</span>
        </div>
      );
    }

    return (
      <NumericInput
        value={displayVal}
        min={isMinutes && useHours && def.min !== undefined ? def.min / 60 : def.min}
        max={isMinutes && useHours && def.max !== undefined ? def.max / 60 : def.max}
        step={isMinutes && useHours ? 0.5 : (def.step ?? 1)}
        hasError={!!error}
        onChange={handleNumericChange}
      />
    );
  };

  // Unit cell: for minutes fields show min/hr toggle buttons
  const unitCell = isMinutes ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <button
        type="button"
        onClick={() => setUseHours(false)}
        style={{
          fontSize: 10,
          fontFamily: "'Tajawal', sans-serif",
          fontWeight: useHours ? 400 : 700,
          color: useHours ? '#CBD5E1' : '#F97316',
          background: useHours ? 'transparent' : '#FFF7ED',
          border: useHours ? '1px solid transparent' : '1px solid #FED7AA',
          borderRadius: 4,
          padding: '2px 5px',
          cursor: 'pointer',
          transition: 'all 0.15s',
          lineHeight: 1.4,
        }}
      >
        دقيقة
      </button>
      <button
        type="button"
        onClick={() => setUseHours(true)}
        style={{
          fontSize: 10,
          fontFamily: "'Tajawal', sans-serif",
          fontWeight: useHours ? 700 : 400,
          color: useHours ? '#F97316' : '#CBD5E1',
          background: useHours ? '#FFF7ED' : 'transparent',
          border: useHours ? '1px solid #FED7AA' : '1px solid transparent',
          borderRadius: 4,
          padding: '2px 5px',
          cursor: 'pointer',
          transition: 'all 0.15s',
          lineHeight: 1.4,
        }}
      >
        ساعة
      </button>
    </div>
  ) : (
    <div
      style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}
    >
      {def.unit}
    </div>
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 80px 24px',
        gap: 10,
        alignItems: 'center',
        padding: '9px 16px',
        background: highlight ? 'rgba(249,115,22,0.04)' : 'transparent',
        transition: 'background 0.15s',
        borderBottom: '1px solid #F1F5F9',
        direction: 'rtl',
      }}
      onMouseEnter={e => {
        if (!highlight) (e.currentTarget as HTMLElement).style.background = '#FAFAFA';
      }}
      onMouseLeave={e => {
        if (!highlight) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {/* Label */}
      <div>
        <div style={{ fontSize: 13, color: '#1E3A5F', fontWeight: 500, lineHeight: 1.35, textAlign: 'right' }}>
          {def.label}
        </div>
        {error && (
          <div style={{ fontSize: 11, color: '#DC2626', marginTop: 2, textAlign: 'right' }}>
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ minWidth: 0 }}>{renderInput()}</div>

      {/* Unit / toggle */}
      {unitCell}

      {/* Tooltip */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <InfoTooltip text={def.explanation} />
      </div>
    </div>
  );
};

export default SettingRow;
