import { supabase } from '../supabase.js';

export type EndReason = 'manual' | 'breakdown' | 'admin_closed' | 'auto_closed';

export interface WorkSessionRow {
  id: string;
  courier_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  active_delivery_minutes: number | null;
  available_waiting_minutes: number | null;
  status: 'active' | 'completed';
  end_reason: EndReason | null;
}

export interface DeliverySessionRow {
  id: string;
  courier_id: string;
  batch_id: string;
  work_session_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  status: 'active' | 'completed' | 'cancelled';
}

function minutesBetween(startIso: string, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - new Date(startIso).getTime()) / 60_000));
}

export async function getActiveWorkSession(courierId: string): Promise<WorkSessionRow | null> {
  const { data } = await supabase
    .from('courier_work_sessions')
    .select('*')
    .eq('courier_id', courierId)
    .eq('status', 'active')
    .maybeSingle();
  return (data as WorkSessionRow | null) ?? null;
}

export async function getActiveDeliverySession(courierId: string): Promise<DeliverySessionRow | null> {
  const { data } = await supabase
    .from('courier_delivery_sessions')
    .select('*')
    .eq('courier_id', courierId)
    .eq('status', 'active')
    .maybeSingle();
  return (data as DeliverySessionRow | null) ?? null;
}

// â”€â”€ POST /start-work â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Driver clicks "Start Work": offline -> available, opens the shift clock.
export async function startWork(
  courierId: string,
): Promise<{ success: true; session: WorkSessionRow } | { success: false; error: string }> {
  const { data: courier } = await supabase
    .from('couriers').select('status').eq('id', courierId).maybeSingle();

  if (!courier) return { success: false, error: 'لم يتم العثور على السائق' };
  if (courier.status !== 'offline') {
    return { success: false, error: 'يجب أن تكون خارج الدوام لتتمكن من بدء الدوام' };
  }

  const existing = await getActiveWorkSession(courierId);
  if (existing) {
    return { success: false, error: 'يوجد دوام نشط بالفعل' };
  }

  const { data: session, error } = await supabase
    .from('courier_work_sessions')
    .insert({ courier_id: courierId, status: 'active' })
    .select('*')
    .single();

  if (error || !session) {
    return { success: false, error: error?.message ?? 'Failed to start work session' };
  }

  await supabase.from('couriers').update({ status: 'available' }).eq('id', courierId);

  return { success: true, session: session as WorkSessionRow };
}

interface CloseSummary {
  duration_minutes: number;
  active_delivery_minutes: number;
  available_waiting_minutes: number;
}

// Closes whatever active work session the courier has (if any), tallying up the
// active-delivery time from their completed delivery sessions inside it. Shared by
// the manual "End Work" flow and the forced breakdown closeout.
async function closeActiveWorkSession(
  courierId: string,
  endReason: EndReason,
): Promise<CloseSummary | null> {
  const session = await getActiveWorkSession(courierId);
  if (!session) return null;

  const now = new Date();
  const duration_minutes = minutesBetween(session.started_at, now);

  const { data: deliverySessions } = await supabase
    .from('courier_delivery_sessions')
    .select('duration_minutes')
    .eq('work_session_id', session.id)
    .eq('status', 'completed');

  const active_delivery_minutes = (deliverySessions ?? [])
    .reduce((sum, d) => sum + ((d.duration_minutes as number) ?? 0), 0);

  const available_waiting_minutes = Math.max(0, duration_minutes - active_delivery_minutes);

  await supabase
    .from('courier_work_sessions')
    .update({
      ended_at: now.toISOString(),
      duration_minutes,
      active_delivery_minutes,
      available_waiting_minutes,
      status: 'completed',
      end_reason: endReason,
    })
    .eq('id', session.id);

  return { duration_minutes, active_delivery_minutes, available_waiting_minutes };
}

// â”€â”€ POST /end-work â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Driver clicks "End Work": available -> offline, closes the shift clock.
export async function endWork(
  courierId: string,
): Promise<{ success: true; summary: CloseSummary } | { success: false; error: string }> {
  const { data: courier } = await supabase
    .from('couriers').select('status').eq('id', courierId).maybeSingle();

  if (!courier) return { success: false, error: 'لم يتم العثور على السائق' };
  if (courier.status === 'on_route') {
    return { success: false, error: 'لا يمكن إنهاء الدوام أثناء تنفيذ مهمة توصيل' };
  }

  const { count: activeBatches } = await supabase
    .from('batches')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', courierId)
    .in('status', ['assigned', 'in_transit']);

  if (activeBatches && activeBatches > 0) {
    return { success: false, error: 'لا يمكن إنهاء الدوام ولديك دفعة قيد التنفيذ' };
  }

  const summary = await closeActiveWorkSession(courierId, 'manual');
  if (!summary) {
    return { success: false, error: 'لا يوجد دوام نشط لإنهائه' };
  }

  await supabase.from('couriers').update({ status: 'offline' }).eq('id', courierId);

  return { success: true, summary };
}

