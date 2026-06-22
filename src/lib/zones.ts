import supabase from './supabase';

/**
 * Delivery zones (bounding boxes). Used to populate the checkout / address-book
 * zone dropdown and to give the customer instant feedback when their map pin
 * falls outside the chosen zone (the server re-validates authoritatively).
 */
export interface Zone {
  id: string;
  name: string;
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}

const ZONE_COLS = 'id, name, min_lat, max_lat, min_lng, max_lng';

/** Fetch all zones, ordered by name, for a select dropdown. */
export async function fetchZones(): Promise<Zone[]> {
  const { data, error } = await supabase.from('zones').select(ZONE_COLS).order('name');
  if (error) throw new Error(error.message);
  return (data as Zone[]) ?? [];
}

/** True when (lat,lng) is inside the zone's bounding box (inclusive). */
export function pointInZone(z: Zone, lat: number, lng: number): boolean {
  return lat >= z.min_lat && lat <= z.max_lat && lng >= z.min_lng && lng <= z.max_lng;
}

/** Geometric centre of a zone box — handy for centring the map on zone select. */
export function zoneCenter(z: Zone): { lat: number; lng: number } {
  return { lat: (z.min_lat + z.max_lat) / 2, lng: (z.min_lng + z.max_lng) / 2 };
}
