import supabase from './supabase';
import type { BatchAdminReasonCode } from '../../shared/batchAdminActions';
export { BATCH_ADMIN_REASON_CODES } from '../../shared/batchAdminActions';
export type { BatchAdminReasonCode } from '../../shared/batchAdminActions';

/**
 * Admin client helpers for "Batch Management" (server/routes/adminBatchesRouter.ts,
 * behind requireAdmin). Mirrors the Bearer-token pattern in src/lib/deliveryIssues.ts.
 */

export interface AdminBatchListRow {
  id: string;
  batch_number: string;
  status: string;
  route: string[];
  zone: string | null;
  total_volume: number;
  max_volume: number;
  max_stops: number;
  reserved_until: string | null;
  needs_dispatcher: boolean;
  estimated_minutes_to_next_zone: number | null;
  stops_used: number;
  shipment_count: number;
  picked_up_count: number;
  not_picked_up_count: number;
  delivered_count: number;
  stranded_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expected_completion_at: string | null;
  courier: { id: string; name: string; status: string } | null;
  creation_source: 'system' | 'admin';
  is_delayed: boolean;
  delay_minutes: number;
  delay_reason: string | null;
  delay_reported_at: string | null;
  delay_reported_by: string | null;
  under_monitoring: boolean;
  requires_manual_intervention: boolean;
  has_active_breakdown: boolean;
  breakdown_reported_at: string | null;
  breakdown_reason: string | null;
  breakdown_resolved_at: string | null;
}

export interface AdminBatchFilters {
  status?: string;
  driver_id?: string;
  zone?: string;
  delayed?: 'true' | 'lt1h' | 'gt1h' | 'severe' | 'with_reason' | 'without_reason';
  breakdown?: 'true';
  created_manually?: 'true';
  date_from?: string;
  date_to?: string;
  q?: string;
  archived?: 'true';
}

export interface AdminShipmentDetail {
  id: string;
  shipment_number: string;
  status: string;
  order_id: number | null;
  merchant_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  pickup_zone: string;
  dropoff_zone: string;
  pickup_lat: number; pickup_lng: number;
  dropoff_lat: number; dropoff_lng: number;
  volume: number;
  deadline: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  leg: 'ab' | 'bc';
  not_picked_up: boolean;
  in_driver_custody: boolean;
  delivered: boolean;
  requires_manual_handling: boolean;
  previous_batch: { id: string; batch_number: string | null } | null;
}

export interface AdminBatchDetail {
  id: string;
  batch_number: string;
  status: string;
  route: string[];
  total_volume: number;
  max_volume: number;
  max_stops: number;
  remaining_capacity: number;
  creation_source: 'system' | 'admin';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  assigned_at: string | null;
  expected_completion_at: string | null;
  reserved_until: string | null;
  courier: { id: string; name: string; status: string; location: { lat: number; lng: number } | null; max_volume: number } | null;
  delay_reported_at: string | null;
  delay_reason: string | null;
  delay_reported_by: string | null;
  under_monitoring: boolean;
  requires_manual_intervention: boolean;
  breakdown_reported_at: string | null;
  breakdown_reason: string | null;
  breakdown_location: { lat: number; lng: number } | null;
  breakdown_resolved_at: string | null;
  breakdown_resolution: string | null;
}