// â”€â”€ Batch lifecycle hooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// "Start Batch": opens the active-delivery clock, tied to the courier's current shift.
export async function startDeliverySession(courierId: string, batchId: string): Promise<void> {
  const session = await getActiveWorkSession(courierId);
  await supabase.from('courier_delivery_sessions').insert({
    courier_id: courierId,
    batch_id: batchId,
    work_session_id: session?.id ?? null,
    status: 'active',
  });
}

// Batch completed normally: close its delivery session as 'completed'.
export async function completeDeliverySession(courierId: string, batchId: string): Promise<void> {
  const { data: session } = await supabase
    .from('courier_delivery_sessions')
    .select('id, started_at')
    .eq('courier_id', courierId)
    .eq('batch_id', batchId)
    .eq('status', 'active')
    .maybeSingle();

  if (!session) return;

  const duration_minutes = minutesBetween(session.started_at as string, new Date());

  await supabase
    .from('courier_delivery_sessions')
    .update({ ended_at: new Date().toISOString(), duration_minutes, status: 'completed' })
    .eq('id', session.id);
}

// Breakdown: cancel the delivery session and force-close the courier's shift.
export async function cancelDeliverySessionAndCloseWork(courierId: string, batchId: string): Promise<void> {
  const { data: session } = await supabase
    .from('courier_delivery_sessions')
    .select('id, started_at')
    .eq('courier_id', courierId)
    .eq('batch_id', batchId)
    .eq('status', 'active')
    .maybeSingle();

  if (session) {
    const duration_minutes = minutesBetween(session.started_at as string, new Date());
    await supabase
      .from('courier_delivery_sessions')
      .update({ ended_at: new Date().toISOString(), duration_minutes, status: 'cancelled' })
      .eq('id', session.id);
  }

  await closeActiveWorkSession(courierId, 'breakdown');
}

// â”€â”€ GET /work-summary/today â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface TodaySummary {
  status: 'available' | 'on_route' | 'offline';
  activeWorkSession: { id: string; startedAt: string } | null;
  activeDeliverySession: { id: string; batchId: string; startedAt: string } | null;
  totalDutyMinutesToday: number;
  activeDeliveryMinutesToday: number;
  availableWaitingMinutesToday: number;
  completedBatchesToday: number;
  activeBatch: { id: string; batchNumber: string; status: string; route: string[] } | null;
}

