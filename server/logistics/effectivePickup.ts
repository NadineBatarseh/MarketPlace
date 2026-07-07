// Resolves the *real-world* pickup point of a batch's shipments for the
// "Redistribute Shipments" admin feature (server/routes/adminBatchesRouter.ts).
//
// A shipment not yet collected still sits at the store — its pickup_lat/lng/
// zone columns are accurate as-is. But once a driver has physically picked it
// up ('picked_up') or it was stranded mid-route ('stranded'), the store is no
// longer where a replacement courier needs to go — they need to go to the
// driver's last known location (live GPS for 'picked_up', the captured
// breakdown_location for 'stranded', which is more reliable since that
// courier may since have gone offline/been reassigned).

import { supabase } from '../supabase.js';
import { getCourierLocation } from './locationUtils.js';
import { fetchAllZones, pointInZone, zoneCenter, type Zone } from '../lib/zones.js';
import { haversineDistance } from './formulas.js';
import { Coordinates, ShipmentStatus } from './types.js';

export type PickupSource = 'store' | 'driver' | 'breakdown' | 'unknown';

export interface EffectivePickup {
  shipment_id: string;
  source: PickupSource;
  lat: number | null;
  lng: number | null;
  zone: string | null;
  location_available: boolean;
}

interface SourceBatch {
  id: string;
  assigned_to: string | null;
  breakdown_location: Coordinates | null;
}

interface SourceShipment {
  id: string;
  status: ShipmentStatus;
  pickup_lat: number;
  pickup_lng: number;
  pickup_zone: string;
}

// Finds the zone whose bounding box contains the point; falls back to the
// nearest zone centre when the point falls outside every box (e.g. a driver
// stopped on a highway between zones).
function resolveZoneForPoint(lat: number, lng: number, zones: Zone[]): string | null {
  const inside = zones.find(z => pointInZone(z, lat, lng));
  if (inside) return inside.name;
  if (!zones.length) return null;
  let nearest: Zone = zones[0];
  let nearestDistance = Infinity;
  for (const z of zones) {
    const center = zoneCenter(z);
    const distance = haversineDistance(lat, lng, center.lat, center.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = z;
    }
  }
  return nearest.name;
}

export async function resolveEffectivePickup(
  batch: SourceBatch,
  shipments: SourceShipment[]
): Promise<EffectivePickup[]> {
  const needsDriverLocation = shipments.some(s => s.status === 'picked_up');
  const needsBreakdownLocation = shipments.some(s => s.status === 'stranded');
  const needsZoneLookup = needsDriverLocation || needsBreakdownLocation;

  const [driverLoc, zones] = await Promise.all([
    needsDriverLocation ? getCourierLocation(batch.id) : Promise.resolve(null),
    needsZoneLookup ? fetchAllZones() : Promise.resolve<Zone[]>([]),
  ]);
  const breakdownLoc = needsBreakdownLocation ? batch.breakdown_location : null;

  return shipments.map((s): EffectivePickup => {
    if (s.status === 'batched' || s.status === 'reserved') {
      return { shipment_id: s.id, source: 'store', lat: s.pickup_lat, lng: s.pickup_lng, zone: s.pickup_zone, location_available: true };
    }
    if (s.status === 'picked_up') {
      if (!driverLoc) return { shipment_id: s.id, source: 'unknown', lat: null, lng: null, zone: null, location_available: false };
      return {
        shipment_id: s.id, source: 'driver', lat: driverLoc.lat, lng: driverLoc.lng,
        zone: resolveZoneForPoint(driverLoc.lat, driverLoc.lng, zones), location_available: true,
      };
    }
    if (s.status === 'stranded') {
      if (!breakdownLoc) return { shipment_id: s.id, source: 'unknown', lat: null, lng: null, zone: null, location_available: false };
      return {
        shipment_id: s.id, source: 'breakdown', lat: breakdownLoc.lat, lng: breakdownLoc.lng,
        zone: resolveZoneForPoint(breakdownLoc.lat, breakdownLoc.lng, zones), location_available: true,
      };
    }
    return { shipment_id: s.id, source: 'unknown', lat: null, lng: null, zone: null, location_available: false };
  });
}

// Fetches the batch fields resolveEffectivePickup needs, keeping the shape
// consistent for callers that already have most of a `batches` row.
export async function fetchSourceBatch(batchId: string): Promise<SourceBatch | null> {
  const { data } = await supabase
    .from('batches')
    .select('id, assigned_to, breakdown_location')
    .eq('id', batchId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, assigned_to: data.assigned_to, breakdown_location: (data.breakdown_location as Coordinates) ?? null };
}
