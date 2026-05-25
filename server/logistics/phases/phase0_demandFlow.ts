import { supabase } from '../../supabase.js';
import { DemandFlow } from '../types.js';

// Phase 0 â€” Demand Flow Extraction
// Groups all available + delayed shipments by pickup_zone â†’ dropoff_zone direction.
// No flow is rejected at this stage â€” even a single-shipment flow is returned.
// Low-count decisions are handled later in Phase 0b using MIN_BATCH_THRESHOLD,
// urgency override, and max waiting time rules.
export async function extractDemandFlows(): Promise<DemandFlow[]> {
  // Supabase does not support GROUP BY directly via the JS client,
  // so we use a raw RPC call to a PostgreSQL function.
  const { data, error } = await supabase.rpc('extract_demand_flows');

  if (error) {
    console.error('[Phase 0] extractDemandFlows error:', error.message);
    return [];
  }

  return (data as DemandFlow[]) ?? [];
}

// â”€â”€ SQL function to create in Supabase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// CREATE OR REPLACE FUNCTION extract_demand_flows()
// RETURNS TABLE (
//   origin              TEXT,
//   destination         TEXT,
//   shipment_count      BIGINT,
//   total_volume        NUMERIC,
//   avg_waiting_hours   NUMERIC,
//   earliest_deadline   TIMESTAMPTZ,
//   origin_lat          NUMERIC,
//   origin_lng          NUMERIC,
//   destination_lat     NUMERIC,
//   destination_lng     NUMERIC
// ) AS $$
// BEGIN
//   RETURN QUERY
//   SELECT
//     s.pickup_zone                                           AS origin,
//     s.dropoff_zone                                          AS destination,
//     COUNT(*)                                                AS shipment_count,
//     SUM(s.volume)                                           AS total_volume,
//     AVG(EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600)  AS avg_waiting_hours,
//     MIN(s.deadline)                                         AS earliest_deadline,
//     AVG(s.pickup_lat)                                       AS origin_lat,
//     AVG(s.pickup_lng)                                       AS origin_lng,
//     AVG(s.dropoff_lat)                                      AS destination_lat,
//     AVG(s.dropoff_lng)                                      AS destination_lng
//   FROM shipments s
//   WHERE s.status IN ('available', 'delayed')
//   GROUP BY s.pickup_zone, s.dropoff_zone;
// END;
// $$ LANGUAGE plpgsql;