export async function getTodaySummary(courierId: string): Promise<TodaySummary | null> {
  const { data: courier } = await supabase
    .from('couriers').select('status').eq('id', courierId).maybeSingle();
  if (!courier) return null;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const [activeWorkSession, activeDeliverySession] = await Promise.all([
    getActiveWorkSession(courierId),
    getActiveDeliverySession(courierId),
  ]);

  // Completed work sessions that started today.
  const { data: completedWorkToday } = await supabase
    .from('courier_work_sessions')
    .select('duration_minutes')
    .eq('courier_id', courierId)
    .eq('status', 'completed')
    .gte('started_at', startOfToday.toISOString());

  let totalDutyMinutesToday = (completedWorkToday ?? [])
    .reduce((sum, s) => sum + ((s.duration_minutes as number) ?? 0), 0);

  if (activeWorkSession) {
    const liveStart = new Date(Math.max(new Date(activeWorkSession.started_at).getTime(), startOfToday.getTime()));
    totalDutyMinutesToday += minutesBetween(liveStart.toISOString(), now);
  }

  // Completed delivery sessions that ended today.
  const { data: completedDeliveryToday } = await supabase
    .from('courier_delivery_sessions')
    .select('duration_minutes')
    .eq('courier_id', courierId)
    .eq('status', 'completed')
    .gte('ended_at', startOfToday.toISOString());

  let activeDeliveryMinutesToday = (completedDeliveryToday ?? [])
    .reduce((sum, s) => sum + ((s.duration_minutes as number) ?? 0), 0);

  if (activeDeliverySession) {
    const liveStart = new Date(Math.max(new Date(activeDeliverySession.started_at).getTime(), startOfToday.getTime()));
    activeDeliveryMinutesToday += minutesBetween(liveStart.toISOString(), now);
  }

  const availableWaitingMinutesToday = Math.max(0, totalDutyMinutesToday - activeDeliveryMinutesToday);

  const { count: completedBatchesToday } = await supabase
    .from('courier_delivery_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('courier_id', courierId)
    .eq('status', 'completed')
    .gte('ended_at', startOfToday.toISOString());

  const { data: activeBatchRow } = await supabase
    .from('batches')
    .select('id, batch_number, status, route')
    .eq('assigned_to', courierId)
    .in('status', ['assigned', 'in_transit'])
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    status: courier.status as TodaySummary['status'],
    activeWorkSession: activeWorkSession
      ? { id: activeWorkSession.id, startedAt: activeWorkSession.started_at }
      : null,
    activeDeliverySession: activeDeliverySession
      ? { id: activeDeliverySession.id, batchId: activeDeliverySession.batch_id, startedAt: activeDeliverySession.started_at }
      : null,
    totalDutyMinutesToday,
    activeDeliveryMinutesToday,
    availableWaitingMinutesToday,
    completedBatchesToday: completedBatchesToday ?? 0,
    activeBatch: activeBatchRow
      ? {
          id: activeBatchRow.id as string,
          batchNumber: (activeBatchRow.batch_number as string) ?? '',
          status: activeBatchRow.status as string,
          route: (activeBatchRow.route as string[]) ?? [],
        }
      : null,
  };
}

// â”€â”€ GET /work-summary/history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// One row per calendar day in the given month (سجل ساعات العمل). Days with no
// work session show worked=false so the UI can render dashes instead of "0".
const WEEKDAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export interface DayHistoryEntry {
  date: string; // YYYY-MM-DD
  day: number;
  weekday: string;
  totalDutyMinutes: number;
  activeDeliveryMinutes: number;
  availableWaitingMinutes: number;
  completedBatches: number;
  worked: boolean;
}

export interface MonthlyHistory {
  year: number;
  month: number; // 1-12
  days: DayHistoryEntry[];
}

export async function getMonthlyHistory(courierId: string, year: number, month: number): Promise<MonthlyHistory> {
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 1, 0, 0, 0, 0); // exclusive
  const daysInMonth = new Date(year, month, 0).getDate();

  const [{ data: workRows }, { data: deliveryRows }] = await Promise.all([
    supabase
      .from('courier_work_sessions')
      .select('started_at, duration_minutes')
      .eq('courier_id', courierId)
      .eq('status', 'completed')
      .gte('started_at', monthStart.toISOString())
      .lt('started_at', monthEnd.toISOString()),
    supabase
      .from('courier_delivery_sessions')
      .select('ended_at, duration_minutes')
      .eq('courier_id', courierId)
      .eq('status', 'completed')
      .gte('ended_at', monthStart.toISOString())
      .lt('ended_at', monthEnd.toISOString()),
  ]);

  const totalDutyByDay = new Map<number, number>();
  const workedDays = new Set<number>();
  for (const row of workRows ?? []) {
    const day = new Date(row.started_at as string).getDate();
    totalDutyByDay.set(day, (totalDutyByDay.get(day) ?? 0) + ((row.duration_minutes as number) ?? 0));
    workedDays.add(day);
  }

  const activeDeliveryByDay = new Map<number, number>();
  const completedBatchesByDay = new Map<number, number>();
  for (const row of deliveryRows ?? []) {
    const day = new Date(row.ended_at as string).getDate();
    activeDeliveryByDay.set(day, (activeDeliveryByDay.get(day) ?? 0) + ((row.duration_minutes as number) ?? 0));
    completedBatchesByDay.set(day, (completedBatchesByDay.get(day) ?? 0) + 1);
  }

  // Fold in live (in-progress) time for today, if this is the current month.
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month - 1;
  if (isCurrentMonth) {
    const [activeWorkSession, activeDeliverySession] = await Promise.all([
      getActiveWorkSession(courierId),
      getActiveDeliverySession(courierId),
    ]);
    const today = now.getDate();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    if (activeWorkSession) {
      const liveStart = new Date(Math.max(new Date(activeWorkSession.started_at).getTime(), startOfToday.getTime()));
      totalDutyByDay.set(today, (totalDutyByDay.get(today) ?? 0) + minutesBetween(liveStart.toISOString(), now));
      workedDays.add(today);
    }
    if (activeDeliverySession) {
      const liveStart = new Date(Math.max(new Date(activeDeliverySession.started_at).getTime(), startOfToday.getTime()));
      activeDeliveryByDay.set(today, (activeDeliveryByDay.get(today) ?? 0) + minutesBetween(liveStart.toISOString(), now));
    }
  }

  const days: DayHistoryEntry[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const totalDutyMinutes = totalDutyByDay.get(day) ?? 0;
    const activeDeliveryMinutes = activeDeliveryByDay.get(day) ?? 0;
    days.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      weekday: WEEKDAYS_AR[date.getDay()],
      totalDutyMinutes,
      activeDeliveryMinutes,
      availableWaitingMinutes: Math.max(0, totalDutyMinutes - activeDeliveryMinutes),
      completedBatches: completedBatchesByDay.get(day) ?? 0,
      worked: workedDays.has(day),
    });
  }

  return { year, month, days };
}

