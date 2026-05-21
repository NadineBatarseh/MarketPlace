-- Track when a driver starts a batch mission
ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Track per-shipment pickup and delivery moments
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS picked_up_at  timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at  timestamptz;
