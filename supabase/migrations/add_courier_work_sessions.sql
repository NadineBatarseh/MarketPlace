-- Driver duty-time and mission-time tracking.
--
-- Two clocks per driver:
--   1. Total Duty Time      — from "Start Work" until "End Work" (courier_work_sessions).
--   2. Active Delivery Time — from "Start Batch" until the batch completes (courier_delivery_sessions).
-- Available Waiting Time = Total Duty Time - Active Delivery Time, computed when a
-- work session closes (and live, on the fly, for the "today" summary endpoint).

-- ── courier_work_sessions ────────────────────────────────────────────────────
-- One row per "Start Work" → "End Work" shift. At most one 'active' row per courier
-- (enforced by the partial unique index below, not just app logic).
create table if not exists public.courier_work_sessions (
  id                        uuid primary key default gen_random_uuid(),
  courier_id                uuid not null references public.couriers(id) on delete cascade,
  started_at                timestamptz not null default now(),
  ended_at                  timestamptz,
  duration_minutes          integer,
  active_delivery_minutes   integer,
  available_waiting_minutes integer,
  status                    text not null default 'active'
                              check (status in ('active', 'completed')),
  end_reason                text
                              check (end_reason in ('manual', 'breakdown', 'admin_closed', 'auto_closed')),
  created_at                timestamptz not null default now()
);

create index if not exists courier_work_sessions_courier_idx
  on public.courier_work_sessions (courier_id, status);

-- A courier can only have one open shift at a time.
create unique index if not exists courier_work_sessions_one_active_per_courier
  on public.courier_work_sessions (courier_id)
  where status = 'active';

-- ── courier_delivery_sessions ────────────────────────────────────────────────
-- One row per "Start Batch" → batch-completed window, linked back to the work
-- session it happened inside of (a batch is always started while on duty).
create table if not exists public.courier_delivery_sessions (
  id              uuid primary key default gen_random_uuid(),
  courier_id      uuid not null references public.couriers(id) on delete cascade,
  batch_id        uuid not null references public.batches(id) on delete cascade,
  work_session_id uuid references public.courier_work_sessions(id) on delete set null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  duration_minutes integer,
  status          text not null default 'active'
                    check (status in ('active', 'completed', 'cancelled')),
  created_at      timestamptz not null default now()
);

create index if not exists courier_delivery_sessions_courier_idx
  on public.courier_delivery_sessions (courier_id, status);

create index if not exists courier_delivery_sessions_work_session_idx
  on public.courier_delivery_sessions (work_session_id);

-- A courier can only have one open delivery session at a time (mirrors the
-- "one active batch per driver" invariant in driverAssignment.ts).
create unique index if not exists courier_delivery_sessions_one_active_per_courier
  on public.courier_delivery_sessions (courier_id)
  where status = 'active';