// ── Admin dashboard: today's duty/delivery/waiting minutes for many couriers ──
// Lightweight — only the three numbers the "نشاط جيد / وقت انتظار مرتفع" badge
// needs (operational monitoring only, not payroll). One pass over today's
// completed sessions for all requested couriers, plus their live (still-active)
// session if any, grouped in memory instead of N per-courier round trips.
export interface CourierTodayMinutes {
  totalDutyMinutes: number;
  activeDeliveryMinutes: number;
  availableWaitingMinutes: number;
}

export async function getTodaySummaryBulk(
  courierIds: string[],
): Promise<Map<string, CourierTodayMinutes>> {
  const result = new Map<string, CourierTodayMinutes>();
  if (!courierIds.length) return result;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const dutyByCourier = new Map<string, number>();
  const deliveryByCourier = new Map<string, number>();

  const [{ data: completedWork }, { data: activeWork }, { data: completedDelivery }, { data: activeDelivery }] =
    await Promise.all([
      supabase
        .from('courier_work_sessions')
        .select('courier_id, duration_minutes')
        .in('courier_id', courierIds)
        .eq('status', 'completed')
        .gte('started_at', startOfToday.toISOString()),
      supabase
        .from('courier_work_sessions')
        .select('courier_id, started_at')
        .in('courier_id', courierIds)
        .eq('status', 'active'),
      supabase
        .from('courier_delivery_sessions')
        .select('courier_id, duration_minutes')
        .in('courier_id', courierIds)
        .eq('status', 'completed')
        .gte('ended_at', startOfToday.toISOString()),
      supabase
        .from('courier_delivery_sessions')
        .select('courier_id, started_at')
        .in('courier_id', courierIds)
        .eq('status', 'active'),
    ]);

  for (const row of completedWork ?? []) {
    const id = row.courier_id as string;
    dutyByCourier.set(id, (dutyByCourier.get(id) ?? 0) + ((row.duration_minutes as number) ?? 0));
  }
  for (const row of activeWork ?? []) {
    const id = row.courier_id as string;
    const liveStart = new Date(Math.max(new Date(row.started_at as string).getTime(), startOfToday.getTime()));
    dutyByCourier.set(id, (dutyByCourier.get(id) ?? 0) + minutesBetween(liveStart.toISOString(), now));
  }
  for (const row of completedDelivery ?? []) {
    const id = row.courier_id as string;
    deliveryByCourier.set(id, (deliveryByCourier.get(id) ?? 0) + ((row.duration_minutes as number) ?? 0));
  }
  for (const row of activeDelivery ?? []) {
    const id = row.courier_id as string;
    const liveStart = new Date(Math.max(new Date(row.started_at as string).getTime(), startOfToday.getTime()));
    deliveryByCourier.set(id, (deliveryByCourier.get(id) ?? 0) + minutesBetween(liveStart.toISOString(), now));
  }

  for (const id of courierIds) {
    const totalDutyMinutes = dutyByCourier.get(id) ?? 0;
    const activeDeliveryMinutes = deliveryByCourier.get(id) ?? 0;
    result.set(id, {
      totalDutyMinutes,
      activeDeliveryMinutes,
      availableWaitingMinutes: Math.max(0, totalDutyMinutes - activeDeliveryMinutes),
    });
  }

  return result;
}
