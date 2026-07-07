-- Human-readable display number for orders, mirroring add_batch_shipment_numbers.sql.
--
-- Why: orders.id is a plain integer, and every page that shows it invented its
-- own ad-hoc formatting (ORD-066 in the merchant dashboard, #SQ-00066 on the
-- customer tracking page, #66 on the customer order-history page) — three
-- different labels for the same order. This column gives every page the same
-- string to render, the same way batch_number/shipment_number already do.
--
-- Format: O-100000, O-100001, … (6 digits, monotonic). Backed by a Postgres
-- sequence so numbering is automatic on INSERT (via the column DEFAULT).
-- orders.id stays the real primary key and every foreign key / API route is
-- untouched — this column exists purely for display. The orders insert in
-- server/routes/ordersRouter.ts omits the column, so the DEFAULT fills it in.

create sequence if not exists order_number_seq start 100000;

alter table public.orders
  add column if not exists order_number text;

-- Backfill existing rows in creation order so the oldest order becomes O-100000.
update public.orders o
set order_number = 'O-' || (99999 + x.rn)::text
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.orders
  where order_number is null
) x
where o.id = x.id;

-- Advance the sequence past the highest number already handed out so the next
-- INSERT can't collide with a backfilled row.
select setval(
  'order_number_seq',
  coalesce((select max(split_part(order_number, '-', 2)::int) from public.orders), 99999) + 1,
  false
);

-- New rows auto-number from the sequence.
alter table public.orders
  alter column order_number set default 'O-' || nextval('order_number_seq')::text;

alter table public.orders
  alter column order_number set not null;

create unique index if not exists orders_order_number_key
  on public.orders (order_number);
