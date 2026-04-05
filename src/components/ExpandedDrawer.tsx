import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const C = {
  primary:     '#136540',
  primaryDark: '#0e4f32',
  primaryLight:'#f0fdf4',
  title:       '#0a3d24',
  muted:       '#4d7260',
  hint:        '#8aad99',
  border:      '#d1e8da',
  borderLight: '#e8f5ee',
  drawerBg:    '#e6f7ee',
  bg:          '#ffffff',
};

export interface DrawerItemData {
  imageUrl:  string | null;
  name:      string;
  price:     string;
  qty:       number | null;
  productId: string | null;
}

function DrawerItem({ item }: { item: DrawerItemData }) {
  const [hov, setHov] = useState(false);
  const navigate = useNavigate();
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={item.productId ? () => navigate(`/product/${item.productId}`) : undefined}
      style={{
        background: hov ? '#f8fdf9' : C.bg,
        padding: '14px 16px',
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        transition: 'background 0.15s',
        direction: 'rtl',
        cursor: item.productId ? 'pointer' : 'default',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        width: 48, height: 48, borderRadius: 10,
        background: C.primaryLight,
        border: `1px solid ${C.borderLight}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, flexShrink: 0, overflow: 'hidden',
      }}>
        {item.imageUrl
          ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : '📦'
        }
      </div>

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: C.title,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {item.name}
        </div>
      </div>

      {/* Price + qty */}
      <div style={{ textAlign: 'left', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.title }}>{item.price}</div>
        {item.qty != null && (
          <div style={{ fontSize: 11, color: C.hint, marginTop: 2 }}>الكمية: {item.qty}</div>
        )}
      </div>
    </div>
  );
}

interface ExpandedDrawerProps {
  items:  DrawerItemData[];
  isOpen: boolean;
}

export default function ExpandedDrawer({ items, isOpen }: ExpandedDrawerProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: isOpen ? '1fr' : '0fr',
      transition: 'grid-template-rows 0.3s cubic-bezier(0.4,0,0.2,1)',
      padding: '0 16px',
    }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={{
          marginBottom: 14,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '11px 16px',
            background: C.drawerBg,
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            direction: 'rtl',
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.title }}>
              {items.length} {items.length === 1 ? 'منتج' : 'منتجات'} في هذا الطلب
            </span>
          </div>

          {/* Items grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 1,
            background: C.border,
          }}>
            {items.map((item, i) => (
              <DrawerItem key={i} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
