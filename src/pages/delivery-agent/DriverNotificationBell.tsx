import { useState, useEffect } from 'react';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';

interface PendingBatchNotification {
  notificationId: string;
  batchId: string;
  route: string[];
  shipmentCount: number;
  totalVolume: number;
  isAccepted: boolean;
}

interface AdminMessage {
  id: string;
  subject: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
}

interface DriverNotificationBellProps {
  driverStatus?: 'available' | 'on_route' | 'offline';
  onBatchAccepted?: () => void;
}

export default function DriverNotificationBell({ driverStatus, onBatchAccepted }: DriverNotificationBellProps) {
  const { rawUser } = useSharedAuth();
  const canAccept = driverStatus === 'available';

  const [pendingNotifications, setPendingNotifications] = useState<PendingBatchNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel]             = useState(false);
  const [unreadCount, setUnreadCount]                   = useState(0);
  const [additionAlerts, setAdditionAlerts]             = useState<{ batchId: string; batchNumber: string; oldVolume: number; newVolume: number; addedCount?: number }[]>([]);
  const [adminMessages, setAdminMessages]               = useState<AdminMessage[]>([]);
  const [unreadMsgCount, setUnreadMsgCount]             = useState(0);

  useEffect(() => {
    if (!rawUser) return;
    loadPendingNotifications();
    loadAdminMessages();
  }, [rawUser?.id]);

  // Batch assignment realtime
  useEffect(() => {
    if (!rawUser?.id) return;
    const channel = supabase
      .channel('driver-notif-bell-' + rawUser.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'driver_notifications', filter: `courier_id=eq.${rawUser.id}` },
        async (payload) => {
          const notifType      = (payload.new.type as string) ?? 'assignment';
          const batchId        = payload.new.batch_id as string;
          const notificationId = payload.new.id as string;

          if (notifType === 'addition') {
            const { data: batch } = await supabase
              .from('batches').select('batch_number, total_volume, bc_shipment_ids').eq('id', batchId).single();
            if (!batch) return;
            const newCount = (batch.bc_shipment_ids as string[])?.length ?? 0;
            setAdditionAlerts((prev) => [...prev, {
              batchId,
              batchNumber: (batch.batch_number as string) ?? '',
              oldVolume:  0,
              newVolume:  batch.total_volume ?? 0,
              addedCount: newCount,
            }]);
            setUnreadCount((c) => c + 1);
            setShowNotifPanel(true);
            return;
          }

          const { data: batch } = await supabase
            .from('batches').select('route, total_volume, ab_shipment_ids').eq('id', batchId).single();
          if (!batch) return;
          setPendingNotifications((prev) => {
            if (prev.some((n) => n.notificationId === notificationId)) return prev;
            setUnreadCount((c) => c + 1);
            return [...prev, {
              notificationId, batchId,
              route:         (batch.route as string[]) ?? [],
              shipmentCount: (batch.ab_shipment_ids as string[])?.length ?? 0,
              totalVolume:   batch.total_volume ?? 0,
              isAccepted:    false,
            }];
          });
          setShowNotifPanel(true);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'driver_notifications', filter: `courier_id=eq.${rawUser.id}` },
        (payload) => {
          const notificationId = payload.new.id as string;
          const isAccepted     = payload.new.is_accepted as boolean;
          setPendingNotifications((prev) =>
            prev.map((n) => n.notificationId === notificationId ? { ...n, isAccepted } : n)
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rawUser?.id]);

  // Admin messages realtime
  useEffect(() => {
    if (!rawUser?.id) return;
    const ch = supabase
      .channel('driver-admin-msgs-' + rawUser.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_messages', filter: `recipient_id=eq.${rawUser.id}` },
        (payload) => {
          const msg = payload.new as AdminMessage;
          setAdminMessages(prev => [msg, ...prev]);
          setUnreadMsgCount(c => c + 1);
          setShowNotifPanel(true);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rawUser?.id]);

  async function loadPendingNotifications() {
    if (!rawUser?.id) return;
    const { data: notifs } = await supabase
      .from('driver_notifications').select('id, batch_id, is_accepted').eq('courier_id', rawUser.id);
    if (!notifs?.length) return;
    const enriched = await Promise.all(
      notifs.map(async (n) => {
        const { data: batch } = await supabase
          .from('batches').select('route, total_volume, ab_shipment_ids').eq('id', n.batch_id).single();
        return {
          notificationId: n.id as string,
          batchId:        n.batch_id as string,
          route:          (batch?.route as string[]) ?? [],
          shipmentCount:  (batch?.ab_shipment_ids as string[])?.length ?? 0,
          totalVolume:    batch?.total_volume ?? 0,
          isAccepted:     n.is_accepted as boolean,
        };
      })
    );
    setPendingNotifications(enriched);
    const seenIds: string[] = JSON.parse(localStorage.getItem(`dd_seen_notifs_${rawUser.id}`) ?? '[]');
    const seenSet = new Set(seenIds);
    setUnreadCount(enriched.filter((n) => !seenSet.has(n.notificationId)).length);
  }

  async function loadAdminMessages() {
    if (!rawUser?.id) return;
    const { data } = await supabase
      .from('admin_messages')
      .select('id, subject, body, created_at, read_at')
      .eq('recipient_id', rawUser.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data) return;
    setAdminMessages(data as AdminMessage[]);
    setUnreadMsgCount(data.filter((m: AdminMessage) => !m.read_at).length);
  }

  async function markMessagesRead(ids: string[]) {
    if (!ids.length) return;
    await supabase
      .from('admin_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);
    setAdminMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, read_at: new Date().toISOString() } : m));
    setUnreadMsgCount(0);
  }

  async function handleAcceptBatch(notif: PendingBatchNotification) {
    if (!rawUser?.id) return;
    if (!canAccept) {
      window.alert(
        driverStatus === 'on_route'
          ? 'أنهِ المهمة الحالية قبل قبول مهمة جديدة.'
          : 'ابدأ الدوام لتتمكن من قبول المهام.'
      );
      return;
    }
    try {
      const res = await fetch('/api/logistics/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: notif.batchId, courier_id: rawUser.id }),
      });
      const json = await res.json();

      if (json.success) {
        // Won the batch — flip every other driver's notification so they see it's taken.
        await supabase.from('driver_notifications').update({ is_accepted: true }).eq('batch_id', notif.batchId);
        setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
        onBatchAccepted?.();
      } else if (res.status === 409) {
        // Someone else already claimed it.
        await supabase.from('driver_notifications').update({ is_accepted: true }).eq('id', notif.notificationId);
        setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
      } else {
        // Not eligible (e.g. already on_route on another batch) — leave the offer pending.
        window.alert(json.message ?? 'تعذر قبول الدفعة');
      }
    } catch {
      window.alert('تعذر الاتصال بالخادم');
    }
  }

  async function handleDeclineBatch(notifId: string) {
    await supabase.from('driver_notifications').delete().eq('id', notifId);
    setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notifId));
  }

  const totalUnread = unreadCount + unreadMsgCount;

  function handleOpenPanel() {
    setShowNotifPanel((v) => !v);
    setUnreadCount(0);
    if (rawUser?.id) {
      const ids = pendingNotifications.map((n) => n.notificationId);
      localStorage.setItem(`dd_seen_notifs_${rawUser.id}`, JSON.stringify(ids));
    }
    // Mark unread admin messages as read when panel opens
    const unreadIds = adminMessages.filter(m => !m.read_at).map(m => m.id);
    if (unreadIds.length) markMessagesRead(unreadIds);
  }

  return (
    <div className="dd-notif-bell-wrap">
      <button
        type="button"
        className="dd-topbar-bell"
        aria-label="الإشعارات"
        onClick={handleOpenPanel}
      >
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {totalUnread > 0 && (
          <span className="dd-notif-dot">{totalUnread}</span>
        )}
      </button>

      {showNotifPanel && (
        <div className="dd-notif-panel">
          <div className="dd-notif-panel-header">
            الإشعارات
          </div>

          {[...additionAlerts].reverse().map((alert, i) => (
            <div key={`add-${alert.batchId}-${i}`} className="dd-notif-panel-item" style={{ borderRight: '3px solid #15803D' }}>
              <div className="dd-notif-panel-icon" style={{ color: '#15803D' }}>
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7-7 7 7" />
                </svg>
              </div>
              <div className="dd-notif-panel-body">
                <p className="dd-notif-panel-title" style={{ color: '#15803D' }}>تمت إضافة شحنات لمسارك</p>
                <p className="dd-notif-panel-meta">
                  {alert.addedCount != null ? `تمت إضافة ${alert.addedCount} شحنة جديدة` : 'تمت إضافة شحنة جديدة'}
                </p>
                <p className="dd-notif-panel-meta" style={{ fontSize: 11, color: '#64748B' }}>
                  التجميعة: {alert.batchNumber}
                </p>
                <button
                  className="dd-notif-btn accept"
                  style={{ marginTop: 4 }}
                  onClick={() => setAdditionAlerts(prev => prev.filter((_, j) => j !== i))}
                >
                  حسناً
                </button>
              </div>
            </div>
          ))}

          {/* Admin messages (most recent 3) */}
          {adminMessages.slice(0, 3).map(msg => (
            <div key={msg.id} className="dd-notif-panel-item" style={{ borderRight: `3px solid ${msg.read_at ? '#E2E8F0' : '#2563eb'}` }}>
              <div className="dd-notif-panel-icon" style={{ color: msg.read_at ? '#94A3B8' : '#2563eb' }}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div className="dd-notif-panel-body">
                <p className="dd-notif-panel-title" style={{ color: '#0F2B4E' }}>{msg.subject}</p>
                {msg.body && (
                  <p className="dd-notif-panel-meta" style={{ whiteSpace: 'pre-line', color: '#475569' }}>
                    {msg.body.length > 80 ? msg.body.slice(0, 80) + '...' : msg.body}
                  </p>
                )}
                <p className="dd-notif-panel-meta" style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
                  {new Date(msg.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {pendingNotifications.length === 0 && additionAlerts.length === 0 && adminMessages.length === 0 && (
            <p className="dd-notif-panel-empty">لا توجد إشعارات</p>
          )}

          {[...pendingNotifications].reverse().map((notif) => (
            <div key={notif.notificationId} className="dd-notif-panel-item">
              <div className="dd-notif-panel-icon">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8l4 2v5h-4V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
              </div>
              <div className="dd-notif-panel-body">
                <p className="dd-notif-panel-title">طلب توصيل جديد</p>
                <p className="dd-notif-panel-route">{notif.route.join(' ← ')}</p>
                <p className="dd-notif-panel-meta">{notif.shipmentCount} شحنة · {notif.totalVolume.toFixed(0)} وحدة</p>
                {!canAccept && !notif.isAccepted && (
                  <p className="dd-notif-panel-meta" style={{ color: '#dc2626' }}>
                    {driverStatus === 'on_route' ? 'أنهِ المهمة الحالية أولاً' : 'ابدأ الدوام أولاً'}
                  </p>
                )}
                <div className="dd-notif-panel-actions">
                  {notif.isAccepted ? (
                    <span className="dd-notif-taken">تم القبول من سائق آخر</span>
                  ) : (
                    <>
                      <button className="dd-notif-btn accept" disabled={!canAccept} onClick={() => handleAcceptBatch(notif)}>قبول</button>
                      <button className="dd-notif-btn decline" onClick={() => handleDeclineBatch(notif.notificationId)}>رفض</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
