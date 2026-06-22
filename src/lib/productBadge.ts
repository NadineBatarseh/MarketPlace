// Shared product-card badge logic — used across the whole site so every card
// shows the same badge with the same priority rules.

export type ProductBadgeKind = 'oos' | 'disc' | 'low' | 'new';

export interface ProductBadge {
  kind: ProductBadgeKind;
  text: string;
}

/** Stock at or below this (but > 0) counts as "limited quantity". */
export const LOW_STOCK_THRESHOLD = 5;
/** A product created within this many days is considered "new". */
export const NEW_DAYS = 14;

interface BadgeInput {
  discount_pct?: number | null;
  stock_Quantity?: number | null;
  created_at?: string | null;
}

/**
 * Returns the single highest-priority badge for a product, or null.
 * Priority: out of stock → discount → low stock → new.
 */
export function getProductBadge(p: BadgeInput): ProductBadge | null {
  if (p.stock_Quantity === 0) {
    return { kind: 'oos', text: 'نفدت الكمية' };
  }
  if (p.discount_pct != null && p.discount_pct > 0) {
    return { kind: 'disc', text: `خصم ${p.discount_pct}%` };
  }
  if (p.stock_Quantity != null && p.stock_Quantity > 0 && p.stock_Quantity <= LOW_STOCK_THRESHOLD) {
    return { kind: 'low', text: 'كمية محدودة' };
  }
  if (p.created_at) {
    const days = (Date.now() - new Date(p.created_at).getTime()) / 86_400_000;
    if (days >= 0 && days <= NEW_DAYS) {
      return { kind: 'new', text: 'جديد' };
    }
  }
  return null;
}
