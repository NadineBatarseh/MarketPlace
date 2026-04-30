import supabase from '../../supabase';
import { Batch } from '../types';

interface CloseBatchParams {
  id: string;
  route: string[];
  ab_shipment_ids: string[];
  bc_shipment_ids: string[];
  total_volume: number;
  reserved_until: string | null;
}

// Phase 6 — Persist the batch record and mark it PENDING_ASSIGNMENT.
// All shipments have already been claimed atomically in Phase 5.
export async function closeBatch(params: CloseBatchParams): Promise<Batch | null> {
  const now = new Date().toISOString();

  const record = {
    id: params.id,
    route: params.route,
    ab_shipment_ids: params.ab_shipment_ids,
    bc_shipment_ids: params.bc_shipment_ids,
    status: 'pending_assignment',
    total_volume: params.total_volume,
    reserved_until: params.reserved_until,
    created_at: now,
  };

  const { data, error } = await supabase
    .from('batches')
    .insert(record)
    .select()
    .single();

  if (error) {
    console.error('[Phase 6] closeBatch error:', error.message);
    return null;
  }

  console.log(
    `[Phase 6] Batch ${params.id} closed — route: ${params.route.join(' → ')}`
  );

  return data as Batch;
}
