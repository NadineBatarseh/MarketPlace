-- Fix "new row violates row-level security policy for table products" when a
-- merchant adds a product from the merchant dashboard (client-side insert,
-- subject to RLS — unlike the service-role create_product MCP tool, which
-- bypasses RLS and already works fine).
--
-- Allows an authenticated merchant to INSERT a product row only into a shop
-- they own (merchants.user_id = auth.uid() -> shops.merchant_id -> shops.shop_id).

drop policy if exists "Merchants can insert their own products" on public.products;

create policy "Merchants can insert their own products"
on public.products
for insert
to authenticated
with check (
  shop_id in (
    select s.shop_id
    from public.shops s
    join public.merchants m on m.id = s.merchant_id
    where m.user_id = auth.uid()
  )
);
