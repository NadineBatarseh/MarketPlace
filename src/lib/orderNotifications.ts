import supabase from './supabase';
import { CUSTOMER_NOTIFICATION_EVENT_TYPES } from '../../shared/trackingEvents';

/**
 * Customer "new update" notification badges (orders icon, order cards).
 * Backed by order_tracking_events.customer_seen_at — NULL means unread.
 * See supabase/migrations/add_tracking_event_customer_seen_at.sql.
 */

export interface OrderNotificationCounts {
  /** order_id → number of unread customer-visible events for that order. */
  byOrder: Record<number, number>;
  total: number;
}

/** Fetch unread notification counts across all of this customer's orders. */
export async function fetchUnreadOrderNotifications(customerId: string): Promise<OrderNotificationCounts> {
  const { data: orders } = await supabase.from('orders').select('id').eq('user_id', customerId);
  const orderIds = (orders ?? []).map(o => o.id as number);
  if (orderIds.length === 0) return { byOrder: {}, total: 0 };

  const { data: events } = await supabase
    .from('order_tracking_events')
    .select('order_id')
    .in('order_id', orderIds)
    .in('event_type', CUSTOMER_NOTIFICATION_EVENT_TYPES)
    .is('customer_seen_at', null);

  const byOrder: Record<number, number> = {};
  for (const e of events ?? []) {
    const id = e.order_id as number;
    byOrder[id] = (byOrder[id] ?? 0) + 1;
  }
  const total = Object.values(byOrder).reduce((sum, n) => sum + n, 0);
  return { byOrder, total };
}

/** Mark all unread customer-visible events for one order as seen. */
export async function markOrderNotificationsSeen(orderId: number): Promise<void> {
  await supabase
    .from('order_tracking_events')
    .update({ customer_seen_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .in('event_type', CUSTOMER_NOTIFICATION_EVENT_TYPES)
    .is('customer_seen_at', null);
}
