-- Phase 1: Meta Catalog connection + one-time import support

-- OAuth CSRF state, mirrors instagram_oauth_states
create table if not exists meta_oauth_states (
  state_token text primary key,
  sb_auth_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- One row per merchant user, mirrors instagram_connections
create table if not exists meta_catalog_connections (
  user_id uuid primary key references auth.users(id),
  access_token text not null,
  business_id text,
  business_name text,
  catalog_id text,
  catalog_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Source attribution on products (nullable, backfilled)
alter table products add column if not exists product_source text default 'manual';
alter table products add column if not exists meta_imported_at timestamptz;
update products set product_source = 'instagram' where instagram_post_id is not null and product_source = 'manual';

create index if not exists idx_products_shop_meta_product_id on products (shop_id, meta_product_id);
