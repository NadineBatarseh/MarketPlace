-- Human-readable display numbers for batches and shipments.
--
-- Why: the dashboards used to show a truncated slice of the UUID primary key
-- (e.g. #A567E02B). Those slices were inconsistent between views (the driver
-- dashboard sliced the LAST 8 chars, the admin monitor the FIRST 8 — so the same
-- batch looked like two different IDs), carried a small collision risk, and meant
-- nothing to a human reading one out to support. The UUID `id` stays the real
-- primary key and every foreign key / API route is untouched — these columns
-- exist purely for display.
--
-- Format: B-100000, B-100001, … / S-100000, S-100001, … (6 digits, monotonic).
-- Backed by a Postgres sequence so numbering is automatic on INSERT (via the
-- column DEFAULT) and gap-tolerant. No application insert site needs to change:
-- batchCycle's claim RPC and createShipmentsForOrder both omit the column, so
-- the DEFAULT fills it in.

-- ── batches.batch_number ────────────────────────────────────────────────────
create sequence if not exists batch_number_seq start 100000;

alter table public.batches
  add column if not exists batch_number text;

-- Backfill existing rows in creation order so the oldest batch becomes B-100000.
update public.batches b
set batch_number = 'B-' || (99999 + o.rn)::text
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.batches
  where batch_number is null
) o
where b.id = o.id;

-- Advance the sequence past the highest number already handed out so the next
-- INSERT can't collide with a backfilled row.
select setval(
  'batch_number_seq',
  coalesce((select max(split_part(batch_number, '-', 2)::int) from public.batches), 99999) + 1,
  false
);

-- New rows auto-number from the sequence.
alter table public.batches
  alter column batch_number set default 'B-' || nextval('batch_number_seq')::text;

alter table public.batches
  alter column batch_number set not null;

create unique index if not exists batches_batch_number_key
  on public.batches (batch_number);

-- ── shipments.shipment_number ───────────────────────────────────────────────
create sequence if not exists shipment_number_seq start 100000;

alter table public.shipments
  add column if not exists shipment_number text;

update public.shipments s
set shipment_number = 'S-' || (99999 + o.rn)::text
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.shipments
  where shipment_number is null
) o
where s.id = o.id;

select setval(
  'shipment_number_seq',
  coalesce((select max(split_part(shipment_number, '-', 2)::int) from public.shipments), 99999) + 1,
  false
);

alter table public.shipments
  alter column shipment_number set default 'S-' || nextval('shipment_number_seq')::text;

alter table public.shipments
  alter column shipment_number set not null;

create unique index if not exists shipments_shipment_number_key
  on public.shipments (shipment_number);
