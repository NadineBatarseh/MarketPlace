import supabase from '../../supabase';
import { C } from '../constants';
import { Shipment } from '../types';

// Phase 3 — Read Zone A→B shipments (no lock, no status change)
// Only reads the batch's shipments to compute remaining courier capacity.
// D15: remaining_capacity = MAX_VOLUME - Σvolume_i
export async function readBatchShipments(
  shipmentIds: string[]
): Promise<Shipment[]> {
  if (shipmentIds.length === 0) return [];

  const { data, error } = await supabase
    .from('shipments')
    .select('*, order_details(qty, products(capacity_units))')
    .in('id', shipmentIds)
    .in('status', ['available', 'delayed']);

  if (error) {
    console.error('[Phase 3] readBatchShipments error:', error.message);
    return [];
  }

  return ((data as any[]) ?? []).map(row => ({
    ...row,
    volume: (row.order_details?.qty ?? 0) * (row.order_details?.products?.capacity_units ?? 0),
  })) as Shipment[];
}

// ── D15 ───────────────────────────────────────────────────────────────────────
// remaining_capacity = MAX_VOLUME - Σvolume_i
export function computeRemainingCapacity(shipments: Shipment[]): number {
  const used = shipments.reduce((sum, s) => sum + s.volume, 0);
  return C.MAX_VOLUME - used;
}