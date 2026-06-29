// Shared vocabulary for the admin Batch Management audit trail
// (server/routes/adminBatchesRouter.ts + supabase/migrations/admin_batch_management.sql).
// Imported by both the frontend (src/) and backend (server/) — see shared/status.ts
// for why cross-directory relative imports are fine here.

export type BatchAdminActionType =
  | 'move_shipment'
  | 'move_shipments_bulk'
  | 'remove_shipment'
  | 'update_estimated_time'
  | 'add_note'
  | 'mark_under_monitoring'
  | 'escalate_manual_intervention'
  | 'resolve_breakdown'
  | 'change_driver';

export type BatchAdminReasonCode =
  | 'load_redistribution'
  | 'vehicle_capacity_issue'
  | 'driver_delay'
  | 'vehicle_breakdown'
  | 'incorrect_initial_allocation'
  | 'delivery_zone_change'
  | 'logistics_center_request'
  | 'other';

export const BATCH_ADMIN_REASON_CODES: { value: BatchAdminReasonCode; label: string }[] = [
  { value: 'load_redistribution',          label: 'إعادة توزيع الحمولة' },
  { value: 'vehicle_capacity_issue',       label: 'مشكلة في سعة المركبة' },
  { value: 'driver_delay',                 label: 'تأخر السائق' },
  { value: 'vehicle_breakdown',            label: 'عطل في المركبة' },
  { value: 'incorrect_initial_allocation', label: 'تخصيص أولي غير صحيح' },
  { value: 'delivery_zone_change',         label: 'تغيير منطقة التوصيل' },
  { value: 'logistics_center_request',     label: 'طلب من مركز اللوجستيات' },
  { value: 'other',                        label: 'سبب آخر' },
];

export type BreakdownResolution =
  | 'shipments_repooled'
  | 'manual_intervention_pending'
  | 'returned_to_warehouse'
  | 'follow_up_required';
