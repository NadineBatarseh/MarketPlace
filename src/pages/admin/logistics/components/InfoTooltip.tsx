import React, { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useLanguage } from '../../../../context/LanguageContext';

interface InfoTooltipProps {
  text: string;
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({ text }) => {
  const { direction } = useLanguage();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, below: true });
  const btnRef = useRef<HTMLButtonElement>(null);

  const show = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const below = spaceBelow > 200;
    setCoords({
      top: below ? rect.bottom + 6 : rect.top - 6,
      left: Math.min(rect.left - 8, window.innerWidth - 296),
      below,
    });
    setVisible(true);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  const portal = visible
    ? ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed',
            top: coords.below ? coords.top : undefined,
            bottom: coords.below ? undefined : window.innerHeight - coords.top,
            left: Math.max(8, coords.left),
            zIndex: 99999,
            width: 260,
            transform: coords.below ? 'none' : 'translateY(-100%)',
          }}
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={hide}
        >
          <div
            style={{
              background: '#0F2B4E',
              borderRadius: 8,
              padding: '10px 14px',
              boxShadow: '0 8px 32px rgba(15,43,78,0.3)',
              direction,
              textAlign: direction === 'rtl' ? 'right' : 'left',
            }}
          >
            <div style={{ color: '#E2E8F0', fontSize: 12, lineHeight: 1.6, fontFamily: 'sans-serif' }}>
              {text}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = '#F97316';
          (e.currentTarget as HTMLElement).style.background = '#FFF7ED';
          show();
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1';
          (e.currentTarget as HTMLElement).style.background = '#F8FAFC';
          hide();
        }}
        onClick={e => { e.stopPropagation(); visible ? hide() : show(); }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: '1.5px solid #CBD5E1',
          background: '#F8FAFC',
          cursor: 'help',
          flexShrink: 0,
          transition: 'border-color 0.15s, background 0.15s',
          padding: 0,
        }}
      >
        <span style={{ color: '#64748B', fontSize: 10, fontWeight: 700, lineHeight: 1, userSelect: 'none', fontStyle: 'italic', fontFamily: 'serif' }}>
          i
        </span>
      </button>
      {portal}
    </>
  );
};

export default InfoTooltip;
