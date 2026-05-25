import { supabase } from '../supabase.js';
import { Coordinates } from './types.js';

// Reads the courier's live GPS location from couriers.location via the batch
export async function getCourierLocation(batchId: string): Promise<Coordinates | null> {
  const { data } = await supabase
    .from('batches')
    .select('couriers!assigned_to(location)')
    .eq('id', batchId)
    .single();
  const loc = (data as any)?.couriers?.location;
  if (!loc?.lat || !loc?.lng) return null;
  return { lat: loc.lat as number, lng: loc.lng as number };
}

// Derives a zone's coordinates by averaging the pickup coords of its shipments
export async function getZoneCoords(zone: string): Promise<Coordinates | null> {
  const { data } = await supabase
    .from('shipments')
    .select('pickup_lat, pickup_lng')
    .eq('pickup_zone', zone)
    .limit(50);
  if (!data?.length) return null;
  const lat = data.reduce((s, r) => s + (r.pickup_lat as number), 0) / data.length;
  const lng = data.reduce((s, r) => s + (r.pickup_lng as number), 0) / data.length;
  return { lat, lng };
}
