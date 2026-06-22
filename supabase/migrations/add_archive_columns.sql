-- Archive System — add standard archive columns to archivable tables.
--
-- Convention (see docs / plan):
--   is_archived    boolean NOT NULL DEFAULT false  -- the query predicate
--   archived_at    timestamptz NULL                -- audit / sort / future auto-purge
--   archived_by    uuid NULL                       -- which admin performed it
--   archive_reason text NULL                        -- optional, shown in confirm modal
--
-- Archive is ADMIN-initiated, recoverable, and audit-tracked. It is distinct from:
--   * products.is_deleted  — MERCHANT-initiated soft delete, entangled with Meta sync (kept as-is).
--   * shops.status         — reversible suspend/deactivate (kept as-is).
-- Storefront queries must exclude BOTH is_deleted AND is_archived.

-- shops ---------------------------------------------------------------
alter table public.shops
  add column if not exists is_archived    boolean      not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    uuid,
  add column if not exists archive_reason text;

create index if not exists shops_is_archived_idx
  on public.shops (is_archived) where is_archived;

-- couriers ------------------------------------------------------------
alter table public.couriers
  add column if not exists is_archived    boolean      not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    uuid,
  add column if not exists archive_reason text;

create index if not exists couriers_is_archived_idx
  on public.couriers (is_archived) where is_archived;

-- products (admin archive; coexists with merchant is_deleted) ---------
alter table public.products
  add column if not exists is_archived    boolean      not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    uuid,
  add column if not exists archive_reason text;

create index if not exists products_is_archived_idx
  on public.products (is_archived) where is_archived;

-- merchant_applications ----------------------------------------------
alter table public.merchant_applications
  add column if not exists is_archived    boolean      not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    uuid,
  add column if not exists archive_reason text;

create index if not exists merchant_applications_is_archived_idx
  on public.merchant_applications (is_archived) where is_archived;

-- delivery_applications ----------------------------------------------
alter table public.delivery_applications
  add column if not exists is_archived    boolean      not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    uuid,
  add column if not exists archive_reason text;

create index if not exists delivery_applications_is_archived_idx
  on public.delivery_applications (is_archived) where is_archived;

-- hubworker_applications ---------------------------------------------
alter table public.hubworker_applications
  add column if not exists is_archived    boolean      not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    uuid,
  add column if not exists archive_reason text;

create index if not exists hubworker_applications_is_archived_idx
  on public.hubworker_applications (is_archived) where is_archived;

-- ACTION REQUIRED (manual): the `products_with_avg_rating` view (used by the
-- homepage showcase) snapshots its column list at creation time, so it neither
-- exposes the new is_archived column nor auto-excludes archived/soft-deleted
-- rows. Recreate it to filter them out, e.g.:
--   create or replace view public.products_with_avg_rating as
--     select ... from public.products p
--     where coalesce(p.is_deleted,false) = false
--       and coalesce(p.is_archived,false) = false
--       ...
-- (the client query in HomePage.tsx cannot filter these because the view does
--  not select them.)
