-- Remove stale courier_current_zone from batches.
-- Zone proximity is now computed live from couriers.location (GPS updated every 15s).
ALTER TABLE public.batches DROP COLUMN IF EXISTS courier_current_zone;
