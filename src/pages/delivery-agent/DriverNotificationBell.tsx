import { useState, useEffect } from 'react';
import supabase from '../../lib/supabase';
import { useSharedAuth } from '../../context/AuthContext';

// 'assignment'   → direct offer to an available driver; accept via /accept
// 'next_mission' → offer to an on_route driver; accept via /accept-next-mission to lock immediately
type NotifType = 'assignment' | 'next_mission';

interface PendingBatchNotification {
  notificationId: string;
  batchId: string;
  type: NotifType;
  route: string[];
  shipmentCount: number;
  totalVolume: number;
  isAccepted: boolean;
  // true only when is_accepted=true AND the batch is assigned to *this* driver
  // (distinguishes "I accepted it" from "someone else accepted it")
  assignedToMe: boolean;
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
  const canAcceptAssignment = driverStatus === 'available' || driverStatus === 'on_route';
  const canAcceptNextMission = driverStatus === 'on_route';

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
          const rawType        = (payload.new.type as string) ?? 'assignment';
          const batchId        = payload.new.batch_id as string;
          const notificationId = payload.new.id as string;

          if (rawType === 'addition') {
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

          // Skip internal-only types that don't need a card
          if (rawType === 'next_mission_expired') {
            // Trigger a reload so any pre-existing next_mission card updates
            loadPendingNotifications();
            return;
          }

          const notifType = (rawType === 'next_mission' ? 'next_mission' : 'assignment') as NotifType;

          const { data: batch } = await supabase
            .from('batches').select('route, total_volume, ab_shipment_ids, assigned_to').eq('id', batchId).single();
          if (!batch) return;

          const assignedToMe = (batch.assigned_to as string | null) === rawUser.id;

          setPendingNotifications((prev) => {
            if (prev.some((n) => n.notificationId === notificationId)) return prev;
            setUnreadCount((c) => c + 1);
            return [...prev, {
              notificationId,
              batchId,
              type:          notifType,
              route:         (batch.route as string[]) ?? [],
              shipmentCount: (batch.ab_shipment_ids as string[])?.length ?? 0,
              totalVolume:   batch.total_volume ?? 0,
              isAccepted:    false,
              assignedToMe,
            }];
          });
          setShowNotifPanel(true);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'driver_notifications', filter: `courier_id=eq.${rawUser.id}` },
        async (payload) => {
          const notificationId = payload.new.id as string;
          const isAccepted     = payload.new.is_accepted as boolean;
          const batchId        = payload.new.batch_id as string;

          // When a next_mission notification is marked accepted, resolve whether
          // it was accepted by this driver or by a competitor.
          let assignedToMe = false;
          if (isAccepted) {
            const { data: batch } = await supabase
              .from('batches').select('assigned_to').eq('id', batchId).maybeSingle();
            assignedToMe = (batch?.assigned_to as string | null) === rawUser.id;
          }

          setPendingNotifications((prev) =>
            prev.map((n) =>
              n.notificationId === notificationId
                ? { ...n, isAccepted, assignedToMe }
                : n
            )
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
      .from('driver_notifications')
      .select('id, batch_id, type, is_accepted')
      .eq('courier_id', rawUser.id)
      .in('type', ['assignment', 'next_mission']); // exclude internal types like next_mission_expired

    if (!notifs?.length) return;
    const enriched = await Promise.all(
      notifs.map(async (n) => {
        const { data: batch } = await supabase
          .from('batches').select('route, total_volume, ab_shipment_ids, assigned_to').eq('id', n.batch_id).single();
        const isAccepted   = n.is_accepted as boolean;
        const assignedToMe = isAccepted
          ? (batch?.assigned_to as string | null) === rawUser.id
          : false;
        return {
          notificationId: n.id as string,
          batchId:        n.batch_id as string,
          type:           ((n.type as string) ?? 'assignment') as NotifType,
          route:          (batch?.route as string[]) ?? [],
          shipmentCount:  (batch?.ab_shipment_ids as string[])?.length ?? 0,
          totalVolume:    batch?.total_volume ?? 0,
          isAccepted,
          assignedToMe,
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

  // Accept a direct assignment notification (available drivers only)
  async function handleAcceptBatch(notif: PendingBatchNotification) {
    if (!rawUser?.id) return;
    if (!canAcceptAssignment) {
      window.alert('ابدأ الدوام لتتمكن من قبول المهام.');
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
        await supabase.from('driver_notifications').update({ is_accepted: true }).eq('batch_id', notif.batchId);
        setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
        onBatchAccepted?.();
      } else if (res.status === 409) {
        await supabase.from('driver_notifications').update({ is_accepted: true }).eq('id', notif.notificationId);
        setPendingNotifications((prev) => prev.filter((n) => n.notificationId !== notif.notificationId));
      } else {
        window.alert(json.message ?? 'تعذر قبول الدفعة');
      }
    } catch {
      window.alert('تعذر الاتصال بالخادم');
    }
  }

  // Accept a next_mission notification (on_route drivers only).
  // Calls /accept-next-mission which atomically locks the batch immediately.
  async function handleAcceptNextMission(notif: PendingBatchNotification) {
    if (!rawUser?.id) return;
    if (!canAcceptNextMission) {
      window.alert('يمكن حجز المهمة القادمة فقط أثناء تنفيذ مهمة حالية.');
      return;
    }
    try {
      const res = await fetch('/api/logistics/accept-next-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: notif.batchId, courier_id: rawUser.id }),
      });
      const json = await res.json();

      if (json.success) {
        // The server already expired all other notifications for this batch.
        // Update local state to show "confirmed" for this card.
        setPendingNotifications((prev) =>
          prev.map((n) =>
            n.notificationId === notif.notificationId
              ? { ...n, isAccepted: true, assignedToMe: true }
              : n
          )
        );
        onBatchAccepted?.();
      } else if (res.status === 409) {
        // Another driver locked it first
        setPendingNotifications((prev) =>
          prev.map((n) =>
            n.notificationId === notif.notificationId
              ? { ...n, isAccepted: true, assignedToMe: false }
              : n
          )
        );
      } else {
        window.alert(json.message ?? 'تعذر حجز المهمة القادمة');
      }
    } catch {
      window.alert('تعذر الاتصال بالخادم');
    }
  }

  async function handleDeclineNotification(notifId: string, courierId: string) {
    try {
      await fetch('/api/logistics/decline-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: notifId, courier_id: courierId }),
      });
    } catch {
      // best-effort — remove from UI regardless
    }
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
                  {new Date(msg.created_at).toLocaleDateString('ar-EG-u-nu-latn', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {pendingNotifications.length === 0 && additionAlerts.length === 0 && adminMessages.length === 0 && (
            <p className="dd-notif-panel-empty">لا توجد إشعارات</p>
          )}

          {[...pendingNotifications].reverse().map((notif) => {
            const isNextMission = notif.type === 'next_mission';

            return (
              <div
                key={notif.notificationId}
                className="dd-notif-panel-item"
                style={isNextMission ? { borderRight: '3px solid #7C3AED' } : undefined}
              >
                <div className="dd-notif-panel-icon" style={isNextMission ? { color: '#7C3AED' } : undefined}>
                  <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8l4 2v5h-4V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                  </svg>
                </div>
                <div className="dd-notif-panel-body">
                  {/* Title differs by type */}
                  <p className="dd-notif-panel-title" style={isNextMission ? { color: '#7C3AED' } : undefined}>
                    {isNextMission ? 'مهمة قادمة' : 'طلب توصيل جديد'}
                  </p>
                  <p className="dd-notif-panel-route">{notif.route.join(' ← ')}</p>
                  <p className="dd-notif-panel-meta">{notif.shipmentCount} شحنة · {notif.totalVolume.toFixed(0)} وحدة</p>

                  {/* Context hint for drivers who can't act */}
                  {!notif.isAccepted && isNextMission && !canAcceptNextMission && (
                    <p className="dd-notif-panel-meta" style={{ color: '#dc2626' }}>
                      {driverStatus === 'available' ? 'هذا العرض مخصص للسائقين في رحلة حالية' : 'ابدأ الدوام أولاً'}
                    </p>
                  )}
                  {!notif.isAccepted && !isNextMission && !canAcceptAssignment && (
                    <p className="dd-notif-panel-meta" style={{ color: '#dc2626' }}>
                      ابدأ الدوام أولاً
                    </p>
                  )}

                  <div className="dd-notif-panel-actions">
                    {notif.isAccepted ? (
                      notif.assignedToMe ? (
                        // This driver won the next mission — show confirmation
                        <span className="dd-notif-taken" style={{ color: '#7C3AED', fontWeight: 600 }}>
                          ✓ محجوزة لك — مهمة قادمة
                        </span>
                      ) : (
                        // Another driver accepted it
                        <span className="dd-notif-taken">
                          {isNextMission ? 'انتهت صلاحية العرض' : 'تم القبول من سائق آخر'}
                        </span>
                      )
                    ) : isNextMission ? (
                      // Next mission: reserve button (on_route only)
                      <>
                        <button
                          className="dd-notif-btn accept"
                          style={{ background: '#7C3AED', borderColor: '#7C3AED' }}
                          disabled={!canAcceptNextMission}
                          onClick={() => handleAcceptNextMission(notif)}
                        >
                          حجز المهمة القادمة
                        </button>
                        <button
                          className="dd-notif-btn decline"
                          onClick={() => handleDeclineNotification(notif.notificationId, rawUser!.id)}
                        >
                          رفض
                        </button>
                      </>
                    ) : (
                      // Regular assignment: accept/decline (available only)
                      <>
                        <button
                          className="dd-notif-btn accept"
                          disabled={!canAcceptAssignment}
                          onClick={() => handleAcceptBatch(notif)}
                        >
                          قبول
                        </button>
                        <button
                          className="dd-notif-btn decline"
                          onClick={() => handleDeclineNotification(notif.notificationId, rawUser!.id)}
                        >
                          رفض
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