export interface AuditLogEntry {
  id: number;
  batch_id: string;
  shipment_id: string | null;
  action_type: string;
  from_batch_id: string | null;
  to_batch_id: string | null;
  previous_status: string | null;
  new_status: string | null;
  reason_code: string | null;
  reason: string | null;
  notes: string | null;
  performed_by: string;
  performed_by_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface BreakdownCase {
  id: string;
  batch_number: string;
  status: string;
  route: string[];
  courier: { id: string; name: string; location: { lat: number; lng: number } | null } | null;
  breakdown_reported_at: string;
  breakdown_reason: string | null;
  breakdown_location: { lat: number; lng: number } | null;
  breakdown_resolved_at: string | null;
  breakdown_resolution: string | null;
  requires_manual_intervention: boolean;
  not_picked_up: number;
  stranded: { id: string; shipment_number: string }[];
  is_active: boolean;
}

export interface RedistributionDestination {
  id: string;
  batch_number: string;
  status: string;
  route: string[];
  courier_name: string | null;
  total_volume: number;
  max_volume: number;
  capacity_after: number;
  stops_used: number;
  stops_after: number;
  max_stops: number;
  match_type: 'exact_zone' | 'distance_based' | null;
  distance_km: number | null;
  eligible: boolean;
  blocked_reasons: string[];
}

export interface RedistributionGroup {
  pickup_zone: string | null;
  dropoff_zone: string;
  source: 'store' | 'driver' | 'breakdown' | 'unknown';
  location_available: boolean;
  shipment_ids: string[];
  total_volume: number;
  eligible_destinations: RedistributionDestination[];
  can_create_new_batch: boolean;
  suggested_route: string[] | null;
}

export interface RedistributeOperationResult {
  shipment_ids: string[];
  destination_batch_id?: string;
  success: boolean;
  error_code?: string;
  moved_volume?: number;
  batch_id?: string;
  total_volume?: number;
}

interface ApiResult<T> { ok: boolean; error?: string; error_code?: string }

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function get<T>(path: string): Promise<T & ApiResult<T>> {
  try {
    const resp = await fetch(path, { headers: await authHeaders() });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) return { ok: false, error: json.error ?? `Request failed (${resp.status})`, error_code: json.error_code, ...json };
    return { ok: true, ...json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' } as T & ApiResult<T>;
  }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T & ApiResult<T>> {
  try {
    const resp = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.ok) return { ok: false, error: json.error ?? `Request failed (${resp.status})`, error_code: json.error_code, ...json };
    return { ok: true, ...json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' } as T & ApiResult<T>;
  }
}

function qs(filters: AdminBatchFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function fetchAdminBatches(filters: AdminBatchFilters = {}) {
  return get<{ batches: AdminBatchListRow[]; config: { maxVolume: number; maxStops: number; delayThresholdMinutes: number } }>(
    `/api/admin/batches${qs(filters)}`,
  );
}

export function fetchAdminBatchDetail(batchId: string) {
  return get<{ batch: AdminBatchDetail; shipments: AdminShipmentDetail[]; audit_log: AuditLogEntry[] }>(`/api/admin/batches/${batchId}`);
}

export function fetchBreakdownCases() {
  return get<{ cases: BreakdownCase[] }>('/api/admin/batches/breakdowns');
}

export function removeShipments(batchId: string, params: {
  shipment_ids: string[]; reason_code: BatchAdminReasonCode; reason: string; notes?: string;
}) {
  return post<{ removed_volume: number; batch_emptied: boolean }>(`/api/admin/batches/${batchId}/remove-shipments`, params);
}

export function updateEstimatedTime(batchId: string, params: { expected_completion_at: string; reason: string }) {
  return post<Record<string, never>>(`/api/admin/batches/${batchId}/update-estimated-time`, params);
}

export function addBatchNote(batchId: string, params: { note: string; under_monitoring?: boolean; manual_intervention?: boolean; driver_contacted?: boolean }) {
  return post<Record<string, never>>(`/api/admin/batches/${batchId}/add-note`, params);
}

export function changeDriver(batchId: string, params: {
  courier_id: string; reason_code: BatchAdminReasonCode; reason: string; notes?: string; confirm_departed?: boolean;
}) {
  return post<Record<string, never>>(`/api/admin/batches/${batchId}/change-driver`, params);
}

export function fetchRedistributionPlan(batchId: string) {
  return get<{ groups: RedistributionGroup[] }>(`/api/admin/batches/${batchId}/redistribution-plan`);
}

export function redistributeShipments(batchId: string, params: {
  reason_code: BatchAdminReasonCode; reason: string; notes?: string;
  moves: { shipment_ids: string[]; destination_batch_id: string }[];
  new_batches: { shipment_ids: string[] }[];
}) {
  return post<{ results: RedistributeOperationResult[] }>(`/api/admin/batches/${batchId}/redistribute`, params);
}

export function resolveBreakdown(batchId: string, params: {
  resolution: 'shipments_repooled' | 'manual_intervention_pending' | 'returned_to_warehouse' | 'follow_up_required';
  note: string;
  stranded_dispositions?: { shipment_id: string; disposition: 'returned_to_warehouse' | 'still_with_driver' }[];
}) {
  return post<{ returned_count: number; still_stranded: number }>(`/api/admin/batches/${batchId}/resolve-breakdown`, params);
}
