-- Audit log for instagram_publish_product's auto flow (productId-only publishing
-- via the global INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_IG_USER_ID account).
-- Distinct from products.instagram_published_media_id/instagram_published_at,
-- which only track the most recent publish — this keeps full history, including
-- failed attempts.

create table if not exists instagram_publish_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  shop_id uuid,
  caption text not null,
  image_url text,
  media_id text,
  status text not null check (status in ('published', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_instagram_publish_logs_product_id on instagram_publish_logs (product_id);
create index if not exists idx_instagram_publish_logs_shop_id on instagram_publish_logs (shop_id);
