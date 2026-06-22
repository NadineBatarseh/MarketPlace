import { supabase } from '../supabase.js';

/**
 * Zone helpers — delivery zones are stored as axis-aligned bounding boxes
 * (zones: id, name, min_lat, max_lat, min_lng, max_lng). There is no polygon /
 * PostGIS geometry, so "is this point inside the zone" is a simple box test.
 *
 * The shipments table also has a BEFORE-INSERT trigger that derives
 * pickup_zone / dropoff_zone from the supplied coordinates against these same
 * boxes (and rejects coordinates that fall outside every zone). We mirror that
 * box logic here so the server can validate the customer's pick BEFORE insert and
 * return a clear message instead of a raw NOT-NULL violation.
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

/** True when (lat,lng) falls inside the zone's bounding box (inclusive). */
export function pointInZone(z: Zone, lat: number, lng: number): boolean {
  return (
    lat >= z.min_lat && lat <= z.max_lat &&
    lng >= z.min_lng && lng <= z.max_lng
  );
}

/** Geometric centre of a zone box — used as a pickup fallback for shops with no pin. */
export function zoneCenter(z: Zone): { lat: number; lng: number } {
  return { lat: (z.min_lat + z.max_lat) / 2, lng: (z.min_lng + z.max_lng) / 2 };
}

export async function fetchZoneById(id: string): Promise<Zone | null> {
  const { data } = await supabase.from('zones').select(ZONE_COLS).eq('id', id).maybeSingle();
  return (data as Zone) ?? null;
}

export async function fetchAllZones(): Promise<Zone[]> {
  const { data } = await supabase.from('zones').select(ZONE_COLS);
  return (data as Zone[]) ?? [];
}
