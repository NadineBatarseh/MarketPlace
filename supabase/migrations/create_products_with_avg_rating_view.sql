-- Powers the home page "top rated products" rail (HomePage.tsx) and
-- /api/stores/:id/products?sort=rating (server/index.ts). Without this view
-- those queries 404 (PostgREST: relation not found).
--
-- avg_rating/review_count are computed from the "Reviews" table (per-product
-- star ratings) — distinct from shop_ratings, which is a separately
-- maintained per-shop aggregate.

create or replace view public.products_with_avg_rating as
select
  p.*,
  coalesce(r.avg_rating, 0)::numeric as avg_rating,
  coalesce(r.review_count, 0) as review_count
from public.products p
left join (
  select product_id, avg(rating) as avg_rating, count(*) as review_count
  from public."Reviews"
  group by product_id
) r on r.product_id = p.id;

grant select on public.products_with_avg_rating to anon, authenticated;
