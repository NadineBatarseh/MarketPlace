-- Orders — persist the destination shipping address on each order.
--
-- Previously the checkout address was only handed to PayTabs at payment time and
-- never stored, so order history / tracking / delivery had no record of WHERE an
-- order ships. This adds a single JSONB snapshot column (vs. ~8 nullable columns)
-- capturing the full destination at the moment the order is placed.
--
-- Snapshot semantics: this is a COPY frozen at purchase time. It is intentionally
-- independent of later edits to customer_profiles — a past order must always show
-- the address it was actually shipped to.
--
-- Shape: { firstName, lastName, phone, email, address, apartment, city, postalCode }
--
-- Written server-side (service role) by server/routes/ordersRouter.ts. Orders
-- placed before this migration simply have shipping_address = NULL, which the UI
-- renders as "no address on file".

alter table public.orders
  add column if not exists shipping_address jsonb;
