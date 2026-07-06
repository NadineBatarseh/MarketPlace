-- Meta Catalog synchronization preferences (Store Settings → Integrations → Meta Catalog).
--
-- These columns are preferences only — nothing in this migration or the
-- accompanying API route runs automatic sync/publish. inbound_sync_mode /
-- outbound_sync_mode just record what the merchant wants once an automatic
-- sync engine ships in a later phase.

alter table meta_catalog_connections
  add column if not exists inbound_sync_mode        text not null default 'one_time',
  add column if not exists outbound_sync_mode        text not null default 'disabled',
  add column if not exists auto_import_new_products  boolean not null default false,
  add column if not exists auto_export_new_products  boolean not null default false,
  add column if not exists settings_updated_at       timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meta_catalog_connections_inbound_sync_mode_check'
  ) then
    alter table meta_catalog_connections
      add constraint meta_catalog_connections_inbound_sync_mode_check
      check (inbound_sync_mode in ('one_time', 'manual', 'automatic'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'meta_catalog_connections_outbound_sync_mode_check'
  ) then
    alter table meta_catalog_connections
      add constraint meta_catalog_connections_outbound_sync_mode_check
      check (outbound_sync_mode in ('disabled', 'manual', 'automatic'));
  end if;
end $$;
