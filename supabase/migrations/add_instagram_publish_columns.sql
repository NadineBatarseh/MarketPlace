-- Outbound Instagram publishing: track the last post made from a product

alter table products add column if not exists instagram_published_media_id text;
alter table products add column if not exists instagram_published_at timestamptz;
