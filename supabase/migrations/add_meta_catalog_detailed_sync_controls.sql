-- Meta Catalog: independent, per-direction synchronization controls.
--
-- Replaces the single generic inbound_sync_mode / outbound_sync_mode dial
-- (from add_meta_catalog_sync_settings.sql) with four independent switches —
-- "import new", "sync updates" for each direction — plus a per-field map so
-- the merchant can choose exactly which attributes are allowed to flow.
--
-- All of this is preference/persistence only. No automatic sync engine reads
-- these columns yet — see metaCatalogConnectRouter.ts.
--
-- auto_import_new_products / auto_export_new_products already exist from the
-- prior migration; "add column if not exists" makes re-adding them a no-op
-- so this migration is safe to run regardless of whether that one ran first.

alter table meta_catalog_connections
  add column if not exists auto_import_new_products             boolean not null default false,
  add column if not exists auto_export_new_products              boolean not null default false,
  add column if not exists auto_sync_meta_updates_to_souqlink    boolean not null default false,
  add column if not exists auto_sync_souqlink_updates_to_meta    boolean not null default false,
  add column if not exists inbound_sync_fields  jsonb not null default '{"price":true,"quantity":true,"availability":true,"details":false,"images":false}'::jsonb,
  add column if not exists outbound_sync_fields jsonb not null default '{"price":true,"quantity":true,"availability":true,"details":false,"images":false}'::jsonb,
  add column if not exists settings_updated_at  timestamptz;
