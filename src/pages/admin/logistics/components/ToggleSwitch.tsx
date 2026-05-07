import React from 'react';

interface ToggleSwitchProps {
  value: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ value, onChange, disabled }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: 40,
        height: 22,
        borderRadius: 11,
        border: 'none',
        padding: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: value ? 'linear-gradient(135deg, #F97316, #EA580C)' : '#CBD5E1',
        boxShadow: value ? '0 0 10px rgba(249,115,22,0.3)' : 'inset 0 1px 3px rgba(0,0,0,0.15)',
        transition: 'background 0.2s ease, box-shadow 0.2s ease',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: 'block',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          transform: value ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </button>
  );
};

export default ToggleSwitch;
